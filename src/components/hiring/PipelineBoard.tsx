import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Briefcase, CalendarDays, CheckCircle2, Filter, Handshake, Search, Users } from 'lucide-react';
import { Avatar } from '../home/parts';
import { pipelineService } from '../../services/pipelineService';
import { subscribeToRequisitions } from '../../services/requisitionService';
import { Requisition } from '../../types';
import { useLoad } from '../common/loadUi';
import { niceDate } from '../leave/ui';

export const PERIODS = [{ days: 7, label: 'Last 7 Days' }, { days: 30, label: 'Last 30 Days' }, { days: 90, label: 'Last 90 Days' }, { days: 0, label: 'All time' }];

/** Which board column a candidate sits in. Rejected candidates are not on the board. */
export const stageOf = (status: string): number | null => {
  const s = String(status || '').toLowerCase();
  if (s.includes('reject')) return null;
  if (s.includes('joining') || s.includes('joined') || s.includes('hired')) return 4;
  if (s.includes('offer') || s.includes('selected')) return 3;
  if (s.includes('interview')) return 2;
  if (s.includes('screen')) return 1;
  return 0;
};
const COLUMNS = [
  { label: 'Sourced', head: 'bg-indigo-50/80', body: 'bg-indigo-50/40', chip: 'bg-indigo-100 text-indigo-800' },
  { label: 'Screening', head: 'bg-sky-50', body: 'bg-sky-50/40', chip: 'bg-sky-100 text-sky-800' },
  { label: 'Interview', head: 'bg-orange-50', body: 'bg-orange-50/40', chip: 'bg-orange-100 text-orange-800' },
  { label: 'Offer', head: 'bg-emerald-50', body: 'bg-emerald-50/40', chip: 'bg-emerald-100 text-emerald-800' },
  { label: 'Joined', head: 'bg-violet-50', body: 'bg-violet-50/40', chip: 'bg-violet-100 text-violet-800' },
];

const ago = (iso?: string) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return d <= 0 ? 'Today' : `${d}d ago`;
};
const inWindow = (iso: string | undefined, from: number, to: number) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from && t < to;
};

export interface PipelineData {
  rows: any[]; all: any[]; reqs: Requisition[]; days: number; loading: boolean; error: string; reload: () => void;
  trend: { candidates: number | null; reqs: number | null };
}

/** One load of the candidate board and requisitions, narrowed to the chosen period. */
export const usePipelineData = (days: number, refreshKey: number): PipelineData => {
  const board = useLoad(() => pipelineService.board(), [refreshKey]);
  const [reqs, setReqs] = useState<Requisition[]>([]);
  useEffect(() => {
    try { return subscribeToRequisitions(setReqs); } catch { return undefined; }
  }, []);
  const all: any[] = board.data?.rows || [];
  const now = Date.now();
  const span = days * 86400_000;
  const rows = days ? all.filter((r) => !r.createdAt || now - new Date(r.createdAt).getTime() <= span) : all;
  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const trend = days ? {
    candidates: pct(all.filter((r) => inWindow(r.createdAt, now - span, now + 1)).length, all.filter((r) => inWindow(r.createdAt, now - 2 * span, now - span)).length),
    reqs: pct(reqs.filter((r) => inWindow(r.publishedAt || r.createdAt, now - span, now + 1)).length, reqs.filter((r) => inWindow(r.publishedAt || r.createdAt, now - 2 * span, now - span)).length),
  } : { candidates: null, reqs: null };
  return { rows, all, reqs, days, loading: board.loading, error: board.error || '', reload: board.reload, trend };
};

const TONES = {
  indigo: ['bg-gradient-to-br from-indigo-100/80 to-violet-50', 'bg-indigo-100 text-indigo-600'],
  sky: ['bg-gradient-to-br from-sky-100/80 to-blue-50', 'bg-sky-100 text-sky-600'],
  green: ['bg-gradient-to-br from-emerald-100/70 to-green-50', 'bg-emerald-100 text-emerald-600'],
  orange: ['bg-gradient-to-br from-orange-100/80 to-amber-50', 'bg-orange-100 text-[#F36B21]'],
  violet: ['bg-gradient-to-br from-violet-100/80 to-indigo-50', 'bg-violet-100 text-violet-600'],
} as const;

export const PipelineStats: React.FC<{ d: PipelineData }> = ({ d }) => {
  const count = (n: number) => d.rows.filter((r) => stageOf(r.status) === n).length;
  const open = d.reqs.filter((r) => r.status === 'JOB_OPEN').length;
  const busy = d.loading && !d.rows.length;
  const tiles: { label: string; value: number; tone: keyof typeof TONES; Icon: React.FC<{ className?: string }>; trend?: number | null }[] = [
    { label: 'Open Requisitions', value: open, tone: 'indigo', Icon: Briefcase, trend: d.trend.reqs },
    { label: 'Total Candidates', value: d.rows.filter((r) => stageOf(r.status) !== null).length, tone: 'sky', Icon: Users, trend: d.trend.candidates },
    { label: 'Interviews', value: count(2), tone: 'green', Icon: CalendarDays },
    { label: 'Offers', value: count(3), tone: 'orange', Icon: Handshake },
    { label: 'Joined', value: count(4), tone: 'violet', Icon: CheckCircle2 },
  ];
  return (
    <section aria-label="Pipeline summary" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className={`flex items-center gap-2.5 rounded-xl border border-white px-3.5 py-2.5 ${TONES[t.tone][0]}`}>
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONES[t.tone][1]}`}><t.Icon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-bold leading-tight tabular-nums text-slate-950">{busy ? '—' : t.value}</span>
            <span className="block truncate text-[11px] text-slate-700">{t.label}</span>
          </span>
          {t.trend !== undefined && t.trend !== null && t.trend !== 0 && <span className={`self-end text-[11px] font-bold ${t.trend > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{t.trend > 0 ? '↑ +' : '↓ '}{t.trend}%</span>}
        </div>
      ))}
    </section>
  );
};

