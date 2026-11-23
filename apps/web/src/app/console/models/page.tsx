'use client';
import { SketchfabWorkbench } from '../../../components/sketchfab-workbench';
export default function ModelsPage() {
  return (
    <div className="space-y-6">
      <header className="border-b border-hairline pb-6">
        <p className="text-xs uppercase tracking-widest text-ink-dim">3D references</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Model exploration</h1>
        <p className="mt-3 max-w-3xl text-sm text-ink-dim">
          Find models for lessons, programs and practice. To share a reference, add its full
          Sketchfab link to a lesson outline. Released lessons show the viewer in learning programs
          and shared rooms. For graded mesh interactions, download a permitted model, upload it to
          the library and complete review before attaching it to a practice experience.
        </p>
      </header>
      <SketchfabWorkbench />
    </div>
  );
}
