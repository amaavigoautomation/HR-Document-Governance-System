import React, { useCallback, useEffect, useState } from 'react';
import { inr, monthLabel, payrollService, previousMonth, shiftMonth } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

/** One-off bonuses, arrears and recoveries for a month, plus loans and advances recovered in instalments. */
export const AdjustmentsTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [month, setMonth] = useState(previousMonth());
  const [people, setPeople] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [adj, setAdj] = useState({ uid: '', kind: 'EARNING', label: '', amount: '', note: '' });
  const [loan, setLoan] = useState({ uid: '', label: '', principal: '', installment: '', note: '' });
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const [p, a, l] = await Promise.all([payrollService.structures(), payrollService.adjustments(month), payrollService.loans()]);
    setPeople(p.rows); setItems(a.items); setLoans(l.items);
  }, [month]);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const personSelect = (value: string, onChange: (v: string) => void) => (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose a person</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select>
  );

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      <Card title="One-off earnings and deductions" right={
        <div className="flex items-center gap-2">
          <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <span className="text-xs font-bold w-32 text-center">{monthLabel(month)}</span>
          <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>}>
        <p className="text-[11px] text-slate-400 mb-3">Bonus, arrears, a reimbursement, or a recovery. These count in the payroll run for the month shown. They cannot change once that month's payroll is approved.</p>
        {canManage && (
          <div className="grid md:grid-cols-6 gap-2 items-end mb-3">
            <Field label="Person">{personSelect(adj.uid, (v) => setAdj({ ...adj, uid: v }))}</Field>
            <Field label="Type"><select className={input} value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}><option value="EARNING">Earning (adds)</option><option value="DEDUCTION">Deduction (takes off)</option></select></Field>
            <Field label="Label"><input className={input} placeholder="Bonus, Arrears…" value={adj.label} onChange={(e) => setAdj({ ...adj, label: e.target.value })} /></Field>
            <Field label="Amount (₹)"><input type="number" className={input} value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label="Note"><input className={input} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveAdjustment({ ...adj, month, amount: Number(adj.amount) }); setAdj({ ...adj, label: '', amount: '', note: '' }); await load(); }, 'Added.')}>Add</button>
          </div>
        )}
        <table className="text-xs w-full">
          <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">Label</th><th className="p-1.5">Type</th><th className="p-1.5 text-right">Amount</th><th className="p-1.5">By</th><th /></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="p-1.5 font-semibold text-slate-800">{a.name}</td><td className="p-1.5">{a.label}{a.note ? <span className="text-slate-400"> · {a.note}</span> : null}</td>
                <td className="p-1.5">{a.kind === 'EARNING' ? 'Earning' : 'Deduction'}</td><td className="p-1.5 text-right tabular-nums">{inr(a.amount)}</td><td className="p-1.5 text-slate-400">{a.by}</td>
                <td className="p-1.5 text-right">{canManage && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await payrollService.deleteAdjustment(a.id); await load(); })}>Delete</button>}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="p-3 text-slate-400">Nothing added for {monthLabel(month)}.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="Loans and advances">
        <p className="text-[11px] text-slate-400 mb-3">Each month's payroll takes one instalment until the balance is zero. The balance only reduces when that month's payroll is locked.</p>
        {canManage && (
          <div className="grid md:grid-cols-6 gap-2 items-end mb-3">
            <Field label="Person">{personSelect(loan.uid, (v) => setLoan({ ...loan, uid: v }))}</Field>
            <Field label="Label"><input className={input} placeholder="Salary advance" value={loan.label} onChange={(e) => setLoan({ ...loan, label: e.target.value })} /></Field>
            <Field label="Amount (₹)"><input type="number" className={input} value={loan.principal} onChange={(e) => setLoan({ ...loan, principal: e.target.value })} /></Field>
            <Field label="Monthly instalment (₹)"><input type="number" className={input} value={loan.installment} onChange={(e) => setLoan({ ...loan, installment: e.target.value })} /></Field>
            <Field label="Note"><input className={input} value={loan.note} onChange={(e) => setLoan({ ...loan, note: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveLoan({ ...loan, principal: Number(loan.principal), installment: Number(loan.installment) }); setLoan({ uid: '', label: '', principal: '', installment: '', note: '' }); await load(); }, 'Loan added.')}>Add loan</button>
          </div>
        )}
        <table className="text-xs w-full">
          <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">Loan</th><th className="p-1.5 text-right">Amount</th><th className="p-1.5 text-right">Instalment</th><th className="p-1.5 text-right">Balance</th><th className="p-1.5">Status</th><th /></tr></thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="p-1.5 font-semibold text-slate-800">{l.name}</td><td className="p-1.5">{l.label}</td>
                <td className="p-1.5 text-right tabular-nums">{inr(l.principal)}</td><td className="p-1.5 text-right tabular-nums">{inr(l.installment)}</td><td className="p-1.5 text-right tabular-nums">{inr(l.balance)}</td>
                <td className="p-1.5">{l.active ? 'Recovering' : l.balance > 0 ? 'Stopped' : 'Repaid'}</td>
                <td className="p-1.5 text-right">{canManage && l.active && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await payrollService.closeLoan(l.id); await load(); }, 'Recovery stopped.')}>Stop</button>}</td>
              </tr>
            ))}
            {loans.length === 0 && <tr><td colSpan={7} className="p-3 text-slate-400">No loans.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
