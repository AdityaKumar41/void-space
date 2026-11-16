'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { gatewayUrl, thumbnailUrl } from '../lib/public-api';
import {
  isThumbnailModelFormat,
  readModelThumbnail,
  renderModelThumbnail,
  storeModelThumbnail,
} from '../lib/model-thumbnails';

interface AssetThumbnailProps {
  readonly cid: string | null;
  readonly alt: string;
  readonly format?: string | null;
  readonly pinned?: boolean;
  readonly fallback: ReactNode;
}

const warnedFailures = new Set<string>();

export function AssetThumbnail({
  cid,
  alt,
  format,
  pinned = false,
  fallback,
}: AssetThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [serverMissed, setServerMissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(cid));
  const [loadingLabel, setLoadingLabel] = useState('Loading preview');
  const canGenerate = Boolean(cid && pinned && isThumbnailModelFormat(format));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setVisible(entry.isIntersecting);
      },
      { rootMargin: '160px' },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setSource(null);
    setServerMissed(false);
    setFailed(false);
    setLoading(Boolean(cid));
    setLoadingLabel('Loading preview');

    if (!cid) return () => {
      active = false;
    };

    void readModelThumbnail(cid)
      .then((cached) => {
        if (!active) return;
        if (cached) {
          const url = URL.createObjectURL(cached);
          blobUrlRef.current = url;
          setSource(url);
        } else {
          setSource(thumbnailUrl(cid));
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (!warnedFailures.has('cache-read')) {
          warnedFailures.add('cache-read');
          console.warn('[thumbnail] Could not read persistent thumbnail cache', error);
        }
        setSource(thumbnailUrl(cid));
      });

    return () => {
      active = false;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [cid]);

  useEffect(() => {
    if (!cid || !canGenerate || !visible || !serverMissed) return;

    let active = true;
    setLoading(true);
    setLoadingLabel('Generating 3D preview');

    void renderModelThumbnail(cid, gatewayUrl(cid))
      .then(async (thumbnail) => {
        try {
          await storeModelThumbnail(cid, thumbnail);
        } catch (error) {
          if (!warnedFailures.has('cache-write')) {
            warnedFailures.add('cache-write');
            console.warn('[thumbnail] Could not persist generated model thumbnails', error);
          }
        }

        if (!active) return;
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(thumbnail);
        blobUrlRef.current = url;
        setSource(url);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (!warnedFailures.has(cid)) {
          warnedFailures.add(cid);
          console.warn(`[thumbnail] Could not render model preview for ${cid}`, error);
        }
        setSource(null);
        setFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canGenerate, cid, serverMissed, visible]);

  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    },
    [],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {failed || !source ? (
        fallback
      ) : (
        <img
          key={source}
          src={source}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(canGenerate);
            if (canGenerate) {
              setServerMissed(true);
            } else {
              setFailed(true);
            }
          }}
          className="h-full w-full object-cover"
        />
      )}
      {loading && !failed ? (
        <div
          role="status"
          aria-label={loadingLabel}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-deeper/75 text-ink-faint"
        >
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-faint/30 border-t-brand" />
          <span className="font-mono text-[10px]">{loadingLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
