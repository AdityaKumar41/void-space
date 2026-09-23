'use client';

/**
 * Route-level fault panel.
 *
 * An operations console that shows a stack trace is worse than one that shows a fault code:
 * the operator needs to know whether the work is safe to retry. Anything that escapes a
 * component error boundary lands here, in the same register as the rest of the UI.
 */
export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="vs-panel m-4">
      <div className="vs-panel-head">
        <span>[ FAULT ]</span>
        <span className="vs-data">UI.RENDER</span>
      </div>
      <div className="p-6">
        <div className="vs-display text-3xl vs-accent">CONSOLE HALTED</div>
        <p className="mt-3 max-w-xl text-[13px] opacity-80">
          This view could not be rendered. Server-side state is unaffected — any job that was
          already queued keeps running, and no mutation was applied twice.
        </p>
        <pre className="mt-4 max-h-40 overflow-auto border p-3 text-[11px]" style={{ borderColor: 'var(--vs-line-strong)' }}>
          {error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          <button type="button" className="vs-btn vs-btn-primary" onClick={reset}>
            RETRY VIEW
          </button>
          <a className="vs-btn" href="/console">
            RETURN TO OVERVIEW
          </a>
        </div>
      </div>
    </div>
  );
}
