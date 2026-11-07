import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Wallet, Search, Inbox, Users, ClipboardList, AlertCircle, FileText, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Requisition, RequisitionStatus, User } from '../types';
import { subscribeToRequisitions } from '../services/requisitionService';
import { STATUS_LABEL, can, needsMyAction } from '../utils/requisitionPermissions';
import { NewRequisitionModal } from './NewRequisitionModal';
import { HiringBudgetsModal } from './HiringBudgetsModal';
import { hasPerm } from '../../shared/permissions';
import { RequisitionDetailPanel } from './RequisitionDetailPanel';

interface Props {
  currentUser: User;
  users: User[];
  /** Compact header for the department-head view embedded in the employee portal */
  embedded?: boolean;
}

type Filter = 'ALL' | 'MINE' | RequisitionStatus;

const STATUS_STYLE: Record<RequisitionStatus, string> = {
  PENDING_ASSIGNMENT: 'bg-amber-100 text-amber-800',
  PENDING_HR: 'bg-blue-100 text-blue-800',
  PENDING_FOUNDER: 'bg-violet-100 text-violet-800',
  JD_DRAFT: 'bg-orange-100 text-[#C2570C]',
  JOB_OPEN: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  CLOSED: 'bg-slate-200 text-slate-700',
};

const URGENCY_DOT: Record<Requisition['urgency'], string> = {
  LOW: 'bg-slate-300',
  MEDIUM: 'bg-amber-400',
  HIGH: 'bg-rose-500',
};

