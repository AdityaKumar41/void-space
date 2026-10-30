import Link from 'next/link';

import { StudioGuideNav } from '../../components/studio-guide-nav';
import { CubeIcon } from '../../components/ui/icons';

export default function StudioGuideLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-base text-ink">
      <header className="sticky top-0 z-40 border-b border-hairline bg-[rgba(10,10,10,0.86)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-4 px-5 sm:px-8">
          <Link href="/docs" className="flex items-center gap-2.5 text-ink">
            <CubeIcon className="text-brand" width={18} height={18} strokeWidth={1.4} />
            <span className="text-[14px] font-semibold tracking-[-0.02em]">VOID·STUDIO</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Guide</span>
          </Link>
          <div className="ml-auto flex items-center gap-4 text-[13px]">
            <Link href="/" className="text-ink-dim transition-colors duration-150 ease-standard hover:text-ink">
              Platform
            </Link>
            <Link
              href="/login?next=/studio/connect"
              className="font-semibold text-ink transition-colors duration-150 ease-standard hover:text-brand-warm"
            >
              Open Studio
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1120px] lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <StudioGuideNav />
        <main id="main" className="min-w-0 px-5 py-10 sm:px-8 lg:px-0 lg:py-14 lg:pr-8">
          {children}
        </main>
      </div>
    </div>
  );
}
