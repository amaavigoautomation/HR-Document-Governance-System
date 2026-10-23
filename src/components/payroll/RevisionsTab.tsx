import React, { useCallback, useEffect, useState } from 'react';
import { inr, monthLabel, payrollService, shiftMonth } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, thisMonth, useRunner } from '../leave/ui';

const STATUS: Record<string, string> = {
  SCHEDULED: 'bg-amber-50 text-amber-700 border-amber-200',
  APPLIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
};

/** Salary revisions: a new salary from the first of a month, with arrears for months that were already paid. */
export const RevisionsTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [people, setPeople] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [uid, setUid] = useState('');
  const [current, setCurrent] = useState<any | null>(null);
  const [effective, setEffective] = useState(shiftMonth(thisMonth(), 0));
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [ctc, setCtc] = useState('');
  const [why, setWhy] = useState('');
  const [applyMonth, setApplyMonth] = useState(thisMonth());
  const [preview, setPreview] = useState<any | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const [p, s, r] = await Promise.all([payrollService.structures(), payrollService.settings(), payrollService.revisions()]);
    setPeople(p.rows.filter((x: any) => x.hasStructure)); setSettings(s.settings); setItems(r.items);
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const choose = async (id: string) => {
    setUid(id);
    setCurrent(null);
    setAmounts({});
    if (!id) return;
    const r = await payrollService.structure(id);
    setCurrent(r.structure);
    setAmounts({ ...(r.structure?.amounts || {}) });
    setCtc(r.structure?.annualCtc ? String(r.structure.annualCtc) : '');
  };

  if (!settings) return <div className="text-sm text-slate-500">Loading…</div>;
  const earn = settings.components.filter((c: any) => c.kind === 'EARNING' && c.active);
  const sum = (a: Record<string, number>) => earn.reduce((n: number, c: any) => n + (Number(a[c.id]) || 0), 0);
  const nameOf = new Map(people.map((p) => [p.uid, p.name]));
  void nameOf;
  const due = items.filter((r) => r.status === 'SCHEDULED' && r.effectiveFrom.slice(0, 7) <= applyMonth);

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      {canManage && (
        <Card title="New salary revision">
          <p className="text-[11px] text-slate-400 mb-3">A revision takes effect from the first day of a month. Nothing changes until you apply it; then the salary updates and the difference for months that were already locked or paid becomes one arrears item in the month you choose.</p>
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <Field label="Person"><select className={input} value={uid} onChange={(e) => choose(e.target.value)}><option value="">Choose a person</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
            <Field label="Effective from (first of the month)"><input type="month" className={input} value={effective} onChange={(e) => e.target.value && setEffective(e.target.value)} /></Field>
            <Field label="Annual CTC (to split with the template)"><input type="number" className={input} value={ctc} onChange={(e) => setCtc(e.target.value)} /></Field>
            <button className={btnGhost} disabled={busy || !ctc || !uid} onClick={() => run(async () => {
              const r = await payrollService.splitCtc(Number(ctc));
              if (r.warnings.length) throw new Error(r.warnings[0]);
              setAmounts(r.amounts);
            })}>Split using the template</button>
          </div>
          {uid && current && (
            <div className="mt-4">
              <div className="grid md:grid-cols-2 gap-x-8 gap-y-2">
                {earn.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <label className="text-xs w-40 text-slate-700">{c.name}</label>
                    <span className="text-[11px] text-slate-400 w-20 text-right tabular-nums">{inr(current.amounts?.[c.id] || 0)}</span>
                    <span className="text-slate-300">→</span>
                    <input type="number" className={input} value={amounts[c.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value === '' ? 0 : Number(e.target.value) })} />
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs font-bold text-slate-800">Monthly gross: {inr(sum(current.amounts || {}))} → {inr(sum(amounts))} ({sum(amounts) >= sum(current.amounts || {}) ? '+' : ''}{inr(sum(amounts) - sum(current.amounts || {}))})</div>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Note"><input className={`${input} w-80`} placeholder="Annual appraisal, promotion…" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
                <button className={btnPrimary} disabled={busy} onClick={() => run(async () => {
                  await payrollService.saveRevision({ uid, effectiveFrom: `${effective}-01`, amounts, annualCtc: ctc ? Number(ctc) : undefined, note: why });
                  setUid(''); setCurrent(null); setAmounts({}); setWhy(''); await load();
                }, 'Revision scheduled. Apply it below when its month is the one you are running.')}>Schedule revision</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {canManage && (
        <Card title="Apply revisions">
          <div className="flex flex-wrap items-end gap-2 mb-2">
            <Field label="Pay the arrears in"><input type="month" className={`${input} w-44`} value={applyMonth} onChange={(e) => { if (e.target.value) { setApplyMonth(e.target.value); setPreview(null); } }} /></Field>
            <button className={btnGhost} disabled={busy || due.length === 0} onClick={() => run(async () => setPreview(await payrollService.applyRevisions(applyMonth, true)))}>Preview arrears</button>
            <button className={btnPrimary} disabled={busy || due.length === 0} onClick={() => {
              if (!window.confirm(`Apply ${due.length} revision(s)? Salaries change now and the arrears are added to the ${monthLabel(applyMonth)} payroll.`)) return;
              run(async () => { await payrollService.applyRevisions(applyMonth, false); setPreview(null); await load(); }, 'Applied. Recalculate the payroll run to include the arrears.');
            }}>Apply {due.length || ''} revision{due.length === 1 ? '' : 's'}</button>
          </div>
          <p className="text-[11px] text-slate-400">{due.length === 0 ? `No scheduled revision is due by ${monthLabel(applyMonth)}.` : `${due.length} revision(s) are due by ${monthLabel(applyMonth)}. PF, ESIC and professional tax are not recalculated on arrears. The month must not be approved or locked.`}</p>
          {preview && (
            <div className="mt-3 overflow-x-auto">
              <table className="text-xs min-w-[520px] w-full">
                <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5 text-right">Gross now</th><th className="p-1.5 text-right">New gross</th><th className="p-1.5">Months</th><th className="p-1.5 text-right">Arrears</th></tr></thead>
                <tbody>
                  {preview.items.map((x: any) => (
                    <tr key={x.uid} className="border-t border-slate-100 align-top">
                      <td className="p-1.5 font-semibold text-slate-800">{x.name}{x.skipped && <div className="font-normal text-amber-700">{x.skipped}</div>}</td>
                      <td className="p-1.5 text-right tabular-nums">{x.oldGross !== undefined ? inr(x.oldGross) : '-'}</td>
                      <td className="p-1.5 text-right tabular-nums">{x.newGross !== undefined ? inr(x.newGross) : '-'}</td>
                      <td className="p-1.5 text-slate-500">{x.months.map((m: any) => `${monthLabel(m.month)} ${inr(m.amount)}`).join(', ') || 'No paid months to correct'}</td>
                      <td className="p-1.5 text-right tabular-nums font-bold">{inr(x.arrearsTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title={`Revisions (${items.length})`}>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[720px] w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">Effective</th><th className="p-1.5 text-right">Gross</th><th className="p-1.5">Status</th><th className="p-1.5 text-right">Arrears</th><th className="p-1.5">Note</th><th /></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-1.5 font-semibold text-slate-800">{r.name}</td>
                  <td className="p-1.5">{niceDate(r.effectiveFrom)}</td>
                  <td className="p-1.5 text-right tabular-nums">{r.status === 'APPLIED' ? inr(r.newGross) : `${inr(r.currentGross)} → ${inr(r.newGross)}`}</td>
                  <td className="p-1.5"><span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS[r.status]}`}>{r.status === 'SCHEDULED' ? 'Scheduled' : r.status === 'APPLIED' ? `Applied in ${monthLabel(r.appliedMonth)}` : 'Cancelled'}</span></td>
                  <td className="p-1.5 text-right tabular-nums">{r.status === 'APPLIED' ? inr(r.arrearsTotal || 0) : '-'}</td>
                  <td className="p-1.5 text-slate-500">{r.note || '-'}</td>
                  <td className="p-1.5 text-right">{canManage && r.status === 'SCHEDULED' && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await payrollService.cancelRevision(r.id); await load(); }, 'Cancelled.')}>Cancel</button>}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="p-3 text-slate-400">No revisions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
