'use client';

/**
 * In-browser 3D preview (SRS §6.3, FR-5.2).
 *
 * The model is fetched from `/ipfs/<cid>` — the nginx-cached gateway route (FR-8.3) — never from the
 * IPFS node directly, so repeat previews come from cache.
 *
 * Design notes, because a 3D viewer is where good intentions usually die:
 *
 * - **It frames the model itself.** Demo content ranges from a 12-triangle cube to a 247k-triangle
 *   whale skeleton 38 units tall. <Bounds fit clip observe> measures whatever actually loaded and
 *   positions the camera for it, so nothing arrives as a speck, and RESET re-fits after the user
 *   has flown off somewhere.
 * - **It reports progress.** A 13 MB model over a cold cache takes seconds; silence reads as
 *   breakage. Percentage, transferred bytes and a skeleton are shown until the first frame.
 * - **It degrades honestly.** A model that will not decode says what failed and offers the raw
 *   bytes, instead of leaving a blank canvas for the user to interpret.
 */
import {
  Bounds,
  ContactShadows,
  Grid,
  OrbitControls,
  useBounds,
  useGLTF,
  useProgress,
} from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
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

import { comparePolycount, formatCount, measureScene, type DecodedGeometry } from '@/lib/geometry';

/** Kinds of model the browser can render natively. */
const NATIVE_FORMATS = new Set(['glb', 'gltf']);

export function canPreviewNatively(format: string): boolean {
  return NATIVE_FORMATS.has(format.toLowerCase().replace(/^\.+/, ''));
}

function displayExtension(format: string): string {
  return format.replace(/^\./, '').toUpperCase();
}

/**
 * What the browser actually decoded from the file, measured on the geometry that reached the GPU.
 *
 * This is deliberately separate from the polycount held in the asset record. The record is written
 * from the same file at ingest time, but it is a *claim*; this is the artifact. Showing both — and
 * saying plainly whether they agree — is what turns the preview into a provenance check: an operator
 * can see that the file served through the gateway really is the geometry the licence describes.
 *
 * The measurement and the comparison live in `@/lib/geometry`, tested without a WebGL context.
 */
interface ModelProps {
  readonly url: string;
  readonly wireframe: boolean;
  readonly onDecoded?: ((geometry: DecodedGeometry) => void) | undefined;
}

function Model({ url, wireframe, onDecoded }: ModelProps) {
  const { scene } = useGLTF(url);

  // A clone, not the cached scene itself: toggling wireframe on the original would leak into every
  // other viewer showing the same asset.
  const prepared = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    prepared.traverse((object) => {
      const mesh = object as { isMesh?: boolean; material?: unknown };
      if (!mesh.isMesh || !mesh.material) return;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        (material as { wireframe?: boolean }).wireframe = wireframe;
      }
    });
  }, [prepared, wireframe]);

  // Reported once per decoded scene, not per render: the numbers cannot change without a new load.
  useEffect(() => {
    if (!onDecoded) return;
    onDecoded(measureScene(prepared));
  }, [prepared, onDecoded]);

  return <primitive object={prepared} />;
}

/**
 * Progress readout shown over the canvas while the model streams in.
 *
 * Visibility is the hard part, not the percentage. The overlay must appear for a cold 13 MB
 * download and must *not* appear for a model three.js already has in its loader cache — otherwise
 * re-opening a card flashes a progress bar for something that is already on screen, and a stalled
 * "0%" reads as breakage. So it is shown only once a transfer is genuinely observed in flight, and
 * a short grace period settles it either way.
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

    // A transfer we watched has ended, so the geometry is decoded and about to be framed.
    if (sawTransfer.current) {
      setVisible(false);
      onSettled();
      return;
    }

    // Nothing observed yet: either the model is cached (nothing to report) or the fetch has not
    // started. One beat of grace covers the gap, then the overlay stands down.
    const timer = setTimeout(() => {
      setVisible(false);
      onSettled();
    }, 1_200);

    return () => clearTimeout(timer);
  }, [active, onSettled]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
    >
      <div className="vs-loader" aria-hidden />
      <div className="vs-data text-[11px] opacity-80">DECODING MODEL · {Math.round(progress)}%</div>
      {total > 0 ? (
        <div className="vs-label">
          {(loaded / 1_048_576).toFixed(1)} / {(total / 1_048_576).toFixed(1)} MB
        </div>
      ) : null}
      <div className="w-40" style={{ background: 'var(--vs-line)', height: 2 }}>
        <div
          style={{
            width: `${Math.max(4, progress)}%`,
            background: 'var(--vs-accent)',
            height: 2,
            transition: 'width 180ms linear',
          }}
        />
      </div>
    </div>
  );
}

/** Hands the toolbar access to the fit-to-view behaviour of <Bounds>. */
function BoundsBridge({ onReady }: { onReady: (reset: () => void) => void }) {
  const bounds = useBounds();

  useEffect(() => {
    onReady(() => {
      bounds.refresh().clip().fit();
    });
  }, [bounds, onReady]);

  return null;
}

