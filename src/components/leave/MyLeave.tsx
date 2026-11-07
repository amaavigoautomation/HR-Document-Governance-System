import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, FileText, HeartPulse, History, Palmtree, Plus, Search, Sun, User, Users, XCircle } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { BalanceStrip } from './Today';
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
      <button className="px-4 py-1.5 rounded-lg bg-[#FA7014] text-white text-xs font-bold disabled:opacity-50" disabled={busy || !text.trim()} onClick={() => { onSend(text.trim(), file); setText(''); setFile(null); }}>Send reply</button>
    </div>
  );
};

const PAGE = 10;
const stPill: Record<string, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-700', REJECTED: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-600', WITHDRAWN: 'bg-slate-100 text-slate-600', CANCEL_REQUESTED: 'bg-amber-50 text-amber-700', INFO_REQUESTED: 'bg-violet-50 text-violet-700',
};
const typeLook = (name = '') => {
  if (/sick|medical/i.test(name)) return { Icon: HeartPulse, cls: 'bg-rose-50 text-rose-600' };
  if (/casual/i.test(name)) return { Icon: CalendarDays, cls: 'bg-violet-50 text-violet-600' };
  if (/annual|earned|privilege|vacation/i.test(name)) return { Icon: Palmtree, cls: 'bg-orange-50 text-orange-600' };
  return { Icon: CalendarDays, cls: 'bg-sky-50 text-sky-600' };
};
const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const field = 'h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-[#FA7014]';

const StatTile: React.FC<{ label: string; value: number; sub?: string; pct?: string; tone: string; icon: string; pctCls?: string; Icon: React.FC<{ className?: string }> }> = ({ label, value, sub, pct, tone, icon, pctCls, Icon }) => (
  <div className={`flex items-center gap-4 rounded-2xl border border-white p-4 ${tone}`}>
    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${icon}`}><Icon className="h-5 w-5" /></span>
    <div><div className="text-sm font-semibold text-slate-700">{label}</div><div className="flex items-center gap-2"><span className="text-3xl font-bold leading-tight text-slate-950">{value}</span>{pct && <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${pctCls}`}>{pct}</span>}</div>{sub && <div className="text-xs text-slate-600">{sub}</div>}</div>
  </div>
);

