import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { GUIDE, guideHref, guideNeighbors, guidePage, type GuidePage } from '../../../content/studio-guide';

interface DocsParams {
  readonly slug?: string[];
}

export function generateStaticParams(): DocsParams[] {
  return GUIDE.map((page) => ({ slug: page.slug ? [page.slug] : [] }));
}

export function generateMetadata({ params }: { params: DocsParams }): Metadata {
  const page = resolve(params);
  if (!page) return { title: 'Studio guide — VOID·SPACE' };
  return {
    title: `${page.title} — VOID·STUDIO`,
    description: page.summary,
  };
}

function resolve(params: DocsParams): GuidePage | undefined {
  const parts = params.slug ?? [];
  if (parts.length > 1) return undefined;
  return guidePage(parts[0] ?? '');
}

export default function StudioGuidePage({ params }: { params: DocsParams }) {
  const page = resolve(params);
  if (!page) notFound();

  const { previous, next } = guideNeighbors(page.slug);
  const directory = page.slug === '';

  return (
    <article className="max-w-[68ch]">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-brand">{page.kicker}</p>
      <h1 className="mt-3 text-[2rem] font-medium leading-[1.1] tracking-[-0.03em] text-ink sm:text-[2.5rem]">
        {page.title}
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-ink-dim">{page.summary}</p>

      {directory ? (
        <ol className="mt-8 divide-y divide-hairline border-y border-hairline">
          {GUIDE.filter((entry) => entry.slug).map((entry, index) => (
            <li key={entry.slug}>
              <Link href={guideHref(entry)} className="group grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 py-4">
                <span className="pt-0.5 font-mono text-[12px] text-ink-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  <span className="block text-[15px] font-semibold text-ink group-hover:text-brand-warm">
                    {entry.title}
                  </span>
                  <span className="mt-1 block text-[13.5px] leading-relaxed text-ink-dim">{entry.summary}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}

      <div className={directory ? 'mt-12' : 'mt-10'}>
        {page.blocks.map((block, index) => {
          if (block.kind === 'p') {
            return (
              <p key={index} className="mt-4 text-[15px] leading-[1.7] text-ink-dim first:mt-0">
                {block.text}
              </p>
            );
          }
          if (block.kind === 'note') {
            return (
              <p
                key={index}
                className="mt-6 border-l border-brand pl-4 text-[14px] leading-relaxed text-ink"
              >
                {block.text}
              </p>
            );
          }
          if (block.kind === 'list') {
            return (
              <ul key={index} className="mt-5 space-y-3 text-[15px] leading-[1.65] text-ink-dim">
                {block.items.map((item) => (
                  <li key={item} className="grid grid-cols-[0.7rem_minmax(0,1fr)] gap-3">
                    <span aria-hidden className="mt-[0.6em] h-1 w-1 rounded-full bg-brand" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );
          }
          if (block.kind === 'steps') {
            return (
              <ol key={index} className="mt-6 border-t border-hairline">
                {block.items.map((step, stepIndex) => (
                  <li key={step.title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-b border-hairline py-5">
                    <span className="font-mono text-[12px] text-brand">{String(stepIndex + 1).padStart(2, '0')}</span>
                    <span>
                      <span className="block text-[15px] font-semibold text-ink">{step.title}</span>
                      <span className="mt-1.5 block text-[14.5px] leading-relaxed text-ink-dim">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            );
          }
          return (
            <div key={index} className="mt-6 overflow-hidden rounded-card border border-hairline">
              {block.rows.map((row) => (
                <div key={row.keys} className="border-b border-hairline px-4 py-3 last:border-b-0">
                  <div className="font-mono text-[12.5px] leading-relaxed text-ink">{row.keys}</div>
                  <div className="mt-1 text-[14px] leading-relaxed text-ink-dim">{row.does}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <nav aria-label="More of the guide" className="mt-12 grid gap-3 border-t border-hairline pt-6 sm:grid-cols-2">
        {previous ? (
          <Link href={guideHref(previous)} className="rounded-card border border-hairline px-4 py-3 hover:border-hairline-strong">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Previous</span>
            <span className="mt-1 block text-[14px] font-semibold text-ink">{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={guideHref(next)}
            className="rounded-card border border-hairline px-4 py-3 text-right hover:border-hairline-strong sm:col-start-2"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Next</span>
            <span className="mt-1 block text-[14px] font-semibold text-ink">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
