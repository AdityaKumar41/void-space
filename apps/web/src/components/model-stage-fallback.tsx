/**
 * What stands in for a 3D stage when there is nothing to render.
 *
 * Shared by the storefront hero and the console so "no preview" looks the same everywhere: an
 * asset whose format has no decoder, an empty catalogue, or a browser without WebGL are different
 * facts and each gets its own sentence rather than a blank rectangle.
 *
 * A plain server component — no hooks, no canvas — so it can be rendered by a Server Component.
 */
export function ModelStageFallback({
  title,
  body,
  code,
}: {
  readonly title: string;
  readonly body: string;
  /** Optional stable identifier, shown so a support conversation has something to quote. */
  readonly code?: string | undefined;
}) {
  return (
    <div className="mk-stage-empty">
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        aria-hidden
        style={{ opacity: 0.32 }}
      >
        <path d="M12 2.6 21 7.5v9L12 21.4 3 16.5v-9z" />
        <path d="M3 7.5l9 4.9 9-4.9M12 12.4v9" />
      </svg>

      <div className="mk-h2 mt-4" style={{ fontSize: '1.05rem' }}>
        {title}
      </div>
      <p className="mk-lead mt-2 max-w-sm text-[13px]">{body}</p>
      {code ? <div className="mk-id mt-3">{code}</div> : null}
    </div>
  );
}
