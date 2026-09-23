'use client';

/**
 * 3D inspection studio (SRS §6.3, FR-5.2, FR-8.1).
 *
 * The model is fetched from `/ipfs/<cid>` — the nginx-cached gateway route (FR-8.3) — never from the
 * IPFS node directly, so a repeat preview comes from cache.
 *
 * Why this is a studio and not a spinning picture
 * ----------------------------------------------
 * The person licensing a 3D asset is a 3D artist, and they do not judge a file by how it looks under
 * one light. They want to know whether the topology is clean, whether the normals face outward,
 * whether the UVs are unfolded or a collapsed mess, what the true dimensions are, how many materials
 * and texture maps they are taking on, and whether it animates. Every one of those questions is
 * answerable from the file we are already serving, so the viewer answers them:
 *
 *   - **Shading modes.** Shaded, shaded-with-edges, wireframe, normals, UVs, matcap and unlit each
 *     expose a different failure.
 *   - **Helpers.** Grid, origin axes, bounds, ground shadow and a light/dark stage, because a dark
 *     model on a dark stage is a silhouette.
 *   - **Camera.** Seven standard viewpoints, an orthographic option for checking real proportions
 *     without perspective foreshortening, turntable, and re-frame.
 *   - **Inventory.** Triangle and vertex counts, extent in model units, and the material list with
 *     colour swatches, metalness/roughness and whether each one is textured.
 *   - **Animation.** If the GLB carries clips, they can be selected, scrubbed and speed-adjusted.
 *
 * It also keeps its integrity readout: the triangle count the *record* claims, against the one the
 * browser decoded from the bytes in the gateway. Those are different claims and the difference is
 * the point.
 */
import {
  ContactShadows,
  Grid,
  OrbitControls,
  OrthographicCamera,
  useAnimations,
  useGLTF,
  useProgress,
} from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  EMPTY_SUMMARY,
  comparePolycount,
  formatCount,
  measureScene,
  summariseScene,
  type DecodedGeometry,
  type SceneSummary,
} from '@/lib/geometry';
import { shortCid } from '@/lib/format';

/** Kinds of model the browser can render natively. */
const NATIVE_FORMATS = new Set(['glb', 'gltf']);

export function canPreviewNatively(format: string): boolean {
  return NATIVE_FORMATS.has(format.toLowerCase().replace(/^\.+/, ''));
}

/** How the surface is drawn. Each one answers a different question about the file. */
export type ShadeMode = 'shaded' | 'edges' | 'wireframe' | 'normals' | 'uv' | 'matcap' | 'unlit';

interface ModeSpec {
  readonly id: ShadeMode;
  readonly label: string;
  /** Keyboard shortcut, shown on the button so the tool is learnable. */
  readonly key: string;
  readonly hint: string;
}

const SHADE_MODES: readonly ModeSpec[] = [
  {
    id: 'shaded',
    label: 'Shaded',
    key: '1',
    hint: 'Lit surface, as the texture author intended it',
  },
  {
    id: 'edges',
    label: 'Edges',
    key: '2',
    hint: 'Shaded surface with the triangulation drawn over it',
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    key: '3',
    hint: 'Topology only — the fastest way to spot n-gons and stray triangles',
  },
  {
    id: 'normals',
    label: 'Normals',
    key: '4',
    hint: 'Surface direction as colour. Inverted or flipped faces show as banding',
  },
  {
    id: 'uv',
    label: 'UV',
    key: '5',
    hint: 'A checker laid out over the UVs. Stretching and overlaps are visible immediately',
  },
  {
    id: 'matcap',
    label: 'MatCap',
    key: '6',
    hint: 'Neutral lit sphere, so form reads without the asset\u2019s own textures',
  },
  {
    id: 'unlit',
    label: 'Unlit',
    key: '7',
    hint: 'Albedo only, no lighting — catches baked-in shading in the texture',
  },
] as const;

/** Standard viewpoints. `iso` is the three-quarter view a thumbnail should use. */
export type CameraView = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const VIEW_DIRECTIONS: Record<CameraView, readonly [number, number, number]> = {
  iso: [0.55, 0.37, 0.74],
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
};

/**
 * All six orthographic viewpoints plus the three-quarter hero view.
 *
 * A modeller inspecting their own export expects to be able to look at the model from every
 * axis — "front and right" is not enough to check a symmetric part, and a bottom view is the
 * only way to see whether a base has been hollowed out.
 */
const VIEW_BUTTONS: readonly { id: CameraView; label: string; key: string }[] = [
  { id: 'iso', label: 'Isometric', key: '0' },
  { id: 'front', label: 'Front', key: 'F' },
  { id: 'back', label: 'Back', key: 'B' },
  { id: 'left', label: 'Left', key: 'L' },
  { id: 'right', label: 'Right', key: 'R' },
  { id: 'top', label: 'Top', key: 'T' },
  { id: 'bottom', label: 'Bottom', key: 'D' },
];

/**
 * Overlays are capped by triangle budget, not by hope.
 *
 * Drawing every edge of a 247k-triangle scan means about 1.5 million line segments built on the main
 * thread; the tab stops responding. Below the budget the overlay is offered, above it the control is
 * disabled and says why. Silently rendering a two-second freeze would be worse than the missing
 * feature.
 */
const EDGE_TRIANGLE_BUDGET = 150_000;

/** Backgrounds. A dark asset on a dark stage needs the light option. */
type Backdrop = 'stage' | 'night' | 'paper';

const BACKDROPS: Record<Backdrop, string> = {
  stage: 'radial-gradient(120% 90% at 50% 0%, #1e1e24 0%, #131317 52%, #0c0c0f 100%)',
  night: '#0a0a0c',
  paper: 'radial-gradient(120% 90% at 50% 0%, #f4f4f6 0%, #dcdce1 60%, #c9c9d0 100%)',
};

const BACKDROP_LABEL: Record<Backdrop, string> = { stage: 'Stage', night: 'Dark', paper: 'Light' };

/* ============================================================================================
 * Procedural textures
 *
 * The UV-checker and the matcap are drawn into a canvas at runtime rather than shipped as image
 * files and rather than fetched from a CDN. Two reasons: a few hundred bytes of code beats two
 * binary assets in the bundle, and a viewer that needs the network to draw its *own UI* is broken on
 * the locked-down networks this platform is deployed into.
 * ========================================================================================== */

