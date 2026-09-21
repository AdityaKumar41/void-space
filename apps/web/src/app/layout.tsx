import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'VOID·SPACE — 3D Asset Management & XR Publishing',
  description:
    'AI-enhanced, multi-tenant 3D digital asset management with decentralized storage and on-chain licensing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-void-950 text-foreground">{children}</body>
    </html>
  );
}
