import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleCheck, CircleX, FileText, Files, Users } from 'lucide-react';
import { Avatar as InitialAvatar } from '../home/parts';
import { btnViolet, dmy, Kpi, MonthChip, PageHead, Pager, Panel, Pill, SearchBox, Select, shiftMonthStr, t12, Tabs, THead } from './kit';
import { leaveService } from '../../services/leaveService';
import { OpenDoc } from './DocAttach';
import { CoverPanel } from './CoverPanel';
import {
  addDaysIso, btnDanger, btnGhost, btnPrimary, Card, ConfirmButton, days, EmptyState, halfNote, input, niceDate, Notice, range, Segmented,
  shortDate, shortRange, Skeleton, StatusPill, thisMonth, todayIst, useRunner,
} from './ui';

const initials = (n: string) => (n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
const Avatar = InitialAvatar;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The questions asked and the answers given on a request, oldest first, so the approver sees the reply. */
const Thread: React.FC<{ events?: { at: string; by: string; message: string }[] }> = ({ events }) => {
  const items = (events || []).filter((e) => /^(More information needed|Replied):/.test(e.message));
  if (items.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {items.map((e, i) => {
        const asked = e.message.startsWith('More information needed:');
        return (
          <div key={i} className={`text-xs rounded-lg px-2.5 py-1.5 border ${asked ? 'bg-amber-50 border-amber-100 text-amber-900' : 'bg-emerald-50 border-emerald-100 text-emerald-900'}`}>
            <span className="font-bold">{asked ? `Question from ${e.by}` : `${e.by} replied`}:</span> {e.message.replace(/^(More information needed|Replied):\s*/, '')}
          </div>
        );
      })}
    </div>
  );
};

type Row = { key: string; id: string; kind: 'leave' | 'cancel' | 'fix'; state: 'PENDING' | 'APPROVED' | 'REJECTED'; name: string; type: string; when: string; reason: string; raw: any };
const PER = 6;
const reqNo = (r: any, fix: boolean) => fix ? (r.docNo || `REG-${String(r.id).slice(-5).toUpperCase()}`) : `APP-${String(r.id).slice(-4).toUpperCase()}`;

export const ApprovalsTab: React.FC<{ reload: () => void }> = ({ reload }) => (
  <div className="space-y-5">
    <PageHead title="Approvals" subtitle="Review and take action on leave, regularization and attendance requests." />
    <CoverPanel onChanged={reload} />
    <ApprovalsList reload={reload} />
  </div>
);

const ApprovalsList: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [data, setData] = useState<any | null>(null);
  const [overlap, setOverlap] = useState<any[]>([]);
  const [tab, setTab] = useState('PENDING');
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('ALL');
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState('');
  const [bulkReject, setBulkReject] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(() => leaveService.inbox().then((d) => {
    setData(d);
    const leaves: any[] = d.leaves || [];
    if (leaves.length === 0) { setOverlap([]); return; }
    // One calendar call covers every request, so we can say who else is away on those days.
    const from = leaves.reduce((m, r) => (r.from < m ? r.from : m), leaves[0].from);
    let to = leaves.reduce((m, r) => (r.to > m ? r.to : m), leaves[0].to);
    if (daysBetween(from, to) > 95) to = addDaysIso(from, 95);
    leaveService.teamCalendar(from, to).then((c) => setOverlap(c.items || [])).catch(() => setOverlap([]));
  }).catch(() => setData({ leaves: [], regularizations: [], decided: { leaves: [], regularizations: [] } })), []);
  useEffect(() => { load(); }, [load]);

  const alsoAway = useCallback((r: any) => Array.from(new Set(overlap.filter((o) => o.uid !== r.uid && o.from <= r.to && o.to >= r.from).map((o) => o.name))), [overlap]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const L = (r: any, state: Row['state']): Row => ({ key: `l-${r.id}`, id: r.id, kind: r.stage === 'CANCEL' ? 'cancel' : 'leave', state, name: r.name, type: r.stage === 'CANCEL' ? 'Leave cancellation' : 'Leave', when: shortRange(r.from, r.to) + (r.days ? ` (${days(r.days)})` : ''), reason: r.reason || '', raw: r });
    const F = (r: any, state: Row['state']): Row => ({ key: `f-${r.id}`, id: r.id, kind: 'fix', state, name: r.name, type: 'Regularization', when: dmy(r.date), reason: r.reason || '', raw: r });
    return [
      ...(data.leaves || []).map((r: any) => L(r, 'PENDING')), ...(data.regularizations || []).map((r: any) => F(r, 'PENDING')),
      ...(data.decided?.leaves || []).map((r: any) => L(r, r.status === 'REJECTED' ? 'REJECTED' : 'APPROVED')),
      ...(data.decided?.regularizations || []).map((r: any) => F(r, r.status === 'REJECTED' ? 'REJECTED' : 'APPROVED')),
    ];
  }, [data]);

  const n = (s: string) => rows.filter((r) => r.state === s).length;
  const list = rows.filter((r) => (tab === 'ALL' || r.state === tab) && (typeF === 'ALL' || r.type === typeF) && (!q || `${r.name} ${r.reason} ${reqNo(r.raw, r.kind === 'fix')}`.toLowerCase().includes(q.toLowerCase())));
  const cur = Math.min(page, Math.max(1, Math.ceil(list.length / PER)));
  const shown = list.slice((cur - 1) * PER, cur * PER);
  const sel = rows.find((r) => r.key === openKey) || shown[0] || null;
  const pendingShown = shown.filter((r) => r.state === 'PENDING');

  const act = (r: Row, decision: 'APPROVE' | 'REJECT' | 'INFO', comment: string) =>
    run(async () => {
      if (r.kind === 'fix') await leaveService.decideRegularization(r.id, decision === 'INFO' ? 'REJECT' : decision, comment);
      else await leaveService.decide(r.id, decision, comment);
      setRemarks('');
      await Promise.all([load(), reload()]);
    }, decision === 'APPROVE' ? 'Approved. The employee has been told.' : decision === 'INFO' ? 'Question sent. The request is on hold until the employee replies.' : 'Rejected. The employee has been told.');

  const bulk = (decision: 'APPROVE' | 'REJECT', comment: string) => {
    const picked = rows.filter((r) => checked.has(r.key) && r.state === 'PENDING');
    return run(async () => {
      for (const r of picked) {
        if (r.kind === 'fix') await leaveService.decideRegularization(r.id, decision, comment);
        else await leaveService.decide(r.id, decision, comment);
      }
      setChecked(new Set()); setBulkReject(false); setBulkText('');
      await Promise.all([load(), reload()]);
    }, `${decision === 'APPROVE' ? 'Approved' : 'Rejected'} ${picked.length} request(s).`);
  };

  if (!data) return <Skeleton rows={3} />;
  const allChecked = pendingShown.length > 0 && pendingShown.every((r) => checked.has(r.key));
  const toggle = (k: string) => setChecked((c) => { const x = new Set(c); if (x.has(k)) x.delete(k); else x.add(k); return x; });
  const away = sel && sel.kind !== 'fix' ? alsoAway(sel.raw) : [];
  const canSeeDocs = !!data.canManage;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total Requests" value={rows.length} tone="violet" Icon={Files} />
        <Kpi label="Pending" value={n('PENDING')} tone="green" Icon={CircleCheck} />
        <Kpi label="Approved" value={n('APPROVED')} tone="blue" Icon={CheckCircle2} />
        <Kpi label="Rejected" value={n('REJECTED')} tone="rose" Icon={CircleX} />
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {data.decided && <p className="-mt-2 text-xs text-slate-500">Approved and rejected show the last 90 days.</p>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <Tabs value={tab} onChange={(k) => { setTab(k); setPage(1); }} tabs={[{ key: 'PENDING', label: 'Pending', count: n('PENDING') }, { key: 'APPROVED', label: 'Approved', count: n('APPROVED') }, { key: 'REJECTED', label: 'Rejected', count: n('REJECTED') }, { key: 'ALL', label: 'All', count: rows.length }]} />
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by employee or request ID..." className="min-w-[200px] flex-1" />
            <Select label="Request type" value={typeF} onChange={(v) => { setTypeF(v); setPage(1); }} options={[{ value: 'ALL', label: 'Request Type' }, { value: 'Leave', label: 'Leave' }, { value: 'Leave cancellation', label: 'Leave cancellation' }, { value: 'Regularization', label: 'Regularization' }]} />
          </div>
          <Panel className="!p-4">
            {list.length === 0 ? (
              <div className="py-10 text-center"><div className="text-lg font-bold text-slate-900">{tab === 'PENDING' ? 'All caught up' : 'Nothing here'}</div><p className="mt-1 text-sm text-slate-600">{tab === 'PENDING' ? 'Nothing is waiting for you. New requests will show up here and you will get an email.' : 'No requests match these filters.'}</p></div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <THead cols={['', 'Request ID', 'Employee', 'Request Type', 'Duration / Date', 'Reason', '']} />
                    <tbody className="divide-y divide-slate-100">
                      {shown.map((r) => (
                        <tr key={r.key} onClick={() => setOpenKey(r.key)} className={`cursor-pointer hover:bg-slate-50 ${sel?.key === r.key ? 'bg-violet-50/70' : ''}`}>
                          <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>{r.state === 'PENDING' && <input type="checkbox" aria-label={`Select ${r.name}`} checked={checked.has(r.key)} onChange={() => toggle(r.key)} className="h-4 w-4 accent-violet-600" />}</td>
                          <td className="whitespace-nowrap px-3 py-3 font-semibold text-violet-700 underline">{reqNo(r.raw, r.kind === 'fix')}</td>
                          <td className="px-3 py-3"><span className="flex items-center gap-2.5"><Avatar name={r.name} /><b className="truncate text-slate-900">{r.name}</b></span></td>
                          <td className="px-3 py-3"><Pill tone={r.kind === 'fix' ? 'blue' : r.kind === 'cancel' ? 'amber' : 'violet'}>{r.type}</Pill></td>
                          <td className="px-3 py-3 text-slate-800">{r.when}</td>
                          <td className="max-w-[10rem] truncate px-3 py-3 text-slate-800">{r.reason || '—'}</td>
                          <td className="px-3 py-3 text-slate-500">{r.state === 'PENDING' ? '⋯' : <Pill tone={r.state === 'APPROVED' ? 'green' : 'rose'}>{r.state === 'APPROVED' ? 'Approved' : 'Rejected'}</Pill>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} total={list.length} per={PER} noun="requests" onPage={setPage} />
              </>
            )}
          </Panel>
          {pendingShown.length > 0 && (
            <Panel className="!p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-800"><input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(pendingShown.map((r) => r.key)))} className="h-4 w-4 accent-violet-600" />Select All ({pendingShown.length})</label>
                <ConfirmButton className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50" disabled={busy || checked.size === 0} question={`Approve ${checked.size}?`} yes="Approve" onConfirm={() => bulk('APPROVE', '')}>Approve Selected</ConfirmButton>
                {bulkReject ? (
                  <span className="flex flex-wrap items-center gap-2"><input autoFocus value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder="Reason (required)" className={`${input} !w-56`} /><button type="button" disabled={busy || !bulkText.trim() || checked.size === 0} onClick={() => bulk('REJECT', bulkText.trim())} className="h-10 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer">Reject {checked.size}</button><button type="button" onClick={() => setBulkReject(false)} className="text-sm font-semibold text-slate-600 cursor-pointer">Back</button></span>
                ) : <button type="button" disabled={busy || checked.size === 0} onClick={() => setBulkReject(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer">Reject Selected</button>}
              </div>
            </Panel>
          )}
        </div>

        {sel ? (
          <Panel title="Request Details" className="xl:sticky xl:top-4" right={<Pill tone={sel.state === 'PENDING' ? 'amber' : sel.state === 'APPROVED' ? 'green' : 'rose'}>{sel.state === 'PENDING' ? 'Pending' : sel.state === 'APPROVED' ? 'Approved' : 'Rejected'}</Pill>}>
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <Avatar name={sel.name} size="lg" />
              <div className="min-w-0">
                <div className="truncate text-lg font-bold text-slate-950">{sel.name}</div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {sel.raw.coveringFor && <Pill tone="blue">Covering for {sel.raw.coveringFor}</Pill>}
                  {sel.raw.managerAway && sel.raw.stage === 'MANAGER' && <Pill tone="amber">{sel.raw.managerName || 'Manager'} is on leave</Pill>}
                  {sel.raw.stage === 'HR' && <Pill>HR approval{sel.raw.managerName ? ` · ${sel.raw.managerName} said yes` : ''}</Pill>}
                </div>
              </div>
            </div>
            <dl className="mt-4 space-y-2.5 text-sm">
              {[['Request ID', reqNo(sel.raw, sel.kind === 'fix')], ['Request Type', sel.type], [sel.kind === 'fix' ? 'Date' : 'Leave Period', sel.kind === 'fix' ? dmy(sel.raw.date) : `${dmy(sel.raw.from)} – ${dmy(sel.raw.to)}`], ...(sel.kind === 'fix' ? [['Time in / out', `${t12(sel.raw.checkIn) === '--' ? 'unchanged' : t12(sel.raw.checkIn)} / ${t12(sel.raw.checkOut) === '--' ? 'unchanged' : t12(sel.raw.checkOut)}`]] : [['Leave type', sel.raw.typeName], ['Duration', `${days(sel.raw.days)}${halfNote(sel.raw)}`]]), ['Reason', sel.reason || '—']].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-2"><dt className="text-slate-600">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
              ))}
            </dl>
            {sel.kind !== 'fix' && (
              <div className={`mt-3 flex items-center gap-1.5 text-xs ${away.length ? 'font-semibold text-amber-700' : 'text-slate-600'}`}><Users className="h-3.5 w-3.5" />{away.length ? `Also away: ${away.slice(0, 4).join(', ')}${away.length > 4 ? ` +${away.length - 4}` : ''}` : 'No one else away then'}</div>
            )}
            {sel.kind !== 'fix' && (sel.raw.warnings || []).map((w: string, i: number) => <div key={i} className="mt-2"><Notice tone="warn">{w}</Notice></div>)}
            {sel.kind !== 'fix' && <div className="mt-2 flex flex-wrap gap-3 text-xs">
              {sel.raw.docUrl && <a className="flex items-center gap-1 font-bold text-violet-700 underline" href={sel.raw.docUrl} target="_blank" rel="noopener noreferrer"><FileText className="h-3.5 w-3.5" />Document</a>}
              {sel.raw.hasPrivateDoc && <OpenDoc requestId={sel.id} name={sel.raw.privateDocName} canOpen={canSeeDocs} />}
            </div>}
            {sel.kind !== 'fix' && <Thread events={sel.raw.events} />}
            {sel.kind === 'fix' && sel.raw.onBehalf && <div className="mt-2 text-xs text-slate-500">Applied by {sel.raw.appliedByName}</div>}

            {sel.state === 'PENDING' && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <label className="text-sm font-semibold text-slate-900">Remarks <span className="font-normal text-slate-600">(needed to reject or ask)</span></label>
                <textarea rows={3} maxLength={300} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Add a comment…" className={`${input} mt-1.5`} />
                <div className="text-right text-xs text-slate-500">{remarks.length} / 300</div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <button type="button" disabled={busy || !remarks.trim()} onClick={() => act(sel, 'REJECT', remarks.trim())} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 cursor-pointer">✕ {sel.kind === 'cancel' ? 'Keep leave' : 'Reject'}</button>
                  <button type="button" disabled={busy} onClick={() => act(sel, 'APPROVE', remarks.trim())} className={btnViolet}>✓ {sel.kind === 'cancel' ? 'Allow cancellation' : 'Approve'}</button>
                </div>
                {sel.kind !== 'fix' && sel.kind !== 'cancel' && <button type="button" disabled={busy || !remarks.trim()} onClick={() => act(sel, 'INFO', remarks.trim())} className="mt-2 text-xs font-semibold text-slate-600 hover:text-violet-700 disabled:opacity-50 cursor-pointer">Ask a question instead</button>}
              </div>
            )}
          </Panel>
        ) : <Panel><p className="py-8 text-center text-sm text-slate-500">Select a request to see its details.</p></Panel>}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ team calendar

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS = 3;
const MONTH_LABEL = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const chipTone = (l: any) => l.halfDay ? 'bg-violet-100 text-violet-800' : l.status === 'PENDING' ? 'bg-orange-100 text-orange-800' : 'bg-emerald-100 text-emerald-800';

export const TeamCalendar: React.FC = () => {
  const [month, setMonth] = useState(thisMonth());
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');
  const [anchor, setAnchor] = useState(todayIst());
  const [dept, setDept] = useState('ALL');
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const today = todayIst();

  // The range being looked at: the month, or the week/day around the anchor (which can touch two months).
  const weekStart = addDaysIso(anchor, -new Date(`${anchor}T00:00:00Z`).getUTCDay());
  const range0 = view === 'month' ? `${month}-01` : view === 'week' ? weekStart : anchor;
  const range1 = view === 'month' ? new Date(Date.UTC(parseInt(month.slice(0, 4), 10), parseInt(month.slice(5, 7), 10), 0)).toISOString().slice(0, 10) : view === 'week' ? addDaysIso(weekStart, 6) : anchor;

  useEffect(() => {
    let alive = true;
    setError(null); setLoading(true);
    leaveService.teamCalendar(range0, range1)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [range0, range1]);

  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const iso = (day: number) => `${month}-${String(day).padStart(2, '0')}`;

  const allItems: any[] = data?.items || [];
  const departments = Array.from(new Set(allItems.map((i) => i.department).filter(Boolean))) as string[];
  const items = dept === 'ALL' ? allItems : allItems.filter((i) => i.department === dept);
  const holidays: any[] = data?.holidays || [];
  const leavesOn = (d: string) => items.filter((i) => i.from <= d && i.to >= d);
  const holidayOn = (d: string) => holidays.find((h) => h.date === d);
  const onLeave = [...items].sort((a, b) => a.from.localeCompare(b.from));
  const distinctPeople = new Set(items.map((i) => i.uid || i.name)).size;

  const shift = (n: number) => {
    if (view === 'month') { const next = shiftMonthStr(month, n); setMonth(next); setAnchor(`${next}-01`); }
    else { const nextA = addDaysIso(anchor, n * (view === 'week' ? 7 : 1)); setAnchor(nextA); setMonth(nextA.slice(0, 7)); }
  };
  const title = view === 'month' ? MONTH_LABEL(month) : view === 'week' ? `${shortDate(weekStart)} – ${shortDate(addDaysIso(weekStart, 6))}` : niceDate(anchor);

  const Chip: React.FC<{ l: any }> = ({ l }) => (
    <span title={`${l.name}${l.type ? ' · ' + l.type : ''}${l.status === 'PENDING' ? ' (waiting)' : ''}`} className={`flex w-full items-center gap-1 truncate rounded-full px-1 py-0.5 text-[10px] font-semibold leading-tight ${chipTone(l)}`}>
      <Avatar name={l.name} /><span className="truncate">{l.name}{l.type ? ` – ${l.type}` : ''}{l.halfDay ? ' – Half Day' : ''}{l.status === 'PENDING' ? ' (Pending)' : ''}</span>
    </span>
  );

  return (
    <div className="space-y-5">
      <PageHead title="Team Calendar" subtitle="View team leave, holidays and important attendance events in a calendar." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex h-11 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 shadow-sm">
          <CalendarDays className="ml-1 h-4 w-4 text-violet-600" />
          <span className="min-w-[6rem] px-1 text-center text-sm font-semibold text-slate-800">{title}</span>
          <button type="button" aria-label="Previous" onClick={() => shift(-1)} className="rounded-lg p-1.5 hover:bg-slate-100 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Next" onClick={() => shift(1)} className="rounded-lg p-1.5 hover:bg-slate-100 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {departments.length > 0 && (
          <label className="block text-xs font-medium text-slate-700">Department
            <Select label="Department" className="mt-1 block w-48" value={dept} onChange={setDept} options={[{ value: 'ALL', label: 'All Departments' }, ...departments.map((d) => ({ value: d, label: d }))]} />
          </label>
        )}
        <div className="ml-auto inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm" role="group" aria-label="View">
          {(['month', 'week', 'day'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); if (v !== 'month') setAnchor(anchor.slice(0, 7) === month ? (month === thisMonth() ? today : `${month}-01`) : anchor); }} className={`rounded-lg px-4 py-1.5 capitalize cursor-pointer ${view === v ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-300' : 'text-slate-800'}`}>{v}</button>)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-100 bg-white px-4 py-2.5 text-sm text-slate-800">
        {[['bg-emerald-500', 'Approved Leave'], ['bg-orange-400', 'Pending Leave'], ['bg-violet-400', 'Partial Day'], ['bg-slate-300', 'Holiday']].map(([c, l]) => <span key={l} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${c}`} />{l}</span>)}
        <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full border-2 border-violet-600" />Today</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={`min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${loading ? 'opacity-60' : ''} transition-opacity`}>
          {view === 'month' && (
            <>
              <div className="hidden md:block">
                <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">{WEEKDAYS.map((w) => <div key={w} className="px-2 py-2.5 text-center text-sm font-bold text-slate-900">{w}</div>)}</div>
                <div className="grid grid-cols-7">
                  {Array.from({ length: totalCells }, (_, idx) => {
                    const day = idx - offset + 1;
                    const inMonth = day >= 1 && day <= daysInMonth;
                    const borders = `border-b border-slate-100 ${idx % 7 !== 6 ? 'border-r' : ''}`;
                    if (!inMonth) return <div key={idx} className={`min-h-[7rem] bg-slate-50/40 p-2 text-sm text-slate-400 ${borders}`}>{day < 1 ? new Date(Date.UTC(y, m - 1, day)).getUTCDate() : day - daysInMonth}</div>;
                    const d = iso(day); const leaves = leavesOn(d); const hol = holidayOn(d);
                    return (
                      <button key={idx} type="button" onClick={() => { setAnchor(d); setView('day'); }} className={`flex min-h-[7rem] flex-col gap-1 p-2 text-left hover:bg-violet-50/40 ${borders} ${d === today ? 'bg-violet-50/70 ring-2 ring-inset ring-violet-500' : ''}`}>
                        <span className="text-sm font-semibold text-slate-900">{day}</span>
                        {hol && <span className="truncate rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700" title={hol.name}>{hol.name}</span>}
                        {leaves.slice(0, MAX_CHIPS).map((l, k) => <Chip key={k} l={l} />)}
                        {leaves.length > MAX_CHIPS && <span className="px-1 text-[10px] font-semibold text-slate-600">+{leaves.length - MAX_CHIPS} more</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="divide-y divide-slate-100 md:hidden">
                {Array.from({ length: daysInMonth }, (_, i) => iso(i + 1)).map((d) => ({ d, leaves: leavesOn(d), hol: holidayOn(d) })).filter((x) => x.leaves.length || x.hol).map(({ d, leaves, hol }) => (
                  <div key={d} className="flex gap-3 px-3 py-2.5"><div className="w-14 shrink-0 text-sm font-bold text-slate-900">{shortDate(d)}</div><div className="flex flex-1 flex-wrap gap-1">{hol && <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold">{hol.name}</span>}{leaves.map((l, k) => <Chip key={k} l={l} />)}</div></div>
                ))}
                {items.length === 0 && <EmptyState icon={Users} title="Everyone is in this month" />}
              </div>
            </>
          )}
          {view === 'week' && (
            <div className="grid grid-cols-1 md:grid-cols-7">
              {Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)).map((d, i) => { const hol = holidayOn(d); return (
                <div key={d} className={`min-h-[12rem] border-b border-slate-100 p-2 md:border-b-0 ${i < 6 ? 'md:border-r' : ''} ${d === today ? 'bg-violet-50/70' : ''}`}>
                  <div className="mb-2 text-sm font-bold text-slate-900">{WEEKDAYS[i]} <span className="font-semibold text-slate-600">{Number(d.slice(8))}</span></div>
                  <div className="space-y-1">{hol && <span className="block truncate rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{hol.name}</span>}{leavesOn(d).map((l, k) => <Chip key={k} l={l} />)}</div>
                </div>); })}
            </div>
          )}
          {view === 'day' && (
            <div className="p-5">
              <div className="mb-3 text-lg font-bold text-slate-950">{niceDate(anchor)}{anchor === today ? ' · Today' : ''}</div>
              {holidayOn(anchor) && <div className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Holiday: {holidayOn(anchor).name}{holidayOn(anchor).optional ? ' (optional)' : ''}</div>}
              {leavesOn(anchor).length === 0 ? <p className="py-6 text-sm text-slate-600">Nobody is on leave this day.</p> : (
                <div className="divide-y divide-slate-100">{leavesOn(anchor).map((l, k) => (
                  <div key={k} className="flex flex-wrap items-center gap-3 py-3"><Avatar name={l.name} /><div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-900">{l.name}{l.halfDay ? ' · half day' : ''}</div><div className="text-xs text-slate-600">{l.type || 'On leave'} · {range(l.from, l.to)}{l.reason ? ` · “${l.reason}”` : ''}</div></div><Pill tone={l.status === 'PENDING' ? 'amber' : 'green'}>{l.status === 'PENDING' ? 'Pending' : 'Approved'}</Pill></div>
                ))}</div>
              )}
            </div>
          )}
          <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-600">
            {items.length === 0 ? 'No one is away in this period.' : `${distinctPeople} ${distinctPeople === 1 ? 'person is' : 'people are'} away in this period.`}{view === 'month' && <span className="hidden md:inline"> Click a day for details.</span>}
          </div>
        </section>

        <Panel title={<span className="flex items-center gap-2">Team on Leave <span className="rounded-full bg-slate-100 px-2 py-0.5 text-sm font-bold text-slate-700">{onLeave.length}</span></span>} Icon={Users}>
          {onLeave.length === 0 ? <p className="text-sm text-slate-600">No approved or waiting leave in this period.</p> : (
            <ul className="divide-y divide-slate-100">
              {onLeave.slice(0, 12).map((l, k) => (
                <li key={k} className="flex items-center gap-3 py-3">
                  <Avatar name={l.name} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-900">{l.name}</div><div className="truncate text-xs text-slate-600">{l.halfDay ? 'Half Day' : l.type || 'On leave'}</div><div className="text-xs text-slate-600">{range(l.from, l.to)}</div></div>
                  <Pill tone={l.status === 'PENDING' ? 'amber' : 'green'}>{l.status === 'PENDING' ? 'Pending' : 'Approved'}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
};
