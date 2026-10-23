import React, { useCallback, useEffect, useState } from 'react';
import { lifecycleService } from '../../services/lifecycleService';
import { EXIT_REASONS, EXIT_STATUS_LABEL } from '../../../shared/lifecycleEngine';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, todayIst, useRunner } from '../leave/ui';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const inr = (n: number) => `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;
const CLEAR_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200', CLEARED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DUES: 'bg-rose-50 text-rose-700 border-rose-200', WAIVED: 'bg-slate-100 text-slate-600 border-slate-200',
};
const Pill: React.FC<{ s: string; label?: string }> = ({ s, label }) => <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${CLEAR_STYLE[s] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>{label || s}</span>;

const Timeline: React.FC<{ events: any[] }> = ({ events }) => (
  <ul className="text-[11px] text-slate-500 space-y-0.5">
    {events.slice().reverse().slice(0, 8).map((e, i) => <li key={i}>{new Date(e.at).toLocaleDateString('en-IN')} · {e.by}: {e.action.replace(/_/g, ' ').toLowerCase()}{e.note ? ` (${e.note})` : ''}</li>)}
  </ul>
);

/** The employee's own resignation: submit, see progress, withdraw. */
export const MyExit: React.FC = () => {
  const [d, setD] = useState<any | null>(null);
  const [last, setLast] = useState('');
  const [comments, setComments] = useState('');
  const { busy, note, run } = useRunner();
  const load = useCallback(() => lifecycleService.exitMy().then((r) => { setD(r); setLast(addDays(r.today, r.noticeDays - 1)); }).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="text-sm text-slate-500">Loading…</div>;
  const e = d.exit;
  const active = e && ['SUBMITTED', 'MANAGER_APPROVED', 'APPROVED'].includes(e.status);

  return (
    <div className="space-y-4 max-w-3xl">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {e && (
        <Card title="My exit" right={<Pill s={e.status === 'APPROVED' || e.status === 'COMPLETED' ? 'CLEARED' : e.status === 'REJECTED' ? 'DUES' : 'PENDING'} label={EXIT_STATUS_LABEL[e.status as keyof typeof EXIT_STATUS_LABEL]} />}>
          <dl className="grid sm:grid-cols-3 gap-3 text-xs">
            <div><dt className="text-slate-500">Resigned on</dt><dd className="font-bold">{niceDate(e.resignationDate)}</dd></div>
            <div><dt className="text-slate-500">{e.status === 'APPROVED' || e.status === 'COMPLETED' ? 'Last working day' : 'Asked for'}</dt><dd className="font-bold">{niceDate(e.status === 'APPROVED' || e.status === 'COMPLETED' ? e.lastWorkingDay : e.requestedLastDay)}</dd></div>
            <div><dt className="text-slate-500">Notice period</dt><dd className="font-bold">{e.noticeRequiredDays} days{e.noticeShortfallDays > 0 && e.status === 'APPROVED' ? ` (${e.noticeShortfallDays} short)` : ''}</dd></div>
          </dl>
          {e.status === 'APPROVED' && (
            <div className="mt-3">
              <div className="text-xs font-bold text-slate-700 mb-1">No-dues clearance</div>
              <ul className="space-y-1">{e.clearance.map((c: any) => (
                <li key={c.deptId} className="flex items-center gap-2 text-xs"><Pill s={c.status} /><span className="flex-1">{c.label}</span>{c.status === 'DUES' && <span className="text-rose-600 font-bold">{inr(c.dues)}{c.note ? ` · ${c.note}` : ''}</span>}</li>
              ))}</ul>
              <p className="text-[11px] text-slate-400 mt-2">Each department signs off once you have returned what you hold. HR then prepares your full and final settlement.</p>
            </div>
          )}
          {e.status === 'REJECTED' && <Notice tone="error">Your request was not accepted. Please speak to your manager or HR.</Notice>}
          <div className="mt-3"><Timeline events={e.events} /></div>
          {['SUBMITTED', 'MANAGER_APPROVED'].includes(e.status) && <button className={`${btnDanger} mt-3`} disabled={busy} onClick={() => run(async () => { await lifecycleService.withdraw(); await load(); }, 'Withdrawn.')}>Withdraw my resignation</button>}
        </Card>
      )}
      {!active && e?.status !== 'COMPLETED' && (
        <Card title="Resign">
          <div className="space-y-3">
            <p className="text-xs text-slate-500">The notice period is {d.noticeDays} days. {d.hasManager ? 'Your manager and then HR will review this.' : 'HR will review this.'}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Last working day I am asking for" hint={`Serving the full notice means ${niceDate(addDays(d.today, d.noticeDays - 1))} or later`}><input type="date" className={input} min={d.today} value={last} onChange={(e) => setLast(e.target.value)} /></Field>
            </div>
            <Field label="Reason / comments (optional)"><textarea className={input} rows={3} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
            <button className={btnDanger} disabled={busy} onClick={() => { if (window.confirm('Submit your resignation? You can withdraw it only until it is approved.')) run(async () => { await lifecycleService.resign({ requestedLastDay: last, comments }); await load(); }, 'Resignation submitted.'); }}>Submit resignation</button>
          </div>
        </Card>
      )}
    </div>
  );
};

const ExitDetail: React.FC<{ x: any; canManage: boolean; me: string; reload: () => Promise<void> }> = ({ x, canManage, me, reload }) => {
  const [last, setLast] = useState(x.lastWorkingDay || x.requestedLastDay);
  const [notice, setNotice] = useState(String(x.noticeRequiredDays ?? ''));
  const [note, setNote] = useState('');
  const [dues, setDues] = useState<Record<string, { amount: string; note: string }>>({});
  const { busy, note: msg, run } = useRunner();
  const waiting = ['SUBMITTED', 'MANAGER_APPROVED'].includes(x.status);
  const isMgrStep = x.status === 'SUBMITTED' && !canManage;
  const act = (fn: () => Promise<any>, done?: string) => run(async () => { await fn(); await reload(); }, done);

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {x.comments && <p className="text-xs text-slate-600"><span className="font-bold">Comments:</span> {x.comments}</p>}
      {waiting && x.uid !== me && (canManage || x.status === 'SUBMITTED') && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
          {!isMgrStep && (
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Approved last working day"><input type="date" className={input} value={last} onChange={(e) => setLast(e.target.value)} /></Field>
              <Field label="Notice period required (days)" hint="Set 0 to waive the notice"><input type="number" className={input} value={notice} onChange={(e) => setNotice(e.target.value)} /></Field>
            </div>
          )}
          <Field label="Note (optional)"><input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={() => act(() => lifecycleService.decideExit({ uid: x.uid, decision: 'APPROVE', note, lastWorkingDay: last, noticeRequiredDays: notice }), isMgrStep ? 'Sent to HR.' : 'Accepted. Clearance has started.')}>{isMgrStep ? 'Approve and send to HR' : 'Accept resignation'}</button>
            <button className={btnDanger} disabled={busy} onClick={() => act(() => lifecycleService.decideExit({ uid: x.uid, decision: 'REJECT', note }), 'Rejected.')}>Reject</button>
          </div>
        </div>
      )}
      {x.status === 'APPROVED' && (
        <>
          <div className="text-xs text-slate-600">Last working day <b>{niceDate(x.lastWorkingDay)}</b> · notice {x.noticeRequiredDays} days, served {x.noticeServedDays}{x.noticeShortfallDays > 0 && <b className="text-rose-600"> · {x.noticeShortfallDays} day(s) short</b>}</div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="p-1.5">Department</th><th className="p-1.5">Owner</th><th className="p-1.5">Status</th><th className="p-1.5">Action</th></tr></thead>
            <tbody>{x.clearance.map((c: any) => {
              const canAct = canManage || (c.ownerUid && c.ownerUid === me);
              const f = dues[c.deptId] || { amount: '', note: '' };
              return (
                <tr key={c.deptId} className="border-b border-slate-100 align-top">
                  <td className="p-1.5 font-bold">{c.label}</td>
                  <td className="p-1.5">{c.ownerName || 'HR'}</td>
                  <td className="p-1.5"><Pill s={c.status} />{c.status === 'DUES' && <div className="text-rose-600 mt-0.5">{inr(c.dues)} · {c.note}</div>}{c.by && <div className="text-slate-400 mt-0.5">{c.by}</div>}</td>
                  <td className="p-1.5">
                    {canAct && x.uid !== me ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                          <button className={btnGhost} disabled={busy || c.status === 'CLEARED'} onClick={() => act(() => lifecycleService.clear({ uid: x.uid, deptId: c.deptId, status: 'CLEARED' }))}>Clear</button>
                          {canManage && <button className={btnGhost} disabled={busy || c.status === 'WAIVED'} onClick={() => act(() => lifecycleService.clear({ uid: x.uid, deptId: c.deptId, status: 'WAIVED' }))}>Waive</button>}
                          {c.status !== 'PENDING' && <button className={btnGhost} disabled={busy} onClick={() => act(() => lifecycleService.clear({ uid: x.uid, deptId: c.deptId, status: 'PENDING' }))}>Reopen</button>}
                        </div>
                        <div className="flex gap-1"><input className={`${input} !py-1 w-20`} type="number" placeholder="Dues" value={f.amount} onChange={(e) => setDues({ ...dues, [c.deptId]: { ...f, amount: e.target.value } })} /><input className={`${input} !py-1`} placeholder="For what" value={f.note} onChange={(e) => setDues({ ...dues, [c.deptId]: { ...f, note: e.target.value } })} /><button className={btnGhost} disabled={busy} onClick={() => act(() => lifecycleService.clear({ uid: x.uid, deptId: c.deptId, status: 'DUES', dues: Number(f.amount), note: f.note }))}>Dues</button></div>
                      </div>
                    ) : <span className="text-slate-400">–</span>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          <div className="text-xs text-slate-600">{x.totals.pending} pending · dues to recover {inr(x.totals.dues)} {x.settlementStatus && <span>· settlement {x.settlementStatus.toLowerCase()}</span>}</div>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Change last working day"><input type="date" className={input} value={last} onChange={(e) => setLast(e.target.value)} /></Field>
              <Field label="Notice (days)"><input type="number" className={`${input} w-24`} value={notice} onChange={(e) => setNotice(e.target.value)} /></Field>
              <button className={btnGhost} disabled={busy} onClick={() => act(() => lifecycleService.setExitDates({ uid: x.uid, lastWorkingDay: last, noticeRequiredDays: notice }), 'Dates updated.')}>Update</button>
              <button className={btnPrimary} disabled={busy || !x.totals.complete} title={x.totals.complete ? '' : 'Finish the clearance first'} onClick={() => act(() => lifecycleService.completeExit(x.uid, x.lastWorkingDay > todayIst() && window.confirm('The last working day has not come yet. Complete the exit early?')), 'Exit completed. Deactivate the user in Administration and issue the letters.')}>Complete exit</button>
              <button className={btnDanger} disabled={busy} onClick={() => { if (window.confirm('Cancel this exit and remove the clearance list?')) act(() => lifecycleService.cancelExit(x.uid), 'Exit cancelled.'); }}>Cancel exit</button>
            </div>
          )}
        </>
      )}
      <Timeline events={x.events} />
    </div>
  );
};

/** HR sees every exit; a manager sees their team's. */
export const ExitsTab: React.FC<{ canManage: boolean; me: string; people: { uid: string; name: string }[] }> = ({ canManage, me, people }) => {
  const [data, setData] = useState<any | null>(null);
  const [openUid, setOpenUid] = useState('');
  const [f, setF] = useState({ uid: '', reason: 'TERMINATION', lastWorkingDay: addDays(todayIst(), 14), comments: '' });
  const { busy, note, run } = useRunner();
  const load = useCallback(() => lifecycleService.exits().then(setData).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {canManage && (
        <Card title="Start an exit for someone (termination, end of contract…)">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Person"><select className={`${input} w-56`} value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value })}><option value="">Choose…</option>{people.filter((p) => p.uid !== me).map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
            <Field label="Reason"><select className={input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{EXIT_REASONS.filter((r) => r !== 'RESIGNATION').map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>)}</select></Field>
            <Field label="Last working day"><input type="date" className={input} value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} /></Field>
            <button className={btnDanger} disabled={busy || !f.uid} onClick={() => run(async () => { await lifecycleService.startExit(f); setF({ ...f, uid: '' }); await load(); }, 'Exit started. Clearance is open.')}>Start exit</button>
          </div>
        </Card>
      )}
      <Card title={canManage ? 'Exits' : 'My team’s exits'}>
        {data.exits.length === 0 && <p className="text-sm text-slate-400">No exits.</p>}
        <ul className="divide-y divide-slate-100">
          {data.exits.map((x: any) => (
            <li key={x.uid} className="py-2.5">
              <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpenUid(openUid === x.uid ? '' : x.uid)}>
                <div className="flex-1 min-w-0"><div className="text-sm font-bold text-slate-900">{x.employee.name} <span className="font-normal text-slate-400">{x.employee.empId}</span></div><div className="text-[11px] text-slate-500">{x.employee.department} · {x.reason.replace(/_/g, ' ').toLowerCase()} · last day {niceDate(x.lastWorkingDay)}</div></div>
                {x.status === 'APPROVED' && <span className="text-[11px] text-slate-500">{x.totals.pending} pending{x.totals.dues > 0 ? ` · dues ${inr(x.totals.dues)}` : ''}</span>}
                <Pill s={x.status === 'APPROVED' || x.status === 'COMPLETED' ? 'CLEARED' : x.status === 'REJECTED' || x.status === 'WITHDRAWN' ? 'WAIVED' : 'PENDING'} label={EXIT_STATUS_LABEL[x.status as keyof typeof EXIT_STATUS_LABEL]} />
              </button>
              {openUid === x.uid && <ExitDetail x={x} canManage={canManage} me={me} reload={load} />}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};
