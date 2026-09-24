/**
 * The public frame: marketing site and catalogue (§6.1 "Public Catalog").
 *
 * A visitor's first page must not begin with a session check, so nothing here touches the session
 * context or React Query — it is a plain server-rendered header and footer. Sign-in is an offered
 * action, not a gate.
 *
 * Two surfaces share this frame and are deliberately separate:
 *
 *   `/`         the product — what the platform does, for whom, and how to buy or try it.
 *   `/catalog`  the licensed-asset catalogue, which is a *feature of* the product.
 *
 * They were one page, and the root URL behaved like a public gallery of customer assets. That is
 * wrong twice over: it exposes licensed work on the company's front page, and it answers "what is
 * this product?" with a grid of whales. A vendor's landing page sells the platform; the catalogue is
 * somewhere a visitor goes on purpose.
 */
import Link from 'next/link';

export type PublicSurface = 'product' | 'catalog' | 'model';

const NAV: readonly { readonly surface: PublicSurface; readonly href: string; readonly label: string }[] = [
  { surface: 'product', href: '/', label: 'Product' },
  { surface: 'catalog', href: '/catalog', label: 'Catalogue' },
];

export function MarketHeader({ current }: { readonly current?: PublicSurface | undefined }) {
  return (
    <header className="mk-header">
      <div className="mk-shell mk-header-inner">
        <Link href="/" className="mk-brand" aria-label="VOID·SPACE — home">
          VOID·SPACE
          {/* The descriptor changes with the surface: "catalogue" on a listing, nothing on the product page. */}
          {current === 'catalog' || current === 'model' ? <span>catalogue</span> : null}
        </Link>

        <nav className="mk-nav" aria-label="Main">
          {NAV.map((entry) => (
            <Link
              key={entry.surface}
              href={entry.href}
              aria-current={current === entry.surface ? 'page' : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </nav>

        <nav className="ml-auto flex items-center gap-2" aria-label="Workspace">
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noreferrer"
            className="vs-btn vs-btn-ghost hidden sm:inline-flex"
          >
            API
          </a>
          <Link href="/console" className="vs-btn vs-btn-ghost">
            Console
          </Link>
          <Link href="/login" className="vs-btn vs-btn-primary">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

/**
 * The colophon.
 *
 * The standards list is the point of this footer: it states, in the plainest terms available, what
 * a buyer is actually getting. Deliberately not links — they are claims about the system, not pages
 * a visitor can go and read.
 */
export function MarketFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-shell py-12">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="mk-brand">
              VOID·SPACE
              <span>catalogue</span>
            </div>
            <p className="mt-4 max-w-md text-[13px] leading-relaxed" style={{ color: 'var(--vs-fg-faint)' }}>
              The 3D asset lifecycle platform: ingest, review, license and deliver 3D content with
              provenance that can be checked rather than trusted. Every licensed asset carries an
              ERC-721 token and content-addressed storage on IPFS.
            </p>
          </div>

          <div>
            <div className="mk-eyebrow">Product</div>
            <nav className="mt-4 flex flex-col gap-2.5" aria-label="Product">
              <Link href="/catalog">Licensed catalogue</Link>
              <Link href="/login">Sign in</Link>
              <Link href="/console">Operations console</Link>
              <a href="/api/v1/docs" target="_blank" rel="noreferrer">
                API reference
              </a>
            </nav>
          </div>

          <div>
            <div className="mk-eyebrow">Under the hood</div>
            <ul className="mt-4 flex flex-col gap-2.5 text-[13px]" style={{ color: 'var(--vs-fg-faint)' }}>
              <li>ERC-721 licence registry</li>
              <li>IPFS content addressing</li>
              <li>EIP-4361 wallet sign-in</li>
              <li>Append-only audit ledger</li>
            </ul>
          </div>
        </div>

        <div
          className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-5"
          style={{ borderColor: 'var(--vs-line)' }}
        >
          <span className="mk-id">VOID·SPACE · 3D asset lifecycle platform</span>
          <span className="mk-id">
            a takedown removes the listing; the token is never burned
          </span>
        </div>
      </div>
    </footer>
  );
}
