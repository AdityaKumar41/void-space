'use client';

/**
 * Copy-to-clipboard for the identifiers this platform is full of.
 *
 * CIDs, transaction hashes, token ids and addresses are all things people need *out* of the
 * interface — to verify on a block explorer, paste into a bug report, or hand to a modeller. Until
 * now they had to select 60-character strings by hand.
 *
 * The confirm state is a word, not a colour: DESIGN.md is explicit that state must never be
 * signalled by colour alone, and a button that silently turns green is exactly that.
 */
import { useCallback, useEffect, useState } from 'react';

import { useToast } from './toast';

export function CopyButton({
  value,
  label,
  compact = false,
}: {
  value: string | null | undefined;
  /** What is being copied, used in the confirmation. e.g. "CID". */
  label: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`, value.length > 42 ? `${value.slice(0, 42)}…` : value);
    } catch {
      setCopied(false);
      // Clipboard access needs a secure context and permission; the dashboard is served over https
      // but a browser policy can still refuse, so say so rather than pretending it worked.
      toast.failure(
        `Could not copy the ${label.toLowerCase()}`,
        'Your browser blocked clipboard access — select the value and copy it manually.',
      );
    }
  }, [value, label, toast]);

  return (
    <button
      type="button"
      data-copied={copied ? 'true' : 'false'}
      className={
        compact
          ? 'inline-flex h-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface px-2.5 text-[12px] font-semibold text-ink'
          : 'inline-flex h-8 shrink-0 items-center justify-center rounded-control border border-hairline-strong bg-transparent px-3 text-[13px] font-semibold text-ink'
      }
      style={copied ? { borderColor: 'var(--vs-published)', color: 'var(--vs-published)' } : undefined}
      onClick={() => void copy()}
      disabled={!value}
      aria-live="polite"
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      title={value ? `Copy ${label.toLowerCase()}` : 'Nothing to copy yet'}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