let uvTextureCache: THREE.Texture | null = null;
let matcapTextureCache: THREE.Texture | null = null;

/**
 * The checker used by the UV mode.
 *
 * Deliberately high-contrast and asymmetric: a red square marks the UV origin, so a flipped or
 * rotated layout is obvious at a glance instead of merely looking "fine".
 */
function getUvTexture(): THREE.Texture {
  if (uvTextureCache) return uvTextureCache;

  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  const cells = 8;
  const cell = size / cells;
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#2f6fd0' : '#eef0f4';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(0, 0, cell, cell);
  ctx.strokeStyle = '#0a0a0c';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  uvTextureCache = new THREE.CanvasTexture(canvas);
  uvTextureCache.colorSpace = THREE.SRGBColorSpace;
  uvTextureCache.wrapS = THREE.RepeatWrapping;
  uvTextureCache.wrapT = THREE.RepeatWrapping;
  uvTextureCache.anisotropy = 4;
  return uvTextureCache;
}

/** A neutral lit-sphere matcap: bright key at upper-left, dark terminator, cool rim. */
function getMatcapTexture(): THREE.Texture {
  if (matcapTextureCache) return matcapTextureCache;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture();

  const body = ctx.createRadialGradient(
    size * 0.34,
    size * 0.3,
    size * 0.02,
    size * 0.5,
    size * 0.52,
    size * 0.64,
  );
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.3, '#c8ccd6');
  body.addColorStop(0.68, '#585d6c');
  body.addColorStop(1, '#13151a');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  const rim = ctx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.34,
    size * 0.5,
    size * 0.5,
    size * 0.5,
  );
  rim.addColorStop(0, 'rgba(110,168,254,0)');
  rim.addColorStop(0.85, 'rgba(110,168,254,0.16)');
  rim.addColorStop(1, 'rgba(110,168,254,0.5)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  matcapTextureCache = new THREE.CanvasTexture(canvas);
  matcapTextureCache.colorSpace = THREE.SRGBColorSpace;
  return matcapTextureCache;
}

/* ============================================================================================
 * Shading modes
 *
 * The clone made when a scene loads is deep *including its materials*. `Object3D.clone(true)`
 * copies the object graph but shares material instances, so a material edited through one viewer
 * leaks into every other viewer on the page — and into the three.js loader cache for good. An
 * earlier revision of this file mutated wireframe on the clone and claimed it was isolated; it was
 * not. Materials are cloned here, once per load, and every mode change mutates only the clones.
 * ========================================================================================== */

/** The materials owned by one prepared scene: mesh → its private clone(s). */
type MaterialMap = Map<THREE.Mesh, THREE.Material | THREE.Material[]>;

/** Builds the substitute material for an inspection mode. */
function makeOverride(source: THREE.Material, mode: ShadeMode): THREE.Material {
  switch (mode) {
    case 'normals':
      return new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

    case 'uv':
      return new THREE.MeshBasicMaterial({
        map: getUvTexture(),
        side: THREE.DoubleSide,
        toneMapped: false,
      });

    case 'matcap':
      return new THREE.MeshMatcapMaterial({ matcap: getMatcapTexture() });

    case 'unlit': {
      const standard = source as THREE.MeshStandardMaterial;
      return new THREE.MeshBasicMaterial({
        map: standard.map ?? null,
        color: standard.color ? standard.color.clone() : new THREE.Color(0xffffff),
        side: standard.side,
        transparent: standard.transparent,
        toneMapped: false,
      });
    }

    default:
      return source;
  }
}

const LIT_MODES = new Set<ShadeMode>(['shaded', 'edges', 'wireframe']);

/**
 * Applies a mode to every mesh in a prepared scene.
 *
 * `generated` collects the substitute materials so they can be disposed when the mode changes: a
 * 40-material asset toggled ten times would otherwise leave 400 materials on the GPU.
 */
function applyShadeMode(
  root: THREE.Object3D,
  mode: ShadeMode,
  originals: MaterialMap,
  generated: THREE.Material[],
): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;

    const original = originals.get(mesh);
    if (!original) return;

    const list = Array.isArray(original) ? original : [original];

    if (LIT_MODES.has(mode)) {
      for (const material of list) {
        (material as THREE.MeshStandardMaterial).wireframe = mode === 'wireframe';
      }
      mesh.material = original;
      return;
    }

    const substitutes = list.map((material) => {
      const substitute = makeOverride(material, mode);
      if (substitute !== material) generated.push(substitute);
      return substitute;
    });

    mesh.material = Array.isArray(original) ? substitutes : (substitutes[0] as THREE.Material);
  });
}

/**
 * Image-based lighting, generated in-process.
 *
 * `RoomEnvironment` ships inside three.js, so the studio gets real PBR reflections — which is what
 * makes metal read as metal rather than as flat grey — without downloading an HDRI. That matters
 * here: the deployment target is an air-gapped network, and a viewer that silently falls back to no
 * reflections would misrepresent every metal asset in the catalogue.
 */
function StudioEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);

    scene.environment = target.texture;
    scene.environmentIntensity = 0.9;

    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);

  return null;
}

/* ============================================================================================
 * Animation
 * ========================================================================================== */

/** Everything the transport bar needs to drive a loaded clip. */
export interface ClipHandle {
  readonly names: readonly string[];
  readonly actions: Record<string, THREE.AnimationAction | null>;
  readonly durations: Record<string, number>;
  readonly mixer: THREE.AnimationMixer;
}

/* ============================================================================================
 * The model
 * ========================================================================================== */

interface ModelProps {
  readonly url: string;
  readonly mode: ShadeMode;
  readonly onDecoded: (geometry: DecodedGeometry) => void;
  readonly onSummary: (summary: SceneSummary) => void;
  readonly onClips: (clips: ClipHandle | null) => void;
}

