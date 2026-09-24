import Link from 'next/link';

import { Container } from './ui/layout';
import { ArrowRightIcon, CubeIcon } from './ui/icons';
import { buttonVariants } from './ui/button';
import { cn } from '../lib/cn';

/**
 * The public frame: marketing site, catalogue and model page (§6.1 "Public Catalog").
 *
 * A visitor's first page must not begin with a session check, so nothing here touches the session
 * context or React Query — it is a plain server-rendered header and footer. Sign-in is an offered
 * action, not a gate.
 *
 * Three surfaces share this frame and are deliberately separate:
 *
 *   `/`             the product — what the platform does, for whom, and how to buy or try it.
 *   `/catalog`      the licensed-asset catalogue, which is a *feature of* the product.
 *   `/m/<assetId>`  one listing, reached from the catalogue.
 *
 * They were one page once, and the root URL behaved like a public gallery of customer assets. That is
 * wrong twice over: it exposes licensed work on the company's front page, and it answers "what is this
 * product?" with a grid of whales. A vendor's landing page sells the platform; the catalogue is
 * somewhere a visitor goes on purpose.
 */
export type PublicSurface = 'product' | 'catalog' | 'model';

interface NavEntry {
  readonly surface: PublicSurface | 'docs';
  readonly href: string;
  readonly label: string;
  readonly external?: boolean;
}

const NAV: readonly NavEntry[] = [
  { surface: 'product', href: '/', label: 'Product' },
  { surface: 'catalog', href: '/catalog', label: 'Catalogue' },
  { surface: 'docs', href: '/api/v1/docs', label: 'API', external: true },
];

/**
 * The wordmark.
 *
 * A wireframe cube rather than a glyph or an ASCII drawing: the product's subject is a 3D object, and
 * the mark is the one place a page can say so before the reader has read anything. It sits in the
 * accent colour at full strength, which is the only decorative use of heat on the storefront — every
 * other use marks an action or a state.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <CubeIcon className="shrink-0 text-brand" width={20} height={20} strokeWidth={1.3} />
      {/*
        The wordmark's lettering hides below 400px, leaving the cube. At that width the cube, the
        catalogue link and the sign-in button need the room more than the name does — and the cube is
        the mark, so nothing is lost.
      */}
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink max-[400px]:hidden">
        VOID·SPACE
      </span>
    </span>
  );
}

/**
 * The announcement bar.
 *
 * Firecrawl opens with a product announcement across the top. Ours states the fact that matters most
 * to the audience this page is written for — that nothing here needs a cloud account — because for a
 * team evaluating a DAM, "can I run this on my own hardware" is the first question and a page that
 * answers it above the fold saves a sales call.
 */
export function MarketAnnouncement() {
  return (
    <div className="border-b border-hairline bg-deeper">
      <Container className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2.5 text-center">
        <span className="flex items-center gap-2 text-[13px] text-ink-dim">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
          The whole stack runs locally — no cloud account, no faucet, no paid RPC.
        </span>
        {/*
          A plain `<a>`, not `next/link`. `/api/v1/docs` is served by the API through the edge — it is
          not a Next route, so a `Link` prefetches `/api/v1/docs?_rsc=…` and gets a 404 on every page
          load. The console error it produced failed the UI audit.

          The link also relabels honestly: it points at the OpenAPI reference, which does describe the
          architecture, but "See the architecture" over a Swagger page would be a small lie.
        */}
        <a
          href="/api/v1/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink transition-colors duration-150 ease-standard hover:text-brand-warm"
        >
          Read the API reference
          <ArrowRightIcon width={13} height={13} />
        </a>
      </Container>
    </div>
  );
}

