import React, { useCallback, useEffect, useState } from 'react';
import { inr, payrollService } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, todayIst, useRunner } from '../leave/ui';
import { downloadSettlementPdf, settlementRows } from './settlementPdf';

const REASONS: [string, string][] = [['RESIGNATION', 'Resignation'], ['TERMINATION', 'Termination'], ['RETIREMENT', 'Retirement'], ['DEATH', 'Death'], ['OTHER', 'Other']];
const STATUS: Record<string, string> = {
  DRAFT: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-sky-50 text-sky-700 border-sky-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const Pill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS[status]}`}>{status === 'DRAFT' ? 'Draft' : status === 'APPROVED' ? 'Approved' : 'Paid'}</span>
);

/** The settlement as a statement: what is paid, what is taken off, and the result. */
export const SettlementStatement: React.FC<{ s: any; company?: any }> = ({ s, company }) => {
  const { earn, ded, reimb } = settlementRows(s);
  const c = s.calc;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
        {([
          ['Employee', `${s.employee.name} (${s.employee.empId})`], ['Last working day', niceDate(s.input.lastWorkingDay)],
          ['Joined', c.joinDate ? niceDate(c.joinDate) : '-'],
          ['Service', c.gratuity?.service ? `${Math.floor(c.gratuity.service.months / 12)} yr ${c.gratuity.service.months % 12} mo` : '-'],
          ['Final month paid days', `${c.inputs.paidDays} of ${c.inputs.payDays}`], ['Reason', REASONS.find((r) => r[0] === s.input.reason)?.[1] || s.input.reason],
          ['Notice', `${c.notice.servedDays} of ${c.notice.requiredDays} day(s) served`], ['Account', s.employee.bankAccountMasked || '-'],
        ] as [string, string][]).map(([k, v]) => <div key={k}><div className="text-slate-400">{k}</div><div className="font-semibold text-slate-800 break-words">{v}</div></div>)}
      </div>
      {c.warnings.map((w: string) => <Notice key={w}>{w}</Notice>)}
      <div className="grid md:grid-cols-2 gap-4">
        {([['Payable', [...earn, ...reimb.map(([l, a]) => [`${l} (reimbursement)`, a] as [string, number])], c.totals.gross + c.totals.reimbursements], ['Deductions', ded, c.totals.deductions]] as [string, [string, number][], number][]).map(([title, list, total]) => (
          <div key={title} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{title}</div>
            <div className="divide-y divide-slate-100">
              {list.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">None</div>}
              {list.map(([label, amount], i) => <div key={`${label}${i}`} className="px-3 py-1.5 text-xs flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{inr(amount)}</span></div>)}
            </div>
            <div className="px-3 py-2 text-xs font-bold flex justify-between border-t border-slate-200 bg-slate-50"><span>Total</span><span className="tabular-nums">{inr(total)}</span></div>
          </div>
        ))}
      </div>
      {c.gratuity?.note && <div className="text-[11px] text-slate-500">Gratuity: {c.gratuity.note}</div>}
      <div className={`flex items-center justify-between rounded-lg text-white px-4 py-3 ${c.totals.recoverable > 0 ? 'bg-rose-600' : 'bg-[#FA7014]'}`}>
        <span className="text-sm font-bold">{c.totals.recoverable > 0 ? 'Recoverable from the employee' : 'Net settlement'}</span>
        <span className="text-lg font-bold tabular-nums">{inr(c.totals.recoverable > 0 ? c.totals.recoverable : c.totals.net)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} onClick={() => downloadSettlementPdf(s, company)}>Download PDF</button>
        {s.paidOn && <span className="text-[11px] text-slate-500">Paid on {niceDate(s.paidOn)}{s.paidRef ? ` · ${s.paidRef}` : ''}</span>}
      </div>
    </div>
  );
};

/** For employees: their own final statement, once it has been paid. */
export const MySettlement: React.FC = () => {
  const [r, setR] = useState<any | null>(null);
  useEffect(() => { payrollService.settlement().then(setR).catch(() => undefined); }, []);
  if (!r?.settlement) return null;
  return <Card title="Full and final settlement"><SettlementStatement s={r.settlement} company={r.company} /></Card>;
};

const blankForm = () => ({
  reason: 'RESIGNATION', lastWorkingDay: todayIst(), resignationDate: '', noticeRequiredDays: '', noticeServedDays: '', recoverNotice: false,
  encashDays: '', encashTypeId: '', forceGratuity: false, extras: [] as { kind: string; label: string; amount: string }[],
});

export const SettlementsTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [list, setList] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [uid, setUid] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [form, setForm] = useState(blankForm());
  const [paidOn, setPaidOn] = useState(todayIst());
  const [ref, setRef] = useState('');
  const { busy, note, run } = useRunner();

  const loadList = useCallback(async () => {
    const [a, b] = await Promise.all([payrollService.settlements(), payrollService.structures()]);
    setList(a.items); setPeople(b.rows.filter((x: any) => x.hasStructure));
  }, []);
  useEffect(() => { loadList().catch(() => undefined); }, [loadList]);

  const open = useCallback(async (id: string) => {
    setUid(id);
    setDetail(null);
    if (!id) return;
    const r = await payrollService.settlement(id);
    setDetail(r);
    const i = r.settlement?.input;
    setForm(i ? {
      reason: i.reason, lastWorkingDay: i.lastWorkingDay, resignationDate: i.resignationDate || '',
      noticeRequiredDays: i.noticeRequiredDays ?? '', noticeServedDays: i.noticeServedDays ?? '', recoverNotice: i.recoverNotice,
      encashDays: i.encashDays ?? '', encashTypeId: i.encashTypeId || '', forceGratuity: i.forceGratuity,
      extras: (i.extras || []).map((x: any) => ({ kind: x.kind, label: x.label, amount: String(x.amount) })),
    } : r.exitHint ? {
      ...blankForm(), reason: r.exitHint.reason === 'RESIGNATION' || !r.exitHint.reason ? 'RESIGNATION' : r.exitHint.reason, lastWorkingDay: r.exitHint.lastWorkingDay,
      resignationDate: r.exitHint.resignationDate || '', noticeRequiredDays: r.exitHint.noticeRequiredDays ?? '', noticeServedDays: r.exitHint.noticeServedDays ?? '',
      extras: (r.exitHint.extras || []).map((x: any) => ({ kind: x.kind, label: x.label, amount: String(x.amount) })),
    } : blankForm());
  }, []);

  const s = detail?.settlement;
  const editable = canManage && (!s || s.status === 'DRAFT');
  const set = (p: any) => setForm({ ...form, ...p });
  const after = async () => { await loadList(); await open(uid); };

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title={`Full and final settlements (${list.length})`}>
        <p className="text-[11px] text-slate-400 mb-3">When someone leaves: the last month's salary up to the last working day, leave pay-out, gratuity, notice-period recovery, loan balance and approved claims, with income tax on the final amount. After this, the person is left out of regular payroll runs from that month on.</p>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[640px] w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">Last day</th><th className="p-1.5">Reason</th><th className="p-1.5">Status</th><th className="p-1.5 text-right">Net</th><th /></tr></thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.uid} className="border-t border-slate-100">
                  <td className="p-1.5"><div className="font-semibold text-slate-800">{x.name}</div><div className="text-slate-400">{x.empId}</div></td>
                  <td className="p-1.5">{niceDate(x.lastWorkingDay)}</td>
                  <td className="p-1.5">{REASONS.find((r) => r[0] === x.reason)?.[1]}</td>
                  <td className="p-1.5"><Pill status={x.status} /></td>
                  <td className="p-1.5 text-right tabular-nums">{x.recoverable > 0 ? `Owes ${inr(x.recoverable)}` : inr(x.net)}</td>
                  <td className="p-1.5 text-right"><button className={btnGhost} onClick={() => open(x.uid)}>Open</button></td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="p-3 text-slate-400">No settlements yet.</td></tr>}
            </tbody>
          </table>
        </div>
        {canManage && (
          <div className="mt-3 flex items-end gap-2">
            <Field label="Start a settlement for"><select className={`${input} w-64`} value={list.some((x) => x.uid === uid) ? '' : uid} onChange={(e) => open(e.target.value)}>
              <option value="">Choose a person</option>
              {people.filter((p) => !list.some((x) => x.uid === p.uid)).map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
            </select></Field>
          </div>
        )}
      </Card>

      {uid && detail && (
        <Card title={`Settlement · ${s?.employee.name || detail.defaults?.name || ''}`} right={s && <Pill status={s.status} />}>
          {detail.exitHint && !s && <Notice tone="ok">Filled in from the accepted exit in People: dates, notice period and no-dues recoveries. Check them, then calculate.</Notice>}
          {!detail.defaults?.hasStructure && !s && <Notice tone="error">This person has no salary on file yet, so a settlement cannot be worked out.</Notice>}
          {editable && (
            <div className="space-y-3 mb-4">
              <div className="grid md:grid-cols-4 gap-3">
                <Field label="Reason"><select className={input} value={form.reason} onChange={(e) => set({ reason: e.target.value })}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
                <Field label="Last working day"><input type="date" className={input} value={form.lastWorkingDay} onChange={(e) => set({ lastWorkingDay: e.target.value })} /></Field>
                <Field label="Resignation date (optional)"><input type="date" className={input} value={form.resignationDate} onChange={(e) => set({ resignationDate: e.target.value })} /></Field>
                <Field label="Joined" hint="From Leave & attendance"><input className={input} disabled value={s?.calc?.joinDate || detail.defaults?.joinDate || 'Not recorded'} readOnly /></Field>
                <Field label="Notice period (days)" hint={`Blank = company default (${detail.defaults?.noticeDays})`}><input type="number" className={input} value={form.noticeRequiredDays} onChange={(e) => set({ noticeRequiredDays: e.target.value })} /></Field>
                <Field label="Notice served (days)" hint="Blank = from resignation date"><input type="number" className={input} value={form.noticeServedDays} onChange={(e) => set({ noticeServedDays: e.target.value })} /></Field>
                <div className="pt-6 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={form.recoverNotice} onChange={(e) => set({ recoverNotice: e.target.checked })} /> Recover the shortfall from pay</label></div>
                <div className="pt-6 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" checked={form.forceGratuity} onChange={(e) => set({ forceGratuity: e.target.checked })} /> Pay gratuity regardless of service</label></div>
              </div>
              <div className="grid md:grid-cols-4 gap-3 items-end">
                <Field label="Leave days to pay out" hint="Blank = whatever is already recorded as encashed this month"><input type="number" step="0.5" className={input} value={form.encashDays} onChange={(e) => set({ encashDays: e.target.value })} /></Field>
                <Field label="Take them off leave type" hint="Reduces the balance when paid"><select className={input} value={form.encashTypeId} onChange={(e) => set({ encashTypeId: e.target.value })}>
                  <option value="">Do not change the balance</option>
                  {(detail.defaults?.leaveBalances || []).map((b: any) => <option key={b.typeId} value={b.typeId}>{b.name} ({b.balance} left)</option>)}
                </select></Field>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-600 mb-1">Other items (bonus due, asset recovery…)</div>
                {form.extras.map((x, i) => (
                  <div key={i} className="flex flex-wrap gap-2 mb-1.5">
                    <select className={`${input} w-40`} value={x.kind} onChange={(e) => set({ extras: form.extras.map((y, j) => (j === i ? { ...y, kind: e.target.value } : y)) })}><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option></select>
                    <input className={`${input} w-64`} placeholder="Label" value={x.label} onChange={(e) => set({ extras: form.extras.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
                    <input type="number" className={`${input} w-36`} placeholder="Amount" value={x.amount} onChange={(e) => set({ extras: form.extras.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)) })} />
                    <button className={btnDanger} onClick={() => set({ extras: form.extras.filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                <button className={btnGhost} onClick={() => set({ extras: [...form.extras, { kind: 'EARNING', label: '', amount: '' }] })}>Add item</button>
              </div>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => {
                await payrollService.saveSettlement({ uid, ...form, extras: form.extras.map((x) => ({ ...x, amount: Number(x.amount) })) });
                await after();
              }, 'Calculated. Review the statement below.')}>{s ? 'Recalculate' : 'Calculate settlement'}</button>
            </div>
          )}

          {s && (
            <>
              <SettlementStatement s={s} company={detail.company} />
              {canManage && (
                <div className="mt-4 flex flex-wrap items-end gap-2">
                  {s.status === 'DRAFT' && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.approveSettlement(uid, s.calc.totals.net); await after(); }, 'Approved. Mark it paid once the money has gone out.')}>Approve</button>}
                  {s.status === 'APPROVED' && <>
                    <Field label="Paid on"><input type="date" className={input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
                    <Field label="Bank reference"><input className={input} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                    <button className={btnPrimary} disabled={busy} onClick={() => {
                      if (!window.confirm('Mark as paid? Loans are closed, claims are marked paid and leave paid out comes off the balance. This cannot be undone.')) return;
                      run(async () => { await payrollService.paySettlement(uid, paidOn, ref); await after(); }, 'Marked as paid.');
                    }}>Mark as paid</button>
                    <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await payrollService.reopenSettlement(uid); await after(); }, 'Reopened as a draft.')}>Reopen</button>
                  </>}
                  {s.status !== 'PAID' && <button className={btnDanger} disabled={busy} onClick={() => {
                    if (!window.confirm('Delete this settlement? The person goes back into regular payroll runs.')) return;
                    run(async () => { await payrollService.deleteSettlement(uid); setUid(''); setDetail(null); await loadList(); }, 'Deleted.');
                  }}>Delete</button>}
                </div>
              )}
              <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">History ({s.events.length})</summary>
                <ul className="mt-1 space-y-0.5">{[...s.events].reverse().map((e: any, i: number) => <li key={i}>{e.at.slice(0, 16).replace('T', ' ')} · {e.by} · {e.action}{e.note ? ` · ${e.note}` : ''}</li>)}</ul>
              </details>
            </>
          )}
        </Card>
      )}
    </div>
  );
};
