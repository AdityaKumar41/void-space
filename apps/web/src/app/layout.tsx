/**
 * Root layout.
 *
 * One set of typefaces for the whole application, loaded from Google Fonts with `display=swap` and
 * generous system fallbacks: if the network is unavailable the interface degrades to the platform
 * sans rather than blocking a render on a font file.
 *
 * Plus Jakarta Sans for interface and display (geometric, slightly humanist, and not Inter), JetBrains
 * Mono for identifiers and figures so columns of hashes and counts line up.
 */
import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'VOID·SPACE — 3D asset marketplace',
  description:
    'Ingest, classify, review, store on IPFS and licence 3D assets on-chain. Every action accounted for in an append-only ledger.',
  openGraph: {
    title: 'VOID·SPACE — 3D asset marketplace',
    description: 'A multi-tenant 3D asset lifecycle platform with on-chain licensing.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#050506',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="relative min-h-screen">
        {/* Depth layers: fixed, pointer-events-none, behind everything. */}
        <div className="vs-atmosphere" aria-hidden />
        <div className="vs-grain" aria-hidden />

        {/* Keyboard users land here first; the nav is reachable but skippable. */}
        <a href="#main" className="vs-skip-link">
          Skip to content
        </a>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
