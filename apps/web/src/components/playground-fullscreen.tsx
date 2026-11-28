'use client';
import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { action } from './learning-ui';
/** Native fullscreen is optional; the playground always occupies the app viewport. */
export function PlaygroundFullscreen() {
  const button = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(false),
    [supported, setSupported] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setSupported(document.fullscreenEnabled);
    const sync = () =>
      setActive(!!document.fullscreenElement?.classList.contains('lesson-playground'));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return (
    <div className="playground-fullscreen-control">
      <button
        ref={button}
        className={action}
        disabled={!supported}
        aria-label={active ? 'Exit browser fullscreen' : 'Enter browser fullscreen'}
        title={
          supported
            ? 'Escape exits browser fullscreen'
            : 'The playground fills the window. Browser fullscreen is unavailable on this device.'
        }
        onClick={async () => {
          setError('');
          try {
            if (active) await document.exitFullscreen();
            else
              await button.current?.closest<HTMLElement>('.lesson-playground')?.requestFullscreen();
          } catch {
            setError('Browser fullscreen could not open. The playground still fills this window.');
          }
        }}
      >
        {active ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      {error && <span role="status">{error}</span>}
    </div>
  );
}