function Model({ url, mode, onDecoded, onSummary, onClips }: ModelProps) {
  const { scene, animations } = useGLTF(url);

  /**
   * The scene is cloned for two reasons, and both matter.
   *
   * Materials must be cloned because three.js shares them through `Object3D.clone()`, so any change
   * made for one viewer would silently apply to every other viewer of the same asset. And the clone
   * has to be a `SkeletonUtils` clone, not a plain one: a plain clone of a skinned mesh shares the
   * original skeleton, so playing a clip in the preview would move bones the original still owns.
   */
  const prepared = useMemo(() => {
    const root = SkeletonUtils.clone(scene) as THREE.Object3D;
    const originals: MaterialMap = new Map();

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;

      const cloned = Array.isArray(mesh.material)
        ? mesh.material.map((material) => material.clone())
        : mesh.material.clone();

      mesh.material = cloned;
      originals.set(mesh, cloned);
    });

    return { root, originals };
  }, [scene]);

  const live = useRef<THREE.Material[]>([]);

  useEffect(() => {
    const substitutes: THREE.Material[] = [];
    applyShadeMode(prepared.root, mode, prepared.originals, substitutes);

    // Dispose the *previous* set only after the new set is assigned, so no frame ever draws a
    // material that has already been released.
    const stale = live.current;
    live.current = substitutes;
    for (const material of stale) material.dispose();
  }, [prepared, mode]);

  useEffect(
    () => () => {
      for (const material of live.current) material.dispose();
      live.current = [];
    },
    [],
  );

  // Both measurements come from the object graph, so they are taken once per load rather than per
  // frame. They describe the file, and the file cannot change while it is on screen.
  useEffect(() => {
    onDecoded(measureScene(prepared.root));
    onSummary(summariseScene(prepared.root));
  }, [prepared, onDecoded, onSummary]);

  const { actions, mixer } = useAnimations(animations, prepared.root);

  useEffect(() => {
    if (animations.length === 0) {
      onClips(null);
      return;
    }

    const durations: Record<string, number> = {};
    const byName: Record<string, THREE.AnimationAction | null> = {};

    for (const clip of animations) {
      durations[clip.name] = clip.duration;
      byName[clip.name] = actions[clip.name] ?? null;
    }

    onClips({ names: animations.map((clip) => clip.name), durations, actions: byName, mixer });
  }, [animations, actions, mixer, onClips]);

  return <primitive object={prepared.root} />;
}

/* ============================================================================================
 * Camera
 * ========================================================================================== */

const FALLBACK_VIEW_DIRECTION = new THREE.Vector3(0.55, 0.37, 0.74).normalize();

/** A fit request. `view` is null when the current viewing angle should simply be kept. */
export interface FitRequest {
  readonly n: number;
  readonly view: CameraView | null;
}

/** The slice of OrbitControls the rig drives. Structural, so it needs no ref typing. */
interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * Frames whatever geometry actually loaded, and answers the standard viewpoints.
 *
 * Distance is derived from the object's *projected* extent — its width and height measured in the
 * camera's own basis. Fitting the bounding sphere instead, which is the obvious implementation,
 * frames an elongated subject badly: the whale skeleton is 13 x 38 x 16 units, so its sphere is far
 * larger than the animal and the animal ends up occupying a third of the frame.
 *
 * The subject is also parked on the origin, so the orbit target and the subject coincide for models
 * of any size or offset. Orthographic uses the same extents but converts them to a zoom factor,
 * because an orthographic camera has no field of view to solve against.
 */
