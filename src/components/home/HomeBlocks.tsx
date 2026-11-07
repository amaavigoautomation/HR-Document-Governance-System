import React, { useMemo, useState } from 'react';
import {
  ArrowRight, Briefcase, CalendarCheck, CalendarDays, CalendarPlus, CheckCircle2, CreditCard, FileText, Fingerprint, LayoutGrid, Palmtree,
  Receipt, ShieldCheck, Users, UserPlus, Zap,
} from 'lucide-react';
import type { DashboardWidget, WidgetTarget } from '../../../shared/dashboard';
import { homeService } from '../../services/homeService';
import { leaveService } from '../../services/leaveService';
import { lifecycleService } from '../../services/lifecycleService';
import { pipelineService } from '../../services/pipelineService';
import { Card, addDaysIso, niceDate, shortDate, shortRange, todayIst } from '../leave/ui';
import { Avatar } from './parts';
import { useLoad } from './useLoad';

// ------------------------------------------------------------------ greeting

const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3600_000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const Greeting: React.FC<{ first: string; today: string; actions?: React.ReactNode }> = ({ first, today, actions }) => (
  <header className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">{greeting()}{first ? `, ${first}` : ''} <span aria-hidden>👋</span></h1>
      <p className="mt-1 text-sm text-slate-600">Here&apos;s what&apos;s happening today.</p>
    </div>
    <div className="flex items-center gap-2">
      {today && <span className="hidden sm:inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-700"><CalendarDays className="h-4 w-4" />{today}</span>}
      {actions}
    </div>
  </header>
);

// ------------------------------------------------------------------ headline tiles

type AttPerson = { days: { status: string }[] };
const PRESENT_FULL = ['PRESENT', 'LATE', 'INCOMPLETE'];
const COUNTED = ['PRESENT', 'LATE', 'INCOMPLETE', 'HALF_DAY', 'ABSENT'];
/** Share of expected working days that were attended: leave, holidays and weekly offs are not expected days. */
const attendancePct = (people: AttPerson[]): number | null => {
  let got = 0; let expected = 0;
  for (const p of people) for (const d of p.days) {
    if (!COUNTED.includes(d.status)) continue;
    expected += 1;
    if (PRESENT_FULL.includes(d.status)) got += 1; else if (d.status === 'HALF_DAY') got += 0.5;
  }
  return expected ? Math.round((got / expected) * 100) : null;
};

const Trend: React.FC<{ delta: number | null; unit?: string }> = ({ delta, unit = '%' }) => {
  if (delta === null || delta === 0 || !Number.isFinite(delta)) return null;
  const up = delta > 0;
  return <span className={`self-end text-sm font-bold ${up ? 'text-emerald-600' : 'text-rose-600'}`}>{up ? '↑' : '↓'} {up ? '+' : ''}{delta}{unit}</span>;
};

const TONES = {
  purple: { tile: 'bg-gradient-to-br from-violet-100/80 to-indigo-50 border-white', icon: 'bg-violet-100 text-violet-600' },
  blue: { tile: 'bg-gradient-to-br from-sky-100/80 to-blue-50 border-white', icon: 'bg-sky-100 text-sky-600' },
  green: { tile: 'bg-gradient-to-br from-emerald-100/70 to-green-50 border-white', icon: 'bg-emerald-100 text-emerald-600' },
  orange: { tile: 'bg-gradient-to-br from-orange-100/80 to-amber-50 border-white', icon: 'bg-orange-100 text-[#F36B21]' },
} as const;

