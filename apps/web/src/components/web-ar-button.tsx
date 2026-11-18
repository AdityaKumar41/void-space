'use client';

/**
 * Browser WebAR entry for a catalog/console model.
 * Checks immersive-ar support, then opens a hit-test placement session with the GLB.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type ArState = 'checking' | 'unsupported' | 'ready' | 'running' | 'error';

export function WebArButton({ modelUrl, name }: { modelUrl: string; name: string }) {
  const [state, setState] = useState<ArState>('checking');
  const [detail, setDetail] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const xr = navigator.xr;
      if (!xr) {
        if (!cancelled) {
          setState('unsupported');
          setDetail('This browser does not expose WebXR.');
        }
        return;
      }
      try {
        const ok = await xr.isSessionSupported('immersive-ar');
        if (!cancelled) {
          setState(ok ? 'ready' : 'unsupported');
          setDetail(
            ok
              ? null
              : 'Immersive AR is not available on this device (try Chrome on Android with ARCore).',
          );
        }
      } catch {
        if (!cancelled) {
          setState('unsupported');
          setDetail('WebXR capability check failed.');
        }
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startAr() {
    const xr = navigator.xr;
    if (!xr) return;
    setState('running');
    setDetail(null);
    let failed = false;
    try {
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body },
      } as XRSessionInit);

      const canvas = document.createElement('canvas');
      canvas.style.display = 'none';
      document.body.appendChild(canvas);
      const resources: { renderer?: THREE.WebGLRenderer; model?: THREE.Object3D } = {};
      let hitTestSource: XRHitTestSource | null = null;
      let disposed = false;
      let ended = false;
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        resources.renderer?.setAnimationLoop(null);
        hitTestSource?.cancel();
        resources.model?.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            for (const value of Object.values(material))
              if (value instanceof THREE.Texture) value.dispose();
            material.dispose();
          }
        });
        canvas.remove();
        resources.renderer?.dispose();
      };
      cleanupRef.current = () => {
        cleanup();
        if (!ended) void session.end().catch(() => undefined);
      };
      session.addEventListener(
        'end',
        () => {
          ended = true;
          cleanup();
          if (!failed) setState('ready');
        },
        { once: true },
      );
      const gl = canvas.getContext('webgl2', { xrCompatible: true });
      if (!gl) throw new Error('WebGL 2 context unavailable for AR');

      const renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl as WebGL2RenderingContext,
        alpha: true,
        antialias: true,
      });
      resources.renderer = renderer;
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      await renderer.xr.setSession(session);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
      const root = new THREE.Group();
      scene.add(root);

      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(modelUrl);
      const model = gltf.scene;
      resources.model = model;
      model.scale.setScalar(0.25);
      root.add(model);
      root.visible = false;

      const refSpace = await session.requestReferenceSpace('local');
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const source = await (
        session as XRSession & {
          requestHitTestSource(options: { space: XRReferenceSpace }): Promise<XRHitTestSource>;
        }
      ).requestHitTestSource({ space: viewerSpace });
      hitTestSource = source ?? null;
      if (disposed) {
        hitTestSource?.cancel();
        return;
      }

      let placed = false;
      const onSelect = () => {
        if (root.visible) placed = true;
      };
      session.addEventListener('select', onSelect);

      renderer.setAnimationLoop((_time, frame) => {
        if (!frame || !hitTestSource) return;
        const hits = frame.getHitTestResults(hitTestSource);
        if (!placed && hits.length > 0) {
          const pose = hits[0]!.getPose(refSpace);
          if (pose) {
            root.visible = true;
            root.position.set(
              pose.transform.position.x,
              pose.transform.position.y,
              pose.transform.position.z,
            );
          }
        }
        renderer.render(scene, camera);
      });
    } catch (error) {
      failed = true;
      cleanupRef.current?.();
      setState('error');
      setDetail(error instanceof Error ? error.message : 'AR session failed to start');
    }
  }

  if (state === 'checking') {
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-10 flex-1 items-center justify-center rounded-control border border-hairline bg-veil-8 px-4 text-[14px] font-semibold text-ink-faint"
      >
        Checking AR…
      </button>
    );
  }

  if (state === 'unsupported') {
    return (
      <button
        type="button"
        disabled
        title={detail ?? 'AR unavailable'}
        className="inline-flex h-10 flex-1 items-center justify-center rounded-control border border-hairline bg-veil-8 px-4 text-[14px] font-semibold text-ink-faint"
      >
        AR not available
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={state === 'running'}
      onClick={() => void startAr()}
      title={detail ?? `Place ${name} in AR`}
      className="inline-flex h-10 flex-1 items-center justify-center rounded-control border border-transparent bg-veil-8 px-4 text-[14px] font-semibold text-ink transition-all duration-200 ease-standard hover:bg-veil-12 disabled:opacity-60"
    >
      {state === 'running' ? 'AR session…' : state === 'error' ? 'Retry AR' : 'View in AR'}
    </button>
  );
}
