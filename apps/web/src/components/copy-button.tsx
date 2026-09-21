'use client';

/**
 * Copy-to-clipboard for the identifiers this platform is full of.
 *
 * CIDs, transaction hashes, token ids and addresses are all things people need *out* of the
 * interface — to verify on a block explorer, paste into a bug report, or hand to a modeller. Until
 * now they had to select 60-character strings by hand.
 */
import { useCallback, useState } from 'react';

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

  const copy = useCallback(async () => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copied`, value.length > 42 ? `${value.slice(0, 42)}…` : value);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
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
      className={compact ? 'vs-btn vs-btn-ghost' : 'vs-btn vs-btn-quiet'}
      onClick={() => void copy()}
      disabled={!value}
      aria-label={`Copy ${label.toLowerCase()}`}
      title={value ? `Copy ${label.toLowerCase()}` : 'Nothing to copy yet'}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}
