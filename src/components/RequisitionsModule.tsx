import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Briefcase, ChevronLeft, ChevronsRight, Clock, Download, FileText, Inbox, Layers, MoreHorizontal, Plus, Search, Wallet } from 'lucide-react';
import { Requisition, RequisitionStatus, User } from '../types';
import { subscribeToRequisitions } from '../services/requisitionService';
import { dashService } from '../services/hiringExtraService';
import { STATUS_LABEL, can, needsMyAction } from '../utils/requisitionPermissions';
import { NewRequisitionModal } from './NewRequisitionModal';
import { HiringBudgetsModal } from './HiringBudgetsModal';
import { hasPerm } from '../../shared/permissions';
import { RequisitionDetailPanel } from './RequisitionDetailPanel';
import { Avatar } from './home/parts';

interface Props {
  currentUser: User;
  users: User[];
  /** Compact header for the department-head view embedded in the employee portal */
  embedded?: boolean;
}

type Filter = 'ALL' | 'MINE' | 'OPEN' | 'PROGRESS' | 'CLOSED';
const PAGE = 10;

const STATUS_STYLE: Record<RequisitionStatus, string> = {
  PENDING_ASSIGNMENT: 'bg-amber-100 text-amber-800',
  PENDING_HR: 'bg-blue-100 text-blue-800',
  PENDING_FOUNDER: 'bg-violet-100 text-violet-800',
  JD_DRAFT: 'bg-orange-100 text-[#C2570C]',
  JOB_OPEN: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  CLOSED: 'bg-slate-200 text-slate-700',
};
/** "Open" = posted and taking applications; "In progress" = still going through approval or JD; "Closed" = closed or rejected. */
const GROUP: Record<RequisitionStatus, Exclude<Filter, 'ALL' | 'MINE'>> = {
  PENDING_ASSIGNMENT: 'PROGRESS', PENDING_HR: 'PROGRESS', PENDING_FOUNDER: 'PROGRESS', JD_DRAFT: 'PROGRESS', JOB_OPEN: 'OPEN', REJECTED: 'CLOSED', CLOSED: 'CLOSED',
};
const SELECT = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#4f46e5]';
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const TILE = {
  purple: ['bg-gradient-to-br from-violet-100/80 to-indigo-50', 'bg-violet-100 text-violet-600'],
  blue: ['bg-gradient-to-br from-sky-100/80 to-blue-50', 'bg-sky-100 text-sky-600'],
  green: ['bg-gradient-to-br from-emerald-100/70 to-green-50', 'bg-emerald-100 text-emerald-600'],
  orange: ['bg-gradient-to-br from-orange-100/80 to-amber-50', 'bg-orange-100 text-[#F36B21]'],
} as const;

