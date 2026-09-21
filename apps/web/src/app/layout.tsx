/**
 * Root layout.
 *
 * Dark substrate only — this is a CRT instrument, not a consumer site (the design direction
 * in .agents/skills/industrial-brutalist-ui picks one substrate per project and commits).
 */
import type { Metadata } from 'next';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'VOID·SPACE — 3D Asset Operations',
  description:
    'Multi-tenant 3D asset lifecycle: ingestion, AI-assisted classification, human review, IPFS-backed storage and on-chain licensing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
