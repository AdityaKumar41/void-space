import * as React from 'react';
import Link from 'next/link';

import { cn } from '../../lib/cn';
import { ArrowLeftIcon } from './icons';

/**
 * A link back to the list a detail page was opened from.
 *
 * Carried as a component rather than typed per page because the arrow, the gap and the hover tone are
 * the same three decisions on every detail view, and a back link that sits half a pixel differently
 * on two screens is the kind of drift nobody fixes.
 */
export function BackLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors duration-150 ease-standard hover:text-ink',
        className,
      )}
    >
      <ArrowLeftIcon width={14} height={14} />
      {children}
    </Link>
  );
}
