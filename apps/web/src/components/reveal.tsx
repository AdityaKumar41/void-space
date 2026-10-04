'use client';

/**
 * Scroll-reveal + count-up motion.
 *
 * The design system's one motion rule (globals.css): "elements never appear statically; each view
 * lifts in once. Transform + opacity only." Both components below implement exactly that, and no
 * more. Nothing re-animates on scroll-back, because a page that re-plays its entrances while you
 * read it is a page fighting you.
 *
 * `prefers-reduced-motion` is honoured in code as well as in the global CSS rule: the animated state
 * is applied instantly, not left to a transition that the media rule has to cancel.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const EASE = 'cubic-bezier(0.25, 0.1, 0.25, 1)';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Lifts children in once, when they first enter the viewport.
 *
 * SSR renders the settled state; the hidden state is applied on mount so a snapshot or a no-JS
 * client never loses content. A wrapper is always a block-level box, so it can break an inline
 * layout — use `className="contents"` if the children are meant to stay in flow.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  style,
}: {
  readonly children: ReactNode;
  /** Stagger offset in ms. Pass `index * step` for a cascade across a grid. */
  readonly delay?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(18px)',
        transition: `opacity 650ms ${EASE} ${delay}ms, transform 650ms ${EASE} ${delay}ms`,
        willChange: shown ? 'auto' : 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Counts from zero to `value` the first time it is visible.
 *
 * Renders the formatted number each frame (`tabular-nums` so a running counter does not jitter a
 * column of figures). Falls back to the final value instantly under reduced motion, and never
 * re-runs once started.
 */
export function CountUp({
  value,
  duration = 900,
  format = (n: number) => n.toLocaleString('en-US'),
  className,
}: {
  readonly value: number;
  readonly duration?: number;
  readonly format?: (n: number) => string;
  readonly className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || started.current) return;
          started.current = true;
          observer.disconnect();

          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            setShown(Math.round(value * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [value, duration]);

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(shown)}
    </span>
  );
}