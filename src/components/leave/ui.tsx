import React from 'react';

export const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FA7014]/40 disabled:bg-slate-50';
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#FA7014] text-white hover:bg-[#e0630f] disabled:opacity-50 transition-colors';
export const btnGhost = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors';
export const btnDanger = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50 transition-colors';

export const Card: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, right, children, className = '' }) => (
  <section className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}>
    {(title || right) && (
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {right}
      </div>
    )}
    {children}
  </section>
);

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block text-xs font-semibold text-slate-600 space-y-1">
    <span>{label}</span>
    {children}
    {hint && <span className="block font-normal text-slate-400">{hint}</span>}
  </label>
);

export const Notice: React.FC<{ tone?: 'info' | 'error' | 'ok'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
  const c = tone === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800';
  return <div className={`text-xs rounded-lg border px-3 py-2 ${c}`}>{children}</div>;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCEL_REQUESTED: 'bg-orange-50 text-orange-700 border-orange-200',
  PRESENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  LATE: 'bg-amber-50 text-amber-700 border-amber-200',
  HALF_DAY: 'bg-orange-50 text-orange-700 border-orange-200',
  ABSENT: 'bg-rose-50 text-rose-700 border-rose-200',
  INCOMPLETE: 'bg-rose-50 text-rose-700 border-rose-200',
  LEAVE: 'bg-sky-50 text-sky-700 border-sky-200',
  HALF_LEAVE: 'bg-sky-50 text-sky-700 border-sky-200',
  HOLIDAY: 'bg-violet-50 text-violet-700 border-violet-200',
  WEEKLY_OFF: 'bg-slate-100 text-slate-500 border-slate-200',
  TODAY: 'bg-blue-50 text-blue-700 border-blue-200',
  FUTURE: 'bg-white text-slate-300 border-slate-100',
  NOT_EMPLOYED: 'bg-white text-slate-300 border-slate-100',
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CANCEL_REQUESTED: 'Cancel requested',
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', INCOMPLETE: 'No check-out', LEAVE: 'Leave', HALF_LEAVE: 'Half leave',
  HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', TODAY: 'Today', FUTURE: '', NOT_EMPLOYED: '',
};

export const StatusPill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] || STATUS_STYLE.PENDING}`}>{STATUS_LABEL[status] ?? status}</span>
);

export const dayName = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const niceDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const range = (a: string, b: string) => (a === b ? niceDate(a) : `${niceDate(a)} – ${niceDate(b)}`);
export const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
export const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Runs an async action, shows its result as a notice. */
export function useRunner() {
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = React.useCallback(async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (done) setNote({ tone: 'ok', text: done });
    } catch (e: any) {
      setNote({ tone: 'error', text: e?.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, note, setNote, run };
}

/** Plain-words note for requests that start or end on a half day, e.g. " · second half only". */
export const halfNote = (r: { from: string; to: string; halfFrom?: boolean; halfTo?: boolean; halfPart?: string }) => {
  if (r.from === r.to) return r.halfFrom || r.halfTo ? ` · ${r.halfPart === 'FIRST' ? 'first half (morning)' : 'second half (afternoon)'} only` : '';
  const parts = [r.halfFrom ? 'from the second half of the first day' : '', r.halfTo ? 'until the first half of the last day' : ''].filter(Boolean);
  return parts.length ? ` · ${parts.join(', ')}` : '';
};
