import React, { useCallback, useEffect, useState } from 'react';
import { downloadCsv } from '../../services/leaveService';
import { inr, monthLabel, payrollService } from '../../services/payrollService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { downloadTaxStatementPdf } from './taxPdf';

const NUM_FIELDS: { key: string; label: string; hint?: string; old?: boolean }[] = [
  { key: 'sec80C', label: 'Section 80C (LIC, ELSS, PPF, tuition…)', hint: 'Your PF is added automatically. Total limit applies.', old: true },
  { key: 'sec80D', label: 'Section 80D (health insurance)', old: true },
  { key: 'sec80CCD1B', label: 'NPS own contribution 80CCD(1B)', old: true },
  { key: 'nps80CCD2', label: 'Employer NPS contribution 80CCD(2)', hint: 'Allowed in both regimes, up to a % of basic.' },
  { key: 'homeLoanInterest', label: 'Home loan interest (self-occupied)', old: true },
  { key: 'rentPaidAnnual', label: 'Rent paid in the year', hint: 'For the HRA exemption.', old: true },
  { key: 'otherDeductions', label: 'Other deductions (80G, 80E, 80TTA…)', old: true },
  { key: 'otherIncome', label: 'Other income (interest, etc.)' },
  { key: 'prevIncome', label: 'Salary earned elsewhere this year', hint: 'A previous employer, or months before payroll started here.' },
  { key: 'prevTds', label: 'Tax already deducted on that income' },
];

const Compare: React.FC<{ title: string; chosen: boolean; cheaper: boolean; r: any }> = ({ title, chosen, cheaper, r }) => (
  <div className={`rounded-lg border p-3 ${chosen ? 'border-[#FA7014] bg-[#FA7014]/5' : 'border-slate-200'}`}>
    <div className="flex items-center justify-between"><div className="text-xs font-bold text-slate-700">{title}</div>
      {cheaper && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Lower tax</span>}</div>
    <div className="text-lg font-bold text-slate-900 tabular-nums mt-1">{inr(r.annualTax)}</div>
    <div className="text-[11px] text-slate-500">tax for the year · about {inr(r.monthlyTds)} a month · taxable {inr(r.taxableIncome)}</div>
  </div>
);

/** Annual tax statement, for the signed-in person or (with payroll access) anyone. */
export const TaxStatement: React.FC<{ uid?: string; fy?: string }> = ({ uid, fy }) => {
  const [st, setSt] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSt(null); setError(null);
    payrollService.taxStatement(fy, uid).then(setSt).catch((e) => setError(e.message));
  }, [uid, fy]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!st) return <div className="text-sm text-slate-500">Loading…</div>;
  const c = st.computation;
  return (
    <Card title={`Annual tax statement · ${st.fyLabel}`} right={<button className={btnPrimary} onClick={() => downloadTaxStatementPdf(st)}>Download PDF</button>}>
      <p className="text-[11px] text-slate-400 mb-3">{st.complete ? 'The year is over.' : `Up to date as of ${st.asOf}: the year is still running, so this covers only what has been paid so far.`} {st.note}</p>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">Paid by month</div>
          {st.months.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">Nothing paid yet this year.</div>}
          {st.months.map((m: any) => <div key={m.month} className="px-3 py-1.5 text-xs flex justify-between border-t border-slate-100"><span>{monthLabel(m.month)}</span><span className="tabular-nums">{inr(m.gross)} · tax {inr(m.tds)}</span></div>)}
        </div>
        <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
          <div className="bg-slate-50 px-3 py-2 font-bold text-slate-600">Computation ({st.regime === 'OLD' ? 'old' : 'new'} regime)</div>
          {([
            ['Salary paid', c.grossSalary], ['Earlier employer / earlier months', c.prevIncome], ['Other income', c.otherIncome], ['HRA exemption', -c.hraExemption],
            ['Standard deduction', -c.standardDeduction], ['Professional tax', -c.professionalTax], ['Deductions (80C, 80D, NPS…)', -c.deductions.total],
          ] as [string, number][]).filter(([, v]) => v !== 0).map(([k, v]) => <div key={k} className="px-3 py-1.5 flex justify-between border-t border-slate-100"><span>{k}</span><span className="tabular-nums">{v < 0 ? '-' : ''}{inr(Math.abs(v))}</span></div>)}
          <div className="px-3 py-1.5 flex justify-between border-t border-slate-200 font-bold"><span>Taxable income</span><span className="tabular-nums">{inr(c.taxableIncome)}</span></div>
          <div className="px-3 py-1.5 flex justify-between border-t border-slate-100"><span>Tax after rebate, plus cess</span><span className="tabular-nums">{inr(c.totalTax)}</span></div>
          <div className="px-3 py-1.5 flex justify-between border-t border-slate-100"><span>Tax deducted so far</span><span className="tabular-nums">{inr(st.taxDeducted)}</span></div>
          <div className="px-3 py-2 flex justify-between border-t border-slate-200 font-bold bg-slate-50"><span>{st.difference > 0 ? 'Still to be deducted' : 'Deducted in excess'}</span><span className="tabular-nums">{inr(Math.abs(st.difference))}</span></div>
        </div>
      </div>
    </Card>
  );
};

