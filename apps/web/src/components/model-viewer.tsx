'use client';

/**
 * In-browser 3D preview (SRS §6.3, FR-5.2).
 *
 * The model is fetched from `/ipfs/<cid>` — the nginx-cached gateway route (FR-8.3) — never
 * from the IPFS node directly, so repeat previews come from cache. Only formats a browser can
 * render natively (.glb/.gltf) are offered: handing an .fbx to a glTF loader produces a blank
 * canvas and a support ticket, so the caller checks first.
 */
import { Center, Grid, OrbitControls, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Component, Suspense, useState, type ReactNode } from 'react';

interface ModelProps {
  readonly url: string;
}

function Model({ url }: ModelProps) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

/** Error boundary: a corrupt GLB must degrade to a message, not a white screen. */
class ViewerBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center">
          <div>
            <div className="vs-data vs-accent">&gt;&gt;&gt; PREVIEW FAILED</div>
            <div className="vs-label mt-2">{this.props.label} could not be decoded by the viewer</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ModelViewer({ cid, format }: { cid: string | null; format: string }) {
  const [wireframe, setWireframe] = useState(false);
  const url = cid ? `/ipfs/${cid}` : null;

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="vs-cursor vs-data opacity-70">AWAITING IPFS PIN</div>
      </div>
    );
  }

  // Stored format is the dotted asset extension ('.glb'), but tolerate '.GLB', 'glb' and
  // surroundings: a case-sensitive comparison here silently removed the preview entirely.
  const normalized = `.${format.toLowerCase().replace(/^\.+/, '')}`;
  if (normalized !== '.glb' && normalized !== '.gltf') {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <div className="vs-data">NO NATIVE PREVIEW FOR {format.replace(/^\./, '').toUpperCase()}</div>
          <div className="vs-label mt-2">
            {format.replace(/^\./, '').toUpperCase()} renders after the Blender derivative produces a
            GLB (FR-6.3)
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ViewerBoundary label={normalized.replace(/^\./, '').toUpperCase()}>
        <Canvas camera={{ position: [3, 2, 3], fov: 45 }} dpr={[1, 2]}>
          <color attach="background" args={['#0a0a0a']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 6, 4]} intensity={1.1} />
          <Suspense fallback={null}>
            <Center>
              <Model url={url} />
            </Center>
          </Suspense>
          <Grid
            args={[20, 20]}
            cellColor="#2a2a2a"
            sectionColor="#3d3d3d"
            fadeDistance={18}
            infiniteGrid
          />
          <OrbitControls makeDefault enableDamping={false} />
        </Canvas>
      </ViewerBoundary>

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
        <span className="vs-label truncate">CID {cid}</span>
        <button type="button" className="vs-btn" onClick={() => setWireframe((value) => !value)}>
          {wireframe ? 'SHADED' : 'WIREFRAME'}
        </button>
      </div>
    </div>
  );
}
