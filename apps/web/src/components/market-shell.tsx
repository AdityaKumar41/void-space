/**
 * The marketplace frame (§6.1 "Public Catalog").
 *
 * A visitor's first page must not begin with a session check, so nothing here touches the session
 * context or React Query — it is a plain server-rendered header and footer. Sign-in is an offered
 * action, not a gate.
 *
 * The header is purposefully thin. On a catalogue the objects should be the largest thing on screen,
 * so the chrome is one line tall, holds no call to action but sign-in, and never competes with a
 * model for attention.
 */
import Link from 'next/link';

export function MarketHeader({ current }: { readonly current?: 'catalogue' | undefined }) {
  return (
    <header className="mk-header">
      <div className="mk-shell mk-header-inner">
        <Link href="/" className="mk-brand" aria-label="VOID·SPACE catalogue — home">
          VOID·SPACE
          <span>catalogue</span>
        </Link>

        <nav className="mk-nav" aria-label="Catalogue">
          <Link href="/" aria-current={current === 'catalogue' ? 'page' : undefined}>
            All models
          </Link>
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
              Every model here was reviewed before it was listed, stored by content hash, and licensed
              as an ERC-721 token. The token id, the contract address and the transaction that minted
              it are printed on the listing, and the geometry is served from the same bytes the hash
              commits to — so a licence can be checked without asking us.
            </p>
          </div>

          <div>
            <div className="mk-eyebrow">Workspace</div>
            <nav className="mt-4 flex flex-col gap-2.5" aria-label="Workspace">
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