export const MyLeave: React.FC<{ me: any; reload: () => void; onApply: (typeId?: string) => void; refreshKey: number }> = ({ me, reload, onApply, refreshKey }) => {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [ledger, setLedger] = useState<any[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [typeF, setTypeF] = useState('ALL');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ledgerType, setLedgerType] = useState('');
  const { busy, note, run } = useRunner();

  const loadRequests = useCallback(() => leaveService.myRequests().then((r) => setRequests(r.items)).catch(() => setRequests([])), []);
  const loadLedger = useCallback(() => leaveService.myLedger().then((r) => setLedger(r.items)).catch(() => setLedger([])), []);
  useEffect(() => { loadRequests(); loadLedger(); }, [loadRequests, loadLedger, refreshKey]);

  const all = requests || [];
  const year = String(me.today).slice(0, 4);
  const thisYear = all.filter((r) => String(r.from).startsWith(year));
  const n = (...st: string[]) => thisYear.filter((r) => st.includes(r.status)).length;
  const pct = (v: number) => (thisYear.length ? `${((v / thisYear.length) * 100).toFixed(1)}%` : '0%');
  const types = Array.from(new Set(all.map((r) => r.typeName))).filter(Boolean) as string[];
  const shown = all.filter((r) =>
    (status === 'ALL' || r.status === status) && (typeF === 'ALL' || r.typeName === typeF) &&
    (!query || `${r.typeName} ${r.reason || ''} ${r.id}`.toLowerCase().includes(query.toLowerCase())));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages);
  const rows = shown.slice((cur - 1) * PAGE, cur * PAGE);
  const sel = all.find((r) => r.id === openId) || shown[0] || null;
  const typesInLedger = Array.from(new Set((ledger || []).map((e) => e.typeName))).filter(Boolean) as string[];
  const ledgerShown = (ledger || []).filter((e) => !ledgerType || e.typeName === ledgerType);
  const holidays: any[] = me.holidays || [];

  const cancel = (r: any) => run(async () => { await leaveService.cancel(r.id); await Promise.all([loadRequests(), loadLedger(), reload()]); },
    r.status === 'PENDING' || r.status === 'INFO_REQUESTED' ? 'Request withdrawn.' : 'Cancellation sent for approval.');
  const canWithdraw = (r: any) => r.status === 'PENDING' || r.status === 'INFO_REQUESTED';
  const canAskCancel = (r: any) => r.status === 'APPROVED' && r.from > me.today;
  const approver = sel ? [...(sel.steps || [])].reverse().find((x: any) => x.status === 'APPROVED') : null;
  const rejecter = sel ? (sel.steps || []).find((x: any) => x.status === 'REJECTED') : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Leave Requests</h1>
          <p className="mt-1 text-sm text-slate-600">View, approve and manage leave applications for you and your team.</p>
        </div>
        <button type="button" onClick={() => onApply()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#F36B21] px-5 text-sm font-bold text-white hover:bg-[#df5d18] cursor-pointer"><Plus className="h-4 w-4" />New Leave Request</button>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Total Requests" value={thisYear.length} sub="This year" tone="bg-orange-50" icon="bg-orange-100 text-orange-600" Icon={CalendarDays} />
        <StatTile label="Approved" value={n('APPROVED')} pct={pct(n('APPROVED'))} pctCls="bg-emerald-100 text-emerald-700" tone="bg-emerald-50" icon="bg-emerald-100 text-emerald-600" Icon={CheckCircle2} />
        <StatTile label="Pending" value={n('PENDING', 'INFO_REQUESTED', 'CANCEL_REQUESTED')} pct={pct(n('PENDING', 'INFO_REQUESTED', 'CANCEL_REQUESTED'))} pctCls="bg-amber-100 text-amber-700" tone="bg-amber-50" icon="bg-amber-100 text-amber-600" Icon={Clock} />
        <StatTile label="Rejected" value={n('REJECTED')} pct={pct(n('REJECTED'))} pctCls="bg-rose-100 text-rose-700" tone="bg-rose-50" icon="bg-rose-100 text-rose-600" Icon={XCircle} />
      </div>

      <BalanceStrip me={me} onApply={(id) => onApply(id)} />
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search by leave type, reason or ID…" className={`${field} w-full pl-9`} /></label>
            <select value={typeF} onChange={(e) => { setTypeF(e.target.value); setPage(1); }} className={field} aria-label="Leave type"><option value="ALL">Leave Type: All</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={field} aria-label="Status"><option value="ALL">Status: All</option>{['PENDING', 'APPROVED', 'REJECTED', 'INFO_REQUESTED', 'CANCEL_REQUESTED', 'CANCELLED', 'WITHDRAWN'].map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr className="bg-slate-50 text-xs font-bold text-slate-700"><th className="px-4 py-3">Leave Type</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Days</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {!requests && <tr><td colSpan={6} className="px-4 py-8"><Skeleton rows={3} /></td></tr>}
                  {requests && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">{all.length === 0 ? 'No leave requests yet. When you apply, it shows up here with its approval status.' : 'Nothing matches these filters.'}</td></tr>}
                  {rows.map((r) => { const look = typeLook(r.typeName); return (
                    <tr key={r.id} onClick={() => setOpenId(r.id)} className={`cursor-pointer hover:bg-slate-50 ${sel?.id === r.id ? 'bg-orange-50/60' : ''}`}>
                      <td className="px-4 py-3"><div className="flex items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${look.cls}`}><look.Icon className="h-4 w-4" /></span><span className="font-bold text-slate-900">{r.typeName}</span></div></td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{shortRange(r.from, r.to)}</td>
                      <td className="px-4 py-3 text-slate-700">{r.days}</td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-slate-700">{r.reason || '—'}</td>
                      <td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${stPill[r.status] || 'bg-slate-100 text-slate-600'}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {canWithdraw(r) && <ConfirmButton className={quiet} disabled={busy} question="Withdraw?" yes="Withdraw" onConfirm={() => cancel(r)}>Withdraw</ConfirmButton>}
                        {canAskCancel(r) && <ConfirmButton className={quiet} disabled={busy} question="Ask to cancel?" yes="Ask" onConfirm={() => cancel(r)}>Cancel leave</ConfirmButton>}
                      </td>
                    </tr>); })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
              <span>{shown.length === 0 ? 'Showing 0' : `Showing ${(cur - 1) * PAGE + 1} – ${Math.min(cur * PAGE, shown.length)}`} of {shown.length} requests</span>
              {pages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label="Previous page" disabled={cur === 1} onClick={() => setPage(cur - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
                  {Array.from({ length: pages }, (_, i) => i + 1).map((k) => <button key={k} type="button" onClick={() => setPage(k)} className={`h-9 w-9 rounded-lg border text-sm font-semibold cursor-pointer ${k === cur ? 'border-[#F36B21] bg-[#F36B21] text-white' : 'border-slate-200 text-slate-700'}`}>{k}</button>)}
                  <button type="button" aria-label="Next page" disabled={cur === pages} onClick={() => setPage(cur + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          </div>
        </section>

        {sel ? (
          <section className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-4">
            <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold text-slate-950">Request Details</h2><span className={`rounded-full px-3 py-1 text-xs font-bold ${stPill[sel.status] || 'bg-slate-100 text-slate-600'}`}>{STATUS_LABEL[sel.status] || sel.status}</span></div>
            <div className="flex items-center gap-3">{(() => { const l = typeLook(sel.typeName); return <span className={`flex h-12 w-12 items-center justify-center rounded-full ${l.cls}`}><l.Icon className="h-5 w-5" /></span>; })()}<div className="min-w-0"><div className="font-bold text-slate-900">{sel.typeName}</div></div></div>
            <dl className="space-y-3 text-sm">
              <div className="flex gap-3"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">Duration</dt><dd className="text-slate-700">{shortRange(sel.from, sel.to)} ({days(sel.days)}){halfNote(sel)}</dd></div>
              <div className="flex gap-3"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">Reason</dt><dd className="text-slate-700">{sel.reason || '—'}</dd></div>
              {sel.createdAt && <div className="flex gap-3"><User className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">Requested on</dt><dd className="text-slate-700">{stamp(sel.createdAt)}</dd></div>}
              {(approver || rejecter) && <div className="flex gap-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" /><dt className="w-24 shrink-0 font-semibold text-slate-800">{rejecter ? 'Rejected by' : 'Approved by'}</dt><dd className="text-slate-700">{(rejecter || approver).byName || 'Approver'}{(rejecter || approver).at ? <><br />{stamp((rejecter || approver).at)}</> : null}</dd></div>}
            </dl>
            {sel.emergency && sel.status === 'PENDING' && <div className="text-xs font-semibold text-amber-700">Emergency leave: provisional until approved.</div>}
            {sel.docUrl && <a className="block text-xs text-[#FA7014] font-bold underline" href={sel.docUrl} target="_blank" rel="noopener noreferrer">Attached document</a>}
            {sel.hasPrivateDoc && <div><OpenDoc requestId={sel.id} name={sel.privateDocName} canOpen /></div>}
            {sel.status === 'INFO_REQUESTED' && <ReplyBox busy={busy} onSend={(message, file) => run(async () => { if (file) await leaveService.docSet(sel.id, file.name, file.dataUrl); await leaveService.respond({ id: sel.id, message }); await Promise.all([loadRequests(), reload()]); }, 'Reply sent. Your request is back with the approver.')} />}
            <div className="border-t border-slate-100 pt-4">
              <h3 className="mb-3 text-base font-bold text-slate-950">Leave Timeline</h3>
              <ol className="space-y-4">
                {(sel.events || []).map((e: any, i: number, arr: any[]) => (
                  <li key={i} className="relative flex gap-3">
                    {i < arr.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%-0.5rem)] w-px bg-emerald-200" />}
                    <span className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 text-sm"><div className="font-bold text-slate-900">{e.message}</div><div className="text-xs text-slate-600">{e.by ? `${e.by} · ` : ''}{stamp(e.at)}</div></div>
                  </li>
                ))}
                {(sel.events || []).length === 0 && <li className="text-xs text-slate-500">No activity recorded yet.</li>}
              </ol>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Select a request to see its details.</section>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Balance history" subtitle="Every day added or taken, newest first." right={typesInLedger.length > 1 ? (
          <select className="border border-slate-300 rounded-lg px-2 py-1 text-xs" value={ledgerType} onChange={(e) => setLedgerType(e.target.value)} aria-label="Leave type">
            <option value="">All types</option>{typesInLedger.map((t) => <option key={t}>{t}</option>)}
          </select>) : undefined}>
          {!ledger ? <Skeleton rows={3} /> : ledgerShown.length === 0 ? <EmptyState icon={History} title="Nothing yet" text="Credits show up here as they are added." /> : (
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 -mx-1 px-1">
              {ledgerShown.map((e) => (
                <div key={e.id} className="py-2 flex justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-700">{LEDGER_LABEL[e.kind] || e.kind} <span className="font-normal text-slate-400">· {e.typeName}</span></div>
                    <div className="text-[11px] text-slate-400 truncate">{niceDate(e.date)}{e.note ? ` · ${e.note}` : ''}</div>
                  </div>
                  <span className={`font-black tabular-nums ${e.delta < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{e.delta > 0 ? '+' : ''}{e.delta}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Holidays this year">
          {holidays.length === 0 ? <div className="text-xs text-slate-500">No holidays added yet.</div> : (
            <div className="max-h-64 overflow-y-auto">
              {holidays.map((h) => (
                <div key={h.date} className={`flex items-center gap-2 py-1 text-xs ${h.date < me.today ? 'opacity-40' : ''}`}>
                  <Sun className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                  <span className="flex-1 truncate text-slate-700">{h.name}{h.optional ? ' (optional)' : ''}</span>
                  <span className="text-slate-500 whitespace-nowrap">{shortDate(h.date)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Your setup">
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-slate-500">Approver</dt><dd className="font-semibold text-slate-800">{me.profile.manager || 'HR (no manager set)'}</dd>
            <dt className="text-slate-500">Leave policy</dt><dd className="font-semibold text-slate-800">{me.profile.policy || '—'}</dd>
            <dt className="text-slate-500">Location</dt><dd className="font-semibold text-slate-800">{me.profile.location || '—'}</dd>
            <dt className="text-slate-500">Joined</dt><dd className="font-semibold text-slate-800">{me.profile.joinDate ? niceDate(me.profile.joinDate) : '—'}</dd>
          </dl>
          <p className="text-[11px] text-slate-400 mt-2">Something wrong here? Ask HR to update it.</p>
        </Card>
      </div>
    </div>
  );
};
