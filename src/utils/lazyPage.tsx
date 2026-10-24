import React, { ComponentType, lazy, Suspense } from 'react';

/** Loads a big screen only when it is first opened, so the first page load downloads much less code. Use like a normal component. */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  const Lazy = lazy(() => load().then((component) => ({ default: component as ComponentType<any> })));
  const Page: React.FC<P> = (props) => (
    <Suspense fallback={<div className="flex-1 p-6 text-sm text-slate-500">Loading…</div>}>
      <Lazy {...(props as any)} />
    </Suspense>
  );
  return Page;
}
