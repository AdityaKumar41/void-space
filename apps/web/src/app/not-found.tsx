/**
 * 404.
 *
 * A dead end in an operations tool usually means a stale link or a deleted asset, so this page says
 * which of those is likely and offers the two routes worth taking.
 */
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="vs-panel w-full max-w-xl">
        <div className="vs-panel-head">
          <span>[ 404 ]</span>
          <span className="vs-data">ROUTE NOT FOUND</span>
        </div>
        <div className="p-6">
          <div className="vs-display text-3xl">Nothing at this address</div>
          <p className="vs-prose mt-3">
            Either the link is stale, or the asset it pointed at has been deleted. Deletion is
            only possible for unpublished work, so anything that was ever published still exists in
            the ledger.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/" className="vs-btn vs-btn-primary">
              BACK TO OVERVIEW
            </Link>
            <Link href="/library" className="vs-btn">
              ASSET LIBRARY
            </Link>
            <Link href="/catalog" className="vs-btn vs-btn-quiet">
              MARKETPLACE
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