const SELECT = 'h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-[#FA7014]';

export const PipelineBoard: React.FC<{ d: PipelineData; onOpenCandidate: (id: string) => void; onOpenRequisitions?: () => void }> = ({ d, onOpenCandidate, onOpenRequisitions }) => {
  const [role, setRole] = useState('');
  const [dept, setDept] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);

  // A candidate's department comes from the requisition for the same role, when there is one.
  const deptOfRole = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of d.reqs) if (r.positionTitle && r.departmentName) m.set(r.positionTitle.toLowerCase(), r.departmentName);
    return m;
  }, [d.reqs]);
  const roles = useMemo(() => Array.from(new Set(d.rows.map((r) => r.designation).filter(Boolean))).sort() as string[], [d.rows]);
  const depts = useMemo(() => Array.from(new Set(d.rows.map((r) => deptOfRole.get(String(r.designation || '').toLowerCase())).filter(Boolean))).sort() as string[], [d.rows, deptOfRole]);
  const sources = useMemo(() => Array.from(new Set(d.rows.map((r) => r.source).filter(Boolean))).sort() as string[], [d.rows]);

  const shown = d.rows.filter((r) => stageOf(r.status) !== null
    && (!role || r.designation === role)
    && (!dept || deptOfRole.get(String(r.designation || '').toLowerCase()) === dept)
    && (!source || r.source === source)
    && (!q || `${r.name} ${r.designation} ${r.email}`.toLowerCase().includes(q.toLowerCase())));
  const filtered = !!(role || dept || source || q);

  const openReqs = d.reqs.filter((r) => r.status === 'JOB_OPEN').slice(0, 5);
  const applicants = (title: string) => d.all.filter((r) => String(r.designation || '').toLowerCase() === title.toLowerCase() && stageOf(r.status) !== null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <select className={SELECT} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All Roles</option>{roles.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {depts.length > 0 && <select className={SELECT} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All Departments</option>{depts.map((x) => <option key={x} value={x}>{x}</option>)}</select>}
        <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-semibold ${more || filtered ? 'border-[#FA7014] text-[#FA7014]' : 'border-slate-200 text-slate-800'}`}><Filter className="h-4 w-4" />More Filters</button>
      </div>
      {more && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-[#FA7014]" placeholder="Search by name, email or role..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search candidates" /></div>
          <select className={SELECT} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source"><option value="">Source: All</option>{sources.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          {filtered && <button type="button" className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:text-[#FA7014]" onClick={() => { setRole(''); setDept(''); setSource(''); setQ(''); }}>Clear filters</button>}
        </div>
      )}
      {d.error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{d.error}</p>}

      <div className="grid gap-2.5 md:grid-cols-3 xl:grid-cols-5" aria-label="Candidates by stage">
        {COLUMNS.map((c, i) => {
          const list = shown.filter((r) => stageOf(r.status) === i);
          return (
            <section key={c.label} className={`flex min-w-0 flex-col rounded-2xl border border-white ${c.body}`}>
              <header className={`flex items-center justify-between rounded-t-2xl px-3 py-2 ${c.head}`}>
                <h3 className="text-sm font-bold text-slate-900">{c.label}</h3>
                <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-bold ${c.chip}`}>{list.length}</span>
              </header>
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto p-2">
                {list.length === 0 && <li className="px-2 py-6 text-center text-xs text-slate-500">{d.loading ? 'Loading…' : 'No candidates'}</li>}
                {list.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => onOpenCandidate(r.id)} className="w-full cursor-pointer rounded-lg border border-slate-100 bg-white p-2.5 text-left shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-2">
                        <Avatar name={r.name || '?'} />
                        <div className="min-w-0"><div className="truncate text-[13px] font-bold text-slate-900">{r.name}</div><div className="truncate text-[11px] text-slate-600">{r.designation || '—'}</div></div>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
                        {i >= 3 ? <><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /><span className="truncate">{r.status}</span></>
                          : i === 2 && r.nextInterview ? <><CalendarDays className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{new Date(r.nextInterview).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></>
                          : <><CalendarDays className="h-3.5 w-3.5 shrink-0" /><span>{ago(r.createdAt) || '—'}</span></>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between"><h2 className="text-base font-bold text-slate-950">Open Requisitions</h2>
          {onOpenRequisitions && <button type="button" onClick={onOpenRequisitions} className="cursor-pointer text-xs font-bold text-[#4f46e5] hover:underline">View All <ArrowRight className="inline h-3.5 w-3.5" /></button>}</div>
        {openReqs.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No requisitions are open for applications.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Requisition ID', 'Role', 'Department', 'Hiring Manager', 'Opened On', 'Applicants', 'Status'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {openReqs.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-slate-800">{r.reqNo}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{r.positionTitle}</td>
                  <td className="px-3 py-2 text-slate-700">{r.departmentName}</td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-2"><Avatar name={r.requestedBy?.name || '?'} /><span className="font-semibold text-slate-900">{r.requestedBy?.name || '—'}</span></span></td>
                  <td className="px-3 py-2 text-slate-700">{(r.publishedAt || r.createdAt) ? niceDate(String(r.publishedAt || r.createdAt).slice(0, 10)) : '—'}</td>
                  <td className="px-3 py-2 text-slate-800">{applicants(r.positionTitle)}</td>
                  <td className="px-3 py-2"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Active</span></td>
                </tr>
              ))}
            </tbody></table></div>
        )}
      </section>
    </div>
  );
};
