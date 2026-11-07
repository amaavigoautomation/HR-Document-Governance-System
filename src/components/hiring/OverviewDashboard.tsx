import React, { useState } from 'react';
import { Briefcase, CheckCircle2, Handshake, Users, UserRound } from 'lucide-react';
import { dashService } from '../../services/hiringExtraService';
import { flowService } from '../../services/flowService';
import { useLoad } from '../common/loadUi';
import { PERIODS, stageOf, usePipelineData } from './PipelineBoard';

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

/** Bird's-eye hiring numbers from the candidate board, requisitions, the founder dashboard and the automation log. A card is left out when its data is not available to this person. */
export const OverviewDashboard: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [days, setDays] = useState(30);
  const d = usePipelineData(days, refreshKey);
  const dash = useLoad(() => dashService.dashboard(), [refreshKey]);
  const act = useLoad(() => flowService.activity(6), [refreshKey]);
  const x = dash.data?.dashboard;

  const rows = d.rows;
  const boardOk = !d.error;
  const atLeast = (n: number) => rows.filter((r) => { const s = stageOf(r.status); return s !== null && s >= n; }).length;
  const funnel = [['Sourced', rows.length], ['Screening', atLeast(1)], ['Interview', atLeast(2)], ['Offer', atLeast(3)], ['Joined', atLeast(4)]] as const;
  const openReqs = d.reqs.filter((r) => r.status === 'JOB_OPEN').length;

  // Department donut: open vacancies, top four plus the rest.
  const depts = (x?.vacanciesByDepartment || []).filter((v) => v.vacancies > 0);
  const total = depts.reduce((n, v) => n + v.vacancies, 0);
  const parts = [...depts.slice(0, 4).map((v) => ({ name: v.department, value: v.vacancies })), ...(depts.length > 4 ? [{ name: 'Others', value: depts.slice(4).reduce((n, v) => n + v.vacancies, 0) }] : [])];
  const R = 52; const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none">{PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}</select>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Hiring summary">
        <Tile label="Open Requisitions" value={openReqs} tone="purple" Icon={Briefcase} trend={d.trend.reqs} />
        {boardOk && <Tile label="Total Applications" value={d.loading && !rows.length ? '—' : rows.length} tone="blue" Icon={Users} trend={d.trend.candidates} />}
        {boardOk && <Tile label="Interviews" value={rows.filter((r) => stageOf(r.status) === 2).length} tone="green" Icon={CheckCircle2} />}
        {boardOk && <Tile label="Offers" value={rows.filter((r) => stageOf(r.status) === 3).length} tone="orange" Icon={Handshake} />}
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
              <div className="text-5xl font-bold tracking-tight text-slate-950">{x.timeToHire.averageDays} <span className="text-3xl">days</span></div>
              <p className="mt-1 text-xs text-slate-500">Average from approval to accepted offer, over {x.timeToHire.sample} hire{x.timeToHire.sample === 1 ? '' : 's'}.</p>
              {x.timeToHire.slowest.length > 0 && <div className="mt-4"><div className="text-xs font-bold text-slate-600">Slowest roles</div>
                <ul className="mt-1 divide-y divide-slate-100 text-sm">{x.timeToHire.slowest.map((s) => <li key={s.position} className="flex justify-between py-1.5"><span className="text-slate-800">{s.position}</span><b className="text-slate-900">{s.days} days</b></li>)}</ul></div>}
            </>}
          </Card>
        )}

        {x && parts.length > 0 && (
          <Card title="Hiring by Department">
            <div className="flex flex-wrap items-center gap-6">
              <div className="relative h-44 w-44 shrink-0" role="img" aria-label={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
                <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
                  <circle cx="70" cy="70" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />
                  {parts.map((p, i) => { const len = (p.value / total) * C; const el = <circle key={p.name} cx="70" cy="70" r={R} fill="none" stroke={SHADES[i]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />; acc += len; return el; })}
                </svg>
                <span className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-3xl font-bold text-slate-950">{total}</span><span className="text-xs text-slate-600">Open vacancies</span></span>
              </div>
              <ul className="min-w-[9rem] flex-1 space-y-2 text-[15px]">
                {parts.map((p, i) => <li key={p.name} className="flex items-center gap-3"><span className="h-3 w-3 rounded-sm" style={{ background: SHADES[i] }} /><span className="flex-1 truncate text-slate-900">{p.name}</span><b className="tabular-nums text-slate-900">{Math.round((p.value / total) * 100)}%</b></li>)}
              </ul>
            </div>
          </Card>
        )}

        {act.data && act.data.items.length > 0 && (
          <Card title="Recent Activity">
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
