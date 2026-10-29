import React, { useCallback, useEffect, useState } from 'react';
import { RATINGS } from '../../services/perfService';
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

export const REVIEW_LABEL: Record<string, string> = {
  CONFIGURATION_PENDING: 'Needs configuration', DEFERRED: 'Deferred (leave)', SELF_PENDING: 'Self-assessment due', MANAGER_PENDING: 'Manager review due',
  DISCUSSION_PENDING: 'Feedback discussion due', HR_REVIEW: 'HR review', APPROVAL_PENDING: 'Waiting for approval', PUBLISHED: 'Published',
  ACKNOWLEDGED: 'Acknowledged', DISPUTED: 'Disputed', CLOSED: 'Closed',
};
export const reviewTone = (s: string): keyof typeof TONE =>
  s === 'ACKNOWLEDGED' || s === 'CLOSED' || s === 'PUBLISHED' ? 'green' : s === 'DISPUTED' || s === 'CONFIGURATION_PENDING' ? 'red' : s === 'DEFERRED' ? 'slate' : 'amber';
export const ReviewPill: React.FC<{ status: string }> = ({ status }) => <Pill tone={reviewTone(status)}>{REVIEW_LABEL[status] || status}</Pill>;

export const PLAN_LABEL: Record<string, string> = {
  CONFIGURATION_PENDING: 'Needs configuration', DRAFT: 'Manager customising', SUBMITTED: 'Waiting for HR approval', PENDING_ACK: 'Waiting for employee', ACTIVE: 'Active', SUPERSEDED: 'Superseded',
};
export const PlanPill: React.FC<{ status: string }> = ({ status }) => (
  <Pill tone={status === 'ACTIVE' ? 'green' : status === 'CONFIGURATION_PENDING' ? 'red' : status === 'SUPERSEDED' ? 'slate' : 'amber'}>{PLAN_LABEL[status] || status}</Pill>
);

/** 1 to 5, or "not observed". Never defaults: leaving it empty is a visible choice. */
export const RatingSelect: React.FC<{ value: number | null; onChange: (v: number | null) => void; disabled?: boolean; notObserved?: boolean; onNotObserved?: (v: boolean) => void; naLabel?: string }> = ({ value, onChange, disabled, notObserved, onNotObserved, naLabel = 'Not observed' }) => (
  <div className="flex flex-wrap items-center gap-1.5">
    {RATINGS.map((r) => (
      <button key={r.value} type="button" disabled={disabled} title={r.label} onClick={() => { onNotObserved?.(false); onChange(value === r.value && !notObserved ? null : r.value); }}
        className={`w-8 h-8 rounded-lg text-xs font-bold border transition-colors ${value === r.value && !notObserved ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'} disabled:opacity-50`}>{r.value}</button>
    ))}
    {onNotObserved && (
      <button type="button" disabled={disabled} onClick={() => { onNotObserved(!notObserved); onChange(null); }}
        className={`px-2 h-8 rounded-lg text-[11px] font-bold border ${notObserved ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'} disabled:opacity-50`}>{naLabel}</button>
    )}
    {value && !notObserved && <span className="text-[11px] text-slate-500">{RATINGS[value - 1].label}</span>}
  </div>
);

export const fmtScore = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(2));
