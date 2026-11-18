'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

export function FieldGuideQr({ guideId, title }: { guideId: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const href = useMemo(() => {
    if (typeof window === 'undefined') return `/console/field-guides?guide=${guideId}`;
    return `${window.location.origin}/console/field-guides?guide=${guideId}`;
  }, [guideId]);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(href, {
      margin: 1,
      width: 180,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled)
          setError('The QR image could not be generated. Open or copy the link below.');
      });
    return () => {
      cancelled = true;
    };
  }, [href]);

  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-brand-warm">
        Mobile / QR deep link
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
        Scan or open this link on a signed-in device to jump straight into “{title}”.
      </p>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR code for ${title}`}
          width={180}
          height={180}
          className="mt-3 rounded-control bg-white p-1"
        />
      ) : error ? null : (
        <div className="mt-3 h-[180px] w-[180px] animate-pulse rounded-control bg-veil-8" />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-control border border-hairline px-3 text-[12px] font-semibold text-ink"
          onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error('Clipboard unavailable');
              await navigator.clipboard.writeText(href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setError('Copy is unavailable. Select the link below or use Open guide.');
            }
          }}
        >
          {copied ? 'Copied' : 'Copy deep link'}
        </button>
        <a
          href={href}
          className="inline-flex h-8 items-center rounded-control border border-transparent bg-veil-8 px-3 text-[12px] font-semibold text-ink"
        >
          Open guide
        </a>
      </div>
      <p className="mt-2 break-all font-mono text-[11px] text-ink-faint">{href}</p>
      {error ? (
        <p role="status" className="mt-2 text-xs text-ink-dim">
          {error}
        </p>
      ) : null}
    </div>
  );
}
