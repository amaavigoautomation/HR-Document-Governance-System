import React from 'react';
import {
  AlertTriangle, Ban, CalendarOff, CheckCircle2, Clock, Coffee, Info, LogOut, Palmtree, Sun, Sunrise, Sunset, X, XCircle,
} from 'lucide-react';

// ------------------------------------------------------------------ base styles (shared with payroll screens)

export const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#FA7014]/40 disabled:bg-slate-50';
export const btnPrimary = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#FA7014] text-white hover:bg-[#e0630f] disabled:opacity-50 transition-colors';
export const btnGhost = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors';
export const btnDanger = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50 transition-colors';
/** Large primary action for the main thing on a screen. */
export const btnBig = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold bg-[#FA7014] text-white hover:bg-[#e0630f] disabled:opacity-50 transition-colors shadow-sm';

export const Card: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; subtitle?: React.ReactNode }> = ({ title, right, children, className = '', subtitle }) => (
  <section className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}>
    {(title || right) && (
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
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

/** info = neutral blue (not a warning), warn = amber, error = red, ok = green. */
export const Notice: React.FC<{ tone?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
  const c = tone === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800'
    : tone === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-sky-50 border-sky-200 text-sky-900';
  const Icon = tone === 'error' ? XCircle : tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div className={`text-xs rounded-lg border px-3 py-2 flex gap-2 items-start ${c}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon className="w-4 h-4 shrink-0 mt-px" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
};

// ------------------------------------------------------------------ statuses (plain words + one colour each, used everywhere)

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200',
  CANCEL_REQUESTED: 'bg-orange-50 text-orange-700 border-orange-200',
  INFO_REQUESTED: 'bg-violet-50 text-violet-700 border-violet-200',
  WITHDRAWN: 'bg-slate-100 text-slate-600 border-slate-200',
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
  PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CANCEL_REQUESTED: 'Cancellation asked', INFO_REQUESTED: 'More information needed', WITHDRAWN: 'Withdrawn',
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', INCOMPLETE: 'Missed check-out', LEAVE: 'On leave', HALF_LEAVE: 'Half-day leave',
  HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', TODAY: 'Today', FUTURE: '', NOT_EMPLOYED: '',
};

const STATUS_ICON: Record<string, React.FC<{ className?: string }>> = {
  PENDING: Clock, APPROVED: CheckCircle2, REJECTED: XCircle, CANCELLED: Ban, CANCEL_REQUESTED: Clock, INFO_REQUESTED: Clock, WITHDRAWN: Ban,
  PRESENT: CheckCircle2, LATE: Clock, HALF_DAY: Sunrise, ABSENT: XCircle, INCOMPLETE: LogOut, LEAVE: Palmtree, HALF_LEAVE: Sunset,
  HOLIDAY: Sun, WEEKLY_OFF: Coffee, TODAY: Clock,
};

export const StatusPill: React.FC<{ status: string; short?: boolean }> = ({ status, short }) => {
  const Icon = STATUS_ICON[status];
  const label = STATUS_LABEL[status] ?? status;
  const text = short && status === 'PENDING' ? 'Pending' : label;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.PENDING}`}>
      {Icon && <Icon className="w-3 h-3" aria-hidden />}{text}
    </span>
  );
};

/** Attendance day look: calendar cell colours, dot colours and icons. */
export const DAY_LOOK: Record<string, { cell: string; dot: string; icon: React.FC<{ className?: string }> }> = {
  PRESENT: { cell: 'bg-emerald-50 border-emerald-200 text-emerald-800', dot: 'bg-emerald-500', icon: CheckCircle2 },
  LATE: { cell: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500', icon: Clock },
  HALF_DAY: { cell: 'bg-orange-50 border-orange-200 text-orange-800', dot: 'bg-orange-500', icon: Sunrise },
  INCOMPLETE: { cell: 'bg-rose-50 border-rose-300 text-rose-800', dot: 'bg-rose-400', icon: LogOut },
  ABSENT: { cell: 'bg-rose-50 border-rose-200 text-rose-700', dot: 'bg-rose-500', icon: XCircle },
  LEAVE: { cell: 'bg-sky-50 border-sky-200 text-sky-800', dot: 'bg-sky-500', icon: Palmtree },
  HALF_LEAVE: { cell: 'bg-sky-50 border-sky-200 text-sky-800', dot: 'bg-sky-400', icon: Sunset },
  HOLIDAY: { cell: 'bg-violet-50 border-violet-200 text-violet-800', dot: 'bg-violet-500', icon: Sun },
  WEEKLY_OFF: { cell: 'bg-slate-100 border-slate-200 text-slate-500', dot: 'bg-slate-400', icon: Coffee },
  TODAY: { cell: 'bg-white border-[#FA7014] text-slate-600', dot: 'bg-[#FA7014]', icon: Clock },
};
export const NoDayIcon = CalendarOff;

/** Plain words for balance history entries. */
export const LEDGER_LABEL: Record<string, string> = {
  OPENING: 'Opening balance', ACCRUAL: 'Credited', USED: 'Leave taken', RESTORED: 'Given back (leave cancelled)', ADJUST: 'Changed by HR',
  ENCASH: 'Encashed', LAPSE: 'Expired at year end', CARRY_OUT: 'Moved to next year', CARRY_IN: 'Brought from last year',
};

// ------------------------------------------------------------------ dates

export const dayName = (iso: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** "Mon, 3 Nov" — short form for lists. */
export const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${dayName(iso)}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
export const range = (a: string, b: string) => (a === b ? niceDate(a) : `${niceDate(a)} – ${niceDate(b)}`);
export const shortRange = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
export const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
export const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
export const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** "in 3 days", "tomorrow", "today", "2 days ago". */
export const relDay = (iso: string, today = todayIst()) => {
  const n = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
};
export const hm = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '');

// ------------------------------------------------------------------ toasts

type Toast = { id: number; tone: 'ok' | 'error'; text: string };
const ToastCtx = React.createContext<((text: string, tone?: 'ok' | 'error') => void) | null>(null);

/** Wrap a screen to show short success messages in the corner instead of small inline text. */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = React.useState<Toast[]>([]);
  const push = React.useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { id, tone, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed z-[60] bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg border ${t.tone === 'ok' ? 'bg-slate-900 text-white border-slate-800' : 'bg-rose-600 text-white border-rose-700'}`}>
            {t.tone === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}><X className="w-4 h-4 opacity-70" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};
export const useToast = () => React.useContext(ToastCtx);

/**
 * Runs an async action. Errors show as an inline notice next to the action. Success shows as a toast when the screen
 * has a ToastProvider (leave screens), otherwise as an inline notice (payroll screens keep their old behaviour).
 */
export function useRunner() {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = React.useCallback(async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (done) {
        if (toast) toast(done);
        else setNote({ tone: 'ok', text: done });
      }
    } catch (e: any) {
      setNote({ tone: 'error', text: e?.message || 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, note, setNote, run };
}

/** Plain-words note for requests that start or end on a half day, e.g. " · afternoon only". */
export const halfNote = (r: { from: string; to: string; halfFrom?: boolean; halfTo?: boolean; halfPart?: string }) => {
  if (r.from === r.to) return r.halfFrom || r.halfTo ? ` · ${r.halfPart === 'FIRST' ? 'morning only' : 'afternoon only'}` : '';
  const parts = [r.halfFrom ? 'starts after lunch' : '', r.halfTo ? 'ends at lunch' : ''].filter(Boolean);
  return parts.length ? ` · ${parts.join(', ')}` : '';
};

// ------------------------------------------------------------------ layout pieces

/** Side panel on desktop, bottom sheet on phones. Closes on Escape and on backdrop click. */
export const Drawer: React.FC<{ open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }> = ({ open, onClose, title, subtitle, children, footer }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl sm:rounded-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[30rem] bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button className="p-1.5 -m-1.5 rounded-lg hover:bg-slate-100" aria-label="Close" onClick={onClose}><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-200 px-5 py-3 bg-slate-50">{footer}</div>}
      </div>
    </div>
  );
};

/** Pill toggle, e.g. Full day | Half day. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: NoInfer<T>; label: React.ReactNode; disabled?: boolean }[]; onChange: (v: NoInfer<T>) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} disabled={o.disabled} onClick={() => onChange(o.value)}
          className={`${size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs'} font-bold rounded-md transition-colors disabled:opacity-40 ${value === o.value ? 'bg-white text-[#FA7014] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const EmptyState: React.FC<{ icon?: React.FC<{ className?: string }>; title: string; text?: string; action?: React.ReactNode }> = ({ icon: Icon = Palmtree, title, text, action }) => (
  <div className="text-center py-8 px-4">
    <div className="mx-auto w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mb-2"><Icon className="w-5 h-5 text-slate-400" /></div>
    <div className="text-sm font-bold text-slate-700">{title}</div>
    {text && <div className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">{text}</div>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export const Skeleton: React.FC<{ rows?: number; className?: string }> = ({ rows = 3, className = '' }) => (
  <div className={`space-y-2 animate-pulse ${className}`} aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-slate-100" style={{ width: `${100 - i * 8}%` }} />)}
  </div>
);

/** Button that asks "Sure?" inline before running, instead of a browser popup. */
export const ConfirmButton: React.FC<{ className?: string; disabled?: boolean; question?: string; yes?: string; onConfirm: () => void; children: React.ReactNode }> = ({ className = btnDanger, disabled, question = 'Sure?', yes = 'Yes', onConfirm, children }) => {
  const [asking, setAsking] = React.useState(false);
  if (!asking) return <button className={className} disabled={disabled} onClick={() => setAsking(true)}>{children}</button>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="font-semibold text-slate-600">{question}</span>
      <button className={btnDanger} disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>{yes}</button>
      <button className={btnGhost} onClick={() => setAsking(false)}>No</button>
    </span>
  );
};