function CameraRig({
  target,
  fill,
  request,
  readyKey,
  onFramed,
}: {
  target: React.RefObject<THREE.Group>;
  fill: number;
  request: FitRequest;
  /**
   * Bumped once the geometry has been decoded and measured.
   *
   * Without it the rig fires its first fit against an empty group — the model arrives through
   * <Suspense>, so on mount there is nothing to measure, `Box3.setFromObject` is empty, and the
   * early return leaves the camera at the canvas's initial position *inside* the model. A 38-unit
   * whale skeleton then renders as a white wall. The refit is therefore driven by the same signal
   * that produces the triangle count, because that signal means "the geometry exists now".
   */
  readyKey: number;
  onFramed: (floor: number, box: THREE.Box3) => void;
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as unknown as OrbitLike | null;

  useEffect(() => {
    const object = target.current;
    if (!object) return;

    let cancelled = false;

    // One frame of grace: the model arrives through <Suspense>, so its matrix is not final on the
    // tick this effect runs.
    const handle = requestAnimationFrame(() => {
      if (cancelled) return;

      object.position.set(0, 0, 0);
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;

      const centre = box.getCenter(new THREE.Vector3());
      object.position.copy(centre).multiplyScalar(-1);
      object.updateMatrixWorld(true);

      const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const fillRatio = Math.max(0.3, Math.min(1, fill));

      const direction = new THREE.Vector3();
      if (request.view) {
        direction.fromArray(VIEW_DIRECTIONS[request.view] as unknown as number[]).normalize();
      } else if (camera.position.lengthSq() > 1e-6) {
        direction.copy(camera.position).normalize();
      } else {
        direction.copy(FALLBACK_VIEW_DIRECTION);
      }

      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), direction)
        .normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();

      // Support function: the box's half-extent measured along an arbitrary axis.
      const extentAlong = (axis: THREE.Vector3) =>
        Math.abs(axis.x) * half.x + Math.abs(axis.y) * half.y + Math.abs(axis.z) * half.z;

      if (camera instanceof THREE.OrthographicCamera) {
        const span = Math.max(half.x, half.y, half.z);
        const distance = Math.max(extentAlong(direction) * 3, span * 6, 1);

        camera.position.copy(direction).multiplyScalar(distance);
        camera.lookAt(0, 0, 0);

        // drei sizes the orthographic frustum to the viewport in CSS pixels at zoom 1, so a world
        // extent of 2h occupies 2h * zoom pixels. Solve for the axis that binds first.
        const zoomVertical = (size.height * fillRatio) / Math.max(1e-6, 2 * extentAlong(up));
        const zoomHorizontal = (size.width * fillRatio) / Math.max(1e-6, 2 * extentAlong(right));
        camera.zoom = Math.max(0.001, Math.min(zoomVertical, zoomHorizontal));
        camera.near = 0.01;
        camera.far = distance * 4 + span * 8;
        camera.updateProjectionMatrix();
      } else {
        const perspective = camera as THREE.PerspectiveCamera;
        const aspect = Math.max(0.2, size.width / Math.max(1, size.height));
        const tanVertical = Math.tan((perspective.fov * Math.PI) / 360);
        const tanHorizontal = tanVertical * aspect;

        const distance =
          Math.max(extentAlong(up) / tanVertical, extentAlong(right) / tanHorizontal) / fillRatio;

        perspective.position.copy(direction).multiplyScalar(distance);
        perspective.lookAt(0, 0, 0);
        perspective.near = Math.max(0.001, distance * 0.002);
        perspective.far = distance * 14;
        perspective.updateProjectionMatrix();
      }

      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }

      // The studio positions its ground shadow from this, so it sits under whatever loaded.
      onFramed(-half.y, box);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [target, camera, size, fill, request, readyKey, controls, onFramed]);

  return null;
}

/* ============================================================================================
 * Overlays (DOM, outside <Canvas>)
 *
 * The canvas is a three.js scene graph, not a DOM tree: a <div> or <button> placed inside it is read
 * as a THREE object and throws "Div is not part of the THREE namespace", taking the whole preview
 * down. Every piece of chrome below is therefore a sibling of the canvas, positioned over it.
 * ========================================================================================== */

/**
 * Progress readout shown while the model streams in.
 *
 * Visibility is the hard part, not the percentage. The overlay must appear for a cold 13 MB download
 * and must *not* appear for a model three.js already has in its loader cache — otherwise re-opening a
 * card flashes a progress bar for something already on screen, and a stalled "0%" reads as breakage.
 * So it is shown only once a transfer is genuinely observed in flight, with a short grace period.
 */
function LoadReporter({ onSettled }: { onSettled: () => void }) {
  const { active, progress, loaded, total } = useProgress();
  const [visible, setVisible] = useState(false);
  const sawTransfer = useRef(false);

  useEffect(() => {
    if (active) {
      sawTransfer.current = true;
      setVisible(true);
    }
  }, [active]);

  useEffect(() => {
    if (active) return;

    if (sawTransfer.current) {
      setVisible(false);
      onSettled();
      return;
    }

    const timer = setTimeout(() => {
      setVisible(false);
      onSettled();
    }, 1_200);

    return () => clearTimeout(timer);
  }, [active, onSettled]);

  if (!visible) return null;

  return (
    <div className="studio-loading" role="status" aria-live="polite">
      <div className="vs-data">Decoding model</div>
      <div className="studio-loading-track">
        <i style={{ width: `${Math.max(4, progress)}%` }} />
      </div>
      {total > 0 ? (
        <div className="vs-label">
          {(loaded / 1_048_576).toFixed(1)} of {(total / 1_048_576).toFixed(1)} MB ·{' '}
          {Math.round(progress)}%
        </div>
      ) : null}
    </div>
  );
}

/**
 * Error boundary: a file the viewer cannot decode explains itself instead of blanking the screen.
 *
 * It reports the fault upward as well as rendering it, because the toolbar belongs to the *canvas* —
 * leaving mode switches and view buttons next to a dead canvas invites the user to press controls
 * that cannot do anything.
 */
class ViewerBoundary extends Component<
  {
    children: ReactNode;
    label: string;
    sourceUrl: string | null;
    onFault?: ((message: string) => void) | undefined;
  },
  { failed: boolean; message: string }
> {
  override state = { failed: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : 'unknown error' };
  }

  override componentDidCatch(error: unknown) {
    this.props.onFault?.(error instanceof Error ? error.message : 'unknown error');
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="studio-fault">
        <div className="studio-fault-inner">
          <div className="vs-eyebrow" style={{ color: 'var(--vs-rejected)' }}>
            Preview unavailable
          </div>
          <div className="mk-display mt-2 text-2xl">
            This {this.props.label} could not be drawn here
          </div>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--vs-fg-dim)' }}>
            The asset itself is unaffected — it is pinned, and the licence on record is untouched. The
            geometry is either in a form this viewer cannot decode, or the preview failed to
            initialise.
          </p>
          <code>{this.state.message}</code>
          {this.props.sourceUrl ? (
            <a
              className="vs-btn mt-4 inline-flex"
              href={this.props.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download the raw file
            </a>
          ) : null}
        </div>
      </div>
    );
  }
}

/**
 * Reports the decoded geometry, and whether it agrees with the asset record.
 *
 * Both the arithmetic and the wording live in `@/lib/geometry` so the comparison can be tested
 * without a WebGL context; this is only the presentation of its verdict. The distinction is the
 * point: the record is a claim made at ingest, the decode is what the bytes in the gateway actually
 * contain, and a licence is being sold on the two agreeing.
 */
function DecodeReadout({
  decoded,
  recorded,
}: {
  decoded: DecodedGeometry;
  recorded: number | null;
}) {
  const agreement = comparePolycount(recorded, decoded.triangles);

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span title={`${decoded.meshes} mesh(es), ${formatCount(decoded.vertices)} vertices`}>
        {formatCount(decoded.triangles)} tris decoded
      </span>
      {agreement.status === 'unknown' ? null : (
        <span
          className={agreement.status === 'mismatch' ? 'studio-warn' : 'studio-ok'}
          title={agreement.reason}
        >
          {agreement.status === 'mismatch'
            ? `≠ ${formatCount(recorded ?? 0)} on record`
            : 'matches the record'}
        </span>
      )}
    </span>
  );
}

/** Registers the canvas screenshot function with the toolbar's export button. */
function CaptureBridge({ register }: { register: (capture: (() => string) | null) => void }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    register(() => gl.domElement.toDataURL('image/png'));
    return () => register(null);
  }, [gl, register]);

  return null;
}

/* ============================================================================================
 * Scene helpers
 * ========================================================================================== */

/**
 * Rounds a span to a grid step a person would choose: 1, 2 or 5 times a power of ten.
 *
 * A fixed cell size cannot work across this catalogue — 0.5 units is a dense mat under a 12-triangle
 * cube and invisible under a 38-unit whale skeleton — so the step is derived from the model.
 */