/**
 * Error boundary: a model the viewer cannot decode explains itself instead of blanking the screen.
 *
 * It reports the fault upward as well as rendering it, because the toolbar and the orbit hint
 * belong to the *canvas* — leaving WIREFRAME/GRID/RESET on screen next to a dead canvas invites the
 * user to press controls that cannot do anything.
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
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        <div className="max-w-md">
          <div className="vs-data vs-accent">[ VIEWER FAULT ]</div>
          <div className="vs-display mt-2 text-xl">
            This {this.props.label} could not be drawn here
          </div>
          <p className="mt-2 text-[12px] leading-relaxed opacity-75">
            The asset itself is unaffected — it is pinned, and the licence on record is untouched.
            Either the geometry is in a form this viewer cannot decode, or the preview failed to
            initialise. A derivative produced by the Blender worker resolves the first case.
          </p>
          <code
            className="mt-3 block border p-2 text-[11px] opacity-70"
            style={{ borderColor: 'var(--vs-line-strong)' }}
          >
            {this.state.message}
          </code>
          {this.props.sourceUrl ? (
            <a
              className="vs-btn vs-btn-quiet mt-3 inline-flex"
              href={this.props.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              DOWNLOAD THE RAW BYTES
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
 * without a WebGL context; this is only the presentation of its verdict.
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
    <span className="flex flex-wrap items-center gap-2">
      <span
        className="vs-data opacity-70"
        title={`Decoded in the browser from the file served over the gateway: ${decoded.meshes} mesh(es), ${formatCount(
          decoded.vertices,
        )} vertices, extent ${decoded.extent.x.toFixed(2)} × ${decoded.extent.y.toFixed(
          2,
        )} × ${decoded.extent.z.toFixed(2)}`}
      >
        DECODED {formatCount(decoded.triangles)} TRI
      </span>
      {agreement.status === 'unknown' ? null : (
        <span
          className={agreement.status === 'mismatch' ? 'vs-data vs-accent' : 'vs-data opacity-70'}
          title={agreement.reason}
        >
          {agreement.status === 'mismatch'
            ? `≠ RECORD ${formatCount(recorded ?? 0)}`
            : '= RECORD ✓'}
        </span>
      )}
    </span>
  );
}

export interface ModelViewerProps {
  readonly cid: string | null;
  readonly format: string;
  /** Shown in the footer and in fault messages. */
  readonly label?: string | undefined;
  /** Measured extent, displayed as a scale readout. */
  readonly dimensions?: { x: number; y: number; z: number } | null;
  /**
   * Triangle count the asset record claims. When given, the footer compares it with what the browser
   * decoded, so a record that disagrees with the file is visible rather than silently trusted.
   */
  readonly recordedPolycount?: number | null;
  /** Compact hides the grid and the footer strip (used inside cards and the quick-look dialog). */
  readonly compact?: boolean;
  /** Fraction of the view the model is fitted to. */
  readonly fill?: number;
}

/**
 * The 3D preview, with its own toolbar.
 *
 * Everything the user can change here is local to this component: two viewers on one page (the
 * console and a quick-look dialog) never fight over shared state.
 */
