import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Eye, FileText, Layers, Percent, Wallet } from 'lucide-react';
import { inr, monthLabel, payrollService } from '../../services/payrollService';
import { Card, Notice, Skeleton, btnGhost, btnPrimary } from '../leave/ui';
import { Kpi, PageHead, Panel, Pill, Select, Tabs, THead } from '../leave/kit';
import { downloadPayslipPdf, slipRows } from './payslipPdf';
import { MySettlement } from './SettlementsTab';

/** One payslip on screen. Opens the signed-in person's own payslip, or anyone's for payroll viewers. */
export const PayslipViewer: React.FC<{ month: string; uid?: string; onClose?: () => void; embedded?: boolean }> = ({ month, uid, onClose, embedded }) => {
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

  const actions = (
    <div className="flex items-center gap-2">
      {slip.status !== 'LOCKED' && slip.status !== 'PAID' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Preview: not final</span>}
      <button className={btnPrimary} onClick={() => downloadPayslipPdf(slip)}>Download PDF</button>
      {onClose && <button className={btnGhost} onClick={onClose}>Close</button>}
    </div>
  );
  const body = (
    <>
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
      <div className="mt-3 flex items-center justify-between rounded-lg bg-[#6d4cf0] text-white px-4 py-3">
        <span className="text-sm font-bold">Net pay</span>
        <span className="text-lg font-bold tabular-nums">{inr(l.net)}</span>
      </div>
      {slip.paidOn && <div className="text-[11px] text-slate-500 mt-2">Paid on {slip.paidOn}</div>}
    </>
  );

  if (embedded) return <div><div className="flex justify-end mb-2">{actions}</div>{body}</div>;
  return <Card title={`Payslip · ${monthLabel(month)}`} right={actions}>{body}</Card>;
};

/** Financial year (April to March) a month belongs to, as its starting year. */
const fyOf = (m: string) => (Number(m.slice(5, 7)) >= 4 ? Number(m.slice(0, 4)) : Number(m.slice(0, 4)) - 1);
const fyText = (y: number) => `${y} – ${y + 1}`;
const money = (n: number) => inr(n);

