'use client';
import { useState } from 'react';
import { Box } from 'lucide-react';
/** Avoid loading WebGL in listings; show saved captures when available. */
export function LibraryModelPreview({ src, title }: { src?: string; title: string }) {
  const [usable, setUsable] = useState(false);
  return (
    <span className="library-model-preview">
      <span className="library-preview-placeholder" aria-hidden="true">
        <Box size={40} strokeWidth={1.25} />
        <span>3D model</span>
        <small>Open to explore</small>
      </span>
      {src && (
        <img
          loading="lazy"
          src={src}
          alt={`Preview of ${title}`}
          className={usable ? 'is-usable' : ''}
          onError={() => setUsable(false)}
          onLoad={(event) => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 24;
              canvas.height = 24;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(event.currentTarget, 0, 0, 24, 24);
              const pixels = ctx.getImageData(0, 0, 24, 24).data;
              let visible = 0;
              for (let i = 0; i < pixels.length; i += 4)
                if (
                  pixels[i + 3]! > 30 &&
                  Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 35
                )
                  visible++;
              setUsable(visible / (24 * 24) > 0.06);
            } catch {
              setUsable(false);
            }
          }}
        />
      )}
    </span>
  );
}
