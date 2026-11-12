import React from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';

/** Shared pieces for the Leave & Attendance screens (violet theme). */

export const btnViolet = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 cursor-pointer transition-colors';
export const btnOutline = 'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-violet-300 hover:bg-violet-50/40 disabled:opacity-50 cursor-pointer transition-colors';
export const field = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200';

export const PageHead: React.FC<{ title: string; subtitle: string; children?: React.ReactNode }> = ({ title, subtitle, children }) => (
  <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
    </div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
  </header>
);

const TONES = {
  green: ['bg-gradient-to-br from-emerald-100/70 to-green-50', 'bg-emerald-100 text-emerald-600'],
  violet: ['bg-gradient-to-br from-violet-100/80 to-indigo-50', 'bg-violet-100 text-violet-600'],
  orange: ['bg-gradient-to-br from-orange-100/80 to-amber-50', 'bg-orange-100 text-orange-600'],
  rose: ['bg-gradient-to-br from-rose-100/70 to-red-50', 'bg-rose-100 text-rose-600'],
  blue: ['bg-gradient-to-br from-sky-100/80 to-blue-50', 'bg-sky-100 text-sky-600'],
} as const;
export type Tone = keyof typeof TONES;

export const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tone: Tone; Icon: React.FC<{ className?: string }> }> = ({ label, value, sub, tone, Icon }) => (
  <div className={`flex min-w-0 items-center gap-3.5 rounded-2xl border border-white px-4 py-3.5 shadow-sm ${TONES[tone][0]}`}>
    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${TONES[tone][1]}`}><Icon className="h-6 w-6" /></span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm text-slate-700">{label}</span>
      <span className="block truncate text-3xl font-bold leading-tight tabular-nums text-slate-950">{value}</span>
      {sub && <span className="block truncate text-xs text-slate-600">{sub}</span>}
    </span>
  </div>
);

export const Panel: React.FC<{ title?: React.ReactNode; Icon?: React.FC<{ className?: string }>; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, Icon, right, className = '', children }) => (
  <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
    {(title || right) && (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-950">{Icon && <Icon className="h-5 w-5 text-violet-600" />}{title}</h2>{right}
      </div>
    )}
    {children}
  </section>
);

export const Tabs: React.FC<{ tabs: { key: string; label: string; count?: number }[]; value: string; onChange: (k: string) => void }> = ({ tabs, value, onChange }) => (
  <div className="flex flex-wrap gap-x-7 gap-y-1 border-b border-slate-200" role="tablist">
    {tabs.map((t) => (
      <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
        className={`-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-3 pt-2 text-sm font-semibold cursor-pointer ${value === t.key ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-800 hover:text-violet-700'}`}>
        {t.label}
        {t.count !== undefined && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${value === t.key ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{t.count}</span>}
      </button>
    ))}
  </div>
);

export const Pager: React.FC<{ page: number; total: number; per: number; noun: string; onPage: (n: number) => void }> = ({ page, total, per, noun, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / per));
  const cur = Math.min(page, pages);
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <span>{total === 0 ? 'Showing 0' : `Showing ${(cur - 1) * per + 1} – ${Math.min(cur * per, total)}`} of {total} {noun}</span>
      {pages > 1 && (
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous page" disabled={cur === 1} onClick={() => onPage(cur - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
          {nums.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
              <button type="button" onClick={() => onPage(n)} aria-current={n === cur ? 'page' : undefined} className={`h-9 w-9 rounded-lg border text-sm font-semibold cursor-pointer ${n === cur ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}>{n}</button>
            </React.Fragment>
          ))}
          <button type="button" aria-label="Next page" disabled={cur === pages} onClick={() => onPage(cur + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthShort = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** "Jan 2025" box with previous and next arrows. */
export const MonthChip: React.FC<{ month: string; onShift: (n: number) => void; disableNext?: boolean }> = ({ month, onShift, disableNext }) => (
  <div className="flex h-11 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 shadow-sm">
    <CalendarDays className="ml-1 h-4 w-4 text-violet-600" />
    <span className="min-w-[5.5rem] px-1 text-center text-sm font-semibold text-slate-800">{monthShort(month)}</span>
    <button type="button" aria-label="Previous month" onClick={() => onShift(-1)} className="rounded-lg p-1.5 hover:bg-slate-100 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
    <button type="button" aria-label="Next month" disabled={disableNext} onClick={() => onShift(1)} className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
  </div>
);

export const shiftMonthStr = (month: string, n: number) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };

export const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; className?: string }> = ({ value, onChange, placeholder, className = '' }) => (
  <label className={`relative block ${className}`}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${field} w-full pl-9`} aria-label={placeholder} />
  </label>
);

export const Select: React.FC<{ value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; className?: string }> = ({ value, onChange, options, label, className = '' }) => (
  <label className={`relative inline-block ${className}`}>
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={`${field} w-full appearance-none pr-9 font-medium cursor-pointer`}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
  </label>
);

export const THead: React.FC<{ cols: string[] }> = ({ cols }) => (
  <thead><tr className="bg-slate-50 text-xs font-semibold text-slate-700">{cols.map((c) => <th key={c} className="whitespace-nowrap px-3 py-3 first:rounded-l-lg last:rounded-r-lg">{c}</th>)}</tr></thead>
);

export const pillTone: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', violet: 'bg-violet-50 text-violet-700',
  blue: 'bg-sky-50 text-sky-700', slate: 'bg-slate-100 text-slate-600', orange: 'bg-orange-50 text-orange-700',
};
export const Pill: React.FC<{ tone?: string; children: React.ReactNode }> = ({ tone = 'slate', children }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${pillTone[tone] || pillTone.slate}`}>{children}</span>
);

/** DD Mon YYYY. */
export const dmy = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** "09:02" to "09:02 AM". */
export const t12 = (hhmm?: string | null) => {
  if (!hhmm) return '--';
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
