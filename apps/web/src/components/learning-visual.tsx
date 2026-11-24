'use client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useState } from 'react';
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
}: {
  activity: LearningActivity;
  selected: string | null;
  onSelect: (id: string) => void;
  exploded: boolean;
  isolated: string | null;
  onMeshCount?: (n: number) => void;
  visualUrl?: string;
}) {
  const scene = activity.scene;
  if (scene.kind === 'none') return null;
  if (scene.kind === 'model' && scene.builtin)
    return (
      <div
        className="h-80 rounded-xl border border-hairline bg-[#19222b]"
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
                </mesh>
              ),
          )}
          <gridHelper args={[10, 10, '#50616e', '#2c3944']} />
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      </div>
    );
  if(scene.kind==='model'&&scene.privateModelId) return <ModelStage cid={null} sourceUrl={visualUrl??`${API_PUBLIC_BASE}/learning/library/${scene.privateModelId}/file`} format="glb" name={activity.title} polycount={null} onGeometryDecoded={g=>onMeshCount?.(g.meshes)} interaction={{hotspots:activity.targets,selectedId:selected,exploded,isolatedId:isolated,onSelect,showLabels:true}}/>;
  if (scene.kind === 'model' && scene.media) {
    const m = scene.media;
    return (
      <ModelStage
        cid={m.cid}
        format={m.format}
        name={m.name}
        polycount={m.polycount}
        onGeometryDecoded={(g, summary) => onMeshCount?.(g.meshes)}
        interaction={{
          hotspots: activity.targets,
          selectedId: selected,
          exploded,
          isolatedId: isolated,
          onSelect,
          showLabels: true,
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
