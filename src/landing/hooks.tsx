import React, { useEffect, useRef, useState } from 'react';
import { navigate } from './routes';

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has scrolled into view (stays true). Everything is visible at once for reduced motion. */
export function useInView<T extends HTMLElement>(threshold = 0.18): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, seen];
}

interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  as?: keyof React.JSX.IntrinsicElements;
  delay?: number;
  variant?: 'up' | 'left' | 'right' | 'zoom' | 'fade';
}

/** Fades and slides its children in the first time they scroll into view. */
export const Reveal: React.FC<RevealProps> = ({ as = 'div', delay = 0, variant = 'up', className = '', style, children, ...rest }) => {
  const [ref, seen] = useInView<HTMLElement>();
  const Tag = as as React.ElementType;
  return (
    <Tag
      ref={ref}
      className={`lp-reveal lp-reveal-${variant} ${seen ? 'is-in' : ''} ${className}`}
      style={{ ...style, ['--d' as string]: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

/** Counts up to `value` when scrolled into view. */
export const CountUp: React.FC<{ value: number; suffix?: string; prefix?: string; duration?: number; format?: boolean }> = ({
  value,
  suffix = '',
  prefix = '',
  duration = 1400,
  format = false,
}) => {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, duration]);
  return (
    <span ref={ref}>
      {prefix}
      {format ? shown.toLocaleString('en-IN') : shown}
      {suffix}
    </span>
  );
};

/** Cards that glow where the cursor is. Spread onto an element: `<div {...spotlight}>`. */
export const spotlight = {
  onMouseMove: (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
  },
};

/** Moves its CSS variables --rx / --ry (-1 to 1) with the pointer, for gentle parallax. */
export function useParallax<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        const y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
        node.style.setProperty('--rx', Math.max(-1, Math.min(1, x)).toFixed(3));
        node.style.setProperty('--ry', Math.max(-1, Math.min(1, y)).toFixed(3));
      });
    };
    const leave = () => {
      node.style.setProperty('--rx', '0');
      node.style.setProperty('--ry', '0');
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
    };
  }, []);
  return ref;
}

/** Scroll position in pixels and as 0-1 progress of the whole page. */
export function useScroll(): { y: number; progress: number } {
  const [state, setState] = useState({ y: 0, progress: 0 });
  useEffect(() => {
    let raf = 0;
    const read = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setState({ y: window.scrollY, progress: Math.min(1, window.scrollY / max) });
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return state;
}

/** Index that advances every `ms`, unless paused. Resets the timer whenever `key` changes. */
export function useRotation(length: number, ms: number, paused: boolean, key: unknown): [number, (i: number) => void] {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (paused || prefersReducedMotion() || length < 2) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % length), ms);
    return () => window.clearTimeout(id);
  }, [index, length, ms, paused, key]);
  return [index, setIndex];
}

/** Link that moves between marketing pages without reloading. */
export const Link: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }> = ({ to, onClick, children, ...rest }) => (
  <a
    href={to}
    onClick={(e) => {
      onClick?.(e);
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    }}
    {...rest}
  >
    {children}
  </a>
);
