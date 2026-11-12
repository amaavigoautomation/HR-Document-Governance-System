import React, { useMemo, useState } from 'react';
import { Briefcase, CheckCircle2, Handshake, UserCheck, Users, UserRound } from 'lucide-react';
import { dashService } from '../../services/hiringExtraService';
import { flowService } from '../../services/flowService';
import { useLoad } from '../common/loadUi';
import { stageOf, usePipelineData } from './PipelineBoard';

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} hr ago`;
  return `${Math.round(m / 1440)}d ago`;
};

const TONES = {
  purple: ['bg-gradient-to-br from-violet-100/80 to-indigo-50', 'bg-violet-100 text-violet-600'],
  blue: ['bg-gradient-to-br from-sky-100/80 to-blue-50', 'bg-sky-100 text-sky-600'],
  green: ['bg-gradient-to-br from-emerald-100/70 to-green-50', 'bg-emerald-100 text-emerald-600'],
  orange: ['bg-gradient-to-br from-orange-100/80 to-amber-50', 'bg-orange-100 text-[#F36B21]'],
} as const;

const Tile: React.FC<{ label: string; value: React.ReactNode; tone: keyof typeof TONES; Icon: React.FC<{ className?: string }>; trend?: number | null }> = ({ label, value, tone, Icon, trend }) => (
  <div className={`flex items-center gap-3 rounded-2xl border border-white px-4 py-3.5 ${TONES[tone][0]}`}>
    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${TONES[tone][1]}`}><Icon className="h-6 w-6" /></span>
    <span className="min-w-0 flex-1"><span className="block text-3xl font-bold leading-tight tabular-nums text-slate-950">{value}</span><span className="block truncate text-sm text-slate-700">{label}</span></span>
    {trend !== undefined && trend !== null && trend !== 0 && <span className={`self-end text-sm font-bold ${trend > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{trend > 0 ? '↑ +' : '↓ '}{trend}%</span>}
  </div>
);

const SHADES = ['#6d4cf0', '#8b6cf3', '#a99af6', '#c4baf9', '#ddd6fc'];
const Card: React.FC<{ title: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) => (
  <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-950">{title}</h2>{right}</div>{children}</section>
);

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
/** Area chart of average days to hire per month. Months with no hires are skipped in the line but keep their label. */
const TthChart: React.FC<{ series: { month: string; averageDays: number | null; hires: number }[] }> = ({ series }) => {
  const pts = series.map((m, i) => ({ ...m, i })).filter((m) => m.averageDays !== null);
  if (pts.length < 2) return null;
  const W = 300; const H = 90; const max = Math.max(...pts.map((p) => p.averageDays!)) * 1.15 || 1;
  const x = (i: number) => 10 + (i * (W - 20)) / Math.max(1, series.length - 1);
  const y = (v: number) => H - 8 - (v / max) * (H - 20);
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.averageDays!)}`).join(' ');
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-28 w-full" role="img" aria-label={`Average days to hire by month: ${pts.map((p) => `${monthName(p.month)} ${p.averageDays}`).join(', ')}`}>
        <defs><linearGradient id="tth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d4cf0" stopOpacity="0.28" /><stop offset="1" stopColor="#6d4cf0" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line} L${x(pts[pts.length - 1].i)},${H - 8} L${x(pts[0].i)},${H - 8} Z`} fill="url(#tth-fill)" />
        <path d={line} fill="none" stroke="#6d4cf0" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p) => <circle key={p.month} cx={x(p.i)} cy={y(p.averageDays!)} r="3.5" fill="#fff" stroke="#6d4cf0" strokeWidth="2"><title>{`${monthName(p.month)}: ${p.averageDays} days (${p.hires} hire${p.hires === 1 ? '' : 's'})`}</title></circle>)}
        {series.map((m, i) => <text key={m.month} x={x(i)} y={H + 10} textAnchor="middle" fontSize="10" fill="#64748b">{monthName(m.month)}</text>)}
      </svg>
    </div>
  );
};

/** Bird's-eye hiring numbers from the candidate board, requisitions, the founder dashboard and the automation log. A card is left out when its data is not available to this person. */
export const OverviewDashboard: React.FC<{ refreshKey: number; days: number }> = ({ refreshKey, days }) => {
  const d = usePipelineData(days, refreshKey);
  const dash = useLoad(() => dashService.dashboard(), [refreshKey]);
  const [allActivity, setAllActivity] = useState(false);
  const act = useLoad(() => flowService.activity(allActivity ? 30 : 6), [refreshKey, allActivity]);
  const x = dash.data?.dashboard;

  const rows = d.rows;
  const boardOk = !d.error;
  const atLeast = (n: number) => rows.filter((r) => { const s = stageOf(r.status); return s !== null && s >= n; }).length;
  const funnel = [['Sourced', rows.length], ['Screening', atLeast(1)], ['Interview', atLeast(2)], ['Offer', atLeast(3)], ['Joined', atLeast(4)]] as const;
  const openReqs = d.reqs.filter((r) => r.status === 'JOB_OPEN').length;

  // Department donut: applications in this period, by the department of the requisition for the same role. Unmatched ones go under Others.
  const deptOfRole = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of d.reqs) if (r.positionTitle && r.departmentName) m.set(r.positionTitle.toLowerCase(), r.departmentName);
    return m;
  }, [d.reqs]);
  const byDept = new Map<string, number>();
  for (const r of rows) { const k = deptOfRole.get(String(r.designation || '').toLowerCase()) || 'Others'; byDept.set(k, (byDept.get(k) || 0) + 1); }
  const named = [...byDept.entries()].filter(([k]) => k !== 'Others').sort((a, b) => b[1] - a[1]);
  const total = rows.length;
  const othersN = (byDept.get('Others') || 0) + named.slice(4).reduce((n, [, v]) => n + v, 0);
  const parts = [...named.slice(0, 4).map(([name, value]) => ({ name, value })), ...(othersN ? [{ name: 'Others', value: othersN }] : [])];
  const R = 52; const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-label="Hiring summary">
        <Tile label="Open Requisitions" value={openReqs} tone="purple" Icon={Briefcase} trend={d.trend.reqs} />
        {boardOk && <Tile label="Total Applications" value={d.loading && !rows.length ? '—' : rows.length} tone="blue" Icon={Users} trend={d.trend.candidates} />}
        {boardOk && <Tile label="Interviews" value={rows.filter((r) => stageOf(r.status) === 2).length} tone="green" Icon={CheckCircle2} trend={d.trend.interviews} />}
        {boardOk && <Tile label="Offers" value={rows.filter((r) => stageOf(r.status) === 3).length} tone="orange" Icon={Handshake} trend={d.trend.offers} />}
        {boardOk && <Tile label="Joined" value={rows.filter((r) => stageOf(r.status) === 4).length} tone="blue" Icon={UserCheck} trend={d.trend.joined} />}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {boardOk && (
          <Card title="Hiring Funnel">
            <div className="flex flex-wrap items-center gap-6">
              <svg viewBox="0 0 240 170" className="h-40 w-60 shrink-0" role="img" aria-label={funnel.map(([l, v]) => `${l} ${v}`).join(', ')}>
                {funnel.map((_, i) => {
                  const top = 120 - i * 22; const bot = top - 20; const y = i * 33;
                  return <polygon key={i} points={`${120 - top},${y} ${120 + top},${y} ${120 + bot},${y + 30} ${120 - bot},${y + 30}`} fill={SHADES[i]} />;
                })}
              </svg>
              <ul className="min-w-[10rem] flex-1 space-y-2.5 text-[15px]">
                {funnel.map(([l, v], i) => <li key={l} className="flex items-center gap-3"><span className="h-3 w-3 rounded-sm" style={{ background: SHADES[i] }} /><span className="flex-1 text-slate-900">{l}</span><b className="tabular-nums text-slate-900">{v}</b></li>)}
              </ul>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Each step counts candidates who are at that stage or further on. Rejected candidates count only as sourced.</p>
          </Card>
        )}

        {x && (
          <Card title="Time to Hire">
            {x.timeToHire.averageDays === null ? <p className="py-6 text-sm text-slate-500">No hires finished yet, so there is nothing to average.</p> : <>
              <div className="flex flex-wrap items-baseline gap-3">
                <div className="text-5xl font-bold tracking-tight text-slate-950">{x.timeToHire.averageDays} <span className="text-3xl">days</span></div>
                {x.timeToHire.changePct !== null && x.timeToHire.changePct !== 0 && <span className={`rounded-full px-2 py-0.5 text-sm font-bold ${x.timeToHire.changePct < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{x.timeToHire.changePct < 0 ? '↓ ' : '↑ +'}{x.timeToHire.changePct}%</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">Average from approval to accepted offer, over {x.timeToHire.sample} hire{x.timeToHire.sample === 1 ? '' : 's'}. The chip compares the latest month with hires against the one before.</p>
              <TthChart series={x.timeToHire.byMonth} />
              {x.timeToHire.slowest.length > 0 && <div className="mt-3"><div className="text-xs font-bold text-slate-600">Slowest roles</div>
                <ul className="mt-1 divide-y divide-slate-100 text-sm">{x.timeToHire.slowest.map((s) => <li key={s.position} className="flex justify-between py-1.5"><span className="text-slate-800">{s.position}</span><b className="text-slate-900">{s.days} days</b></li>)}</ul></div>}
            </>}
          </Card>
        )}

        {boardOk && parts.length > 0 && (
          <Card title="Hiring by Department">
            <div className="flex flex-wrap items-center gap-6">
              <div className="relative h-44 w-44 shrink-0" role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
                <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
                  <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />
                  {parts.map((p, i) => { const len = (p.value / total) * C; const el = <circle key={p.name} cx="70" cy="70" r={R} fill="none" stroke={SHADES[i]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />; acc += len; return el; })}
                </svg>
                <span className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-3xl font-bold text-slate-950">{total}</span><span className="text-xs text-slate-600">Applications</span></span>
              </div>
              <ul className="min-w-[9rem] flex-1 space-y-2 text-[15px]">
                {parts.map((p, i) => <li key={p.name} className="flex items-center gap-3"><span className="h-3 w-3 rounded-sm" style={{ background: SHADES[i] }} /><span className="flex-1 truncate text-slate-900">{p.name}</span><b className="tabular-nums text-slate-900">{Math.round((p.value / total) * 100)}%</b></li>)}
              </ul>
            </div>
          </Card>
        )}

        {act.data && act.data.items.length > 0 && (
          <Card title="Recent Activity" right={<button type="button" onClick={() => setAllActivity((v) => !v)} className="text-sm font-semibold text-violet-700 hover:underline">{allActivity ? 'Show less' : 'View All →'}</button>}>
            <ul className="divide-y divide-slate-100">
              {act.data.items.map((a, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><UserRound className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800"><b>{a.candidateName}</b> · {a.text}</span>
                  <span className="shrink-0 text-xs text-slate-500">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
};
