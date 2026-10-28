import React from 'react';
import { FileX, RefreshCw } from 'lucide-react';
import { Card, Skeleton } from '../leave/ui';

/** The empty state every card shares: a faded file icon and "No data available". */
export const NoData: React.FC<{ text?: string; hint?: React.ReactNode }> = ({ text = 'No data available', hint }) => (
  <div className="flex flex-col items-center justify-center text-center py-8 text-slate-400">
    <FileX className="w-10 h-10 mb-2 opacity-60" aria-hidden />
    <p className="text-xs font-medium">{text}</p>
    {hint && <div className="mt-1 text-[11px] text-slate-400">{hint}</div>}
  </div>
);

/** One card: title row, then loading, error (with Retry), empty or the content. */
export const HomeCard: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
  emptyHint?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}> = ({ title, icon, right, loading, error, onRetry, empty, emptyText, emptyHint, className = '', children }) => (
  <Card className={className} title={<span className="inline-flex items-center gap-2">{icon}{title}</span>} right={right}>
    {error ? (
      <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2" role="alert">
        <span>{error}</span>
        {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-bold underline"><RefreshCw className="w-3 h-3" />Retry</button>}
      </div>
    ) : loading ? (
      <Skeleton rows={3} />
    ) : empty ? (
      <NoData text={emptyText} hint={emptyHint} />
    ) : (
      children
    )}
  </Card>
);

/** Small tab row used inside cards. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: NoInfer<T>) => void; items: { value: NoInfer<T>; label: string; count?: number }[] }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 mb-3 overflow-x-auto" role="tablist">
      {items.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.value)}
            className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px transition-colors ${on ? 'border-[#FA7014] text-[#FA7014]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        );
      })}
    </div>
  );
}

const PALETTE = ['bg-orange-100 text-orange-700', 'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700'];

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

export const Avatar: React.FC<{ name: string; size?: 'sm' | 'lg' }> = ({ name, size = 'sm' }) => {
  const color = PALETTE[Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
  return (
    <span className={`shrink-0 inline-flex items-center justify-center rounded-full font-black ${color} ${size === 'lg' ? 'w-14 h-14 text-lg' : 'w-8 h-8 text-[11px]'}`} aria-hidden>
      {initials(name)}
    </span>
  );
};

/** Only web addresses and this app's own paths become links, so a stored value can never run script. */
export const safeHref = (url: string): string | null => (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) ? url : null);
