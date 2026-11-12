import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, FileText, Hourglass, XCircle } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { Notice, Skeleton, todayIst, addDaysIso, useRunner } from './ui';
import { btnOutline, btnViolet, dmy, field, Kpi, Pager, PageHead, Panel, Pill, Select, SearchBox, Tabs, THead } from './kit';

const PER = 5;
type AppType = 'IN' | 'OUT' | 'BOTH';
const TYPE_LABEL: Record<AppType, string> = { IN: 'Missed Check-in', OUT: 'Missed Check-out', BOTH: 'Time Correction' };
const typeOf = (r: any): AppType => (r.checkIn && r.checkOut ? 'BOTH' : r.checkOut ? 'OUT' : 'IN');
const stateTone = (s: string) => (s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'rose' : 'amber');
const stateLabel = (s: string) => (s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : 'Pending');
const appNo = (r: any) => r.docNo || `AA-${String(r.id || '').slice(-4).toUpperCase()}`;

/**
 * Ask for attendance to be corrected for a day: forgot to punch, wrong time, work from home or a visit.
 * Left: your applications. Right: the form to apply.
 */
export const AttendanceApplicationPage: React.FC<{ me: any; onChanged?: () => void }> = ({ me, onChanged }) => {
  const today = todayIst();
  const myUid: string = me.person?.uid || '';
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string }[]>([]);
  const [uid, setUid] = useState(myUid);
  const [type, setType] = useState<AppType>('IN');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [mine, setMine] = useState<any[] | null>(null);
  const [inbox, setInbox] = useState<any | null>(null);
  const [tab, setTab] = useState<'my' | 'all'>('my');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
  const [kind, setKind] = useState('ALL');
  const [page, setPage] = useState(1);
  const [saved, setSaved] = useState<string | null>(null);
  const { busy, note, setNote, run } = useRunner();

  useEffect(() => { leaveService.attendancePeople().then((r: any) => setPeople(r.items || [])).catch(() => setPeople([])); }, []);
  const load = useCallback(() => {
    leaveService.myRegularizations().then((r: any) => setMine(r.items)).catch(() => setMine([]));
    leaveService.inbox().then(setInbox).catch(() => setInbox({ regularizations: [], decided: { regularizations: [] } }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const isMine = uid === myUid;
  const floor: string = (isMine ? me.profile.joinDate : '') || addDaysIso(today, -366);
  const allApps = useMemo(() => {
    const seen = new Set<string>();
    return [...(mine || []), ...(inbox?.regularizations || []), ...(inbox?.decided?.regularizations || [])]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  }, [mine, inbox]);
  const hasAll = (inbox?.regularizations?.length || 0) + (inbox?.decided?.regularizations?.length || 0) > 0 || people.length > 1;
  const source = tab === 'all' && hasAll ? allApps : mine || [];
  const count = (s: string) => source.filter((r) => r.status === s).length;
  const rows = source.filter((r) => (status === 'ALL' || r.status === status) && (kind === 'ALL' || typeOf(r) === kind) && (!q || `${appNo(r)} ${r.reason} ${r.name}`.toLowerCase().includes(q.toLowerCase())));
  const cur = Math.min(page, Math.max(1, Math.ceil(rows.length / PER)));

  const needIn = type !== 'OUT'; const needOut = type !== 'IN';
  const problem = !date ? 'Choose a date.'
    : needIn && !from ? 'Enter the check-in time.'
    : needOut && !to ? 'Enter the check-out time.'
    : type === 'BOTH' && to <= from ? 'The check-out must be after the check-in.'
    : !reason.trim() ? 'Give a reason.' : '';
  const reset = () => { setType('IN'); setDate(today); setFrom(''); setTo(''); setReason(''); setNote(null); };

  const submit = () => run(async () => {
    const res: any = await leaveService.applyAttendance({
      uid: isMine ? undefined : uid, remarks: '',
      rows: [{ date, checkIn: needIn ? from : '', checkOut: needOut ? to : '', outDate: needOut ? date : '', reason }],
    });
    setSaved(res.docNo); reset(); load(); onChanged?.();
  });

  return (
    <div className="space-y-5">
      <PageHead title="Attendance Application" subtitle="Apply for attendance corrections and track your requests." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Total Applications" value={source.length} tone="violet" Icon={FileText} />
        <Kpi label="Approved" value={count('APPROVED')} tone="green" Icon={CheckCircle2} />
        <Kpi label="Pending" value={count('PENDING')} tone="orange" Icon={Hourglass} />
        <Kpi label="Rejected" value={count('REJECTED')} tone="rose" Icon={XCircle} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,0.8fr)]">
        <Panel>
          <Tabs tabs={[{ key: 'my', label: 'My Applications' }, ...(hasAll ? [{ key: 'all', label: 'All Applications' }] : [])]} value={tab} onChange={(k) => { setTab(k as 'my' | 'all'); setPage(1); }} />
          <div className="my-4 flex flex-wrap items-center gap-3">
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by ID or reason" className="w-60" />
            <Select label="Status" className="w-40" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'ALL', label: 'All Status' }, { value: 'PENDING', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
            <Select label="Application type" className="w-48" value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: 'ALL', label: 'All Types' }, ...(Object.keys(TYPE_LABEL) as AppType[]).map((k) => ({ value: k, label: TYPE_LABEL[k] }))]} />
          </div>
          {!mine ? <Skeleton rows={4} /> : rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No applications found.</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <THead cols={tab === 'all' ? ['Application ID', 'Employee', 'Application Type', 'Date', 'Reason', 'Status'] : ['Application ID', 'Application Type', 'Date', 'Reason', 'Status']} />
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice((cur - 1) * PER, cur * PER).map((r) => (
                      <tr key={r.id} className="text-slate-800">
                        <td className="whitespace-nowrap px-3 py-3.5 font-semibold text-violet-700">{appNo(r)}</td>
                        {tab === 'all' && <td className="px-3 py-3.5">{r.name}</td>}
                        <td className="px-3 py-3.5"><Pill tone="violet">{TYPE_LABEL[typeOf(r)]}</Pill></td>
                        <td className="whitespace-nowrap px-3 py-3.5">{dmy(r.date)}</td>
                        <td className="max-w-[16rem] truncate px-3 py-3.5 text-slate-600" title={r.reason}>{r.reason || '—'}</td>
                        <td className="px-3 py-3.5"><Pill tone={stateTone(r.status)}>{stateLabel(r.status)}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} total={rows.length} per={PER} noun="applications" onPage={setPage} />
            </>
          )}
        </Panel>

        <Panel title="New Attendance Application">
          <div className="space-y-4 text-sm">
            {saved && <Notice tone="ok">Saved as {saved}.</Notice>}
            {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
            {people.length > 1 && (
              <label className="block font-semibold text-slate-900">Employee
                <Select label="Employee" className="mt-1.5 block w-full font-normal" value={uid} onChange={setUid} options={people.map((p) => ({ value: p.uid, label: `${p.empId ? `${p.empId} - ` : ''}${p.name}${p.uid === myUid ? ' (me)' : ''}` }))} />
              </label>
            )}
            <label className="block font-semibold text-slate-900">Application Type <span className="text-rose-500">*</span>
              <Select label="Application type" className="mt-1.5 block w-full font-normal" value={type} onChange={(v) => setType(v as AppType)} options={(Object.keys(TYPE_LABEL) as AppType[]).map((k) => ({ value: k, label: TYPE_LABEL[k] }))} />
            </label>
            <label className="block font-semibold text-slate-900">Date <span className="text-rose-500">*</span>
              <input type="date" className={`${field} mt-1.5 w-full font-normal`} min={floor} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block font-semibold text-slate-900">Time From{needIn && <span className="text-rose-500"> *</span>}
                <div className="relative"><Clock className="pointer-events-none absolute left-3 top-[1.6rem] h-4 w-4 text-slate-400" /><input type="time" aria-label="Time from" disabled={!needIn} className={`${field} mt-1.5 w-full pl-9 font-normal disabled:bg-slate-50`} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              </label>
              <label className="block font-semibold text-slate-900">Time To{needOut && <span className="text-rose-500"> *</span>}
                <div className="relative"><Clock className="pointer-events-none absolute left-3 top-[1.6rem] h-4 w-4 text-slate-400" /><input type="time" aria-label="Time to" disabled={!needOut} className={`${field} mt-1.5 w-full pl-9 font-normal disabled:bg-slate-50`} value={to} onChange={(e) => setTo(e.target.value)} /></div>
              </label>
            </div>
            <label className="block font-semibold text-slate-900">Reason <span className="text-rose-500">*</span>
              <textarea rows={4} maxLength={300} placeholder="Enter reason for your application" className="mt-1.5 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200" value={reason} onChange={(e) => setReason(e.target.value)} />
              <span className="block text-right text-xs font-normal text-slate-500">{reason.length}/300</span>
            </label>
            {problem && (reason || from || to) ? <p className="text-xs text-rose-600">{problem}</p> : null}
            {!isMine && <p className="text-xs text-slate-500">{me.canManage ? 'As HR, this is applied straight away.' : 'This goes to HR for approval.'}</p>}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button type="button" className={btnOutline} disabled={busy} onClick={reset}>Cancel</button>
              <button type="button" className={btnViolet} disabled={busy || !!problem} onClick={() => void submit()}>{busy ? 'Saving…' : 'Submit Application'}</button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
};