const Tile: React.FC<{ label: string; value: string | number; tone: keyof typeof TONES; Icon: React.FC<{ className?: string }>; trend?: React.ReactNode; onClick?: () => void }> = ({ label, value, tone, Icon, trend, onClick }) => {
  const t = TONES[tone];
  const body = (
    <>
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${t.icon}`}><Icon className="h-6 w-6" /></span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-3xl font-bold leading-tight tabular-nums text-slate-950">{value}</span>
        <span className="block truncate text-sm text-slate-700">{label}</span>
      </span>
      {trend}
    </>
  );
  const cls = `flex items-center gap-4 rounded-2xl border px-5 py-5 ${t.tile}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} w-full cursor-pointer transition-shadow hover:shadow-sm`}>{body}</button> : <div className={cls}>{body}</div>;
};

/**
 * Four headline numbers. Company-wide ones only appear for people allowed to see them; everyone else gets their own
 * equivalents. Trend arrows show only where they can be worked out from real dates (people who joined, last month's attendance).
 */
export const TopTiles: React.FC<{ widgets: DashboardWidget[]; refreshKey: number; onOpen: (t: WidgetTarget) => void }> = ({ widgets, refreshKey, onOpen }) => {
  const admin = widgets.find((w) => w.id === 'admin');
  const hiring = widgets.find((w) => w.id === 'hiring');
  const today = todayIst();
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonthStart = `${addDaysIso(monthStart, -1).slice(0, 7)}-01`;
  const prevSameDay = addDaysIso(prevMonthStart, Number(today.slice(8)) - 1);
  const prevEnd = prevSameDay < monthStart ? prevSameDay : addDaysIso(monthStart, -1);

  const leave = useLoad(() => homeService.onLeave('today'), [refreshKey]);
  const dir = useLoad(() => (admin ? lifecycleService.directory() : Promise.resolve(null)), [refreshKey, !!admin]);
  const att = useLoad(async () => {
    const [cur, prev] = await Promise.all([
      leaveService.attendanceReport({ from: monthStart, to: today }),
      leaveService.attendanceReport({ from: prevMonthStart, to: prevEnd }).catch(() => null),
    ]);
    return { cur: cur.people as AttPerson[], prev: (prev?.people || null) as AttPerson[] | null };
  }, [refreshKey]);

  const headcount = admin ? (admin.data as any)?.activeEmployees : null;
  const growth = useMemo(() => {
    const people: any[] = dir.data?.people || [];
    if (!people.length || typeof headcount !== 'number') return null;
    const cutoff = addDaysIso(today, -30);
    const before = people.filter((p) => p.active && p.joinDate && p.joinDate <= cutoff).length;
    return before > 0 ? Math.round(((headcount - before) / before) * 100) : null;
  }, [dir.data, headcount, today]);

  const open = hiring ? (hiring.data as any)?.open : null;
  const pct = att.data ? attendancePct(att.data.cur) : null;
  const prevPct = att.data?.prev ? attendancePct(att.data.prev) : null;
  const scopeAll = (att.data?.cur.length || 0) > 1;
  const tasks = widgets.reduce((n, w) => n + (typeof (w.data as any)?.count === 'number' ? (w.data as any).count : 0), 0);
  const go = (w?: DashboardWidget) => (w?.target ? () => onOpen(w.target!) : undefined);

  const tiles: React.ReactNode[] = [];
  if (typeof headcount === 'number') tiles.push(<Tile key="hc" label="Total Employees" value={headcount} tone="purple" Icon={Users} trend={<Trend delta={growth} />} onClick={go(admin)} />);
  if (typeof open === 'number') tiles.push(<Tile key="op" label="Open Roles" value={open} tone="blue" Icon={Briefcase} onClick={go(hiring)} />);
  if (leave.data) tiles.push(<Tile key="ol" label="On Leave Today" value={leave.data.count} tone="green" Icon={CalendarDays} />);
  if (pct !== null) tiles.push(<Tile key="at" label={scopeAll ? 'Attendance (MTD)' : 'Your Attendance (MTD)'} value={`${pct}%`} tone="orange" Icon={CheckCircle2} trend={<Trend delta={prevPct === null ? null : pct - prevPct} />} />);
  if (tiles.length < 4 && tasks > 0) tiles.push(<Tile key="tk" label="Waiting on you" value={tasks} tone="blue" Icon={FileText} />);

  if (tiles.length === 0) return null;
  return <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{tiles.slice(0, 4)}</section>;
};

// ------------------------------------------------------------------ hiring pipeline

const STAGES: { label: string; terms: string[] | null }[] = [
  { label: 'Sourced', terms: null },
  { label: 'Screening', terms: ['screen'] },
  { label: 'Interview', terms: ['interview'] },
  { label: 'Offer', terms: ['offer', 'selected'] },
  { label: 'Joined', terms: ['joining', 'joined', 'hired'] },
];
const SHADES = ['#c4c1fb', '#aaa6f8', '#9a95f6', '#aaa6f8', '#bdb9fa'];
const PERIODS = [{ days: 7, label: 'Last 7 Days' }, { days: 30, label: 'Last 30 Days' }, { days: 90, label: 'Last 90 Days' }];

/** Candidates by stage, from the same board as Hiring Pipeline. Only people who can open that board see it. */
export const PipelineChart: React.FC<{ refreshKey: number; onOpen: (t: WidgetTarget) => void }> = ({ refreshKey, onOpen }) => {
  const board = useLoad(() => pipelineService.board(), [refreshKey]);
  const [days, setDays] = useState(30);
  if (board.error || (!board.loading && !board.data)) return null;
  const since = Date.now() - days * 86400_000;
  const rows: any[] = (board.data?.rows || []).filter((r: any) => !r.createdAt || new Date(r.createdAt).getTime() >= since);
  const counts = STAGES.map((s) => (s.terms === null ? rows.length : rows.filter((r) => s.terms!.some((t) => String(r.status || '').toLowerCase().includes(t))).length));
  const max = Math.max(10, Math.ceil(Math.max(...counts) / 10) * 10);
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0].map(Math.round);
  return (
    <Card className="min-w-0" title={<span className="inline-flex items-center gap-2"><Users className="h-5 w-5" />Hiring Pipeline</span>} right={
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none" aria-label="Period">
        {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
      </select>}>
      <div className="flex gap-3" role="img" aria-label={STAGES.map((s, i) => `${s.label} ${counts[i]}`).join(', ')}>
        <div className="flex h-52 flex-col justify-between pb-7 text-right text-xs text-slate-600">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 top-2 bottom-7 flex flex-col justify-between" aria-hidden>{ticks.map((_, i) => <div key={i} className="border-t border-dashed border-slate-200" />)}</div>
          <div className="relative flex h-52 items-end justify-around gap-3 pt-2">
            {STAGES.map((s, i) => (
              <div key={s.label} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-sm font-bold text-slate-900">{counts[i]}</span>
                <div className="w-full max-w-[84px] rounded-t-md" style={{ height: `${(counts[i] / max) * (100 - 14)}%`, minHeight: counts[i] ? 4 : 0, background: SHADES[i] }} />
                <span className="mt-2 h-5 text-sm text-slate-800">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 text-right"><button type="button" onClick={() => onOpen({ module: 'talent-acquisition-overview' })} className="text-sm font-bold text-[#F36B21] hover:underline cursor-pointer">Open pipeline <ArrowRight className="inline h-3.5 w-3.5" /></button></div>
    </Card>
  );
};

// ------------------------------------------------------------------ quick actions

const ACTIONS: { label: string; Icon: React.FC<{ className?: string }>; target?: WidgetTarget }[] = [
  { label: 'Refer a Candidate', Icon: UserPlus, target: { module: 'my-hiring' } },
  { label: 'Apply Leave', Icon: CalendarPlus, target: { module: 'leave-management', section: 'my' } },
  { label: 'Mark Attendance', Icon: Fingerprint, target: { module: 'leave-management', section: 'attendance' } },
  { label: 'Raise Claim', Icon: Receipt, target: { module: 'payroll', section: 'claims' } },
  { label: 'My Letters', Icon: FileText, target: { module: 'people', section: 'myletters' } },
  { label: 'View Payslip', Icon: CreditCard, target: { module: 'payroll', section: 'payslips' } },
  { label: 'My Policies', Icon: ShieldCheck, target: { module: 'document-version-control', docTab: 'employee' } },
  { label: 'More', Icon: LayoutGrid },
];

export const QuickActionsGrid: React.FC<{ onOpen: (t: WidgetTarget) => void }> = ({ onOpen }) => (
  <Card className="min-w-0" title={<span className="inline-flex items-center gap-2"><Zap className="h-5 w-5" />Quick Actions</span>}>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => (
        <button key={a.label} type="button"
          onClick={() => (a.target ? onOpen(a.target) : document.getElementById('home-more')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))}
          className="flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-3 text-center text-[13px] font-medium leading-tight text-slate-800 shadow-sm hover:border-[#F36B21]/60 hover:bg-orange-50/40 cursor-pointer">
          <a.Icon className="h-6 w-6 text-slate-700" />{a.label}
        </button>
      ))}
    </div>
  </Card>
);

// ------------------------------------------------------------------ upcoming

type Kind = 'Interviews' | 'Leaves' | 'Events';
interface UpItem { key: string; kind: Kind; when: string; title: React.ReactNode; sub: string; Icon: React.FC<{ className?: string }>; tone: string; target?: WidgetTarget }
const TABS: ('All' | Kind)[] = ['All', 'Interviews', 'Leaves', 'Events'];
const nice = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const UpcomingCard: React.FC<{ refreshKey: number; onOpen: (t: WidgetTarget) => void }> = ({ refreshKey, onOpen }) => {
  const [tab, setTab] = useState<'All' | Kind>('All');
  const today = todayIst();
  const iv = useLoad(() => pipelineService.interviews(), [refreshKey]);
  const lv = useLoad(() => leaveService.myRequests(), [refreshKey]);
  const me = useLoad(() => leaveService.me(), [refreshKey]);
  const wishes = useLoad(() => homeService.wishes('month'), [refreshKey]);

  const items: UpItem[] = [];
  for (const i of (iv.data?.items || []) as any[]) {
    if (i.status !== 'SCHEDULED' || !i.startIso || new Date(i.startIso).getTime() < Date.now() || !(i.iAmOnPanel || i.iAmGuest)) continue;
    items.push({ key: `i${i.id}`, kind: 'Interviews', when: i.startIso, title: <><b>Interview</b> – {i.positionTitle}</>, sub: `${i.candidateName} · ${nice(i.startIso)}`, Icon: CalendarDays, tone: 'bg-violet-100 text-violet-600', target: { module: 'my-hiring' } });
  }
  for (const r of (lv.data?.items || []) as any[]) {
    if (!['APPROVED', 'PENDING'].includes(r.status) || r.to < today) continue;
    items.push({ key: `l${r.id}`, kind: 'Leaves', when: r.from, title: <><b>Your Leave</b> – {r.typeName}</>, sub: `${shortRange(r.from, r.to)}${r.status === 'PENDING' ? ' · waiting for approval' : ''}`, Icon: Palmtree, tone: 'bg-indigo-100 text-indigo-600', target: { module: 'leave-management', section: 'my' } });
  }
  for (const h of ((me.data?.holidays || []) as any[]).filter((x) => x.date >= today).slice(0, 3)) {
    items.push({ key: `h${h.date}`, kind: 'Events', when: h.date, title: <><b>{h.name}</b>{h.optional ? ' (optional)' : ''}</>, sub: `Holiday · ${shortDate(h.date)}`, Icon: CalendarCheck, tone: 'bg-emerald-100 text-emerald-600' });
  }
  for (const c of [...(wishes.data?.birthdays || []), ...(wishes.data?.work || [])].filter((x: any) => x.date >= today).slice(0, 4)) {
    items.push({ key: `c${c.uid}${c.kind}`, kind: 'Events', when: c.date, title: <><b>{c.name}</b> – {c.kind === 'BIRTHDAY' ? 'birthday' : 'work anniversary'}</>, sub: shortDate(c.date), Icon: CalendarCheck, tone: 'bg-emerald-100 text-emerald-600' });
  }
  items.sort((a, b) => a.when.localeCompare(b.when));
  const shown = items.filter((x) => tab === 'All' || x.kind === tab).slice(0, 5);
  const loading = iv.loading || lv.loading;

  return (
    <Card className="min-w-0" title={<span className="inline-flex items-center gap-2"><CalendarDays className="h-5 w-5" />Upcoming</span>} right={
      <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-sm" role="tablist" aria-label="Upcoming">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 font-medium cursor-pointer ${tab === t ? 'bg-violet-200 text-violet-900' : 'text-slate-600 hover:text-slate-900'}`}>{t}</button>)}
      </div>}>
      {loading && shown.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        : shown.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Nothing coming up.</p> : (
          <ul className="divide-y divide-slate-100">
            {shown.map((x) => (
              <li key={x.key}>
                <button type="button" disabled={!x.target} onClick={() => x.target && onOpen(x.target)} className="flex w-full items-center gap-3 py-3 text-left disabled:cursor-default cursor-pointer">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${x.tone}`}><x.Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[15px] text-slate-900">{x.title}</span><span className="block truncate text-sm text-slate-600">{x.sub}</span></span>
                  {x.target && <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />}
                </button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
};

// ------------------------------------------------------------------ leave balance

export const LeaveBalanceCard: React.FC<{ refreshKey: number; onOpen: (t: WidgetTarget) => void }> = ({ refreshKey, onOpen }) => {
  const me = useLoad(() => leaveService.me(), [refreshKey]);
  const list = ((me.data?.balances || []) as any[]).filter((b) => !b.isLop && b.eligible && b.requiresBalance);
  if (!me.loading && (me.error || list.length === 0)) return null;
  return (
    <Card className="min-w-0" title={<span className="inline-flex items-center gap-2"><Palmtree className="h-5 w-5" />Leave Balance</span>}
      right={<button type="button" onClick={() => onOpen({ module: 'leave-management', section: 'my' })} className="text-sm font-bold text-[#4f46e5] hover:underline cursor-pointer">View Details <ArrowRight className="inline h-3.5 w-3.5" /></button>}>
      {me.loading ? <p className="py-6 text-center text-sm text-slate-500">Loading…</p> : (
        <ul className="space-y-4 py-1">
          {list.slice(0, 5).map((b) => {
            const total = Math.max(b.credited, b.balance + b.used + (b.pending || 0), 1);
            const pct = Math.max(0, Math.min(100, Math.round((b.balance / total) * 100)));
            return (
              <li key={b.typeId} className="grid grid-cols-[7.5rem_1fr_6.5rem] items-center gap-4 text-[15px]">
                <span className="truncate text-slate-900">{b.name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100" title={`${b.balance} of ${total} days left`}><span className="block h-full rounded-full bg-[#8b7df3]" style={{ width: `${pct}%` }} /></span>
                <span className="text-right text-slate-800">{b.balance} / {total} days</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ team attendance

const HERE = ['PRESENT', 'LATE', 'INCOMPLETE', 'HALF_DAY'];
const NOT_EXPECTED = ['HOLIDAY', 'WEEKLY_OFF', 'NOT_EMPLOYED', 'FUTURE', 'LEAVE'];

/** Today's attendance for the people this person may see (their team, or everyone for HR). Hidden when that is only themselves. */
export const TeamAttendanceCard: React.FC<{ refreshKey: number; onOpen: (t: WidgetTarget) => void }> = ({ refreshKey, onOpen }) => {
  const today = todayIst();
  const att = useLoad(() => leaveService.attendanceReport({ from: today, to: today }), [refreshKey]);
  const people: { uid: string; name: string; days: { status: string }[] }[] = att.data?.people || [];
  if (!att.loading && (att.error || people.length < 2)) return null;
  const expected = people.filter((p) => !NOT_EXPECTED.includes(p.days[0]?.status || 'FUTURE'));
  const here = expected.filter((p) => HERE.includes(p.days[0]?.status));
  const pct = expected.length ? Math.round((here.length / expected.length) * 100) : 0;
  const R = 34; const C = 2 * Math.PI * R;
  return (
    <Card className="min-w-0" title={<span className="inline-flex items-center gap-2"><Users className="h-5 w-5" />Team Attendance (Today)</span>}
      right={<button type="button" onClick={() => onOpen({ module: 'leave-management', section: 'reports' })} className="text-sm font-bold text-[#4f46e5] hover:underline cursor-pointer">View Team <ArrowRight className="inline h-3.5 w-3.5" /></button>}>
      {att.loading ? <p className="py-6 text-center text-sm text-slate-500">Loading…</p> : (
        <div className="flex flex-wrap items-center gap-5 py-2">
          <div className="flex items-center">
            {here.slice(0, 4).map((p, i) => <span key={p.uid} className={i ? '-ml-2' : ''} title={p.name}><Avatar name={p.name} /></span>)}
            {here.length > 4 && <span className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-[11px] font-bold text-violet-700">+{here.length - 4}</span>}
          </div>
          <div className="border-l border-slate-200 pl-5">
            <div className="text-2xl font-bold text-slate-950">{here.length} / {expected.length}</div>
            <div className="text-sm text-slate-600">Team Present</div>
          </div>
          <div className="relative ml-auto h-20 w-20 shrink-0" role="img" aria-label={`${pct}% present`}>
            <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
              <circle cx="40" cy="40" r={R} fill="none" stroke="#e5e7eb" strokeWidth="8" />
              <circle cx="40" cy="40" r={R} fill="none" stroke="#22a64a" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * C} ${C}`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-slate-950">{pct}%</span>
          </div>
        </div>
      )}
    </Card>
  );
};

export { niceDate };
