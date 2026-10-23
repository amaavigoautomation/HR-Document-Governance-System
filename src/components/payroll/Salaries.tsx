import React, { useCallback, useEffect, useState } from 'react';
import { csvToObjects } from '../../../shared/csv';
import { inr, payrollService } from '../../services/payrollService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const blank = { amounts: {} as Record<string, number>, annualCtc: 0, state: '', pfApplicable: true, esicApplicable: true, pfOnActualWage: false, pan: '', uan: '', esicNo: '', bankName: '', bankAccount: '', ifsc: '' };

const Editor: React.FC<{ uid: string; name: string; settings: any; states: string[]; canManage: boolean; onSaved: () => void; onClose: () => void }> = ({ uid, name, settings, states, canManage, onSaved, onClose }) => {
  const [f, setF] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { busy, note, run } = useRunner();

  useEffect(() => {
    setF(null);
    payrollService.structure(uid).then((r) => {
      setF(r.structure ? { ...blank, ...r.structure } : { ...blank });
      setHistory(r.structure?.history || []);
    }).catch(() => setF({ ...blank }));
  }, [uid]);

  if (!f) return <div className="text-sm text-slate-500">Loading…</div>;
  const ro = !canManage;
  const earn = settings.components.filter((c: any) => c.kind === 'EARNING' && c.active);
  const ded = settings.components.filter((c: any) => c.kind === 'DEDUCTION' && c.active);
  const gross = earn.reduce((n: number, c: any) => n + (Number(f.amounts[c.id]) || 0), 0);
  const set = (p: any) => setF({ ...f, ...p });
  const setAmt = (id: string, v: string) => set({ amounts: { ...f.amounts, [id]: v === '' ? 0 : Number(v) } });

  return (
    <Card title={`Salary · ${name}`} right={<button className={btnGhost} onClick={onClose}>Close</button>}>
      {note && <div className="mb-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      {canManage && (
        <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <Field label="Annual CTC (₹)"><input type="number" className={`${input} w-44`} value={f.annualCtc || ''} onChange={(e) => set({ annualCtc: Number(e.target.value) })} /></Field>
          <button className={btnGhost} disabled={busy || !f.annualCtc} onClick={() => run(async () => {
            const r = await payrollService.splitCtc(Number(f.annualCtc));
            setWarnings(r.warnings);
            set({ amounts: { ...Object.fromEntries(ded.map((c: any) => [c.id, f.amounts[c.id] || 0])), ...r.amounts } });
          })}>Split using the template</button>
          <span className="text-[11px] text-slate-400 max-w-sm">Fills the earnings below from the company's CTC template. You can still edit each amount.</span>
        </div>
      )}
      {warnings.map((w) => <div key={w} className="mb-2"><Notice>{w}</Notice></div>)}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-bold text-slate-600 mb-2">Earnings (₹ a month, full month)</div>
          <div className="space-y-2">{earn.map((c: any) => (
            <div key={c.id} className="flex items-center gap-2"><label className="text-xs w-44 text-slate-700">{c.name}</label>
              <input type="number" className={input} disabled={ro} value={f.amounts[c.id] ?? ''} onChange={(e) => setAmt(c.id, e.target.value)} /></div>
          ))}</div>
          <div className="mt-2 text-xs font-bold text-slate-800">Monthly gross: {inr(gross)} · Annual: {inr(gross * 12)}</div>
          {ded.length > 0 && (<>
            <div className="text-xs font-bold text-slate-600 mt-4 mb-2">Fixed deductions (₹ a month)</div>
            <div className="space-y-2">{ded.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2"><label className="text-xs w-44 text-slate-700">{c.name}</label>
                <input type="number" className={input} disabled={ro} value={f.amounts[c.id] ?? ''} onChange={(e) => setAmt(c.id, e.target.value)} /></div>
            ))}</div>
          </>)}
        </div>
        <div className="space-y-3">
          <Field label="State for professional tax"><select className={input} disabled={ro} value={f.state} onChange={(e) => set({ state: e.target.value })}><option value="">Company default ({settings.pt.defaultState || 'none'})</option>{states.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ro} checked={f.pfApplicable} onChange={(e) => set({ pfApplicable: e.target.checked })} /> PF applies</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ro} checked={f.pfOnActualWage} onChange={(e) => set({ pfOnActualWage: e.target.checked })} /> PF on actual wage (above ceiling)</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ro} checked={f.esicApplicable} onChange={(e) => set({ esicApplicable: e.target.checked })} /> ESIC applies</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PAN"><input className={input} disabled={ro} value={f.pan} onChange={(e) => set({ pan: e.target.value })} /></Field>
            <Field label="UAN (PF)"><input className={input} disabled={ro} value={f.uan} onChange={(e) => set({ uan: e.target.value })} /></Field>
            <Field label="ESIC number"><input className={input} disabled={ro} value={f.esicNo} onChange={(e) => set({ esicNo: e.target.value })} /></Field>
            <Field label="Bank"><input className={input} disabled={ro} value={f.bankName} onChange={(e) => set({ bankName: e.target.value })} /></Field>
            <Field label="Account number"><input className={input} disabled={ro} value={f.bankAccount} onChange={(e) => set({ bankAccount: e.target.value })} /></Field>
            <Field label="IFSC"><input className={input} disabled={ro} value={f.ifsc} onChange={(e) => set({ ifsc: e.target.value })} /></Field>
          </div>
        </div>
      </div>
      {canManage && (
        <div className="mt-4"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveStructure({ uid, ...f }); onSaved(); }, 'Salary saved.')}>Save salary</button></div>
      )}
      {history.length > 0 && (
        <details className="mt-4 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Earlier versions ({history.length})</summary>
          <ul className="mt-1 space-y-1">{history.map((h, i) => <li key={i}>{h.at.slice(0, 10)} · {h.by} · gross {inr(Object.entries(h.amounts).filter(([id]) => earn.some((c: any) => c.id === id)).reduce((n, [, v]) => n + Number(v), 0))}</li>)}</ul>
        </details>
      )}
    </Card>
  );
};

