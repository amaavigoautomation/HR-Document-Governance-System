import React, { useCallback, useEffect, useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { btnDanger, btnGhost, btnPrimary, Card, days, Field, halfNote, input, niceDate, Notice, range, StatusPill, todayIst, useRunner } from './ui';

export const MyLeave: React.FC<{ me: any; reload: () => void }> = ({ me, reload }) => {
  const types: any[] = me.settings.types;
  const [typeId, setTypeId] = useState(types[0]?.id || '');
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(todayIst());
  // "Leave value" of the first and last day, as in most HR systems: the first day starts from the first or the second half,
  // the last day ends after the first or the second half. First + Second (the default) means full days.
  const [fromValue, setFromValue] = useState<'FIRST' | 'SECOND'>('FIRST');
  const [toValue, setToValue] = useState<'FIRST' | 'SECOND'>('SECOND');
  const [reason, setReason] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[] | null>(null);
  const { busy, note, run } = useRunner();

  const type = types.find((t) => t.id === typeId);
  const single = from === to;
  const canHalf = !!type?.halfDay;
  const noDays = single && fromValue === 'SECOND' && toValue === 'FIRST';
  const halfFrom = canHalf && (single ? !(fromValue === 'FIRST' && toValue === 'SECOND') : fromValue === 'SECOND');
  const halfTo = canHalf && !single && toValue === 'FIRST';
  const halfPart: 'FIRST' | 'SECOND' = single && fromValue === 'FIRST' && toValue === 'FIRST' ? 'FIRST' : 'SECOND';
  const bal = me.balances.find((b: any) => b.typeId === typeId);
  const loadRequests = useCallback(() => leaveService.myRequests().then((r) => setRequests(r.items)).catch(() => undefined), []);
  useEffect(() => { loadRequests(); }, [loadRequests]);

  useEffect(() => {
    if (!typeId || !from || !to || to < from || noDays) { setPreview(null); return; }
    const t = setTimeout(() => {
      leaveService.calc({ typeId, from, to, halfFrom, halfTo, halfPart, reason, docUrl }).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [typeId, from, to, halfFrom, halfTo, halfPart, noDays, docUrl, reason]);

  const submit = () =>
    run(async () => {
      await leaveService.apply({ typeId, from, to, halfFrom, halfTo, halfPart, reason, docUrl });
      setReason(''); setDocUrl('');
      await Promise.all([loadRequests(), reload()]);
    }, 'Leave request sent.');

  const upcoming: any[] = (me.holidays || []).filter((h: any) => h.date >= me.today).slice(0, 8);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {me.balances.filter((b: any) => !b.isLop).map((b: any) => (
            <div key={b.typeId} className="bg-white border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-700">{b.name}</div>
                <span className="text-[10px] text-slate-400">{b.code}</span>
              </div>
              {b.requiresBalance ? (
                <>
                  <div className="mt-1 text-2xl font-black text-slate-900">{b.balance}<span className="text-xs font-semibold text-slate-400"> left</span></div>
                  <div className="text-[11px] text-slate-500">Credited {b.credited} · Used {b.used}{b.pending ? ` · Pending ${b.pending}` : ''}</div>
                </>
              ) : (
                <>
                  <div className="mt-1 text-sm font-semibold text-slate-600">No fixed balance</div>
                  <div className="text-[11px] text-slate-500">Taken this year: {b.used} day(s)</div>
                </>
              )}
              <div className="text-[10px] text-slate-400 mt-1">{b.cycleLabel}</div>
            </div>
          ))}
        </div>

        <Card title="Apply for leave">
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 max-w-3xl">
            <Field label="Document no"><div className="text-sm text-slate-500 py-2">Given when you send the request</div></Field>
            <Field label="Date of application"><div className="text-sm font-semibold text-slate-800 py-2">{niceDate(me.today)}</div></Field>

            <Field label="Leave type">
              <select className={input} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {me.balances.filter((b: any) => b.eligible).map((b: any) => <option key={b.typeId} value={b.typeId}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Available balance">
              <div className="text-sm font-bold text-slate-900 py-2">{!bal ? '–' : bal.requiresBalance ? `${bal.balance} day(s)` : 'No fixed balance'}</div>
            </Field>

            <Field label="From date"><input type="date" className={input} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
            <Field label="Leave value" hint={canHalf ? undefined : 'This leave type is taken in full days only'}>
              <select className={input} disabled={!canHalf} value={canHalf ? fromValue : 'FIRST'} onChange={(e) => setFromValue(e.target.value as 'FIRST' | 'SECOND')}>
                <option value="FIRST">First Half Day (from the start of the day)</option>
                <option value="SECOND">Second Half Day (from the afternoon)</option>
              </select>
            </Field>

            <Field label="Till date"><input type="date" className={input} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Leave value">
              <select className={input} disabled={!canHalf} value={canHalf ? toValue : 'SECOND'} onChange={(e) => setToValue(e.target.value as 'FIRST' | 'SECOND')}>
                <option value="FIRST">First Half Day (until the afternoon)</option>
                <option value="SECOND">Second Half Day (until the end of the day)</option>
              </select>
            </Field>
          </div>
          {noDays && <div className="mt-3"><Notice tone="error">The leave would end before it starts. Choose First Half Day for the start or Second Half Day for the end.</Notice></div>}
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 max-w-3xl mt-3">
            <Field label="Remarks"><textarea rows={3} className={input} placeholder="Remarks" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {type?.docRequiredAfterDays > 0 && (
              <Field label="Attachment (document link)" hint={`Needed when longer than ${type.docRequiredAfterDays} day(s)`}>
                <input className={input} placeholder="https://…" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} />
              </Field>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {preview?.valid === false && <Notice tone="error">{preview.error}</Notice>}
            {preview?.valid && (
              <Notice tone="info">
                {days(preview.days)} will be counted. Approval: {preview.steps.map((s: string) => (s === 'MANAGER' ? 'your manager' : 'HR')).join(' then ')}.
                {Object.values<number>(preview.balanceAfter || {}).length > 0 && ` Balance after: ${Object.values<number>(preview.balanceAfter).join(', ')}.`}
                {preview.warnings?.map((w: string) => ` ${w}`)}
              </Notice>
            )}
            {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
            <button className={btnPrimary} disabled={busy || noDays || preview?.valid === false} onClick={submit}>Send request</button>
          </div>
        </Card>

        <Card title="My requests">
          {requests.length === 0 ? <div className="text-xs text-slate-500">No requests yet.</div> : (
            <div className="divide-y divide-slate-100">
              {requests.map((r) => (
                <div key={r.id} className="py-2.5 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800">{r.typeName} · {days(r.days)}</div>
                    <div className="text-xs text-slate-500">{range(r.from, r.to)}{halfNote(r)}{r.reason ? ` · ${r.reason}` : ''}</div>
                    {r.steps?.map((s: any, i: number) => s.comment && <div key={i} className="text-[11px] text-slate-400">{s.byName}: {s.comment}</div>)}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.status} />
                    {(r.status === 'PENDING' || (r.status === 'APPROVED' && r.from > me.today)) && (
                      <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await leaveService.cancel(r.id); await Promise.all([loadRequests(), reload()]); }, r.status === 'PENDING' ? 'Request withdrawn.' : 'Cancellation sent for approval.')}>
                        {r.status === 'PENDING' ? 'Withdraw' : 'Ask to cancel'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Upcoming holidays">
          {upcoming.length === 0 ? <div className="text-xs text-slate-500">No holidays added.</div> : upcoming.map((h) => (
            <div key={h.date} className="flex justify-between text-xs py-1">
              <span className="text-slate-700">{h.name}{h.optional ? ' (optional)' : ''}</span>
              <span className="text-slate-500">{niceDate(h.date)}</span>
            </div>
          ))}
        </Card>
        <Card title="Balance history" right={<button className={btnGhost} onClick={() => leaveService.myLedger().then((r) => setLedger(r.items))}>{ledger ? 'Refresh' : 'Show'}</button>}>
          {ledger && (ledger.length === 0 ? <div className="text-xs text-slate-500">Nothing yet.</div> : (
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
              {ledger.map((e) => (
                <div key={e.id} className="py-1.5 flex justify-between text-xs">
                  <span className="text-slate-600">{e.typeName} · {e.kind.toLowerCase().replace('_', ' ')}<span className="block text-[10px] text-slate-400">{niceDate(e.date)}{e.note ? ` · ${e.note}` : ''}</span></span>
                  <span className={e.delta < 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>{e.delta > 0 ? '+' : ''}{e.delta}</span>
                </div>
              ))}
            </div>
          ))}
        </Card>
        <Card title="About you">
          <div className="text-xs text-slate-600 space-y-1">
            <div>Location: <b>{me.profile.location || '—'}</b></div>
            <div>Policy: <b>{me.profile.policy || '—'}</b></div>
            <div>Manager: <b>{me.profile.manager || 'Not assigned (HR approves)'}</b></div>
            <div>Joined: <b>{me.profile.joinDate ? niceDate(me.profile.joinDate) : '—'}</b></div>
          </div>
        </Card>
      </div>
    </div>
  );
};