export function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** The measurement rig, drawn under and around whatever loaded. */
function SceneHelpers({
  floor,
  span,
  box,
  showGrid,
  showAxes,
  showBounds,
  showShadow,
  animated,
  night,
}: {
  floor: number;
  span: number;
  box: THREE.Box3 | null;
  showGrid: boolean;
  showAxes: boolean;
  showBounds: boolean;
  showShadow: boolean;
  animated: boolean;
  night: boolean;
}) {
  const cell = niceStep(span / 8);
  const section = cell * 5;

  return (
    <>
      {showGrid ? (
        <Grid
          position={[0, floor, 0]}
          args={[span * 2, span * 2]}
          cellSize={cell}
          cellThickness={0.5}
          cellColor={night ? '#2b2b33' : '#b6b6c0'}
          sectionSize={section}
          sectionThickness={1}
          sectionColor={night ? '#42424e' : '#8e8e9c'}
          fadeDistance={span * 14}
          fadeStrength={1}
          infiniteGrid
        />
      ) : null}

      {/* Origin axes, coloured by axis so orientation is readable at a glance. */}
      {showAxes ? <axesHelper args={[span * 0.9]} /> : null}

      {showBounds && box ? (
        <box3Helper args={[box, new THREE.Color('#6ea8fe')]} />
      ) : null}

      {/*
        The ground shadow is what stops a model reading as a sticker. It is pinned to the model's
        own footprint and only re-rendered while a clip is playing: a 247k-triangle scan re-rendered
        into a shadow map every frame is a cost with nothing to show for it.
      */}
      {showShadow ? (
        <ContactShadows
          position={[0, floor, 0]}
          opacity={night ? 0.62 : 0.38}
          scale={span * 2.2}
          blur={2.6}
          far={span * 1.4}
          resolution={512}
          frames={animated ? Infinity : 1}
        />
      ) : null}
    </>
  );
}

/* ============================================================================================
 * Inventory panel
 * ========================================================================================== */

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="studio-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * What is actually inside the file.
 *
 * Counts come from the decoded scene, not from the ingest record, because the two can disagree and
 * this panel exists to show it. The material list is the part an artist cannot get anywhere else on
 * this page: how many sheets they will have to manage, whether each one carries a texture, and
 * whether the metalness/roughness were authored or left at defaults.
 */