/** The payslip beside the list: who it is for, then earnings, deductions and net pay. */
const PayslipPanel: React.FC<{ month: string }> = ({ month }) => {
  const [slip, setSlip] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSlip(null); setError(null); payrollService.payslip(month).then(setSlip).catch((e) => setError(e.message)); }, [month]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!slip) return <Skeleton rows={6} />;
  const { earn, ded, reimb } = slipRows(slip);
  const l = slip.line; const e = slip.employee;
  const table = (title: string, rows: [string, number][], total: number, totalLabel: string, tone: string) => (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 text-sm">
      <div className="flex justify-between bg-slate-50 px-3 py-2 font-bold text-slate-900"><span>{title}</span><span>Amount</span></div>
      {rows.length === 0 && <div className="px-3 py-2 text-slate-500">None</div>}
      {rows.map(([k, v], i) => <div key={`${k}${i}`} className="flex justify-between gap-3 border-t border-slate-100 px-3 py-2 text-slate-800"><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>)}
      <div className={`flex justify-between px-3 py-2.5 font-bold ${tone}`}><span>{totalLabel}</span><span className="tabular-nums">{money(total)}</span></div>
    </div>
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><FileText className="h-5 w-5" /></span><h2 className="text-lg font-bold text-slate-950">Payslip – {monthLabel(month)}</h2></div>
        <button type="button" onClick={() => downloadPayslipPdf(slip)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-violet-300 px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50 cursor-pointer"><Download className="h-4 w-4" />Download PDF</button>
      </div>
      {slip.status !== 'LOCKED' && slip.status !== 'PAID' && <p className="mt-2 text-xs font-semibold text-amber-700">Preview: not final</p>}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {([['Employee', e.name], ['Employee ID', e.empId], ['Department', e.department || '-'], ['Paid days', `${l.paidDays} of ${l.payDays}`]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-semibold text-slate-900 break-words">{v}</dd></div>)}
      </dl>
      {table('Earnings', earn, l.gross, 'Total Earnings (A)', 'bg-violet-50 text-slate-950')}
      {table('Deductions', ded, l.totalDeductions, 'Total Deductions (B)', 'bg-violet-50 text-slate-950')}
      {reimb.length > 0 && table('Reimbursements (not taxed)', reimb, reimb.reduce((n, r) => n + r[1], 0), 'Total Reimbursements', 'bg-slate-50 text-slate-950')}
      <div className="mt-4 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800"><span className="font-bold">Net Pay (A – B)</span><span className="text-xl font-bold tabular-nums">{money(l.net)}</span></div>
      {slip.paidOn && <p className="mt-2 text-xs text-slate-600">Paid on {slip.paidOn}</p>}
    </>
  );
};

/** Everyone's own payslips (released once payroll for the month is locked). */
export const MyPayslips: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fy, setFy] = useState<number | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [tab, setTab] = useState('slips');
  const [tds, setTds] = useState<number | null>(null);

  useEffect(() => { payrollService.myPayslips().then((r) => setItems(r.items)).catch((e) => setError(e.message)); }, []);
  useEffect(() => { payrollService.taxStatement().then((r: any) => setTds(Number(r.taxDeducted) || 0)).catch(() => setTds(null)); }, []);

  const years = useMemo(() => Array.from(new Set((items || []).map((p) => fyOf(p.month)))).sort((a, b) => b - a), [items]);
  const year = fy ?? years[0] ?? null;
  const rows = useMemo(() => (items || []).filter((p) => year === null || fyOf(p.month) === year), [items, year]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!items) return <Skeleton rows={5} />;
  if (items.length === 0) return <div className="space-y-5"><PageHead title="My Payslips" subtitle="View, download and manage your payroll payslips." /><Panel><div className="text-sm text-slate-600">No payslips yet. They appear here once payroll for a month is finalised.</div></Panel><MySettlement /></div>;

  const latest = items[0];
  const sel = rows.find((p) => p.month === month) || rows[0];
  const ytdGross = rows.reduce((n, p) => n + p.gross, 0);
  const ytdDed = rows.reduce((n, p) => n + p.deductions, 0);
  const ytdNet = rows.reduce((n, p) => n + p.net, 0);
  const view = (m: string) => { setMonth(m); setTab('slips'); };
  const download = (m: string) => payrollService.payslip(m).then(downloadPayslipPdf).catch(() => undefined);

  return (
    <div className="space-y-5">
      <PageHead title="My Payslips" subtitle="View, download and manage your payroll payslips." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Monthly Salary" value={money(latest.gross)} sub="Gross, latest month" tone="violet" Icon={Wallet} />
        <Kpi label="Last Paid" value={monthLabel(latest.month)} sub={latest.status === 'PAID' ? 'Paid' : 'Released'} tone="green" Icon={CalendarDays} />
        <Kpi label="YTD Earnings" value={money(ytdGross)} sub={year !== null ? `FY ${fyText(year)}` : undefined} tone="blue" Icon={Layers} />
        <Kpi label="Total Tax (YTD)" value={tds === null ? '—' : money(tds)} tone="orange" Icon={Percent} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel>
          <Tabs tabs={[{ key: 'slips', label: 'Payslips' }, { key: 'year', label: 'Yearly Summary' }]} value={tab} onChange={setTab} />
          <div className="my-4"><Select label="Financial year" className="w-72" value={String(year)} onChange={(v) => { setFy(Number(v)); setMonth(null); }} options={years.map((y) => ({ value: String(y), label: `Financial Year: ${fyText(y)}` }))} /></div>
          {tab === 'slips' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <THead cols={['Pay Period', 'Gross Pay', 'Deductions', 'Net Pay', 'Status', 'Actions']} />
                <tbody className="divide-y divide-slate-100">
                  {rows.map((p) => (
                    <tr key={p.month} className={`text-slate-800 ${sel?.month === p.month ? 'bg-violet-50/50' : ''}`}>
                      <td className="whitespace-nowrap px-3 py-3.5"><button type="button" className="font-semibold text-violet-700 underline cursor-pointer" onClick={() => view(p.month)}>{monthLabel(p.month)}</button></td>
                      <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{money(p.gross)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{money(p.deductions)}</td>
                      <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{money(p.net)}</td>
                      <td className="px-3 py-3.5"><Pill tone={p.status === 'PAID' ? 'green' : 'blue'}>{p.status === 'PAID' ? 'Paid' : 'Released'}</Pill></td>
                      <td className="px-3 py-3.5"><span className="flex gap-2">
                        <button type="button" aria-label={`View ${monthLabel(p.month)}`} onClick={() => view(p.month)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 hover:border-violet-300 cursor-pointer"><Eye className="h-4 w-4" /></button>
                        <button type="button" aria-label={`Download ${monthLabel(p.month)}`} onClick={() => void download(p.month)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 hover:border-violet-300 cursor-pointer"><Download className="h-4 w-4" /></button>
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {([['Payslips in the year', String(rows.length)], ['Total gross pay', money(ytdGross)], ['Total deductions', money(ytdDed)], ['Total net pay', money(ytdNet)], ['Income tax deducted', tds === null ? '—' : money(tds)]] as [string, string][]).map(([k, v]) => <div key={k} className="rounded-xl bg-slate-50 p-4"><dt className="text-xs text-slate-600">{k}</dt><dd className="mt-1 text-lg font-bold text-slate-950">{v}</dd></div>)}
            </dl>
          )}
        </Panel>
        <Panel>{sel ? <PayslipPanel month={sel.month} /> : <p className="py-10 text-center text-sm text-slate-500">No payslips in this year.</p>}</Panel>
      </div>
      <MySettlement />
    </div>
  );
};