export function ModelViewer({
  cid,
  format,
  label,
  dimensions,
  recordedPolycount = null,
  compact = false,
  fill = 0.8,
}: ModelViewerProps) {
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(!compact);
  const [expanded, setExpanded] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  /** Set by ViewerBoundary: the canvas is dead, so its chrome must not be offered. */
  const [faulted, setFaulted] = useState(false);
  /** Measured from the geometry that actually loaded — see DecodedGeometry. */
  const [decoded, setDecoded] = useState<DecodedGeometry | null>(null);

  const wrapper = useRef<HTMLDivElement>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const url = cid ? `/ipfs/${cid}` : null;

  const registerReset = useCallback((reset: () => void) => {
    resetRef.current = reset;
  }, []);

  const handleDecoded = useCallback((geometry: DecodedGeometry) => {
    setDecoded(geometry);
  }, []);

  /** Fullscreen on the wrapper, so the toolbar travels with the canvas. */
  const toggleExpanded = useCallback(async () => {
    const element = wrapper.current;
    if (!element) return;

    try {
      if (!document.fullscreenElement) {
        await element.requestFullscreen();
        setExpanded(true);
      } else {
        await document.exitFullscreen();
        setExpanded(false);
      }
    } catch {
      // A browser that refuses fullscreen is not a failure worth surfacing: the viewer still works.
    }
  }, []);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="vs-data opacity-80">NOT ON IPFS YET</div>
          <div className="vs-label mx-auto mt-2 max-w-xs">
            The pin worker has not returned a CID for this version yet. Preview unlocks itself as
            soon as it does.
          </div>
        </div>
      </div>
    );
  }

  if (!canPreviewNatively(format)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="vs-data">{displayExtension(format)} CANNOT BE RENDERED IN A BROWSER</div>
          <div className="vs-label mx-auto mt-2 max-w-xs">
            The file is stored and licensed correctly. A GLB derivative from the Blender worker is
            what makes it previewable here (FR-6.3).
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapper} className="relative h-full w-full" style={{ background: 'var(--vs-surface-2)' }}>
      <ViewerBoundary
        label={displayExtension(format)}
        sourceUrl={url}
        onFault={() => setFaulted(true)}
      >
        <Canvas
          camera={{ position: [3, 2, 4], fov: 42, near: 0.01, far: 5000 }}
          // Capping pixel ratio keeps a 247k-triangle model responsive on a retina display.
          dpr={[1, 1.8]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onPointerDown={() => setHintVisible(false)}
        >
          <color attach="background" args={['#0b0b0c']} />
          <fog attach="fog" args={['#0b0b0c', 60, 260]} />

          {/* Three-point-ish lighting, so geometry reads without downloading an HDRI. */}
          <hemisphereLight args={['#cbd5e1', '#1a1a1a', 0.6]} />
          <directionalLight position={[6, 9, 6]} intensity={1.7} />
          <directionalLight position={[-7, 4, -5]} intensity={0.55} color="#8fb4d9" />
          <ambientLight intensity={0.28} />

          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1 / Math.max(0.25, fill)}>
              <Model url={url} wireframe={wireframe} onDecoded={handleDecoded} />
            </Bounds>
            <BoundsBridge onReady={registerReset} />
          </Suspense>

          {/* Grounds the model, so it does not read as floating in a void. */}
          <ContactShadows
            position={[0, -0.001, 0]}
            opacity={0.45}
            scale={80}
            blur={2.5}
            far={60}
            resolution={512}
            color="#000000"
          />

          {showGrid ? (
            <Grid
              args={[80, 80]}
              cellColor="#232323"
              sectionColor="#3a3a3a"
              fadeDistance={140}
              fadeStrength={1.2}
              infiniteGrid
              side={2}
            />
          ) : null}

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.12}
            zoomSpeed={0.9}
            rotateSpeed={0.8}
            onDoubleClick={() => resetRef.current?.()}
          />
        </Canvas>
      </ViewerBoundary>

      {/*
        Outside <Canvas>, never inside it. The canvas is a three.js scene graph, not a DOM tree:
        any host element placed in it (a div, a button, text) is read as a THREE object and throws
        "Div is not part of the THREE namespace", taking the whole preview down with it. These
        overlays are plain DOM, so they belong here as siblings of the canvas.
      */}
      <LoadReporter onSettled={() => setHintVisible(false)} />

      {/* The chrome controls a canvas that no longer exists once the boundary has caught a fault. */}
      {!faulted ? (
      <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1">
        <button
          type="button"
          className="vs-btn vs-btn-ghost"
          aria-pressed={wireframe}
          onClick={() => setWireframe((value) => !value)}
          title="Show triangle edges instead of the shaded surface"
        >
          {wireframe ? 'SHADED' : 'WIREFRAME'}
        </button>
        {!compact ? (
          <button
            type="button"
            className="vs-btn vs-btn-ghost"
            aria-pressed={showGrid}
            onClick={() => setShowGrid((value) => !value)}
            title="Toggle the measurement grid"
          >
            GRID
          </button>
        ) : null}
        <button
          type="button"
          className="vs-btn vs-btn-ghost"
          onClick={() => resetRef.current?.()}
          title="Re-frame the model (or double-click the canvas)"
        >
          RESET
        </button>
        <button
          type="button"
          className="vs-btn vs-btn-ghost"
          onClick={() => void toggleExpanded()}
          title="Full-screen preview"
        >
          {expanded ? 'EXIT' : 'FULL'}
        </button>
      </div>
      ) : null}

      {hintVisible && !faulted ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2">
          <span className="vs-label" style={{ background: 'var(--vs-bg)', padding: '3px 8px' }}>
            DRAG TO ORBIT · SCROLL TO ZOOM · DOUBLE-CLICK TO RE-FRAME
          </span>
        </div>
      ) : null}

      {!compact && !faulted ? (
        <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <a
            className="vs-label truncate hover:opacity-100"
            href={url}
            target="_blank"
            rel="noreferrer"
            title={`${label ?? 'model'} — open the raw file from the gateway`}
          >
            {label ? `${label} · ` : ''}CID {cid}
          </a>
          <span className="flex flex-wrap items-center gap-3">
            {/* The integrity readout: what the file contains, against what the record claims. */}
            {decoded ? <DecodeReadout decoded={decoded} recorded={recordedPolycount} /> : null}
            {dimensions ? (
              <span
                className="vs-data opacity-70"
                title="Extent recorded for this version, in model units"
              >
                {dimensions.x} × {dimensions.y} × {dimensions.z} UNITS
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
