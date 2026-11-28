/**
 * Root layout.
 *
 * One set of typefaces for the whole application, self-hosted from `public/fonts` and declared with
 * `@font-face` in `globals.css`. Deliberately not Google Fonts: a marketplace that renders nothing
 * until fonts.googleapis.com answers is broken on a locked-down network, and the container build
 * cannot reach it at all.
 *
 * Plus Jakarta Sans for interface and display (geometric, slightly humanist, and not Inter — see the
 * type rules in `DESIGN.md`), JetBrains Mono for the identifiers and figures this product is made of,
 * so columns of hashes, CIDs and triangle counts line up.
 *
 * Learning, marketplace and asset tools share the light agent workspace theme.
 * Model stages keep their own rendering controls and materials.
 */
import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import './globals.css';
import './agent-workspace.css';
import './lesson-playground.css';
import './institution.css';
import './learning-experience.css';

export const metadata: Metadata = {
  title: 'Void Space — your personal learning agent',
  description:
    'Create interactive lessons with your personal learning agent. Explore models, practise, and study independently or with your institution.',
  openGraph: {
    title: 'Void Space — your personal learning agent',
    description:
      'Personal learning agents, interactive lessons and private model libraries for individuals and institutions.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  // The page ground, so a mobile browser's chrome matches the page rather than framing it.
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="relative min-h-screen">
        {/* Keyboard users land here first; the header's destinations are reachable but skippable. */}
        <a href="#main" className="vs-skip-link">
          Skip to content
        </a>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