export const RequisitionsModule: React.FC<Props> = ({ currentUser, users, embedded = false }) => {
  const [all, setAll] = useState<Requisition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('MINE');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [loc, setLoc] = useState('');
  const [mgr, setMgr] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [showBudgets, setShowBudgets] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [avgDays, setAvgDays] = useState<number | null>(null);

  useEffect(() => {
    const unsub = subscribeToRequisitions((items) => {
      setAll(items);
      setLoaded(true);
    });
    return unsub;
  }, []);
  // Average time to hire comes from the founder dashboard; people who cannot open it simply do not get that tile.
  useEffect(() => {
    if (embedded) return;
    dashService.dashboard().then((r: any) => setAvgDays(r?.dashboard?.timeToHire?.averageDays ?? null)).catch(() => undefined);
  }, [embedded]);

  // Only show what this user is allowed to see
  const visible = useMemo(() => all.filter((r) => can(currentUser, 'view', r)), [all, currentUser]);
  const myActionCount = useMemo(() => visible.filter((r) => needsMyAction(currentUser, r)).length, [visible, currentUser]);

  useEffect(() => {
    // Default to "all" when nothing needs the user's attention
    if (loaded && filter === 'MINE' && myActionCount === 0) setFilter('ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const uniq = (f: (r: Requisition) => string | undefined) => Array.from(new Set(visible.map(f).filter(Boolean) as string[])).sort();
  const depts = useMemo(() => uniq((r) => r.departmentName), [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const locs = useMemo(() => uniq((r) => r.location), [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const mgrs = useMemo(() => uniq((r) => r.requestedBy?.name), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible
      .filter((r) => (filter === 'MINE' ? needsMyAction(currentUser, r) : filter === 'ALL' ? true : GROUP[r.status] === filter))
      .filter((r) => (!dept || r.departmentName === dept) && (!loc || r.location === loc) && (!mgr || r.requestedBy?.name === mgr) && (!status || r.status === status))
      .filter((r) => !q || [r.reqNo, r.positionTitle, r.departmentName, r.requestedBy.name, r.ownerHr?.name || ''].some((v) => v.toLowerCase().includes(q)));
  }, [visible, filter, search, currentUser, dept, loc, mgr, status]);

  const count = (g: Exclude<Filter, 'ALL' | 'MINE'>) => visible.filter((r) => GROUP[r.status] === g).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const change = (fn: () => void) => { fn(); setPage(1); };
  const openReq = openId ? all.find((r) => r.id === openId) || null : null;

  // "vs last month": how many of this kind were raised this calendar month against last month.
  const now = new Date();
  const monthOf = (iso: string) => { const d = new Date(iso); return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()); };
  const trendFor = (list: Requisition[]) => {
    const cm = list.filter((r) => monthOf(r.createdAt) === 0).length; const pm = list.filter((r) => monthOf(r.createdAt) === 1).length;
    return pm > 0 ? Math.round(((cm - pm) / pm) * 100) : null;
  };
  const tiles: { label: string; value: React.ReactNode; tone: keyof typeof TILE; Icon: React.FC<{ className?: string }>; trend?: number | null }[] = [
    { label: 'Open Requisitions', value: count('OPEN'), tone: 'purple', Icon: Briefcase, trend: trendFor(visible.filter((r) => GROUP[r.status] === 'OPEN')) },
    { label: 'In Progress Hiring', value: count('PROGRESS'), tone: 'blue', Icon: Layers, trend: trendFor(visible.filter((r) => GROUP[r.status] === 'PROGRESS')) },
    { label: 'Total Requisitions', value: visible.length, tone: 'green', Icon: FileText, trend: trendFor(visible) },
    ...(avgDays !== null ? [{ label: 'Avg. Time to Hire', value: <>{avgDays} <span className="text-xl">days</span></>, tone: 'orange' as const, Icon: Clock }] : []),
  ];

  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Requisition ID', 'Job Title', 'Department', 'Location', 'Hiring Manager', 'Status', 'Openings', 'Created On'];
    const body = rows.map((r) => [r.reqNo, r.positionTitle, r.departmentName, r.location, r.requestedBy?.name, STATUS_LABEL[r.status], r.vacancies, (r.createdAt || '').slice(0, 10)].map(q).join(','));
    const url = URL.createObjectURL(new Blob([[head.map(q).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'requisitions.csv'; a.click(); URL.revokeObjectURL(url);
  };

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'MINE', label: 'Needs my action', count: myActionCount },
    { key: 'ALL', label: 'All Requisitions', count: visible.length },
    { key: 'OPEN', label: 'Open', count: count('OPEN') },
    { key: 'PROGRESS', label: 'In Progress', count: count('PROGRESS') },
    { key: 'CLOSED', label: 'Closed', count: count('CLOSED') },
  ];
  const pageButtons = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1);

  return (
    <div className={`flex-1 min-w-0 ${embedded ? 'space-y-4 p-3 sm:p-4' : 'space-y-5 bg-[#F7F8FA] p-4 sm:p-6 xl:p-8'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={`${embedded ? 'text-lg' : 'text-3xl'} font-bold tracking-tight text-slate-950`}>{embedded ? 'Hiring requests' : 'Requisitions'}</h1>
          <p className="mt-1 text-sm text-slate-600">{embedded ? 'Review and manage your department hiring requests.' : 'Create, track and manage hiring requisitions across your organization.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!embedded && hasPerm(currentUser.perms, 'hiring.budget.manage') && <button onClick={() => setShowBudgets(true)} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#4f46e5]"><Wallet className="h-4 w-4" />Budgets</button>}
          {!embedded && <button onClick={exportCsv} disabled={rows.length === 0} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#4f46e5] disabled:opacity-50"><Download className="h-4 w-4" />Export</button>}
          {can(currentUser, 'create') && <button onClick={() => setShowNew(true)} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-[#4f46e5] px-5 text-sm font-bold text-white shadow-sm hover:bg-[#4338ca]"><Plus className="h-4 w-4" />Create Requisition</button>}
        </div>
      </div>

      {!embedded && <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Requisition summary">
        {tiles.map((t) => (
          <div key={t.label} className={`flex items-start gap-4 rounded-2xl border border-white px-5 py-4 ${TILE[t.tone][0]}`}>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${TILE[t.tone][1]}`}><t.Icon className="h-6 w-6" /></span>
            <span className="min-w-0">
              <span className="block text-sm text-slate-700">{t.label}</span>
              <span className="block text-3xl font-bold leading-tight tabular-nums text-slate-950">{loaded ? t.value : '—'}</span>
              {t.trend !== undefined && t.trend !== null && t.trend !== 0 && <span className="block text-sm"><b className={t.trend > 0 ? 'text-emerald-600' : 'text-rose-600'}>{t.trend > 0 ? '↑' : '↓'} {Math.abs(t.trend)}%</b> <span className="text-slate-600">vs last month</span></span>}
            </span>
          </div>
        ))}
      </section>}

      <div className="space-y-4">
        <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-200" role="tablist" aria-label="Requisition groups">
          {tabs.map((t) => { const on = filter === t.key; return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => change(() => setFilter(t.key))} className={`-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 px-2 py-3 text-sm font-semibold ${on ? 'border-[#4f46e5] text-[#4f46e5]' : 'border-transparent text-slate-800 hover:text-slate-950'}`}>
              {t.label}<span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${on ? 'bg-violet-100 text-[#4f46e5]' : 'bg-slate-100 text-slate-700'}`}>{t.count}</span>
            </button>); })}
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input aria-label="Search requisitions" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#4f46e5]" placeholder="Search requisitions (title, ID, department)..." value={search} onChange={(e) => change(() => setSearch(e.target.value))} /></div>
          <select className={SELECT} aria-label="Department" value={dept} onChange={(e) => change(() => setDept(e.target.value))}><option value="">Department</option>{depts.map((x) => <option key={x}>{x}</option>)}</select>
          <select className={SELECT} aria-label="Location" value={loc} onChange={(e) => change(() => setLoc(e.target.value))}><option value="">Location</option>{locs.map((x) => <option key={x}>{x}</option>)}</select>
          <select className={SELECT} aria-label="Hiring manager" value={mgr} onChange={(e) => change(() => setMgr(e.target.value))}><option value="">Hiring Manager</option>{mgrs.map((x) => <option key={x}>{x}</option>)}</select>
          <select className={SELECT} aria-label="Status" value={status} onChange={(e) => change(() => setStatus(e.target.value))}><option value="">Status</option>{(Object.keys(STATUS_LABEL) as RequisitionStatus[]).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!loaded ? <div className="p-10 text-center text-sm text-slate-500">Loading requisitions...</div> : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><Inbox className="h-6 w-6 text-slate-400" /></span>
              <div className="text-sm font-bold text-slate-800">No requisitions here</div>
              <div className="max-w-sm text-xs leading-relaxed text-slate-600">{visible.length === 0 ? (can(currentUser, 'create') ? 'Raise the first one with “Create Requisition”.' : 'Nothing has been assigned to you yet.') : 'No requisitions match these filters.'}</div>
            </div>
          ) : <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-700"><tr className="border-b border-slate-200">
                  {['Requisition ID', 'Job Title', 'Department', 'Location', 'Hiring Manager', 'Status', 'Openings', 'Created On', 'Actions'].map((h) => <th key={h} className="px-4 py-3.5 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">{shown.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-violet-50/30">
                    <td className="px-4 py-4"><button type="button" onClick={() => setOpenId(r.id)} className="cursor-pointer font-semibold text-[#4f46e5] underline-offset-2 hover:underline">{r.reqNo}</button></td>
                    <td className="px-4 py-4 font-semibold text-slate-900">{r.positionTitle}</td>
                    <td className="px-4 py-4 text-slate-700">{r.departmentName || '—'}</td>
                    <td className="px-4 py-4 text-slate-700">{r.location || '—'}</td>
                    <td className="px-4 py-4"><span className="inline-flex items-center gap-2"><Avatar name={r.requestedBy?.name || '?'} /><span className="font-medium text-slate-900">{r.requestedBy?.name || '—'}</span></span></td>
                    <td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="px-4 py-4 tabular-nums text-slate-800">{r.vacancies}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-slate-800">{fmt(r.createdAt)}</td>
                    <td className="px-4 py-4">{needsMyAction(currentUser, r)
                      ? <button type="button" onClick={() => setOpenId(r.id)} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-xs font-bold text-[#B94B0D]"><AlertCircle className="h-3.5 w-3.5" />Your turn</button>
                      : <button type="button" aria-label={`Open ${r.reqNo}`} onClick={() => setOpenId(r.id)} className="cursor-pointer rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"><MoreHorizontal className="h-5 w-5" /></button>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5 text-sm text-slate-700">
              <span>Showing {(cur - 1) * PAGE + 1} – {Math.min(cur * PAGE, rows.length)} of {rows.length} requisition{rows.length === 1 ? '' : 's'}</span>
              {pages > 1 && <nav className="flex items-center gap-1.5" aria-label="Pages">
                <button type="button" disabled={cur === 1} onClick={() => setPage(cur - 1)} aria-label="Previous page" className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                {pageButtons.map((n, i) => <React.Fragment key={n}>{i > 0 && n - pageButtons[i - 1] > 1 && <span className="px-1">…</span>}<button type="button" onClick={() => setPage(n)} aria-current={n === cur ? 'page' : undefined} className={`h-9 min-w-9 cursor-pointer rounded-lg px-2 font-semibold ${n === cur ? 'bg-[#4f46e5] text-white' : 'border border-slate-200 bg-white text-slate-800 hover:border-[#4f46e5]'}`}>{n}</button></React.Fragment>)}
                <button type="button" disabled={cur === pages} onClick={() => setPage(cur + 1)} aria-label="Next page" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"><ChevronsRight className="h-4 w-4" /></button>
              </nav>}
            </div>
          </>}
        </div>
      </div>
      {showBudgets && <HiringBudgetsModal onClose={() => setShowBudgets(false)} />}
      {showNew && <NewRequisitionModal currentUser={currentUser} users={users} existing={all} onClose={() => setShowNew(false)} onCreated={(r) => { setShowNew(false); setFilter('ALL'); setOpenId(r.id); }} />}
      {openReq && <RequisitionDetailPanel req={openReq} currentUser={currentUser} users={users} allRequisitions={all} onClose={() => setOpenId(null)} />}
    </div>
  );
};
