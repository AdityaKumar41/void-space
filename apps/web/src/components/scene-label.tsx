'use client';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';

/** A screen-space pin with DOM ownership isolated from the Three renderer.
 * Deferred disposal avoids unmounting a second React root inside a canvas commit.
 */
export function SceneLabel({ position, children }: { position: Vector3; children: ReactNode }) {
  const group = useRef<Group>(null);
  const dom = useRef<{ element: HTMLDivElement; root: Root } | null>(null);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const projected = useMemo(() => new Vector3(), []);
  useEffect(() => {
    const target = gl.domElement.parentElement;
    if (!target) return;
    // Fresh containers also make StrictMode setup → cleanup → setup safe.
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'none',
      pointerEvents: 'none',
    });
    target.appendChild(element);
    const root = createRoot(element);
    dom.current = { element, root };
    invalidate();
    return () => {
      dom.current = null;
      element.remove();
      queueMicrotask(() => root.unmount());
    };
  }, [gl, invalidate]);
  useEffect(() => {
    dom.current?.root.render(
      <div
        style={{ width: 'max-content', transform: 'translate(-50%, -50%)', pointerEvents: 'auto' }}
      >
        {children}
      </div>,
    );
    invalidate();
  }, [children, gl, invalidate]);
  useFrame(({ camera, size }) => {
    if (!group.current || !dom.current) return;
    group.current.updateWorldMatrix(true, false);
    group.current.getWorldPosition(projected).project(camera);
    const style = dom.current.element.style;
    style.display = projected.z >= -1 && projected.z <= 1 ? 'block' : 'none';
    style.transform = `translate3d(${((projected.x + 1) * size.width) / 2}px, ${((1 - projected.y) * size.height) / 2}px, 0)`;
    style.zIndex = String(Math.round((1 - projected.z) * 10));
  });
  return <group ref={group} position={position} />;
}
