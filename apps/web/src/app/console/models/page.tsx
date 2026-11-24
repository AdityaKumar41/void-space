'use client';
import { SketchfabWorkbench } from '../../../components/sketchfab-workbench';
export default function ModelsPage() {
  return (
    <div className="space-y-6">
      <header className="border-b border-hairline pb-6">
        <p className="text-xs uppercase tracking-widest text-ink-dim">3D references</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Model exploration</h1>
        <p className="mt-3 max-w-3xl text-sm text-ink-dim">
          Explore Sketchfab references for your lessons. To label individual components, import a
          model you have permission to use into your private learning library and review its labels.
        </p>
      </header>
      <SketchfabWorkbench />
    </div>
  );
}
