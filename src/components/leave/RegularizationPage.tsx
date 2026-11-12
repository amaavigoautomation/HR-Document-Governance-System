import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, Hourglass, Plus, XCircle } from 'lucide-react';
import { Avatar } from '../home/parts';
import { leaveService } from '../../services/leaveService';
import { Notice, Skeleton, todayIst, useRunner } from './ui';
import { leaveNav } from './leaveNav';
import { btnOutline, btnViolet, dmy, field, Kpi, MonthChip, Pager, PageHead, Pill, SearchBox, Select, shiftMonthStr, Tabs, THead, t12 } from './kit';

const PER = 5;
type RType = 'IN' | 'OUT' | 'BOTH';
const TYPE_LABEL: Record<RType, string> = { IN: 'Missed Check-in', OUT: 'Missed Check-out', BOTH: 'Time Correction' };
const typeOf = (r: any): RType => (r.checkIn && r.checkOut ? 'BOTH' : r.checkOut ? 'OUT' : 'IN');
const stateTone = (s: string) => (s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'rose' : 'amber');
const stateLabel = (s: string) => (s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : 'Pending');
const reqNo = (r: any) => r.docNo || `REG-${String(r.id || '').slice(-4).toUpperCase()}`;
const timeText = (r: any) => (r.checkIn && r.checkOut ? `${t12(r.checkIn)} – ${t12(r.checkOut)}` : t12(r.checkIn || r.checkOut));

