import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Inbox, Users, ClipboardList, AlertCircle } from 'lucide-react';
import { Requisition, RequisitionStatus, User } from '../types';
import { subscribeToRequisitions } from '../services/requisitionService';
import { STATUS_LABEL, can, needsMyAction } from '../utils/requisitionPermissions';
import { NewRequisitionModal } from './NewRequisitionModal';
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
    <div className="flex-1 min-w-0 space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`${embedded ? 'text-lg' : 'text-2xl'} font-black tracking-tight text-slate-900`}>
            {embedded ? 'Hiring requests' : 'Talent Acquisition - Requisitions'}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Request, approve and publish new hires: department head, then HR, then founder, then job description.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {can(currentUser, 'create') && (
            <button
              onClick={() => setShowNew(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#FA7014] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#E65A05]"
            >
              <Plus className="w-3.5 h-3.5" /> New requisition
            </button>
          )}
        </div>
      </div>

      {(
        <>
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                  filter === c.key ? 'border-[#FA7014] bg-orange-50 text-[#C2570C]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {c.label}
                {c.count !== undefined && <span className="ml-1.5 text-slate-400">{c.count}</span>}
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA7014]/30"
                placeholder="Search requisitions"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {!loaded ? (
              <div className="p-8 text-center text-xs text-slate-500">Loading requisitions...</div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <Inbox className="w-8 h-8 text-slate-300" />
                <div className="text-sm font-bold text-slate-700">No requisitions here</div>
                <div className="text-xs text-slate-500">
                  {visible.length === 0
                    ? can(currentUser, 'create')
                      ? 'Raise the first one with "New requisition".'
                      : 'Nothing has been assigned to you yet.'
                    : 'Try a different filter.'}
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[r.urgency]}`} title={`${r.urgency} urgency`} />
                          <span className="text-[11px] font-mono font-bold text-slate-500">{r.reqNo}</span>
                          <span className="truncate text-sm font-black text-slate-900">{r.positionTitle}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {r.departmentName} - {r.vacancies} opening{r.vacancies === 1 ? '' : 's'} - by {r.requestedBy.name}
                          {r.ownerHr ? ` - owner ${r.ownerHr.name}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {needsMyAction(currentUser, r) && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#C2570C]">
                            <AlertCircle className="w-3.5 h-3.5" /> Your turn
                          </span>
                        )}
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {showNew && (
        <NewRequisitionModal
          currentUser={currentUser}
          users={users}
          existing={all}
          onClose={() => setShowNew(false)}
          onCreated={(r) => {
            setShowNew(false);
            setView('requests');
            setFilter('ALL');
            setOpenId(r.id);
          }}
        />
      )}

      {openReq && (
        <RequisitionDetailPanel req={openReq} currentUser={currentUser} users={users} allRequisitions={all} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
};
