import React from 'react';
import { Briefcase, CheckCircle2, ClipboardList, Users } from 'lucide-react';
import type { DashboardWidget, WidgetTarget } from '../../../shared/dashboard';
import { homeService } from '../../services/homeService';
import { useLoad } from './useLoad';

type Tone = 'orange' | 'blue' | 'purple' | 'green';

// Soft tinted tile and round icon, one colour per tile.
const TONES: Record<Tone, { tile: string; icon: string }> = {
  orange: { tile: 'bg-orange-50 border-orange-100', icon: 'bg-orange-100 text-[#FA7014]' },
  blue: { tile: 'bg-sky-50 border-sky-100', icon: 'bg-sky-100 text-sky-600' },
  purple: { tile: 'bg-violet-50 border-violet-100', icon: 'bg-violet-100 text-violet-600' },
  green: { tile: 'bg-emerald-50 border-emerald-100', icon: 'bg-emerald-100 text-emerald-600' },
};

const Tile: React.FC<{ label: string; value: number; tone: Tone; Icon: React.FC<{ className?: string }>; onClick?: () => void }> = ({ label, value, tone, Icon, onClick }) => {
  const t = TONES[tone];
  const body = (
    <>
      <span className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${t.icon}`}><Icon className="w-6 h-6" /></span>
      <span className="min-w-0 text-left">
        <span className="block text-sm font-semibold text-slate-700 truncate">{label}</span>
        <span className="block text-3xl font-black tabular-nums text-slate-900 leading-tight">{value}</span>
      </span>
    </>
  );
  const cls = `flex items-center gap-4 rounded-2xl border px-5 py-4 ${t.tile}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} w-full cursor-pointer hover:shadow-sm transition-shadow`}>{body}</button>
    : <div className={cls}>{body}</div>;
};

/**
 * The four headline numbers on Home. Each tile uses real data and only shows when this person can see it:
 * headcount (company admins), on leave today (everyone, as the company's leave visibility allows),
 * open positions (people who work with hiring) and requests waiting for them.
 */
export const StatTiles: React.FC<{ widgets: DashboardWidget[]; refreshKey: number; onOpen: (t: WidgetTarget) => void }> = ({ widgets, refreshKey, onOpen }) => {
  const leave = useLoad(() => homeService.onLeave('today'), [refreshKey]);
  const admin = widgets.find((w) => w.id === 'admin');
  const hiring = widgets.find((w) => w.id === 'hiring');
  const approvals = widgets.find((w) => w.id === 'approvals');
  const tiles: React.ReactNode[] = [];

  const headcount = admin ? (admin.data as any)?.activeEmployees : null;
  if (typeof headcount === 'number') tiles.push(<Tile key="hc" label="Headcount" value={headcount} tone="orange" Icon={Users} onClick={admin?.target ? () => onOpen(admin.target!) : undefined} />);
  if (leave.data) tiles.push(<Tile key="ol" label="On leave today" value={leave.data.count} tone="blue" Icon={ClipboardList} />);
  const open = hiring ? (hiring.data as any)?.open : null;
  if (typeof open === 'number') tiles.push(<Tile key="op" label="Open positions" value={open} tone="purple" Icon={Briefcase} onClick={hiring?.target ? () => onOpen(hiring.target!) : undefined} />);
  const pending = approvals ? (approvals.data as any)?.leave : null;
  if (typeof pending === 'number') tiles.push(<Tile key="pa" label="Pending approvals" value={pending} tone="green" Icon={CheckCircle2} onClick={approvals?.target ? () => onOpen(approvals.target!) : undefined} />);

  if (tiles.length === 0) return null;
  return <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{tiles}</section>;
};
