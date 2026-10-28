import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads one card's data. Each card has its own state, so a slow or failing card never blanks the page.
 * A reply that arrives after a newer request was started is ignored.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => { if (id === seq.current) setState({ data, error: null, loading: false }); },
      (e: any) => { if (id === seq.current) setState((s) => ({ ...s, loading: false, error: e?.message || 'Could not load this card.' })); },
    );
  }, deps);
  useEffect(() => {
    run();
    return () => { seq.current += 1; };
  }, [run]);
  return { ...state, reload: run };
}
