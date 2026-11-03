import React, { useCallback, useEffect, useState } from 'react';
import { Notice, Skeleton } from '../leave/ui';

/** Loads something once and again on demand. */
export function useLoad<T = any>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => { setLoading(true); return fn().then((d) => { setData(d); setError(null); }).catch((e) => setError(e?.message || 'Could not load.')).finally(() => setLoading(false)); }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export const Loading: React.FC<{ error?: string | null; loading?: boolean }> = ({ error, loading }) =>
  error ? <Notice tone="error">{error}</Notice> : loading ? <Skeleton rows={3} /> : null;

const TONE: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200', amber: 'bg-amber-50 text-amber-800 border-amber-200', red: 'bg-rose-50 text-rose-700 border-rose-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200', slate: 'bg-slate-100 text-slate-600 border-slate-200',
};
export const Pill: React.FC<{ tone?: keyof typeof TONE; children: React.ReactNode }> = ({ tone = 'slate', children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${TONE[tone]}`}>{children}</span>
);
