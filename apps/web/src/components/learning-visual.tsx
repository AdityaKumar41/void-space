'use client';
import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import type { LearningActivity, LearningTarget } from '@void-space/types';
import { ModelStage } from './model-stage';
import { API_PUBLIC_BASE } from '../lib/api';
export default function LearningVisual({
  activity,
  selected,
  onSelect,
  exploded,
  isolated,
  onMeshCount,
  visualUrl,
  showLabels = true,
  onSurfacePick,
}: {
  activity: LearningActivity;
  selected: string | null;
  onSelect: (id: string) => void;
  exploded: boolean;
  isolated: string | null;
  onMeshCount?: (n: number) => void;
  visualUrl?: string;
  showLabels?: boolean;
  onSurfacePick?: (position: [number, number, number], meshKey: string) => void;
}) {
  const [labelElement, setLabelElement] = useState<HTMLDivElement | null>(null);
  const labelPortal = useMemo(
    () => (labelElement ? { current: labelElement } : undefined),
    [labelElement],
  );
  const scene = activity.scene;
  const pickSurface = (position: [number, number, number], meshKey: string) => {
    if (onSurfacePick) {
      onSurfacePick(position, meshKey);
      return;
    }
    const candidates = activity.targets.filter((t) => t.meshKey === meshKey);
    const nearest = [...candidates].sort(
      (a, b) =>
        a.position.reduce((n, x, i) => n + (x - position[i]!) ** 2, 0) -
        b.position.reduce((n, x, i) => n + (x - position[i]!) ** 2, 0),
    )[0];
    if (nearest) onSelect(nearest.id);
  };
  if (scene.kind === 'none') return null;
  if (scene.kind === 'model' && scene.builtin)
    return (
      <div
        className="learning-model-canvas"
        aria-label="Interactive 3D components. Drag to orbit, scroll to zoom; use the component buttons for keyboard access."
      >
        <Canvas camera={{ position: [0, 2, 5], fov: 45 }}>
          <ambientLight intensity={1.5} />
          <directionalLight position={[3, 6, 5]} intensity={3} />
          {activity.targets.map(
            (target, i) =>
              (!isolated || target.id === isolated) && (
                <mesh
                  key={target.id}
                  position={[(i - 1) * (exploded ? 2.1 : 1.5), 0, 0]}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(target.id);
                  }}
                >
                  {target.meshKey === 'sphere' ? (
                    <sphereGeometry args={[0.5, 32, 24]} />
                  ) : target.meshKey === 'cylinder' ? (
                    <cylinderGeometry args={[0.45, 0.45, 1, 32]} />
                  ) : (
                    <boxGeometry args={[0.85, 0.85, 0.85]} />
                  )}
                  <meshStandardMaterial
                    color={selected === target.id ? '#e8be7d' : '#84a6b0'}
                    roughness={0.55}
                  />
                  {labelPortal && (
                    <Html portal={labelPortal} position={[0, 0.75, 0]} center zIndexRange={[15, 0]}>
                      <button
                        type="button"
                        className="learning-scene-label"
                        aria-label={`Scene target ${showLabels ? target.label : i + 1}`}
                        aria-pressed={selected === target.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(target.id);
                        }}
                      >
                        <span>{i + 1}</span>
                        {showLabels && target.label}
                      </button>
                    </Html>
                  )}
                </mesh>
              ),
          )}
          <gridHelper args={[10, 10, '#50616e', '#2c3944']} />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
        <div ref={setLabelElement} className="learning-label-portal" />
      </div>
    );
  if (scene.kind === 'model' && scene.privateModelId)
    return (
      <ModelStage
        presentation
        cid={null}
        sourceUrl={visualUrl ?? `${API_PUBLIC_BASE}/learning/library/${scene.privateModelId}/file`}
        format="glb"
        name={activity.title}
        polycount={null}
        onGeometryDecoded={(g) => onMeshCount?.(g.meshes)}
        interaction={{
          hotspots: onSurfacePick ? [] : activity.targets,
          selectedId: selected,
          exploded,
          isolatedId: isolated,
          onSelect,
          showLabels,
          onSurfacePick: pickSurface,
        }}
      />
    );
  if (scene.kind === 'model' && scene.media) {
    const m = scene.media;
    return (
      <ModelStage
        presentation
        cid={m.cid}
        format={m.format}
        name={m.name}
        polycount={m.polycount}
        onGeometryDecoded={(g, summary) => onMeshCount?.(g.meshes)}
        interaction={{
          hotspots: onSurfacePick ? [] : activity.targets,
          selectedId: selected,
          exploded,
          isolatedId: isolated,
          onSelect,
          showLabels,
          onSurfacePick: pickSurface,
        }}
      />
    );
  }
  const xy = (target: LearningTarget) => [
    300 + target.position[0] * 220,
    150 - target.position[1] * 100,
  ];
  return (
    <div className="relative overflow-hidden rounded-xl border border-hairline bg-[#18232b]">
      <svg
        role="img"
        aria-label={
          scene.kind === 'process'
            ? 'Process connections; use the component list below to explore'
            : 'Component diagram; use the component list below to explore'
        }
        viewBox="0 0 600 300"
        className="min-h-64 w-full"
      >
        <defs>
          <marker
            id="learning-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6" fill="#90a8b3" />
          </marker>
        </defs>
        {scene.kind === 'diagram' && scene.imageSourceId && (
          <image href={visualUrl} width="600" height="300" preserveAspectRatio="xMidYMid meet" />
        )}
        {scene.kind === 'process' &&
          scene.edges.map((edge, i) => {
            const a = activity.targets.find((t) => t.id === edge.from)!,
              b = activity.targets.find((t) => t.id === edge.to)!;
            const [x1, y1] = xy(a),
              [x2, y2] = xy(b);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#90a8b3"
                strokeWidth="2"
                markerEnd="url(#learning-arrow)"
              />
            );
          })}
        {activity.targets.map((target) => {
          const [x, y] = xy(target);
          return (
            <g key={target.id} onClick={() => onSelect(target.id)} className="cursor-pointer">
              <rect
                x={x! - 54}
                y={y! - 28}
                width="108"
                height="56"
                rx={8}
                fill={selected === target.id ? '#e8be7d' : '#2e434f'}
                stroke="#90a8b3"
              />
              <text
                x={x}
                y={y! + 4}
                fill={selected === target.id ? '#19222b' : '#f0f4f5'}
                textAnchor="middle"
                fontSize="12"
              >
                {target.label.length > 18 ? target.label.slice(0, 16) + '…' : target.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