function StatsPanel({
  decoded,
  summary,
  clips,
  ortho,
  onClose,
}: {
  decoded: DecodedGeometry | null;
  summary: SceneSummary;
  clips: ClipHandle | null;
  ortho: boolean;
  onClose: () => void;
}) {
  return (
    <div className="studio-panel">
      <div className="studio-panel-head">
        <span>File inventory</span>
        <button type="button" className="studio-btn" onClick={onClose} aria-label="Hide inventory">
          Hide
        </button>
      </div>

      <div className="studio-panel-body">
        {decoded ? (
          <div className="studio-section">
            <StatRow label="Triangles" value={formatCount(decoded.triangles)} />
            <StatRow label="Vertices" value={formatCount(decoded.vertices)} />
            <StatRow label="Meshes" value={formatCount(decoded.meshes)} />
            <StatRow
              label="Extent"
              value={`${decoded.extent.x.toFixed(1)} × ${decoded.extent.y.toFixed(1)} × ${decoded.extent.z.toFixed(1)}`}
            />
            <StatRow label="Projection" value={ortho ? 'Orthographic' : 'Perspective'} />
          </div>
        ) : (
          <div className="studio-section">
            <StatRow label="Geometry" value="measuring…" />
          </div>
        )}

        <div className="studio-section">
          <StatRow label="Materials" value={formatCount(summary.materials.length)} />
          <StatRow label="Textures" value={formatCount(summary.textures)} />
          {summary.bones > 0 ? (
            <StatRow label="Bones" value={formatCount(summary.bones)} />
          ) : null}
          {summary.emptyNodes > 0 ? (
            <StatRow label="Empty nodes" value={formatCount(summary.emptyNodes)} />
          ) : null}
        </div>

        {summary.materials.length > 0 ? (
          <div className="studio-section">
            {summary.materials.map((material, index) => (
              <div
                className="studio-mat"
                key={`${material.name}-${material.kind}-${index}`}
                title={`${material.kind}${material.textured ? ' · textured' : ' · no texture'}${
                  material.doubleSided ? ' · double-sided' : ''
                }`}
              >
                <span>
                  {material.color ? (
                    <i className="studio-swatch" style={{ background: material.color }} />
                  ) : null}
                  {material.name.length > 0 ? material.name : `Material ${index + 1}`}
                </span>
                <em>
                  {material.kind}
                  {material.textured ? ' · tex' : ''}
                </em>
              </div>
            ))}
          </div>
        ) : null}

        {clips && clips.names.length > 0 ? (
          <div className="studio-section">
            <StatRow label="Animation clips" value={formatCount(clips.names.length)} />
            <div className="mt-1 flex flex-wrap gap-1">
              {clips.names.map((name) => (
                <span className="vs-chip" key={name}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================================================
 * Animation transport
 * ========================================================================================== */

function Transport({
  clips,
  clipName,
  playing,
  time,
  speed,
  onClip,
  onToggle,
  onScrub,
  onSpeed,
}: {
  clips: ClipHandle;
  clipName: string;
  playing: boolean;
  time: number;
  speed: number;
  onClip: (name: string) => void;
  onToggle: () => void;
  onScrub: (time: number) => void;
  onSpeed: (speed: number) => void;
}) {
  const duration = Math.max(0.001, clips.durations[clipName] ?? 0);

  return (
    <div className="studio-transport">
      <button
        type="button"
        className="studio-btn"
        onClick={onToggle}
        aria-label={playing ? 'Pause animation' : 'Play animation'}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <input
        type="range"
        min={0}
        max={duration}
        step={Math.max(0.001, duration / 600)}
        value={Math.min(time, duration)}
        onChange={(event) => onScrub(Number(event.target.value))}
        aria-label="Animation position"
      />

      <span className="studio-clip-time">
        {time.toFixed(2)}s / {duration.toFixed(2)}s
      </span>

      {clips.names.length > 1 ? (
        <select
          value={clipName}
          onChange={(event) => onClip(event.target.value)}
          aria-label="Animation clip"
        >
          {clips.names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : (
        <span className="studio-clip-time">{clipName}</span>
      )}

      <select
        value={speed}
        onChange={(event) => onSpeed(Number(event.target.value))}
        aria-label="Playback speed"
      >
        {[0.25, 0.5, 1, 1.5, 2].map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>
    </div>
  );
}

/* ============================================================================================
 * The studio
 * ========================================================================================== */

export interface ModelViewerProps {
  readonly cid: string | null;
  readonly format: string;
  /** Shown in the footer and in fault messages. */
  readonly label?: string | undefined;
  /** Measured extent recorded for this version, displayed as a scale readout. */
  readonly dimensions?: { x: number; y: number; z: number } | null;
  /**
   * Triangle count the asset record claims. When given, the footer compares it with what the browser
   * decoded, so a record that disagrees with the file is visible rather than silently trusted.
   */
  readonly recordedPolycount?: number | null;
  /** Compact hides the whole toolbar (used for marketplace cards and the quick-look dialog). */
  readonly compact?: boolean;
  /** Fraction of the view the model is fitted to. */
  readonly fill?: number;
  /**
   * Gently rotates the model until the visitor touches it.
   *
   * For a showcase, a still frame reads as a photograph, and a marketplace whose subject never moves
   * is not obviously showing a 3D file. It stops the moment the visitor takes control, because a
   * camera that keeps drifting under your cursor is the opposite of helpful.
   */
  readonly autoRotate?: boolean;
  /**
   * Presentation chrome (marketplace storefront).
   *
   * The full studio — shading modes, camera axis buttons, measurement helpers, inventory, export —
   * is the right surface for inspecting a file, and the wrong one to greet a visitor with. A
   * storefront hero showing a file inventory panel and an "Axes" toggle reads as a developer tool,
   * so presentation mode keeps only what a *viewer* needs: the model, the orbit hint, and their own
   * ability to drag it. Everything else stays one click away on the model page.
   */
  readonly presentation?: boolean;
}

export function ModelViewer({
  cid,
  format,
  label,
  dimensions,
  recordedPolycount = null,
  compact = false,
  fill = 0.8,
  autoRotate = false,
  presentation = false,
}: ModelViewerProps) {
  const previewable = canPreviewNatively(format);
  const url = cid ? `/ipfs/${cid}` : null;

  /* --- the file --------------------------------------------------------------------------- */
  const [mode, setMode] = useState<ShadeMode>('shaded');
  const [request, setRequest] = useState<FitRequest>({ n: 0, view: 'iso' });
  const [view, setView] = useState<CameraView>('iso');
  const [ortho, setOrtho] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop>('stage');

  // The grid is a scale reference and earns its place; the origin axes are an authoring aid, and on a
  // public listing they just add three coloured lines through the model. Both stay one click away.
  const [showGrid, setShowGrid] = useState(!compact && !presentation);
  const [showAxes, setShowAxes] = useState(false);
  const [showBounds, setShowBounds] = useState(false);
  // The ground shadow stays on in presentation mode: it is the thing that stops a model reading as a
  // flat sticker, which matters more on a storefront than in a measurement viewport.
  const [showShadow, setShowShadow] = useState(true);

  const [spinning, setSpinning] = useState(autoRotate);
  const [panelOpen, setPanelOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hintVisible, setHintVisible] = useState(!compact);
  const [faulted, setFaulted] = useState(false);

  /* --- what was decoded ------------------------------------------------------------------- */
  const [decoded, setDecoded] = useState<DecodedGeometry | null>(null);
  const [readyKey, setReadyKey] = useState(0);
  const [summary, setSummary] = useState<SceneSummary>(EMPTY_SUMMARY);
  const [clips, setClips] = useState<ClipHandle | null>(null);
  const [clipName, setClipName] = useState('');
  const [playing, setPlaying] = useState(true);
  const [clipTime, setClipTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [floor, setFloor] = useState<number | null>(null);
  const [box, setBox] = useState<THREE.Box3 | null>(null);

  const wrapper = useRef<HTMLDivElement>(null);
  const modelRef = useRef<THREE.Group>(null);
  const captureRef = useRef<(() => string) | null>(null);

  const handleDecoded = useCallback((geometry: DecodedGeometry) => {
    setDecoded(geometry);
    // The geometry exists now, so the camera has something to frame. See CameraRig.readyKey.
    setReadyKey((value) => value + 1);
  }, []);
  const handleSummary = useCallback((next: SceneSummary) => setSummary(next), []);
  const handleFramed = useCallback((nextFloor: number, nextBox: THREE.Box3) => {
    setFloor(nextFloor);
    setBox(nextBox);
  }, []);
  const registerCapture = useCallback((capture: (() => string) | null) => {
    captureRef.current = capture;
  }, []);

  const handleClips = useCallback((next: ClipHandle | null) => {
    setClips(next);
    // Keep the current clip if it survived a reload, otherwise take the first the file offers.
    setClipName((previous) =>
      next && previous.length > 0 && next.names.includes(previous)
        ? previous
        : (next?.names[0] ?? ''),
    );
  }, []);

  /** The model's largest dimension — the unit every helper is sized against. */
  const span = useMemo(() => {
    if (!box) return 1;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, 0.001);
  }, [box]);

  /* --- camera moves ----------------------------------------------------------------------- */
  const goToView = useCallback((next: CameraView) => {
    setView(next);
    setRequest((current) => ({ n: current.n + 1, view: next }));
  }, []);

  /** Re-frame without changing which way the camera looks — used by RESET-adjacent affordances. */
  const refitInPlace = useCallback(() => {
    setRequest((current) => ({ n: current.n + 1, view: null }));
  }, []);

  const toggleOrtho = useCallback(() => {
    setOrtho((value) => !value);
    // A new camera starts at its own default position, so the framing is re-solved for the view the
    // user was last looking from rather than left to chance.
    setRequest((current) => ({ n: current.n + 1, view }));
  }, [view]);

  const toggleExpanded = useCallback(async () => {
    const element = wrapper.current;
    if (!element) return;
    try {
      if (!document.fullscreenElement) await element.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Fullscreen can be refused by policy; the studio stays usable without it.
    }
  }, []);

  const saveShot = useCallback(() => {
    const data = captureRef.current?.();
    if (!data) return;

    const slug = (label ?? 'model')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model';

    const link = document.createElement('a');
    link.href = data;
    link.download = `${slug}-${mode}.png`;
    link.click();
  }, [label, mode]);

  /* --- animation ------------------------------------------------------------------------ */
  useEffect(() => {
    if (!clips || clipName.length === 0) return;
    const action = clips.actions[clipName];
    if (!action) return;

    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.play();
    setClipTime(0);

    return () => {
      action.stop();
    };
  }, [clips, clipName]);

  useEffect(() => {
    if (!clips || clipName.length === 0) return;
    const action = clips.actions[clipName];
    if (action) action.paused = !playing;
  }, [clips, clipName, playing]);

  useEffect(() => {
    if (!clips || clipName.length === 0) return;
    const action = clips.actions[clipName];
    if (action) action.setEffectiveTimeScale(speed);
  }, [clips, clipName, speed]);

  // The transport reads the mixer rather than driving it: polled at 10 Hz, which is enough to look
  // continuous for a scrubber and costs nothing next to a per-frame React render.
  useEffect(() => {
    if (!playing || !clips || clipName.length === 0) return;
    const id = setInterval(() => {
      const action = clips.actions[clipName];
      if (action) setClipTime(action.time);
    }, 100);
    return () => clearInterval(id);
  }, [playing, clips, clipName]);

  const handleScrub = useCallback(
    (time: number) => {
      const action = clips?.actions[clipName];
      if (!action || !clips) return;
      action.time = time;
      clips.mixer.update(0);
      setClipTime(time);
    },
    [clips, clipName],
  );

  /* --- chrome behaviour ------------------------------------------------------------------- */
  useEffect(() => {
    if (!hintVisible) return;
    const timer = setTimeout(() => setHintVisible(false), 7_000);
    return () => clearTimeout(timer);
  }, [hintVisible]);

  useEffect(() => {
    const onChange = () => setExpanded(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (compact) return;

    /**
     * One keyboard scheme, printed on the buttons so it is discoverable:
     *
     *   1–7  surface shading      0 + F/B/L/R/T/D  camera views
     *   G A O H P  overlays       I inventory   S save PNG   M full screen
     *
     * Full screen moved to M (maximize) because F is the standard "front view" in every DCC
     * tool, and hijacking it for fullscreen cost the more useful binding.
     */
    const SHADE_KEYS: Record<string, ShadeMode> = {
      '1': 'shaded',
      '2': 'edges',
      '3': 'wireframe',
      '4': 'normals',
      '5': 'uv',
      '6': 'matcap',
      '7': 'unlit',
    };

    const VIEW_KEYS: Record<string, CameraView> = {
      '0': 'iso',
      f: 'front',
      b: 'back',
      l: 'left',
      r: 'right',
      t: 'top',
      d: 'bottom',
    };

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();

      const shade = SHADE_KEYS[key];
      if (shade) {
        setMode(shade);
        event.preventDefault();
        return;
      }

      const view = VIEW_KEYS[key];
      if (view) {
        goToView(view);
        event.preventDefault();
        return;
      }

      switch (key) {
        case 'v':
          toggleOrtho();
          break;
        case 'g':
          setShowGrid((value) => !value);
          break;
        case 'a':
          setShowAxes((value) => !value);
          break;
        case 'o':
          setShowBounds((value) => !value);
          break;
        case 'h':
          setShowShadow((value) => !value);
          break;
        case 'p':
          setSpinning((value) => !value);
          break;
        case 'i':
          setPanelOpen((value) => !value);
          break;
        case 's':
          saveShot();
          break;
        case 'm':
          void toggleExpanded();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, goToView, saveShot, toggleExpanded, toggleOrtho]);

  const edgeDisabled = decoded !== null && decoded.triangles > EDGE_TRIANGLE_BUDGET;
  const animated = Boolean(clips && playing);

  /* --- no preview possible ---------------------------------------------------------------- */
  if (!previewable || !url) {
    return (
      <div className="studio" style={{ background: BACKDROPS[backdrop] }}>
        <div className="mk-stage-empty">
          <div>
            <div className="mk-display text-xl">
              {previewable ? 'No pinned content to preview' : `${format.replace(/^\./, '').toUpperCase()} has no browser preview`}
            </div>
            <p className="mt-2 text-[13px]" style={{ color: 'var(--vs-fg-dim)' }}>
              {url
                ? 'Download it from the gateway to inspect it in your own tool.'
                : 'This asset has no content-addressed copy yet.'}
            </p>
            {url ? (
              <a className="vs-btn mt-4 inline-flex" href={url} download>
                Download the file
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapper}
      className="studio"
      style={{ background: BACKDROPS[backdrop] }}
      onDoubleClick={refitInPlace}
    >
      <div className="studio-viewport">
        <ViewerBoundary
          label={label ?? 'model'}
          sourceUrl={url}
          onFault={() => setFaulted(true)}
        >
          <Canvas
            dpr={[1, 2]}
            /*
              Demand-driven rendering.
            
              A canvas that renders on its own animation frame forever holds the GPU awake for as long
              as the page is open, which on a laptop is a fan that never stops and a battery that
              drains while the reader is reading. Real 3D viewers stop when nothing is moving.
            
              `demand` is exactly that: R3F cancels its animation frame once nothing has invalidated
              the scene, and drei's OrbitControls invalidates on every change event, so orbiting and
              damping still animate. The two things here that genuinely need a continuous frame —
              turntable rotation and a playing animation clip — opt back into `always` while they run.
            */
            frameloop={spinning || animated ? 'always' : 'demand'}
            gl={{
              antialias: true,
              // Required by the export button: without it the drawing buffer is cleared after each
              // composite and toDataURL returns an empty image.
              preserveDrawingBuffer: true,
              powerPreference: 'high-performance',
            }}
            /*
              The initial position is only ever seen for the instant before the rig frames the
              model, so it is set far enough out that a large scan is not entered from the inside —
              the fit then moves the camera to wherever the geometry actually needs it.
            */
            camera={{ position: [14, 10, 20], fov: 42, near: 0.01, far: 5_000 }}
            onPointerDown={() => setSpinning(false)}
          >
            <StudioEnvironment />

            {/* A key/fill/rim rig. The environment map does the reflections; these do the shaping. */}
            <hemisphereLight args={['#dfe6f5', '#1b1b22', 0.5]} />
            <directionalLight position={[4, 7, 5]} intensity={2.2} />
            <directionalLight position={[-5, 2, -4]} intensity={0.6} />
            <directionalLight position={[0, -4, 3]} intensity={0.28} />

            {ortho ? (
              <OrthographicCamera makeDefault position={[3, 2, 4]} near={0.01} far={1_000} />
            ) : null}

            <Suspense fallback={null}>
              <group ref={modelRef}>
                <Model
                  url={url}
                  mode={mode}
                  onDecoded={handleDecoded}
                  onSummary={handleSummary}
                  onClips={handleClips}
                />
              </group>
            </Suspense>

            {floor !== null ? (
              <SceneHelpers
                floor={floor}
                span={span}
                box={showBounds ? box : null}
                showGrid={showGrid}
                showAxes={showAxes}
                showBounds={showBounds}
                showShadow={showShadow}
                animated={animated}
                night={backdrop !== 'paper'}
              />
            ) : null}

            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              enablePan
              autoRotate={spinning}
              autoRotateSpeed={0.9}
            />

            <CameraRig
              target={modelRef}
              fill={fill}
              request={request}
              readyKey={readyKey}
              onFramed={handleFramed}
            />
            <CaptureBridge register={registerCapture} />
          </Canvas>
        </ViewerBoundary>
      </div>

      <LoadReporter onSettled={() => setHintVisible(false)} />

      {!faulted && !compact ? (
        <>
          {!presentation ? (
            <div className="studio-top">
            <div className="studio-group">
              <span className="studio-group-label">Surface</span>
              {SHADE_MODES.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  className="studio-btn"
                  aria-pressed={mode === spec.id}
                  aria-keyshortcuts={spec.key}
                  title={
                    spec.id === 'edges' && edgeDisabled
                      ? `Too dense for an edge overlay: ${formatCount(decoded?.triangles ?? 0)} triangles is over the ${formatCount(EDGE_TRIANGLE_BUDGET)} budget. Wireframe costs nothing.`
                      : `${spec.hint}  ·  ${spec.key}`
                  }
                  disabled={spec.id === 'edges' && edgeDisabled}
                  onClick={() => setMode(spec.id)}
                >
                  {spec.label}
                  <kbd>{spec.key}</kbd>
                </button>
              ))}
            </div>

            <div className="studio-group">
              <span className="studio-group-label">Camera</span>
              {VIEW_BUTTONS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="studio-btn"
                  aria-pressed={view === entry.id}
                  aria-keyshortcuts={entry.key}
                  title={`Look at the model from the ${entry.label.toLowerCase()} and re-frame it  ·  ${entry.key}`}
                  onClick={() => goToView(entry.id)}
                >
                  {entry.label}
                  <kbd>{entry.key}</kbd>
                </button>
              ))}
              <span className="studio-divider" aria-hidden />
              <button
                type="button"
                className="studio-btn"
                aria-pressed={ortho}
                title="Projection: orthographic shows true proportions with no perspective foreshortening — use it when measuring an export against its spec sheet  ·  V"
                onClick={toggleOrtho}
              >
                {ortho ? 'Orthographic' : 'Perspective'}
                <kbd>V</kbd>
              </button>
            </div>

            <div className="studio-group">
              <span className="studio-group-label">Overlays</span>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={showGrid}
                aria-keyshortcuts="G"
                title="Measurement grid, stepped to this model's scale  ·  G"
                onClick={() => setShowGrid((value) => !value)}
              >
                Grid
                <kbd>G</kbd>
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={showAxes}
                aria-keyshortcuts="A"
                title="Origin axes — X red, Y green, Z blue  ·  A"
                onClick={() => setShowAxes((value) => !value)}
              >
                Axes
                <kbd>A</kbd>
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={showBounds}
                aria-keyshortcuts="O"
                title="Bounding box of the geometry as decoded, so you can check the export fits the volume it was authored for  ·  O"
                onClick={() => setShowBounds((value) => !value)}
              >
                Bounds
                <kbd>O</kbd>
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={showShadow}
                aria-keyshortcuts="H"
                title="Ground shadow, so the model does not read as a sticker  ·  H"
                onClick={() => setShowShadow((value) => !value)}
              >
                Shadow
                <kbd>H</kbd>
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={spinning}
                aria-keyshortcuts="P"
                title="Turntable — stops as soon as you take control  ·  P"
                onClick={() => setSpinning((value) => !value)}
              >
                Turntable
                <kbd>P</kbd>
              </button>
            </div>

            <div className="studio-group studio-spacer">
              <button
                type="button"
                className="studio-btn"
                title={`Background: stage, dark or light. A dark asset needs the light one. Currently ${BACKDROP_LABEL[backdrop]}.`}
                onClick={() =>
                  setBackdrop((value) =>
                    value === 'stage' ? 'night' : value === 'night' ? 'paper' : 'stage',
                  )
                }
              >
                <span className="studio-swatch" data-backdrop={backdrop} aria-hidden />
                {BACKDROP_LABEL[backdrop]}
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={panelOpen}
                aria-keyshortcuts="I"
                title="File inventory — geometry, materials, textures, rig  ·  I"
                onClick={() => setPanelOpen((value) => !value)}
              >
                Inventory
                <kbd>I</kbd>
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-keyshortcuts="S"
                title="Save the current view as a PNG at the canvas resolution  ·  S"
                onClick={saveShot}
              >
                Save PNG
                <kbd>S</kbd>
              </button>
              <button
                type="button"
                className="studio-btn"
                aria-pressed={expanded}
                aria-keyshortcuts="M"
                title="Full screen  ·  M"
                onClick={() => void toggleExpanded()}
              >
                {expanded ? 'Exit' : 'Full screen'}
                <kbd>M</kbd>
              </button>
            </div>
          </div>
          ) : null}

          {!presentation && panelOpen ? (
            <StatsPanel
              decoded={decoded}
              summary={summary}
              clips={clips}
              ortho={ortho}
              onClose={() => setPanelOpen(false)}
            />
          ) : null}

          {clips && clips.names.length > 0 && clipName.length > 0 ? (
            <Transport
              clips={clips}
              clipName={clipName}
              playing={playing}
              time={clipTime}
              speed={speed}
              onClip={setClipName}
              onToggle={() => setPlaying((value) => !value)}
              onScrub={handleScrub}
              onSpeed={setSpeed}
            />
          ) : null}

          {hintVisible ? (
            <div className="studio-hint">
              {presentation ? (
                <>
                  <strong>Drag</strong> to orbit · <strong>scroll</strong> to zoom
                </>
              ) : (
                <>
                  <strong>Orbit</strong> drag · <strong>Zoom</strong> scroll ·{' '}
                  <strong>Re-frame</strong> double-click
                  <span className="studio-hint-sep" aria-hidden />
                  every control is also a key — they are printed on the buttons
                </>
              )}
            </div>
          ) : null}

          {!presentation ? (
            <div className="studio-bottom">
            <span className="studio-meta">
              {label ? <span>{label}</span> : null}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title={`${cid} — open the raw file from the gateway`}
              >
                CID {shortCid(cid)}
              </a>
              {decoded ? (
                <DecodeReadout decoded={decoded} recorded={recordedPolycount} />
              ) : (
                <span>decoding…</span>
              )}
              {dimensions ? (
                <span title="Extent recorded for this version, in model units">
                  {dimensions.x} × {dimensions.y} × {dimensions.z} units on record
                </span>
              ) : null}
            </span>
          </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