export const RequisitionsModule: React.FC<Props> = ({ currentUser, users, embedded = false }) => {
  const [all, setAll] = useState<Requisition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('MINE');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'requests' | 'roles'>('requests');
  const [showNew, setShowNew] = useState(false);
  const [showBudgets, setShowBudgets] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToRequisitions((items) => {
      setAll(items);
      setLoaded(true);
    });
    return unsub;
  }, []);

  // Only show what this user is allowed to see
  const visible = useMemo(() => all.filter((r) => can(currentUser, 'view', r)), [all, currentUser]);
  const myActionCount = useMemo(() => visible.filter((r) => needsMyAction(currentUser, r)).length, [visible, currentUser]);

  useEffect(() => {
    // Default to "all" when nothing needs the user's attention
    if (loaded && filter === 'MINE' && myActionCount === 0) setFilter('ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible
      .filter((r) => {
        if (filter === 'MINE') return needsMyAction(currentUser, r);
        if (filter !== 'ALL') return r.status === filter;
        return true;
      })
      .filter(
        (r) =>
          !q ||
          [r.reqNo, r.positionTitle, r.departmentName, r.requestedBy.name, r.ownerHr?.name || ''].some((v) =>
            v.toLowerCase().includes(q)
          )
      );
  }, [visible, filter, search, currentUser]);

  const counts = useMemo(() => {
    const c: Partial<Record<RequisitionStatus, number>> = {};
    for (const r of visible) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [visible]);

  const openReq = openId ? all.find((r) => r.id === openId) || null : null;

  const chips: { key: Filter; label: string; count?: number }[] = [
    { key: 'MINE', label: 'Needs my action', count: myActionCount },
    { key: 'ALL', label: 'All', count: visible.length },
    { key: 'PENDING_ASSIGNMENT', label: STATUS_LABEL.PENDING_ASSIGNMENT, count: counts.PENDING_ASSIGNMENT },
    { key: 'PENDING_HR', label: STATUS_LABEL.PENDING_HR, count: counts.PENDING_HR },
    { key: 'PENDING_FOUNDER', label: STATUS_LABEL.PENDING_FOUNDER, count: counts.PENDING_FOUNDER },
    { key: 'JD_DRAFT', label: STATUS_LABEL.JD_DRAFT, count: counts.JD_DRAFT },
    { key: 'JOB_OPEN', label: STATUS_LABEL.JOB_OPEN, count: counts.JOB_OPEN },
    { key: 'REJECTED', label: STATUS_LABEL.REJECTED, count: counts.REJECTED },
    { key: 'CLOSED', label: STATUS_LABEL.CLOSED, count: counts.CLOSED },
  ];

  return (
    <div className={`flex-1 min-w-0 ${embedded ? 'space-y-4 p-3 sm:p-4' : 'space-y-6 bg-[#F7F8FA] p-4 sm:p-6 xl:p-8'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          {!embedded && <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500"><span>Talent Acquisition</span><ChevronRight className="h-3.5 w-3.5" /><span className="text-slate-800">Requisitions</span></div>}
          <h1 className={`${embedded ? 'text-lg' : 'text-[28px]'} font-bold tracking-tight text-slate-900`}>{embedded ? 'Hiring requests' : 'Hiring requisitions'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{embedded ? 'Review and manage your department hiring requests.' : 'Track hiring requests from department submission through approval and job opening.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!embedded && hasPerm(currentUser.perms, 'hiring.budget.manage') && <button onClick={() => setShowBudgets(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"><Wallet className="h-4 w-4" /> Hiring budgets</button>}
          {can(currentUser, 'create') && <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#F36B21] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#DF5C17] focus:outline-none focus:ring-2 focus:ring-orange-300 focus:ring-offset-2"><Plus className="h-4 w-4" /> New requisition</button>}
        </div>
      </div>

      {!embedded && <div className="grid grid-cols-2 gap-3 rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50/90 via-white to-orange-50/60 p-4 sm:grid-cols-4 sm:gap-2 sm:p-5">
        {[{ label: 'Department request', icon: FileText }, { label: 'HR review', icon: Users }, { label: 'Founder approval', icon: CheckCircle2 }, { label: 'Job description', icon: ClipboardList }].map((step, index) => {
          const StepIcon = step.icon;
          return <div key={step.label} className="flex items-center gap-2.5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[#F36B21]"><StepIcon className="h-5 w-5" /></span><span className="text-xs font-semibold text-slate-800 sm:text-sm">{step.label}</span>{index < 3 && <ChevronRight className="ml-auto hidden h-4 w-4 text-slate-400 sm:block" />}</div>;
        })}
      </div>}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => <button key={c.key} onClick={() => setFilter(c.key)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold transition-colors ${filter === c.key ? 'border-[#F36B21] bg-orange-50 text-[#B94B0D]' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
            {c.label}{c.count !== undefined && <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${filter === c.key ? 'bg-orange-100 text-[#B94B0D]' : 'bg-slate-100 text-slate-500'}`}>{c.count}</span>}
          </button>)}
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input aria-label="Search requisitions" className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#F36B21] focus:ring-2 focus:ring-orange-100" placeholder="Search requisitions" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!loaded ? <div className="p-10 text-center text-sm text-slate-500">Loading requisitions...</div> : rows.length === 0 ? <div className="flex flex-col items-center gap-2 p-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100"><Inbox className="h-6 w-6 text-slate-400" /></span>
            <div className="text-sm font-bold text-slate-800">No requisitions here</div>
            <div className="max-w-sm text-xs leading-relaxed text-slate-500">{visible.length === 0 ? (can(currentUser, 'create') ? 'Raise the first one with “New requisition”.' : 'Nothing has been assigned to you yet.') : 'No requests match this filter or search. Try adjusting your selection.'}</div>
          </div> : <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[850px] border-collapse text-left">
                <thead className="bg-slate-50"><tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3.5">Requisition</th><th className="px-4 py-3.5">Department</th><th className="px-4 py-3.5">Requested by</th><th className="px-4 py-3.5 text-center">Vacancies</th><th className="px-4 py-3.5">Urgency</th><th className="px-4 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Action</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer transition-colors hover:bg-slate-50/80">
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#F36B21]"><FileText className="h-4 w-4" /></span><div className="min-w-0"><div className="font-mono text-[11px] font-bold text-slate-800">{r.reqNo}</div><div className="mt-0.5 max-w-[230px] truncate text-xs text-slate-600">{r.positionTitle}</div></div></div></td>
                  <td className="px-4 py-4 text-xs font-medium text-slate-700">{r.departmentName}</td><td className="px-4 py-4"><div className="text-xs font-medium text-slate-800">{r.requestedBy.name}</div>{r.ownerHr && <div className="mt-0.5 text-[10px] text-slate-400">HR: {r.ownerHr.name}</div>}</td>
                  <td className="px-4 py-4 text-center text-xs font-semibold tabular-nums text-slate-700">{r.vacancies}</td><td className="px-4 py-4"><span className="inline-flex items-center gap-2 text-xs text-slate-700"><span className={`h-2 w-2 rounded-full ${URGENCY_DOT[r.urgency]}`} />{r.urgency.charAt(0) + r.urgency.slice(1).toLowerCase()}</span></td>
                  <td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td><td className="px-5 py-4 text-right">{needsMyAction(currentUser, r) ? <span className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-[10px] font-bold text-[#B94B0D]"><AlertCircle className="h-3 w-3" /> Your turn</span> : <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">{rows.map((r) => <li key={r.id}><button onClick={() => setOpenId(r.id)} className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50">
              <span className="flex min-w-0 items-start gap-3"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#F36B21]"><FileText className="h-4 w-4" /></span><span className="min-w-0"><span className="block font-mono text-[10px] font-bold text-slate-500">{r.reqNo}</span><span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">{r.positionTitle}</span><span className="mt-1 block text-[11px] text-slate-500">{r.departmentName} · {r.vacancies} opening{r.vacancies === 1 ? '' : 's'}</span><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span></span></span><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
            </button></li>)}</ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3 text-[11px] text-slate-500"><span>Showing {rows.length} of {visible.length} requisitions</span><span>Sorted by latest activity</span></div>
          </>}
        </div>
      </div>
      {showBudgets && <HiringBudgetsModal onClose={() => setShowBudgets(false)} />}
      {showNew && <NewRequisitionModal currentUser={currentUser} users={users} existing={all} onClose={() => setShowNew(false)} onCreated={(r) => { setShowNew(false); setFilter('ALL'); setOpenId(r.id); }} />}
      {openReq && <RequisitionDetailPanel req={openReq} currentUser={currentUser} users={users} allRequisitions={all} onClose={() => setOpenId(null)} />}
    </div>
  );
};
