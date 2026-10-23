import React, { useEffect, useState } from 'react';
import { downloadCsv } from '../../services/leaveService';
import { monthLabel, payrollService, previousMonth, shiftMonth } from '../../services/payrollService';
import { Card, Notice, btnGhost, input } from '../leave/ui';

/** Phase 1: what attendance and leave say about each person's pay for the month. Useful even without running payroll here. */
export const InputsTab: React.FC = () => {
  const [month, setMonth] = useState(previousMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    payrollService.inputs(month).then(setData).catch((e) => setError(e.message));
  }, [month]);

  const exportCsv = () => data && downloadCsv(`payroll-inputs-${month}.csv`, [
    ['Employee ID', 'Name', 'Email', 'Days in month', 'Days basis', 'Paid days', 'Loss of pay days', 'Unpaid leave days', 'Absent days', 'Half-day cut', 'Paid leave days', 'Leave days to encash'],
    ...data.rows.map((r: any) => [r.empId, r.name, r.email, r.monthDays, r.payDays, r.paidDays, r.lopDays, r.lop.unpaidLeave, r.lop.absent, r.lop.halfDay, r.paidLeaveDays, r.encashDays]),
  ]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <input type="month" className={`${input} max-w-[11rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className={btnGhost} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <span className="text-sm font-bold text-slate-800 ml-1">{monthLabel(month)}</span>
        <div className="ml-auto"><button className={btnGhost} disabled={!data} onClick={exportCsv}>Export CSV</button></div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {data?.notes.map((n: string) => <Notice key={n}>{n}</Notice>)}
      {data && (
        <Card title="Paid days and leave to pay out">
          <p className="text-[11px] text-slate-400 mb-2">
            {data.attendanceMode === 'ATTENDANCE' ? 'Pay is cut for approved unpaid leave, absent days and half days.' : 'Pay is cut only for approved unpaid leave. Attendance records are not used (change this in Setup).'} Month basis: {data.daysBasis === 'FIXED_30' ? 'fixed 30 days' : 'calendar days'}.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[900px] w-full">
              <thead className="text-left text-slate-500"><tr>
                <th className="p-1.5">Person</th><th className="p-1.5 text-right">Paid days</th><th className="p-1.5 text-right">Loss of pay</th><th className="p-1.5">Why</th>
                <th className="p-1.5 text-right">Paid leave</th><th className="p-1.5 text-right">Encash (days)</th><th className="p-1.5">Notes</th></tr></thead>
              <tbody>
                {data.rows.map((r: any) => {
                  const why = [r.lop.unpaidLeave ? `unpaid leave ${r.lop.unpaidLeave}` : '', r.lop.absent ? `absent ${r.lop.absent}` : '', r.lop.halfDay ? `half days ${r.lop.halfDay}` : '',
                    r.lop.late ? `late ${r.lop.late}` : '', r.lop.manual ? `manual ${r.lop.manual}` : '', r.preJoinDays ? `before joining ${r.preJoinDays}` : ''].filter(Boolean).join(', ');
                  return (
                    <tr key={r.uid} className="border-t border-slate-100 align-top">
                      <td className="p-1.5"><div className="font-semibold text-slate-800">{r.name}</div><div className="text-slate-400">{r.empId} · {r.department || '-'}</div></td>
                      <td className="p-1.5 text-right tabular-nums">{r.paidDays} / {r.payDays}</td>
                      <td className="p-1.5 text-right tabular-nums">{r.lopDays}</td>
                      <td className="p-1.5 text-slate-500">{why || '-'}</td>
                      <td className="p-1.5 text-right tabular-nums">{r.paidLeaveDays}</td>
                      <td className="p-1.5 text-right tabular-nums">{r.encashDays || '-'}</td>
                      <td className="p-1.5 text-amber-700">{[!r.hasStructure ? 'No salary set' : '', ...r.warnings].filter(Boolean).join(' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {!data && !error && <div className="text-sm text-slate-500">Loading…</div>}
    </div>
  );
};
