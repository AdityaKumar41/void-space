'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Open a shared destination once, and clear it when the user returns to the list. */
export function useLinkedItem<T extends { id: string }>(
  parameter: string,
  items: readonly T[] | undefined,
) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const handled = useRef<string | null>(null);
  const [active, setActive] = useState<T | null>(null);
  const linkedId = params.get(parameter);
  useEffect(() => {
    if (!linkedId) {
      handled.current = null;
      return;
    }
    if (handled.current === linkedId) return;
    const item = items?.find((candidate) => candidate.id === linkedId);
    if (item) {
      handled.current = linkedId;
      setActive(item);
    }
  }, [linkedId, items]);
  function select(item: T | null) {
    setActive(item);
    if (!item && linkedId) {
      const next = new URLSearchParams(params.toString());
      next.delete(parameter);
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
    }
  }
  const unavailable = Boolean(linkedId && items && !items.some((item) => item.id === linkedId));
  return [active, select, unavailable] as const;
}
