'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { GUIDE, guideHref } from '../content/studio-guide';
import { cn } from '../lib/cn';

const GROUPS = ['Start', 'The editor', 'VOID·SPACE'] as const;

export function StudioGuideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Studio guide"
      className="min-w-0 max-w-full lg:sticky lg:top-14 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:py-8"
    >
      <div className="flex gap-2 overflow-x-auto px-5 py-3 lg:flex-col lg:gap-7 lg:overflow-visible lg:px-0 lg:py-0">
        {GROUPS.map((group) => (
          <div key={group} className="flex shrink-0 items-center gap-2 lg:block">
            <div className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint lg:block">
              {group}
            </div>
            <ul className="flex gap-1 lg:mt-2 lg:flex-col lg:gap-0.5">
              {GUIDE.filter((page) => page.group === group).map((page) => {
                const href = guideHref(page);
                const current = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'block whitespace-nowrap rounded-control px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-standard lg:whitespace-normal lg:px-2',
                        current
                          ? 'bg-heat-12 font-semibold text-ink'
                          : 'text-ink-dim hover:bg-veil-6 hover:text-ink',
                      )}
                    >
                      {page.slug ? page.title : 'Overview'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