export const Salaries: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [importResult, setImportResult] = useState<any | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([payrollService.structures(), payrollService.settings()]);
    setRows(a.rows); setData(b);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  if (!rows || !data) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!data.configured) return <Notice>Set up payroll first (Setup tab).</Notice>;
  const shown = rows.filter((r) => !q || `${r.name} ${r.email} ${r.empId}`.toLowerCase().includes(q.toLowerCase()));
  const missing = rows.filter((r) => !r.hasStructure).length;

  return (
    <div className="space-y-4">
      <Card title={`Salaries (${rows.length})`} right={canManage && (
        <label className={`${btnGhost} cursor-pointer`}>Import CSV
          <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(async () => { setImportResult(await payrollService.importStructures(csvToObjects(await f.text()))); await load(); }, 'Import finished.'); }} />
        </label>)}>
        {note && <div className="mb-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
        {importResult && <div className="mb-2"><Notice tone={importResult.errors.length ? 'info' : 'ok'}>Saved {importResult.saved}. {importResult.errors.slice(0, 6).map((e: any) => `Row ${e.row}: ${e.error}. `)}</Notice></div>}
        {canManage && <p className="text-[11px] text-slate-400 mb-2">CSV columns: <b>email</b>, then one column per component code ({data.settings.components.filter((c: any) => c.active).map((c: any) => c.code).join(', ')}) or <b>annual_ctc</b> to use the CTC template. Optional: state, pan, uan, esic_no, bank_name, bank_account, ifsc, pf (yes/no), esic (yes/no). Importing again replaces that person's salary.</p>}
        {missing > 0 && <div className="mb-2"><Notice>{missing} active employee(s) have no salary yet and will be left out of payroll runs.</Notice></div>}
        <input className={`${input} max-w-xs mb-2`} placeholder="Search name, email, ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[640px] w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">Department</th><th className="p-1.5 text-right">Monthly gross</th><th className="p-1.5">State</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.uid} className="border-t border-slate-100">
                  <td className="p-1.5"><div className="font-semibold text-slate-800">{r.name}</div><div className="text-slate-400">{r.email}</div></td>
                  <td className="p-1.5">{r.department || '-'}</td>
                  <td className="p-1.5 text-right tabular-nums">{r.hasStructure ? inr(r.monthlyGross) : <span className="text-amber-600">Not set</span>}</td>
                  <td className="p-1.5">{r.state || '-'}</td>
                  <td className="p-1.5 text-right"><button className={btnGhost} disabled={busy} onClick={() => setOpen(open === r.uid ? null : r.uid)}>{canManage ? (r.hasStructure ? 'Edit' : 'Set salary') : 'View'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && <Editor uid={open} name={rows.find((r) => r.uid === open)?.name || ''} settings={data.settings} states={data.states} canManage={canManage} onSaved={() => { load(); }} onClose={() => setOpen(null)} />}
    </div>
  );
};
