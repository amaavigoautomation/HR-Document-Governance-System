import React, { useEffect, useState } from 'react';
import { inr, monthLabel, payrollService } from '../../services/payrollService';
import { Card, Notice, btnGhost, btnPrimary } from '../leave/ui';
import { downloadPayslipPdf, slipRows } from './payslipPdf';
import { MySettlement } from './SettlementsTab';

/** One payslip on screen. Opens the signed-in person's own payslip, or anyone's for payroll viewers. */
export const PayslipViewer: React.FC<{ month: string; uid?: string; onClose?: () => void }> = ({ month, uid, onClose }) => {
  const [slip, setSlip] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlip(null);
    setError(null);
    payrollService.payslip(month, uid).then(setSlip).catch((e) => setError(e.message));
  }, [month, uid]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!slip) return <div className="text-sm text-slate-500">Loading…</div>;
  const { earn, ded, reimb } = slipRows(slip);
  const l = slip.line;
  const e = slip.employee;
  const rows = Math.max(earn.length, ded.length);

  return (
    <Card
      title={`Payslip · ${monthLabel(month)}`}
      right={
        <div className="flex items-center gap-2">
          {slip.status !== 'LOCKED' && slip.status !== 'PAID' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Preview: not final</span>}
          <button className={btnPrimary} onClick={() => downloadPayslipPdf(slip)}>Download PDF</button>
          {onClose && <button className={btnGhost} onClick={onClose}>Close</button>}
        </div>
      }
    >
      {slip.company?.legalName && <div className="text-sm font-bold text-slate-800">{slip.company.legalName}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs my-3">
        {([
          ['Employee', e.name], ['Employee ID', e.empId], ['Department', e.department || '-'], ['Designation', e.title || '-'],
          ['Joined', e.joinDate || '-'], ['PAN', e.pan || '-'], ['UAN', e.uan || '-'], ['Account', e.bankAccountMasked || '-'],
          ['Paid days', `${l.paidDays} of ${l.payDays}`], ['Loss of pay', `${slip.inputs?.lopDays ?? 0} day(s)`],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k}><div className="text-slate-400">{k}</div><div className="font-semibold text-slate-800 break-words">{v}</div></div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {[['Earnings', earn, l.gross, 'Gross earnings'], ['Deductions', ded, l.totalDeductions, 'Total deductions']].map(([title, list, total, totalLabel]: any) => (
          <div key={title} className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">{title}</div>
            <div className="divide-y divide-slate-100">
              {list.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">None</div>}
              {list.map(([label, amount]: [string, number], i: number) => (
                <div key={`${label}${i}`} className="px-3 py-1.5 text-xs flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{inr(amount)}</span></div>
              ))}
            </div>
            <div className="px-3 py-2 text-xs font-bold flex justify-between border-t border-slate-200 bg-slate-50"><span>{totalLabel}</span><span className="tabular-nums">{inr(total)}</span></div>
          </div>
        ))}
      </div>
      {rows === 0 && <div className="text-xs text-slate-400 mt-2">This payslip has no lines.</div>}
      {reimb.length > 0 && (
        <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">Reimbursements (not taxable, added to net pay)</div>
          <div className="divide-y divide-slate-100">{reimb.map(([label, amount], i) => <div key={`${label}${i}`} className="px-3 py-1.5 text-xs flex justify-between gap-3"><span>{label}</span><span className="tabular-nums">{inr(amount)}</span></div>)}</div>
        </div>
      )}
      {slip.tax && slip.line.tds > 0 && (
        <div className="text-[11px] text-slate-500 mt-2">
          Income tax: estimated tax for the year {inr(slip.tax.annualTax)} under the {slip.tax.regime === 'OLD' ? 'old' : 'new'} regime, {inr(slip.tax.taxDeductedSoFar)} already deducted, the rest spread over {slip.tax.monthsLeft} month(s).
        </div>
      )}
      <div className="mt-3 flex items-center justify-between rounded-lg bg-[#FA7014] text-white px-4 py-3">
        <span className="text-sm font-bold">Net pay</span>
        <span className="text-lg font-bold tabular-nums">{inr(l.net)}</span>
      </div>
      {slip.paidOn && <div className="text-[11px] text-slate-500 mt-2">Paid on {slip.paidOn}</div>}
    </Card>
  );
};

/** Everyone's own payslips (released once payroll for the month is locked). */
export const MyPayslips: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    payrollService.myPayslips().then((r) => { setItems(r.items); if (r.items[0]) setMonth(r.items[0].month); }).catch((e) => setError(e.message));
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!items) return <div className="text-sm text-slate-500">Loading…</div>;
  if (items.length === 0) return <div className="space-y-4"><Card><div className="text-sm text-slate-500">No payslips yet. They appear here once payroll for a month is finalised.</div></Card><MySettlement /></div>;

  return (
    <div className="space-y-4">
      <Card title="Your payslips">
        <div className="divide-y divide-slate-100">
          {items.map((p) => (
            <button key={p.month} onClick={() => setMonth(p.month)}
              className={`w-full text-left py-2.5 px-2 flex items-center justify-between gap-3 rounded ${month === p.month ? 'bg-[#FA7014]/5' : 'hover:bg-slate-50'}`}>
              <div>
                <div className="text-sm font-bold text-slate-800">{monthLabel(p.month)}</div>
                <div className="text-xs text-slate-500">Gross {inr(p.gross)} · Deductions {inr(p.deductions)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${p.status === 'PAID' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>{p.status === 'PAID' ? 'Paid' : 'Released'}</span>
                <span className="text-sm font-bold tabular-nums">{inr(p.net)}</span>
              </div>
            </button>
          ))}
        </div>
      </Card>
      {month && <PayslipViewer month={month} />}
      <MySettlement />
    </div>
  );
};
