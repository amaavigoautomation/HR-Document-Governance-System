import React, { useCallback, useEffect, useState } from 'react';
import { downloadCsv } from '../../services/leaveService';
import { inr, monthLabel, payrollService, previousMonth, shiftMonth } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { PayslipViewer } from './MyPayslips';

const STEPS = [['DRAFT', 'Draft'], ['APPROVED', 'Approved'], ['LOCKED', 'Locked'], ['PAID', 'Paid']] as const;

const Stat: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className={`rounded-lg border px-3 py-2 ${strong ? 'border-[#FA7014]/40 bg-[#FA7014]/5' : 'border-slate-200 bg-white'}`}>
    <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-sm font-bold text-slate-900 tabular-nums">{value}</div>
  </div>
);

/** Phases 2 to 4: calculate the month, review, approve, lock (releases payslips) and mark paid. */
export const RunTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [month, setMonth] = useState(previousMonth());
  const [data, setData] = useState<{ run: any; lines: any[] } | null>(null);
  const [slipUid, setSlipUid] = useState<string | null>(null);
  const [ov, setOv] = useState<{ uid: string; delta: string; note: string } | null>(null);
  const [paidOn, setPaidOn] = useState('');
  const [ref, setRef] = useState('');
  const { busy, note, setNote, run: runner } = useRunner();

  const reload = useCallback(async () => {
    const r = await payrollService.run(month);
    setData({ run: r.run, lines: r.lines });
  }, [month]);
  useEffect(() => {
    setData(null); setSlipUid(null); setOv(null); setNote(null);
    reload().catch((e) => setNote({ tone: 'error', text: e.message }));
  }, [reload, setNote]);

  const rundoc = data?.run;
  const status: string = rundoc?.status || 'NONE';
  const lines = data?.lines || [];
  const t = rundoc?.totals;
  const draft = status === 'DRAFT';

  const calculate = () => runner(async () => {
    const r = await payrollService.calculate(month);
    setData({ run: r.run, lines: r.lines });
  }, rundoc ? 'Recalculated.' : 'Calculated. Review the figures below.');

  const approve = () => runner(async () => {
    try {
      await payrollService.approve(month, rundoc.totals.net, false);
    } catch (e: any) {
      if (String(e.message).includes('has not ended') && window.confirm(`${monthLabel(month)} has not ended yet. Days still to come will be paid in full. Approve anyway?`)) {
        await payrollService.approve(month, rundoc.totals.net, true);
      } else {
        await reload();
        throw e;
      }
    }
    await reload();
  }, 'Approved. Check the figures once more, then lock to release payslips.');

  const step = (fn: () => Promise<any>, done: string, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    runner(async () => { await fn(); await reload(); }, done);
  };

  const exportKind = (kind: string, label: string) => runner(async () => {
    const r = await payrollService.exportRun(month, kind);
    downloadCsv(`${label}-${month}.csv`, [r.header, ...r.rows]);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <input type="month" className={`${input} max-w-[11rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <span className="text-sm font-bold text-slate-800 ml-1">{monthLabel(month)}</span>
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      <Card title="Payroll run">
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {STEPS.map(([k, label], i) => {
            const reached = STEPS.findIndex(([x]) => x === status) >= i;
            return (
              <React.Fragment key={k}>
                {i > 0 && <span className="text-slate-300">›</span>}
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${reached ? 'bg-[#FA7014] text-white border-[#FA7014]' : 'bg-white text-slate-400 border-slate-200'}`}>{label}</span>
              </React.Fragment>
            );
          })}
          {status === 'NONE' && <span className="text-xs text-slate-500 ml-2">Not calculated yet.</span>}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {(status === 'NONE' || draft) && <button className={btnPrimary} disabled={busy} onClick={calculate}>{draft ? 'Recalculate' : 'Calculate payroll'}</button>}
            {draft && lines.length > 0 && <button className={btnPrimary} disabled={busy} onClick={approve}>Approve</button>}
            {draft && <button className={btnDanger} disabled={busy} onClick={() => step(() => payrollService.deleteRun(month), 'Draft deleted.', 'Delete this draft? Nothing has been paid or released.')}>Delete draft</button>}
            {status === 'APPROVED' && <>
              <button className={btnPrimary} disabled={busy} onClick={() => step(() => payrollService.lock(month), 'Locked. Payslips are now visible to employees.', 'Lock payroll? Employees will see their payslips and this month can no longer be changed.')}>Lock and release payslips</button>
              <button className={btnGhost} disabled={busy} onClick={() => step(() => payrollService.reopen(month), 'Reopened as a draft.')}>Reopen</button>
            </>}
            {status === 'LOCKED' && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Paid on"><input type="date" className={input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
                <Field label="Bank reference"><input className={input} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
                <button className={btnPrimary} disabled={busy} onClick={() => step(() => payrollService.markPaid(month, paidOn || undefined, ref), 'Marked as paid.')}>Mark as paid</button>
              </div>
            )}
          </div>
        )}
        {!canManage && <div className="text-xs text-slate-500">You can view payroll but not change it.</div>}

        {rundoc && rundoc.warnings.length > 0 && <div className="mt-3 space-y-1.5">{rundoc.warnings.map((w: string) => <Notice key={w}>{w}</Notice>)}</div>}
        {rundoc && rundoc.skipped.length > 0 && (
          <div className="mt-2 text-xs text-slate-500">Not in this run: {rundoc.skipped.map((s: any) => `${s.name} (${s.reason})`).join(', ')}.</div>
        )}
      </Card>

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-5 gap-2">
          <Stat label="People" value={String(t.headcount)} />
          <Stat label="Gross" value={inr(t.gross)} />
          <Stat label="Deductions" value={inr(t.deductions)} />
          <Stat label="Net pay" value={inr(t.net)} strong />
          <Stat label="PF (employee)" value={inr(t.pfEmployee)} />
          <Stat label="ESIC (employee)" value={inr(t.esicEmployee)} />
          <Stat label="Professional tax" value={inr(t.pt)} />
          <Stat label="Income tax (TDS)" value={inr(t.tds || 0)} />
          <Stat label="Reimbursements" value={inr(t.reimbursements || 0)} />
          <Stat label="Employer cost" value={inr(t.employerCost)} />
        </div>
      )}

      {lines.length > 0 && (
        <Card title={`Payslips in this run (${lines.length})`} right={status !== 'DRAFT' && status !== 'NONE' ? (
          <div className="flex flex-wrap gap-1.5">
            {([['bank', 'Bank transfer'], ['register', 'Salary register'], ['pf', 'PF'], ['esic', 'ESIC'], ['pt', 'Prof. tax'], ['tds', 'TDS']] as const).map(([k, l]) => (
              <button key={k} className={btnGhost} disabled={busy} onClick={() => exportKind(k, k)}>{l} CSV</button>
            ))}
          </div>) : undefined}>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[860px] w-full">
              <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5 text-right">Paid days</th><th className="p-1.5 text-right">Gross</th><th className="p-1.5 text-right">Deductions</th><th className="p-1.5 text-right">Net pay</th><th className="p-1.5">Flags</th><th /></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <React.Fragment key={l.uid}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="p-1.5"><div className="font-semibold text-slate-800">{l.employee.name}</div><div className="text-slate-400">{l.employee.empId} · {l.employee.department || '-'}</div></td>
                      <td className="p-1.5 text-right tabular-nums">{l.line.paidDays} / {l.line.payDays}</td>
                      <td className="p-1.5 text-right tabular-nums">{inr(l.line.gross)}</td>
                      <td className="p-1.5 text-right tabular-nums">{inr(l.line.totalDeductions)}</td>
                      <td className="p-1.5 text-right tabular-nums font-bold">{inr(l.line.net)}</td>
                      <td className="p-1.5">
                        {l.line.blocking && <span className="text-rose-700 font-bold">Fix before approving. </span>}
                        <span className="text-amber-700">{l.line.warnings.join(' ')}</span>
                        {l.inputs.lop.manual ? <span className="text-slate-500"> Manual change: {l.inputs.lop.manual} day(s) of loss of pay.</span> : null}
                      </td>
                      <td className="p-1.5 text-right whitespace-nowrap">
                        <button className={btnGhost} onClick={() => setSlipUid(slipUid === l.uid ? null : l.uid)}>Payslip</button>
                        {canManage && draft && <button className={`${btnGhost} ml-1`} onClick={() => setOv(ov?.uid === l.uid ? null : { uid: l.uid, delta: String(l.inputs.lop.manual || ''), note: '' })}>Adjust days</button>}
                      </td>
                    </tr>
                    {ov?.uid === l.uid && (
                      <tr className="bg-slate-50"><td colSpan={7} className="p-2">
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="Extra loss-of-pay days (negative to give back)"><input type="number" step="0.5" className={`${input} w-40`} value={ov.delta} onChange={(e) => setOv({ ...ov, delta: e.target.value })} /></Field>
                          <Field label="Reason (required)"><input className={`${input} w-72`} value={ov.note} onChange={(e) => setOv({ ...ov, note: e.target.value })} /></Field>
                          <button className={btnPrimary} disabled={busy} onClick={() => runner(async () => {
                            const r = await payrollService.setOverride({ month, uid: l.uid, lopDelta: Number(ov.delta) || 0, note: ov.note });
                            setData({ run: r.run, lines: r.lines }); setOv(null);
                          }, 'Paid days updated.')}>Apply</button>
                          <button className={btnGhost} onClick={() => setOv(null)}>Cancel</button>
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {slipUid && <PayslipViewer month={month} uid={slipUid} onClose={() => setSlipUid(null)} />}

      {rundoc && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold">Audit trail ({rundoc.events.length})</summary>
          <ul className="mt-1 space-y-0.5">{[...rundoc.events].reverse().map((e: any, i: number) => <li key={i}>{e.at.slice(0, 16).replace('T', ' ')} · {e.by} · {e.action}{e.note ? ` · ${e.note}` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
};
