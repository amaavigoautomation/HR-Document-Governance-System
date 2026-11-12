import React, { useLayoutEffect, useRef } from 'react';

/**
 * Two-column masonry with no gaps. Every card stays in one parent (so nothing remounts when cards load or resize);
 * a CSS grid made of 1px rows places each card by its measured height, and dense packing sends the next card to
 * whichever column ends first. One column below the xl breakpoint.
 */
const Cell: React.FC<{ gap: number; children: React.ReactNode }> = ({ gap, children }) => {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const el = inner.current;
    if (!o || !el) return;
    const fit = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      o.style.gridRowEnd = `span ${h > 0 ? h + gap : 1}`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gap]);
  return <div ref={outer}><div ref={inner}>{children}</div></div>;
};

export const Masonry: React.FC<{ id?: string; gap?: number; children: React.ReactNode }> = ({ id, gap = 16, children }) => {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div id={id} className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 grid-flow-dense" style={{ gridAutoRows: '1px' }}>
      {items.map((c, i) => <Cell key={React.isValidElement(c) && c.key != null ? String(c.key) : i} gap={gap}>{c}</Cell>)}
    </div>
  );
};
