import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The shared page look: a title tile with subtitle, pastel number cards, underline tabs, a quiet table style and paging.
 * New screens use these so every module reads the same; older screens can move over one at a time.
 */
type Icon = React.ComponentType<{ className?: string }>;

export const PageHeader: React.FC<{ icon: Icon; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode }> = ({ icon: I, title, subtitle, actions, badge }) => (
  <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
    <div className="flex items-center gap-4 min-w-0">
      <span className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 text-[#6d4cf0] flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(109,76,240,0.08)]"><I className="w-6 h-6" /></span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap"><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>{badge}</div>
        {subtitle && <p className="text-sm text-slate-600 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export type Tone = 'violet' | 'green' | 'amber' | 'rose' | 'blue';
const TONES: Record<Tone, { card: string; circle: string }> = {
  violet: { card: 'bg-gradient-to-br from-violet-50 to-white border-violet-100', circle: 'bg-violet-100 text-violet-600' },
  green: { card: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-100', circle: 'bg-emerald-100 text-emerald-600' },
  amber: { card: 'bg-gradient-to-br from-orange-50 to-white border-orange-100', circle: 'bg-orange-100 text-orange-500' },
  rose: { card: 'bg-gradient-to-br from-rose-50 to-white border-rose-100', circle: 'bg-rose-100 text-rose-500' },
  blue: { card: 'bg-gradient-to-br from-sky-50 to-white border-sky-100', circle: 'bg-sky-100 text-sky-600' },
};

/** A number with an icon in a soft circle: label on top, big value, optional line underneath. */
export const KpiCard: React.FC<{ icon: Icon; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; onClick?: () => void }> = ({ icon: I, label, value, hint, tone = 'violet', onClick }) => {
  const t = TONES[tone];
  const body = (
    <>
      <span className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${t.circle}`}><I className="w-5 h-5" /></span>
      <span className="min-w-0 text-left">
        <span className="block text-[13px] font-semibold text-slate-600 truncate">{label}</span>
        <span className="block text-3xl font-extrabold text-slate-900 leading-tight">{value}</span>
        {hint && <span className="block text-xs text-slate-500 truncate">{hint}</span>}
      </span>
    </>
  );
  const cls = `flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${t.card}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} w-full hover:shadow-md transition-shadow cursor-pointer`}>{body}</button> : <div className={cls}>{body}</div>;
};
export const KpiGrid: React.FC<{ children: React.ReactNode; cols?: 3 | 4 | 5 }> = ({ children, cols = 4 }) => (
  <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 ${cols === 5 ? 'lg:grid-cols-5' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>{children}</div>
);

/** Tabs with a violet underline under the open one and an optional count bubble. */
export function UnderlineTabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; badge?: number }[] }) {
  return (
    <div role="tablist" className="flex items-center gap-6 border-b border-slate-200 overflow-x-auto">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={`relative flex items-center gap-2 whitespace-nowrap py-3 text-sm font-bold cursor-pointer ${on ? 'text-[#6d4cf0]' : 'text-slate-700 hover:text-slate-900'}`}>
            {o.label}
            {!!o.badge && <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-[#6d4cf0] text-white text-[11px] font-bold flex items-center justify-center">{o.badge}</span>}
            {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-[#6d4cf0]" />}
          </button>
        );
      })}
    </div>
  );
}

/** Class names for a table in the shared look: tinted header, quiet dividers, roomy rows. */
export const tbl = {
  wrap: 'bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
  table: 'w-full text-left text-sm border-collapse',
  headRow: 'bg-violet-50/60 text-slate-700 text-xs font-bold',
  th: 'py-3.5 px-4 whitespace-nowrap',
  body: 'divide-y divide-slate-100',
  row: 'hover:bg-slate-50/70 transition-colors',
  td: 'py-3.5 px-4 align-middle',
};

/** A soft tinted pill for versions, statuses and categories. */
export const Chip: React.FC<{ tone?: Tone | 'slate'; children: React.ReactNode }> = ({ tone = 'slate', children }) => {
  const c = { violet: 'bg-violet-100 text-violet-700', green: 'bg-emerald-100 text-emerald-700', amber: 'bg-orange-100 text-orange-700', rose: 'bg-rose-100 text-rose-700', blue: 'bg-sky-100 text-sky-700', slate: 'bg-slate-100 text-slate-700' }[tone];
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${c}`}>{children}</span>;
};

export const Pagination: React.FC<{ page: number; pageSize: number; total: number; onPage: (p: number) => void; noun?: string }> = ({ page, pageSize, total, onPage, noun = 'items' }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1; const to = Math.min(total, page * pageSize);
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  const btn = 'min-w-[2rem] h-8 px-2 rounded-lg border text-sm font-bold flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-default';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
      <span>Showing {from} – {to} of {total} {noun}</span>
      <div className="flex items-center gap-1.5">
        <button className={`${btn} border-slate-200 bg-white text-slate-600`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
        {nums.map((n, i) => (
          <React.Fragment key={n}>
            {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
            <button className={`${btn} ${n === page ? 'bg-[#6d4cf0] border-[#6d4cf0] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
          </React.Fragment>
        ))}
        <button className={`${btn} border-slate-200 bg-white text-slate-600`} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

/** Big header card for the Document Governance screens: title, badge, line of text, illustration and actions. */
export const HeroCard: React.FC<{ icon: Icon; title: React.ReactNode; badge?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }> = ({ icon: I, title, badge, subtitle, actions }) => (
  <div className="relative overflow-hidden bg-gradient-to-r from-white via-white to-violet-50 rounded-2xl p-6 border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
    <div className="relative z-10 min-w-0 max-w-2xl">
      <div className="flex items-center flex-wrap gap-3">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">{title}</h1>
        {badge && <span className="bg-violet-100 text-violet-700 text-xs px-3 py-1 rounded-full font-bold">{badge}</span>}
      </div>
      {subtitle && <p className="text-sm text-slate-600 mt-2">{subtitle}</p>}
    </div>
    <div className="relative z-10 flex flex-wrap items-center gap-3 lg:ml-auto">
      <div className="hidden xl:block relative w-36 h-28 shrink-0">
      <svg aria-hidden="true" viewBox="0 0 150 120" className="w-full h-full">
        <g transform="rotate(-8 60 60)">
          <rect x="20" y="14" width="78" height="96" rx="9" fill="#ede9fe" stroke="#ddd6fe" />
          <rect x="30" y="26" width="58" height="9" rx="4" fill="#c4b5fd" opacity=".7" />
          <rect x="30" y="44" width="58" height="5" rx="2.5" fill="#c4b5fd" opacity=".55" />
          <rect x="30" y="56" width="46" height="5" rx="2.5" fill="#c4b5fd" opacity=".55" />
          <rect x="30" y="68" width="52" height="5" rx="2.5" fill="#c4b5fd" opacity=".55" />
        </g>
        <circle cx="104" cy="82" r="22" fill="#6d4cf0" />
      </svg>
      <span className="absolute w-6 h-6 text-white -translate-x-1/2 -translate-y-1/2" style={{ left: '69.3%', top: '68.3%' }}><I className="w-6 h-6" /></span>
      </div>
      {actions}
    </div>
  </div>
);

/** A labelled select / date field in the filter row (icon, label, bold value). */
export const FilterField: React.FC<{ icon: Icon; label: string; children: React.ReactNode }> = ({ icon: I, label, children }) => (
  <label className="flex items-center gap-2 h-11 bg-white border border-slate-300 rounded-xl px-3.5 text-sm text-slate-600 focus-within:border-[#6d4cf0]">
    <I className="w-4 h-4 text-slate-500" />
    <span>{label}</span>
    {children}
  </label>
);

export const filterCard = 'bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col lg:flex-row items-stretch lg:items-center gap-3';
export const searchInput = 'w-full h-11 pl-10 pr-4 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#6d4cf0]/25 focus:border-[#6d4cf0] placeholder:text-slate-400 transition-all';