/** The declaration form. `uid` is for HR editing someone else's. */
export const DeclarationForm: React.FC<{ uid?: string; canManage: boolean; onSaved?: () => void }> = ({ uid, canManage, onSaved }) => {
  const [d, setD] = useState<any | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [showStatement, setShowStatement] = useState(false);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([payrollService.taxDeclaration(undefined, uid), payrollService.taxPreview(uid)]);
    setD(a); setPreview(b);
  }, [uid]);
  useEffect(() => { setD(null); setShowStatement(false); load().catch(() => undefined); }, [load]);
  if (!d) return <div className="text-sm text-slate-500">Loading…</div>;

  const decl = d.declaration;
  const set = (p: any) => setD({ ...d, declaration: { ...decl, ...p } });
  const locked = !d.canEdit || (!!uid && !canManage);
  const num = (k: string) => (
    <input type="number" className={input} disabled={locked || (decl.regime === 'NEW' && NUM_FIELDS.find((f) => f.key === k)?.old)} value={decl[k] || ''} onChange={(e) => set({ [k]: e.target.value === '' ? 0 : Number(e.target.value) })} />
  );

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title={`Tax declaration · ${d.fyLabel}${d.name && uid ? ` · ${d.name}` : ''}`} right={d.status !== 'NONE' && (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${d.status === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-sky-700 border-sky-200'}`}>{d.status === 'VERIFIED' ? 'Verified by HR' : 'Submitted'}</span>)}>
        {d.mode === 'MANUAL' && <div className="mb-3"><Notice>Income tax is currently entered by HR as a fixed amount each month, so this declaration does not change your payslip yet. The estimate below is for your information.</Notice></div>}
        {preview?.available && (
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <Compare title="New regime" chosen={decl.regime === 'NEW'} cheaper={preview.cheaper === 'NEW'} r={preview.NEW} />
            <Compare title="Old regime" chosen={decl.regime === 'OLD'} cheaper={preview.cheaper === 'OLD'} r={preview.OLD} />
          </div>
        )}
        {preview && !preview.available && <div className="mb-3 text-xs text-slate-500">{preview.reason}</div>}
        {preview?.available && <p className="text-[11px] text-slate-400 mb-3">Estimates use your current salary for the rest of the year and the deductions typed below. Tax already deducted so far: {inr(preview.taxDeductedSoFar)}.</p>}
        <div className="flex gap-4 mb-3 text-sm">
          {(['NEW', 'OLD'] as const).map((r) => (
            <label key={r} className="flex items-center gap-1.5"><input type="radio" disabled={locked} checked={decl.regime === r} onChange={() => set({ regime: r })} /> {r === 'NEW' ? 'New regime (default)' : 'Old regime (with deductions)'}</label>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-3">
          {NUM_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={decl.regime === 'NEW' && f.old ? 'Not allowed in the new regime.' : f.hint}>{num(f.key)}</Field>
          ))}
          <label className="text-xs flex items-center gap-1.5 text-slate-700 pt-5"><input type="checkbox" disabled={locked} checked={decl.metroCity} onChange={(e) => set({ metroCity: e.target.checked })} /> I live in a metro city (Delhi, Mumbai, Kolkata, Chennai)</label>
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Proof (rent receipts, investment statements) is checked by HR outside this system.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {!locked && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveTaxDeclaration({ uid, declaration: decl }); await load(); onSaved?.(); }, 'Declaration saved.')}>Save declaration</button>}
          {canManage && uid && d.status !== 'NONE' && (
            <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await payrollService.verifyDeclaration({ uid, verified: d.status !== 'VERIFIED' }); await load(); onSaved?.(); })}>{d.status === 'VERIFIED' ? 'Remove verification' : 'Mark as verified'}</button>
          )}
          <button className={btnGhost} onClick={() => setShowStatement(!showStatement)}>{showStatement ? 'Hide' : 'View'} annual tax statement</button>
        </div>
        {locked && <div className="mt-2 text-[11px] text-slate-500">HR has verified this declaration. Ask HR to change it.</div>}
      </Card>
      {showStatement && <TaxStatement uid={uid} />}
    </div>
  );
};

export const MyTax: React.FC = () => <DeclarationForm canManage={false} />;

/** HR: who has declared, verification, the year's tax register. */
export const TaxAdmin: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [data, setData] = useState<any | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, note, run } = useRunner();
  const load = useCallback(async () => setData(await payrollService.taxDeclarations()), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title={`Tax declarations · ${data.fyLabel}`} right={
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await payrollService.tdsRegister(); downloadCsv(`tds-register-${r.fyLabel}.csv`, [r.header, ...r.rows]); })}>Download year's tax register (CSV)</button>}>
        <p className="text-[11px] text-slate-400 mb-3">{data.mode === 'AUTO' ? 'Income tax is calculated automatically every month from these declarations.' : 'Income tax is still a fixed deduction on each salary. Switch to automatic in Setup to calculate it from declarations.'} People who have not declared are taxed under the default regime with no deductions. The register compares the tax due for the year with the tax actually deducted.</p>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[600px] w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">PAN</th><th className="p-1.5">Regime</th><th className="p-1.5">Declaration</th><th /></tr></thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.uid} className="border-t border-slate-100">
                  <td className="p-1.5"><div className="font-semibold text-slate-800">{r.name}</div><div className="text-slate-400">{r.empId} · {r.department || '-'}</div></td>
                  <td className="p-1.5">{r.pan || <span className="text-amber-600">Missing</span>}</td>
                  <td className="p-1.5">{r.regime === 'OLD' ? 'Old' : 'New'}</td>
                  <td className="p-1.5">{r.status === 'NONE' ? <span className="text-slate-400">Not declared</span> : r.status === 'VERIFIED' ? 'Verified' : 'Submitted'}</td>
                  <td className="p-1.5 text-right"><button className={btnGhost} onClick={() => setOpen(open === r.uid ? null : r.uid)}>{open === r.uid ? 'Close' : canManage ? 'Open / edit' : 'View'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <DeclarationForm uid={open} canManage={canManage} onSaved={() => load()} />}
    </div>
  );
};