export function MarketHeader({
  current,
  announcement = false,
}: {
  readonly current?: PublicSurface | undefined;
  /** Renders the announcement bar above the header. Landing page only. */
  readonly announcement?: boolean;
}) {
  return (
    <>
      {announcement ? <MarketAnnouncement /> : null}

      <header className="sticky top-0 z-50 border-b border-hairline bg-[rgba(10,10,10,0.78)] backdrop-blur-xl backdrop-saturate-150">
        <Container className="flex h-16 items-center gap-4 md:gap-8">
          <Link href="/" aria-label="VOID·SPACE — home">
            <Wordmark />
          </Link>

          {/*
            The nav is not hidden on small screens. "Catalogue" is the one destination a phone visitor
            actually wants, so it stays at every width; "Product" is dropped below `md` because the
            wordmark beside it already goes home, and the API link waits until `sm`.
          */}
          <nav className="flex items-center gap-0.5 md:gap-1" aria-label="Main">
            {NAV.map((entry) => {
              const responsive =
                entry.surface === 'product'
                  ? 'hidden md:inline-flex'
                  : entry.surface === 'docs'
                    ? 'hidden sm:inline-flex'
                    : 'inline-flex';

              const base = cn(
                'rounded-control px-2.5 py-2 text-[14px] transition-colors duration-150 ease-standard hover:bg-veil-6 hover:text-ink md:px-3',
                responsive,
              );

              return entry.external ? (
                <a
                  key={entry.label}
                  href={entry.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(base, 'text-ink-dim')}
                >
                  {entry.label}
                </a>
              ) : (
                <Link
                  key={entry.label}
                  href={entry.href}
                  aria-current={current === entry.surface ? 'page' : undefined}
                  className={cn(
                    base,
                    current === entry.surface ? 'font-semibold text-ink' : 'text-ink-dim',
                  )}
                >
                  {entry.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/console"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
            >
              Console
            </Link>
            <Link href="/login" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              Sign in
            </Link>
          </div>
        </Container>
      </header>
    </>
  );
}

/**
 * The colophon.
 *
 * The standards list is the point of this footer: it states, in the plainest terms available, what a
 * buyer is actually getting. Deliberately not links — they are claims about the system, not pages a
 * visitor can go and read.
 *
 * There are no privacy or terms links. That is a decision rather than an omission: this workspace has
 * no published policy documents, and a footer link to a page that does not exist is a worse signal
 * than an absent one. The two operating facts a visitor can rely on are stated instead.
 */
export function MarketFooter() {
  return (
    <footer className="border-t border-hairline bg-base">
      <Container className="py-16">
        <div className="grid gap-12 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
          <div>
            <Wordmark />
            <p className="mt-5 max-w-[46ch] text-[13.5px] leading-[1.75] text-ink-faint">
              The 3D asset lifecycle platform: ingest, review, license and deliver 3D content with
              provenance that can be checked rather than trusted. Every licensed asset carries an
              ERC-721 token and content-addressed storage on IPFS.
            </p>
          </div>

          <nav aria-label="Product">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Product
            </h2>
            <ul className="mt-5 flex flex-col gap-3 text-[13.5px]">
              {[
                { href: '/catalog', label: 'Licensed catalogue' },
                { href: '/login', label: 'Sign in' },
                { href: '/console', label: 'Operations console' },
              ].map((entry) => (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    className="text-ink-dim transition-colors duration-150 ease-standard hover:text-ink"
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href="/api/v1/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-dim transition-colors duration-150 ease-standard hover:text-ink"
                >
                  API reference
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Under the hood
            </h2>
            <ul className="mt-5 flex flex-col gap-3 text-[13.5px] text-ink-faint">
              <li>ERC-721 licence registry</li>
              <li>IPFS content addressing</li>
              <li>EIP-4361 wallet sign-in</li>
              <li>Row-level tenant isolation</li>
              <li>Append-only audit ledger</li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6">
          <span className="font-mono text-[12px] text-ink-faint">
            © 2026 VOID·SPACE · 3D asset lifecycle platform
          </span>
          <span className="font-mono text-[12px] text-ink-faint">
            a takedown removes the listing; the token is never burned
          </span>
        </div>
      </Container>
    </footer>
  );
}

