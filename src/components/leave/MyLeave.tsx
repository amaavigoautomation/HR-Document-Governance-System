import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Check, ChevronDown, Circle, History, Sun, X } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { BalanceStrip } from './Today';
import {
  btnGhost, btnPrimary, Card, ConfirmButton, days, EmptyState, halfNote, LEDGER_LABEL, niceDate, Notice, Segmented, shortDate,
  shortRange, Skeleton, StatusPill, useRunner,
} from './ui';

type Filter = 'all' | 'open' | 'done';
const quiet = 'text-xs font-bold text-slate-500 hover:text-rose-700 px-2 py-1 rounded-md hover:bg-rose-50 disabled:opacity-50';

/** Who has to act, step by step: "Sent → Rahul ✓ → HR (waiting)". */
const Timeline: React.FC<{ r: any; managerName?: string }> = ({ r, managerName }) => {
  const steps: any[] = r.steps || [];
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
      <li className="flex items-center gap-1 text-slate-500"><Check className="w-3 h-3 text-emerald-600" />Sent {r.createdAt ? shortDate(r.createdAt.slice(0, 10)) : ''}</li>
      {steps.map((s, i) => {
        const who = s.byName || (s.role === 'MANAGER' ? managerName || 'Manager' : 'HR');
        const waiting = s.status === 'PENDING' && r.status === 'PENDING' && i === r.stepIndex;
        return (
          <React.Fragment key={i}>
            <li className="text-slate-300">→</li>
            <li className={`flex items-center gap-1 ${s.status === 'APPROVED' ? 'text-emerald-700' : s.status === 'REJECTED' ? 'text-rose-700' : waiting ? 'text-amber-700 font-bold' : 'text-slate-400'}`}>
              {s.status === 'APPROVED' ? <Check className="w-3 h-3" /> : s.status === 'REJECTED' ? <X className="w-3 h-3" /> : <Circle className="w-2.5 h-2.5" />}
              {who}{waiting ? ' (waiting)' : ''}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
};

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

export const MyLeave: React.FC<{ me: any; reload: () => void; onApply: (typeId?: string) => void; refreshKey: number }> = ({ me, reload, onApply, refreshKey }) => {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [ledger, setLedger] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [ledgerType, setLedgerType] = useState('');
  const { busy, note, run } = useRunner();

  const loadRequests = useCallback(() => leaveService.myRequests().then((r) => setRequests(r.items)).catch(() => setRequests([])), []);
  const loadLedger = useCallback(() => leaveService.myLedger().then((r) => setLedger(r.items)).catch(() => setLedger([])), []);
  useEffect(() => { loadRequests(); loadLedger(); }, [loadRequests, loadLedger, refreshKey]);

  const isOpen = (r: any) => ['PENDING', 'CANCEL_REQUESTED', 'INFO_REQUESTED'].includes(r.status) || (r.status === 'APPROVED' && r.to >= me.today);
  const shown = (requests || []).filter((r) => filter === 'all' || (filter === 'open' ? isOpen(r) : !isOpen(r)));
  const typesInLedger = Array.from(new Set((ledger || []).map((e) => e.typeName))).filter(Boolean) as string[];
  const ledgerShown = (ledger || []).filter((e) => !ledgerType || e.typeName === ledgerType);
  const holidays: any[] = me.holidays || [];

  const cancel = (r: any) => run(async () => { await leaveService.cancel(r.id); await Promise.all([loadRequests(), loadLedger(), reload()]); },
    r.status === 'PENDING' || r.status === 'INFO_REQUESTED' ? 'Request withdrawn.' : 'Cancellation sent for approval.');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-slate-900">My leave</h2>
        <button className={btnPrimary} onClick={() => onApply()}><CalendarPlus className="w-4 h-4" />Apply for leave</button>
      </div>
      <BalanceStrip me={me} onApply={(id) => onApply(id)} />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2" title="My requests" right={
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Active' }, { value: 'done', label: 'Past' }]} />
        }>
          {note && <div className="mb-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
          {!requests ? <Skeleton rows={3} /> : shown.length === 0 ? (
            <EmptyState title={filter === 'all' ? 'No leave requests yet' : 'Nothing here'} text={filter === 'all' ? 'When you apply for leave it shows up here with its approval status.' : undefined}
              action={filter === 'all' ? <button className={btnGhost} onClick={() => onApply()}>Apply for leave</button> : undefined} />
          ) : (
            <div className="divide-y divide-slate-100">
              {shown.map((r) => {
                const expanded = openId === r.id;
                const canWithdraw = r.status === 'PENDING' || r.status === 'INFO_REQUESTED';
                const canAskCancel = r.status === 'APPROVED' && r.from > me.today;
                const lastComment = [...(r.steps || [])].reverse().find((s: any) => s.comment);
                return (
                  <div key={r.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button className="min-w-0 text-left flex-1" onClick={() => setOpenId(expanded ? null : r.id)} aria-expanded={expanded}>
                        <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                          {shortRange(r.from, r.to)}
                          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                        <div className="text-xs text-slate-500">{r.typeName} · {days(r.days)}{halfNote(r)}{r.reason ? ` · ${r.reason}` : ''}</div>
                        {lastComment && !expanded && <div className="text-[11px] text-slate-500 mt-0.5 italic">“{lastComment.comment}” — {lastComment.byName}</div>}
                      </button>
                      <div className="flex items-center gap-2">
                        <StatusPill status={r.status} short />
                        {canWithdraw && <ConfirmButton className={quiet} disabled={busy} question="Withdraw?" yes="Withdraw" onConfirm={() => cancel(r)}>Withdraw</ConfirmButton>}
                        {canAskCancel && <ConfirmButton className={quiet} disabled={busy} question="Ask to cancel?" yes="Ask" onConfirm={() => cancel(r)}>Cancel leave</ConfirmButton>}
                      </div>
                    </div>
                    {r.status === 'INFO_REQUESTED' && <ReplyBox busy={busy} onSend={(message, file) => run(async () => { if (file) await leaveService.docSet(r.id, file.name, file.dataUrl); await leaveService.respond({ id: r.id, message }); await Promise.all([loadRequests(), reload()]); }, 'Reply sent. Your request is back with the approver.')} />}
                    {r.emergency && r.status === 'PENDING' && <div className="mt-1 text-[11px] font-semibold text-amber-700">Emergency leave: provisional until approved.</div>}
                    {r.status !== 'CANCELLED' && r.status !== 'WITHDRAWN' && <div className="mt-1.5"><Timeline r={r} managerName={me.profile.manager} /></div>}
                    {expanded && (
                      <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
                        {(r.events || []).map((e: any, i: number) => (
                          <div key={i} className="text-[11px] text-slate-600"><span className="text-slate-400">{niceDate(e.at.slice(0, 10))} · </span><b>{e.by}</b>: {e.message}</div>
                        ))}
                        {r.docUrl && <a className="text-[11px] text-[#FA7014] font-bold underline" href={r.docUrl} target="_blank" rel="noopener noreferrer">Attached document</a>}
                        {r.hasPrivateDoc && <div><OpenDoc requestId={r.id} name={r.privateDocName} canOpen /></div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
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
    </div>
  );
};