/** Attendance corrections: every request in the month, with approve and reject for those the person may decide. */
export const RegularizationPage: React.FC<{ me: any; onChanged?: () => void }> = ({ me, onChanged }) => {
  const today = todayIst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mine, setMine] = useState<any[] | null>(null);
  const [inbox, setInbox] = useState<any | null>(null);
  const [tab, setTab] = useState('ALL');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(() => {
    leaveService.myRegularizations().then((r: any) => setMine(r.items)).catch(() => setMine([]));
    leaveService.inbox().then(setInbox).catch(() => setInbox({ regularizations: [], decided: { regularizations: [] } }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decidable = useMemo(() => new Set<string>((inbox?.regularizations || []).map((r: any) => r.id)), [inbox]);
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...(mine || []), ...(inbox?.regularizations || []), ...(inbox?.decided?.regularizations || [])]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [mine, inbox]);

  const inMonth = all.filter((r) => String(r.date).startsWith(month));
  const n = (s: string) => inMonth.filter((r) => r.status === s).length;
  const rows = inMonth.filter((r) => (tab === 'ALL' || r.status === tab) && (kind === 'ALL' || typeOf(r) === kind)
    && (!from || r.date >= from) && (!to || r.date <= to)
    && (!q || `${reqNo(r)} ${r.name} ${r.reason}`.toLowerCase().includes(q.toLowerCase())));
  const cur = Math.min(page, Math.max(1, Math.ceil(rows.length / PER)));
  const open = all.find((r) => r.id === openId);

  const decide = (r: any, d: 'APPROVE' | 'REJECT') => run(async () => {
    await leaveService.decideRegularization(r.id, d, comment);
    setComment(''); setOpenId(null); load(); onChanged?.();
  }, d === 'APPROVE' ? 'Approved. The employee has been told.' : 'Rejected. The employee has been told.');

  const sub = (s: string) => (inMonth.length ? `${Math.round((n(s) / inMonth.length) * 100)}% of requests` : '—');
  return (
    <div className="space-y-5">
      <PageHead title="Regularization" subtitle="Review and manage attendance regularization requests.">
        <MonthChip month={month} onShift={(d) => { setMonth(shiftMonthStr(month, d)); setPage(1); }} disableNext={month >= today.slice(0, 7)} />
        <button type="button" className={btnViolet} onClick={() => leaveNav.setSection('application')}><Plus className="h-4 w-4" />New Regularization</button>
      </PageHead>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Total Requests" value={inMonth.length} sub="This month" tone="violet" Icon={FileText} />
        <Kpi label="Pending" value={n('PENDING')} sub={sub('PENDING')} tone="orange" Icon={Hourglass} />
        <Kpi label="Approved" value={n('APPROVED')} sub={sub('APPROVED')} tone="green" Icon={CheckCircle2} />
        <Kpi label="Rejected" value={n('REJECTED')} sub={sub('REJECTED')} tone="rose" Icon={XCircle} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <Tabs tabs={[{ key: 'ALL', label: 'All Requests', count: inMonth.length }, { key: 'PENDING', label: 'Pending', count: n('PENDING') }, { key: 'APPROVED', label: 'Approved', count: n('APPROVED') }, { key: 'REJECTED', label: 'Rejected', count: n('REJECTED') }]} value={tab} onChange={(k) => { setTab(k); setPage(1); }} />
        <div className="my-4 flex flex-wrap items-center gap-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by ID, employee or reason" className="w-72" />
          <Select label="Request type" className="w-48" value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ value: 'ALL', label: 'All Request Types' }, ...(Object.keys(TYPE_LABEL) as RType[]).map((k) => ({ value: k, label: TYPE_LABEL[k] }))]} />
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">From<input type="date" aria-label="From date" className={field} min={`${month}-01`} max={`${month}-31`} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">To<input type="date" aria-label="To date" className={field} min={`${month}-01`} max={`${month}-31`} value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        {note && <div className="mb-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
        {!mine ? <Skeleton rows={4} /> : rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No regularization requests for these filters.</p> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <THead cols={['Request ID', 'Employee', 'Request Type', 'Date', 'Time', 'Reason', 'Status', 'Actions']} />
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((cur - 1) * PER, cur * PER).map((r) => {
                    const can = r.status === 'PENDING' && decidable.has(r.id);
                    return (
                      <tr key={r.id} className={`text-slate-800 ${openId === r.id ? 'bg-violet-50/50' : ''}`}>
                        <td className="whitespace-nowrap px-3 py-3.5 font-semibold text-violet-700">{reqNo(r)}</td>
                        <td className="px-3 py-3.5"><span className="flex items-center gap-2.5"><Avatar name={r.name || '?'} /><b className="text-slate-900">{r.name}</b></span></td>
                        <td className="px-3 py-3.5"><Pill tone="violet">{TYPE_LABEL[typeOf(r)]}</Pill></td>
                        <td className="whitespace-nowrap px-3 py-3.5">{dmy(r.date)}</td>
                        <td className="whitespace-nowrap px-3 py-3.5">{timeText(r)}</td>
                        <td className="max-w-[14rem] truncate px-3 py-3.5 text-slate-600" title={r.reason}>{r.reason || '—'}</td>
                        <td className="px-3 py-3.5"><Pill tone={stateTone(r.status)}>{stateLabel(r.status)}</Pill></td>
                        <td className="px-3 py-3.5">{can ? <button type="button" className="text-sm font-semibold text-violet-700 hover:underline cursor-pointer" onClick={() => { setOpenId(openId === r.id ? null : r.id); setComment(''); }}>{openId === r.id ? 'Close' : 'Review'}</button> : <span className="text-slate-400">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={rows.length} per={PER} noun="requests" onPage={setPage} />
          </>
        )}
        {open && decidable.has(open.id) && open.status === 'PENDING' && (
          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
            <p className="text-sm font-bold text-slate-900">{open.name} · {dmy(open.date)} · {timeText(open)}</p>
            <p className="mt-1 text-sm text-slate-600">{open.reason || 'No reason given.'}</p>
            <textarea rows={2} maxLength={300} placeholder="Remarks (optional)" className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200" value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="mt-3 flex gap-3">
              <button type="button" className={`${btnOutline} !border-rose-300 !text-rose-700`} disabled={busy} onClick={() => void decide(open, 'REJECT')}>Reject</button>
              <button type="button" className={btnViolet} disabled={busy} onClick={() => void decide(open, 'APPROVE')}>Approve</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
