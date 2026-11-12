import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, CalendarDays, Check, ChevronRight, FileText, HeartPulse, History, Info, Palmtree, Plus, Sun, User, Users } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { btnViolet, dmy, Kpi, MonthChip, PageHead, Pager, Panel, Pill, SearchBox, Select, shiftMonthStr, Tabs, THead } from './kit';
import {
  Card, ConfirmButton, days, EmptyState, halfNote, LEDGER_LABEL, niceDate, Notice, shortDate,
  shortRange, Skeleton, STATUS_LABEL, useRunner,
} from './ui';

const quiet = 'text-xs font-bold text-slate-500 hover:text-rose-700 px-2 py-1 rounded-md hover:bg-rose-50 disabled:opacity-50';

import { DocAttach, OpenDoc, type Picked } from './DocAttach';

const ReplyBox: React.FC<{ busy: boolean; onSend: (message: string, file: Picked | null) => void }> = ({ busy, onSend }) => {
  const [text, setText] = useState('');
  const [file, setFile] = useState<Picked | null>(null);
  return (
    <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-3 space-y-2">
      <div className="text-xs font-semibold text-violet-800">Your approver asked for more information. Reply to put the request back in their queue.</div>
      <textarea rows={2} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your reply" />
      <DocAttach value={file} onChange={setFile} label="Attach a document with your reply" />
      <button className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => { onSend(text.trim(), file); setText(''); setFile(null); }}>Send reply</button>
    </div>
  );
};

