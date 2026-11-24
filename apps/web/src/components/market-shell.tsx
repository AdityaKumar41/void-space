import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export type PublicSurface = 'product' | 'catalog' | 'model';
export function Wordmark() {
  return (
    <span className="learning-site-brand">
      <svg width="32" height="32" viewBox="0 0 40 40" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <path
            key={i}
            d="M18 0h4l-1 14h-2z"
            fill="currentColor"
            transform={`rotate(${i * 45} 20 20)`}
          />
        ))}
        <circle cx="20" cy="20" r="3" fill="currentColor" />
      </svg>
      <span>/</span>void space
    </span>
  );
}
export function MarketHeader({ current }: { current?: PublicSurface; announcement?: boolean }) {
  return (
    <header className="public-site-header">
      <nav className="learning-site-nav" aria-label="Main navigation">
        <Link href="/" aria-label="Void Space home">
          <Wordmark />
        </Link>
        <div className="learning-site-links">
          <Link href="/#platform">Platform</Link>
          <Link href="/learn/discover">Explore lessons</Link>
          <Link href="/catalog" aria-current={current === 'catalog' ? 'page' : undefined}>
            Marketplace
          </Link>
        </div>
        <Link className="learning-outline" href="/console/learn/agent">
          Open workspace
          <ArrowUpRight size={17} />
        </Link>
      </nav>
    </header>
  );
}
export function MarketFooter() {
  return (
    <footer className="learning-site-footer public-site-footer">
      <Link href="/">
        <Wordmark />
      </Link>
      <nav aria-label="Footer">
        <Link href="/learn/discover">Public lessons</Link>
        <Link href="/catalog">Marketplace</Link>
        <Link href="/console/learn/agent">Workspace</Link>
      </nav>
      <span>Learn through exploration.</span>
    </footer>
  );
}