const PAGE = 5;
const stTone: Record<string, string> = { APPROVED: 'green', PENDING: 'amber', REJECTED: 'rose', CANCELLED: 'slate', WITHDRAWN: 'slate', CANCEL_REQUESTED: 'amber', INFO_REQUESTED: 'violet' };
const typeLook = (name = '') => {
  if (/sick|medical/i.test(name)) return { Icon: HeartPulse, cls: 'bg-sky-100 text-sky-600' };
  if (/casual/i.test(name)) return { Icon: Palmtree, cls: 'bg-emerald-100 text-emerald-600' };
  if (/annual|earned|privilege|vacation/i.test(name)) return { Icon: Briefcase, cls: 'bg-violet-100 text-violet-600' };
  return { Icon: CalendarDays, cls: 'bg-orange-100 text-orange-600' };
};
const BAL_TONES = [
  ['from-emerald-100/70 to-green-50', 'bg-emerald-100 text-emerald-600', 'bg-emerald-500', 'bg-emerald-100'],
  ['from-violet-100/80 to-indigo-50', 'bg-violet-100 text-violet-600', 'bg-violet-600', 'bg-violet-100'],
  ['from-sky-100/80 to-blue-50', 'bg-sky-100 text-sky-600', 'bg-sky-500', 'bg-sky-100'],
  ['from-orange-100/80 to-amber-50', 'bg-orange-100 text-orange-600', 'bg-orange-400', 'bg-orange-100'],
];
const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const monthOf = (iso: string) => String(iso).slice(0, 7);
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MyLeave: React.FC<{ me: any; reload: () => void; onApply: (typeId?: string) => void; refreshKey: number }> = ({ me, reload, onApply, refreshKey }) => {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [ledger, setLedger] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [typeF, setTypeF] = useState('ALL');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState('requests');
  const [month, setMonth] = useState(String(me.today).slice(0, 7));
  const [ledgerType, setLedgerType] = useState('');
  const { busy, note, run } = useRunner();

  const loadRequests = useCallback(() => leaveService.myRequests().then((r) => setRequests(r.items)).catch(() => setRequests([])), []);
  const loadLedger = useCallback(() => leaveService.myLedger().then((r) => setLedger(r.items)).catch(() => setLedger([])), []);
  useEffect(() => { loadRequests(); loadLedger(); }, [loadRequests, loadLedger, refreshKey]);

  const all = requests || [];
  const types = Array.from(new Set(all.map((r) => r.typeName))).filter(Boolean) as string[];
  const shown = all.filter((r) =>
    (status === 'ALL' || r.status === status) && (typeF === 'ALL' || r.typeName === typeF) &&
    (!query || `${r.typeName} ${r.reason || ''} ${r.id}`.toLowerCase().includes(query.toLowerCase())));
  const rows = shown.slice((Math.min(page, Math.max(1, Math.ceil(shown.length / PAGE))) - 1) * PAGE).slice(0, PAGE);
  const sel = all.find((r) => r.id === openId) || null;
  const typesInLedger = Array.from(new Set((ledger || []).map((e) => e.typeName))).filter(Boolean) as string[];
  const ledgerShown = (ledger || []).filter((e) => !ledgerType || e.typeName === ledgerType);
  const holidays: any[] = me.holidays || [];
  const balances = (me.balances as any[]).filter((b) => !b.isLop && b.eligible);

  // Leave summary for the chosen month: days by what happened to them.
  const inMonth = (d: { date: string; value: number }) => monthOf(d.date) === month;
  const sumDays = (pred: (r: any, d: { date: string; value: number }) => boolean) => Math.round(all.reduce((n, r) => n + (r.detail || []).filter((d: any) => inMonth(d) && pred(r, d)).reduce((a: number, d: any) => a + d.value, 0), 0) * 100) / 100;
  const taken = sumDays((r, d) => r.status === 'APPROVED' && d.date <= me.today);
  const approvedNext = sumDays((r, d) => r.status === 'APPROVED' && d.date > me.today);
  const pending = sumDays((r) => ['PENDING', 'INFO_REQUESTED', 'CANCEL_REQUESTED'].includes(r.status));
  const remaining = Math.round(balances.filter((b) => b.requiresBalance).reduce((n, b) => n + (b.balance || 0), 0) * 100) / 100;
  const sumTotal = taken + approvedNext + pending + remaining;
  const R = 52; const C = 2 * Math.PI * R;

  const cancel = (r: any) => run(async () => { await leaveService.cancel(r.id); await Promise.all([loadRequests(), loadLedger(), reload()]); },
    r.status === 'PENDING' || r.status === 'INFO_REQUESTED' ? 'Request withdrawn.' : 'Cancellation sent for approval.');
  const canWithdraw = (r: any) => r.status === 'PENDING' || r.status === 'INFO_REQUESTED';
  const canAskCancel = (r: any) => r.status === 'APPROVED' && r.from > me.today;
  const approver = sel ? [...(sel.steps || [])].reverse().find((x: any) => x.status === 'APPROVED') : null;
  const rejecter = sel ? (sel.steps || []).find((x: any) => x.status === 'REJECTED') : null;
  const reqNo = (r: any) => `LR-${String(r.createdAt || r.from).slice(0, 4)}-${String(r.id).slice(-4).toUpperCase()}`;

  // Calendar tab: this month's days, marked when covered by a request.
  const monthDays = (() => { const [y, m] = month.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`); })();
  const leaveOn = (date: string) => all.find((r) => r.from <= date && r.to >= date && !['REJECTED', 'CANCELLED', 'WITHDRAWN'].includes(r.status));
  const lead = new Date(`${month}-01T00:00:00Z`).getUTCDay();

  return (
    <div className="space-y-5">
      <PageHead title="My Leave" subtitle="View your leave balance, apply for leave and track your requests.">
        <MonthChip month={month} onShift={(n) => setMonth(shiftMonthStr(month, n))} />
        <button type="button" onClick={() => onApply()} className={btnViolet}><Plus className="h-4 w-4" />Apply Leave</button>
      </PageHead>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel title={<span className="inline-flex items-center gap-2">Leave Balance <Info className="h-4 w-4 text-slate-400" /></span>} right={me.profile?.policy ? <span className="text-sm text-slate-700">Leave Policy: <b className="text-violet-700">{me.profile.policy}</b></span> : undefined}>
          {balances.length === 0 ? <p className="py-6 text-sm text-slate-500">No leave types apply to you yet.</p> : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {balances.map((b, i) => {
                const t = BAL_TONES[i % BAL_TONES.length];
                const total = Math.max(b.credited, b.balance + b.used + (b.pending || 0));
                const left = b.requiresBalance && total > 0 ? Math.max(0, Math.min(100, Math.round((b.balance / total) * 100))) : 0;
                const look = typeLook(b.name);
                return (
                  <button key={b.typeId} type="button" onClick={() => onApply(b.typeId)} title={`Apply for ${b.name}`} className={`min-w-0 rounded-2xl border border-white bg-gradient-to-br p-3.5 text-left shadow-sm hover:shadow ${t[0]}`}>
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full ${t[1]}`}><look.Icon className="h-5 w-5" /></span>
                    <div className="mt-2 truncate text-sm font-bold text-slate-900">{b.name}</div>
                    {b.requiresBalance ? (
                      <>
                        <div className="mt-0.5 text-slate-900"><span className="text-2xl font-bold">{b.balance}</span> <span className="text-sm text-slate-600">/ {total} days</span></div>
                        <div className={`mt-2 h-2 overflow-hidden rounded-full ${t[3]}`}><div className={`h-full rounded-full ${t[2]}`} style={{ width: `${left}%` }} /></div>
                      </>
                    ) : <div className="mt-1 text-sm font-semibold text-slate-700">No limit · taken {b.used}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title={<>Leave Summary <span className="text-base font-normal text-slate-700">({monthShortLabel(month)})</span></>}>
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative h-36 w-36 shrink-0" role="img" aria-label={`${dayWord(taken)} taken`}>
              <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
                <circle cx="70" cy="70" r={R} fill="none" stroke="#ede9fe" strokeWidth="11" />
                <circle cx="70" cy="70" r={R} fill="none" stroke="#6d4cf0" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${sumTotal ? (taken / sumTotal) * C : 0} ${C}`} />
              </svg>
              <span className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-3xl font-bold text-slate-950">{taken}</span><span className="text-xs leading-tight text-slate-600">{taken === 1 ? 'Day' : 'Days'}<br />Taken</span></span>
            </div>
            <ul className="min-w-[10rem] flex-1 space-y-2.5 text-sm">
              {[['bg-violet-600', 'Taken', taken], ['bg-violet-300', 'Approved', approvedNext], ['bg-slate-400', 'Pending', pending], ['bg-slate-200', 'Remaining', remaining]].map(([c, l, v]: any) => (
                <li key={l} className="flex items-center gap-2.5"><span className={`h-3 w-3 rounded-full ${c}`} /><span className="flex-1 text-slate-800">{l}</span><b className="text-slate-950">{dayWord(v)}</b></li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      <div>
        <Tabs tabs={[{ key: 'requests', label: 'My Requests' }, { key: 'calendar', label: 'Leave Calendar' }, { key: 'history', label: 'Leave History' }]} value={tab} onChange={setTab} />

        {tab === 'requests' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search by leave type or reference ID..." className="min-w-[220px] flex-1" />
              <Select label="Status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'ALL', label: 'Status' }, ...['PENDING', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'CANCEL_REQUESTED', 'CANCELLED', 'WITHDRAWN'].map((x) => ({ value: x, label: STATUS_LABEL[x] || x }))]} />
              <Select label="Leave type" value={typeF} onChange={(v) => { setTypeF(v); setPage(1); }} options={[{ value: 'ALL', label: 'Leave Type' }, ...types.map((t) => ({ value: t, label: t }))]} />
            </div>
            <Panel className="!p-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <THead cols={['Request ID', 'Leave Type', 'From', 'To', 'Duration', 'Reason', 'Status', 'Applied On', 'Actions']} />
                  <tbody className="divide-y divide-slate-100">
                    {!requests && <tr><td colSpan={9} className="px-4 py-8"><Skeleton rows={3} /></td></tr>}
                    {requests && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">{all.length === 0 ? 'No leave requests yet. When you apply, it shows up here with its approval status.' : 'Nothing matches these filters.'}</td></tr>}
                    {rows.map((r) => (
                      <tr key={r.id} className={sel?.id === r.id ? 'bg-violet-50/50' : ''}>
                        <td className="whitespace-nowrap px-3 py-3"><button type="button" onClick={() => setOpenId(sel?.id === r.id ? null : r.id)} className="font-semibold text-violet-700 underline hover:text-violet-900 cursor-pointer">{reqNo(r)}</button></td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-900">{r.typeName}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-800">{dmy(r.from)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-800">{dmy(r.to)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-800">{dayWord(r.days)}</td>
                        <td className="max-w-[11rem] truncate px-3 py-3 text-slate-800">{r.reason || '—'}</td>
                        <td className="px-3 py-3"><Pill tone={stTone[r.status] || 'slate'}>{STATUS_LABEL[r.status] || r.status}</Pill></td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-800">{dmy(r.createdAt)}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {canWithdraw(r) && <ConfirmButton className="text-xs font-bold text-slate-600 hover:text-rose-700" disabled={busy} question="Withdraw?" yes="Withdraw" onConfirm={() => cancel(r)}>Withdraw</ConfirmButton>}
                          {canAskCancel(r) && <ConfirmButton className="text-xs font-bold text-slate-600 hover:text-rose-700" disabled={busy} question="Ask to cancel?" yes="Ask" onConfirm={() => cancel(r)}>Cancel leave</ConfirmButton>}
                          {!canWithdraw(r) && !canAskCancel(r) && <button type="button" aria-label="View details" onClick={() => setOpenId(sel?.id === r.id ? null : r.id)} className="text-lg leading-none text-slate-500 hover:text-violet-700 cursor-pointer">⋯</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={page} total={shown.length} per={PAGE} noun="requests" onPage={setPage} />
            </Panel>

            {sel && (
              <Panel title="Request Details" right={<Pill tone={stTone[sel.status] || 'slate'}>{STATUS_LABEL[sel.status] || sel.status}</Pill>}>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">{(() => { const l = typeLook(sel.typeName); return <span className={`flex h-12 w-12 items-center justify-center rounded-full ${l.cls}`}><l.Icon className="h-5 w-5" /></span>; })()}<div className="min-w-0"><div className="font-bold text-slate-950">{sel.typeName}</div><div className="text-xs text-slate-600">{reqNo(sel)}</div></div></div>
                    <dl className="space-y-3 text-sm">
                      <div className="flex gap-3"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">Duration</dt><dd className="text-slate-700">{shortRange(sel.from, sel.to)} ({days(sel.days)}{halfNote(sel)})</dd></div>
                      <div className="flex gap-3"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">Reason</dt><dd className="text-slate-700">{sel.reason || '—'}</dd></div>
                      {sel.createdAt && <div className="flex gap-3"><User className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">Requested on</dt><dd className="text-slate-700">{stamp(sel.createdAt)}</dd></div>}
                      {(approver || rejecter) && <div className="flex gap-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">{rejecter ? 'Rejected by' : 'Approved by'}</dt><dd className="text-slate-700">{(rejecter || approver).name}</dd></div>}
                    </dl>
                    {sel.emergency && sel.status === 'PENDING' && <div className="text-xs font-semibold text-amber-700">Emergency leave: provisional until approved.</div>}
                    {sel.docUrl && <a className="block text-xs font-bold text-violet-700 underline" href={sel.docUrl} target="_blank" rel="noopener noreferrer">Attached document</a>}
                    {sel.hasPrivateDoc && <div><OpenDoc requestId={sel.id} name={sel.privateDocName} canOpen /></div>}
                    {sel.status === 'INFO_REQUESTED' && <ReplyBox busy={busy} onSend={(message, file) => run(async () => { if (file) await leaveService.docSet(sel.id, file.name, file.dataUrl); await leaveService.respond({ id: sel.id, message }); await Promise.all([loadRequests(), reload()]); }, 'Reply sent. It is back with your approver.')} />}
                  </div>
                  <div>
                    <h3 className="mb-3 text-base font-bold text-slate-950">Leave Timeline</h3>
                    <ol className="space-y-4">
                      {(sel.events || []).map((e: any, i: number, arr: any[]) => (
                        <li key={i} className="relative flex gap-3">
                          {i < arr.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-0.5rem)] w-px bg-violet-200" />}
                          <span className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white"><Check className="h-3.5 w-3.5" /></span>
                          <div className="min-w-0 text-sm"><div className="font-bold text-slate-900">{e.message}</div><div className="text-xs text-slate-600">{e.by ? `${e.by} · ` : ''}{stamp(e.at)}</div></div>
                        </li>
                      ))}
                      {(sel.events || []).length === 0 && <li className="text-xs text-slate-500">No activity recorded yet.</li>}
                    </ol>
                  </div>
                </div>
              </Panel>
            )}
          </div>
        )}

        {tab === 'calendar' && (
          <Panel className="mt-4" title={`${monthShortLabel(month)} leave`}>
            <div className="mb-1.5 grid grid-cols-7 gap-1">{WEEK.map((w) => <div key={w} className="text-center text-xs font-semibold text-slate-800">{w}</div>)}</div>
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
              {monthDays.map((d) => {
                const r = leaveOn(d); const h = holidays.find((x) => x.date === d);
                return <div key={d} title={r ? `${r.typeName} (${STATUS_LABEL[r.status]})` : h?.name || ''} className={`flex h-12 flex-col items-center justify-center rounded-lg text-sm font-semibold ${r ? (r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800') : h ? 'bg-slate-200 text-slate-600' : 'bg-slate-50 text-slate-800'} ${d === me.today ? 'ring-2 ring-violet-500' : ''}`}>{Number(d.slice(8))}{(r || h) && <span className="max-w-full truncate px-1 text-[9px] font-medium">{r ? r.typeCode || r.typeName : 'Holiday'}</span>}</div>;
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-700"><span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-emerald-300" />Approved</span><span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-300" />Waiting</span><span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-300" />Holiday</span></div>
          </Panel>
        )}

        {tab === 'history' && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card title="Balance history" subtitle="Every day added or taken, newest first." right={typesInLedger.length > 1 ? (
              <select className="rounded-lg border border-slate-300 px-2 py-1 text-xs" value={ledgerType} onChange={(e) => setLedgerType(e.target.value)} aria-label="Leave type">
                <option value="">All types</option>{typesInLedger.map((t) => <option key={t}>{t}</option>)}
              </select>) : undefined}>
              {!ledger ? <Skeleton rows={3} /> : ledgerShown.length === 0 ? <EmptyState icon={History} title="Nothing yet" text="Credits show up here as they are added." /> : (
                <div className="-mx-1 max-h-96 divide-y divide-slate-100 overflow-y-auto px-1">
                  {ledgerShown.map((e) => (
                    <div key={e.id} className="flex justify-between gap-2 py-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-700">{LEDGER_LABEL[e.kind] || e.kind} <span className="font-normal text-slate-400">· {e.typeName}</span></div>
                        <div className="truncate text-[11px] text-slate-400">{niceDate(e.date)}{e.note ? ` · ${e.note}` : ''}</div>
                      </div>
                      <span className={`font-black tabular-nums ${e.delta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{e.delta > 0 ? '+' : ''}{e.delta}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <div className="space-y-4">
              <Card title="Holidays this year">
                {holidays.length === 0 ? <div className="text-xs text-slate-500">No holidays added yet.</div> : (
                  <div className="max-h-56 overflow-y-auto">
                    {holidays.map((h) => (
                      <div key={h.date} className={`flex items-center gap-2 py-1 text-xs ${h.date < me.today ? 'opacity-40' : ''}`}>
                        <Sun className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                        <span className="flex-1 truncate text-slate-700">{h.name}{h.optional ? ' (optional)' : ''}</span>
                        <span className="whitespace-nowrap text-slate-500">{shortDate(h.date)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title="Your setup">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-slate-500">Approver</dt><dd className="font-semibold text-slate-800">{me.profile.manager || 'HR (no manager set)'}</dd>
                  <dt className="text-slate-500">Leave policy</dt><dd className="font-semibold text-slate-800">{me.profile.policy || '—'}</dd>
                  <dt className="text-slate-500">Location</dt><dd className="font-semibold text-slate-800">{me.profile.location || '—'}</dd>
                  <dt className="text-slate-500">Joined</dt><dd className="font-semibold text-slate-800">{me.profile.joinDate ? niceDate(me.profile.joinDate) : '—'}</dd>
                </dl>
                <p className="mt-2 text-[11px] text-slate-400">Something wrong here? Ask HR to update it.</p>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const monthShortLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
