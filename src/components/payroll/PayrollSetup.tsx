import React, { useCallback, useEffect, useState } from 'react';
import { payrollService } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

const slugId = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

const Num: React.FC<{ label: string; value: number; onChange: (n: number) => void; hint?: string; disabled?: boolean; step?: string }> = ({ label, value, onChange, hint, disabled, step }) => (
  <Field label={label} hint={hint}>
    <input type="number" step={step || 'any'} className={input} disabled={disabled} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
  </Field>
);

const Check: React.FC<{ label: string; checked: boolean; onChange: (b: boolean) => void; disabled?: boolean }> = ({ label, checked, onChange, disabled }) => (
  <label className="text-xs flex items-center gap-1.5 text-slate-700"><input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
);

export const PayrollSetup: React.FC<{ canManage: boolean; onChanged: () => void }> = ({ canManage, onChanged }) => {
  const [data, setData] = useState<any | null>(null);
  const [s, setS] = useState<any | null>(null);
  const [ptState, setPtState] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const r = await payrollService.settings();
    setData(r);
    setS(r.settings);
    setPtState((cur) => cur || r.settings.pt.defaultState || Object.keys(r.settings.pt.states)[0] || 'Maharashtra');
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  if (!data || !s) return <div className="text-sm text-slate-500">Loading…</div>;

  if (!data.configured) {
    return (
      <Card title="Set up payroll">
        <p className="text-sm text-slate-600 mb-3">Payroll has not been set up for this company. Start from a template (salary components, PF, ESIC and starter professional tax slabs) and change anything you need.</p>
        {canManage
          ? <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.applyStarter(); await load(); onChanged(); }, 'Payroll template applied.')}>Start from template</button>
          : <div className="text-xs text-slate-500">Ask someone with payroll access to set this up.</div>}
        {note && <div className="mt-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      </Card>
    );
  }

  const ro = !canManage;
  const patch = (p: any) => setS({ ...s, ...p });
  const patchIn = (key: string, p: any) => setS({ ...s, [key]: { ...s[key], ...p } });
  const earnings = s.components.filter((c: any) => c.kind === 'EARNING');
  const setComp = (id: string, p: any) => patch({ components: s.components.map((c: any) => (c.id === id ? { ...c, ...p } : c)) });
  const setBasic = (id: string) => patch({ components: s.components.map((c: any) => ({ ...c, isBasic: c.id === id })) });
  const addComponent = (kind: 'EARNING' | 'DEDUCTION') => {
    let n = s.components.length + 1;
    let id = `item-${n}`;
    while (s.components.some((c: any) => c.id === id)) id = `item-${++n}`;
    patch({ components: [...s.components, { id, code: `C${n}`, name: kind === 'EARNING' ? 'New earning' : 'New deduction', kind, active: true, prorate: kind === 'EARNING', pfWage: false, esicWage: kind === 'EARNING' }] });
  };
  const slabs: any[] = s.pt.states[ptState] || [];
  const setSlabs = (list: any[]) => patchIn('pt', { states: { ...s.pt.states, [ptState]: list } });
  const tpl: any[] = s.ctcTemplate;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Notice>Statutory rates, ceilings and professional tax slabs here are starter values. They change over time, so have your accountant confirm them before paying real salaries.</Notice>

      <Card title="General" right={canManage && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.saveSettings({ ...s, components: s.components.map((c: any) => ({ ...c, id: slugId(c.id) || c.id })) }); await load(); onChanged(); }, 'Payroll setup saved.')}>Save all changes</button>}>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Company name on payslips"><input className={input} disabled={ro} value={s.company.legalName} onChange={(e) => patchIn('company', { legalName: e.target.value })} /></Field>
          <Field label="Address on payslips"><input className={input} disabled={ro} value={s.company.address} onChange={(e) => patchIn('company', { address: e.target.value })} /></Field>
          <Field label="Days in a month" hint="Calendar: real days. Fixed 30: every month is 30 days.">
            <select className={input} disabled={ro} value={s.daysBasis} onChange={(e) => patch({ daysBasis: e.target.value })}><option value="CALENDAR">Calendar days</option><option value="FIXED_30">Fixed 30 days</option></select>
          </Field>
          <Field label="What reduces pay" hint="Leave only: just approved unpaid leave. Attendance: absent days and half days too (needs check-ins).">
            <select className={input} disabled={ro} value={s.attendanceMode} onChange={(e) => patch({ attendanceMode: e.target.value })}><option value="LEAVE_ONLY">Unpaid leave only</option><option value="ATTENDANCE">Unpaid leave + attendance</option></select>
          </Field>
          <Field label="Leave encashment is paid at"><select className={input} disabled={ro} value={s.encashmentBase} onChange={(e) => patch({ encashmentBase: e.target.value })}><option value="BASIC">Basic salary / 30 per day</option><option value="GROSS">Gross salary / 30 per day</option></select></Field>
          <div className="pt-5"><Check disabled={ro} label="Deduct pay for late marks (uses the leave setup's late-mark rule)" checked={s.deductLateMarks} onChange={(b) => patch({ deductLateMarks: b })} /></div>
        </div>
      </Card>

      <Card title="Salary components" right={canManage && <div className="flex gap-2"><button className={btnGhost} onClick={() => addComponent('EARNING')}>Add earning</button><button className={btnGhost} onClick={() => addComponent('DEDUCTION')}>Add deduction</button></div>}>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[820px] w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Code</th><th className="p-1.5">Name</th><th className="p-1.5">Type</th><th className="p-1.5">Pro-rated</th><th className="p-1.5">PF wage</th><th className="p-1.5">ESIC wage</th><th className="p-1.5">Basic</th><th className="p-1.5">Active</th><th /></tr></thead>
            <tbody>
              {s.components.map((c: any) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="p-1"><input className={`${input} w-24`} disabled={ro} value={c.code} onChange={(e) => setComp(c.id, { code: e.target.value.toUpperCase() })} /></td>
                  <td className="p-1"><input className={input} disabled={ro} value={c.name} onChange={(e) => setComp(c.id, { name: e.target.value })} /></td>
                  <td className="p-1.5">{c.kind === 'EARNING' ? 'Earning' : 'Deduction'}</td>
                  <td className="p-1.5 text-center">{c.kind === 'EARNING' && <input type="checkbox" disabled={ro} checked={c.prorate} onChange={(e) => setComp(c.id, { prorate: e.target.checked })} />}</td>
                  <td className="p-1.5 text-center">{c.kind === 'EARNING' && <input type="checkbox" disabled={ro} checked={c.pfWage} onChange={(e) => setComp(c.id, { pfWage: e.target.checked })} />}</td>
                  <td className="p-1.5 text-center">{c.kind === 'EARNING' && <input type="checkbox" disabled={ro} checked={c.esicWage} onChange={(e) => setComp(c.id, { esicWage: e.target.checked })} />}</td>
                  <td className="p-1.5 text-center">{c.kind === 'EARNING' && <input type="radio" name="basic" disabled={ro} checked={!!c.isBasic} onChange={() => setBasic(c.id)} />}</td>
                  <td className="p-1.5 text-center"><input type="checkbox" disabled={ro} checked={c.active} onChange={(e) => setComp(c.id, { active: e.target.checked })} /></td>
                  <td className="p-1">{canManage && <button className={btnDanger} onClick={() => patch({ components: s.components.filter((x: any) => x.id !== c.id), ctcTemplate: tpl.filter((r) => r.componentId !== c.id) })}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Pro-rated earnings shrink with loss of pay. PF wage and ESIC wage mark which earnings count for those schemes. Income tax (TDS) is not calculated here: keep it as a fixed deduction and enter the monthly amount on each salary.</p>
      </Card>

      <Card title="CTC split template" right={canManage && <button className={btnGhost} onClick={() => patch({ ctcTemplate: [...tpl, { componentId: earnings[0]?.id || '', mode: 'FIXED', value: 0 }] })}>Add row</button>}>
        <p className="text-[11px] text-slate-400 mb-2">Used by "Split from annual CTC" on a salary. Here CTC means the gross monthly pay times 12; employer PF and ESIC are shown on top. Keep one row as the balancing component so the parts add up.</p>
        <div className="space-y-2">
          {tpl.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={`${input} max-w-[14rem]`} disabled={ro} value={r.componentId} onChange={(e) => patch({ ctcTemplate: tpl.map((x, j) => (j === i ? { ...x, componentId: e.target.value } : x)) })}>
                {earnings.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={`${input} max-w-[13rem]`} disabled={ro} value={r.mode} onChange={(e) => patch({ ctcTemplate: tpl.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)) })}>
                <option value="PERCENT_OF_CTC">% of monthly pay</option><option value="PERCENT_OF_BASIC">% of basic</option><option value="FIXED">Fixed amount</option><option value="BALANCE">Balance (the rest)</option>
              </select>
              {r.mode !== 'BALANCE' && <input type="number" className={`${input} max-w-[8rem]`} disabled={ro} value={r.value} onChange={(e) => patch({ ctcTemplate: tpl.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)) })} />}
              {canManage && <button className={btnDanger} onClick={() => patch({ ctcTemplate: tpl.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
          ))}
          {tpl.length === 0 && <div className="text-xs text-slate-400">No rows yet.</div>}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Provident fund (PF)">
          <Check disabled={ro} label="Deduct PF" checked={s.pf.enabled} onChange={(b) => patchIn('pf', { enabled: b })} />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Num label="Employee %" value={s.pf.employeePct} disabled={ro} onChange={(n) => patchIn('pf', { employeePct: n })} />
            <Num label="Employer %" value={s.pf.employerPct} disabled={ro} onChange={(n) => patchIn('pf', { employerPct: n })} />
            <Num label="EDLI %" value={s.pf.edliPct} disabled={ro} onChange={(n) => patchIn('pf', { edliPct: n })} />
            <Num label="Admin charge %" value={s.pf.adminPct} disabled={ro} onChange={(n) => patchIn('pf', { adminPct: n })} />
            <Num label="Wage ceiling (₹ a month)" value={s.pf.wageCeiling} disabled={ro} onChange={(n) => patchIn('pf', { wageCeiling: n })} hint="PF is worked out on wages up to this, unless a person contributes on actual wage." />
          </div>
        </Card>
        <Card title="ESIC">
          <Check disabled={ro} label="Deduct ESIC" checked={s.esic.enabled} onChange={(b) => patchIn('esic', { enabled: b })} />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Num label="Employee %" value={s.esic.employeePct} disabled={ro} onChange={(n) => patchIn('esic', { employeePct: n })} />
            <Num label="Employer %" value={s.esic.employerPct} disabled={ro} onChange={(n) => patchIn('esic', { employerPct: n })} />
            <Num label="Wage ceiling (₹ a month)" value={s.esic.wageCeiling} disabled={ro} onChange={(n) => patchIn('esic', { wageCeiling: n })} hint="People whose full monthly ESIC wage is above this are not covered." />
          </div>
        </Card>
      </div>

      <Card title="Professional tax">
        <Check disabled={ro} label="Deduct professional tax" checked={s.pt.enabled} onChange={(b) => patchIn('pt', { enabled: b })} />
        <div className="grid md:grid-cols-3 gap-3 my-3">
          <Field label="Default state" hint="Used for people with no state on their salary.">
            <select className={input} disabled={ro} value={s.pt.defaultState} onChange={(e) => patchIn('pt', { defaultState: e.target.value })}><option value="">None</option>{data.states.map((x: string) => <option key={x} value={x}>{x}</option>)}</select>
          </Field>
          <Field label="Edit slabs for">
            <select className={input} value={ptState} onChange={(e) => setPtState(e.target.value)}>{data.states.map((x: string) => <option key={x} value={x}>{x}{(s.pt.states[x] || []).length ? ' ✓' : ''}</option>)}</select>
          </Field>
        </div>
        <table className="text-xs w-full max-w-3xl">
          <thead className="text-left text-slate-500"><tr><th className="p-1">Gross from (₹)</th><th className="p-1">to (₹, blank = no limit)</th><th className="p-1">Tax a month (₹)</th><th className="p-1">February (₹, optional)</th><th className="p-1">Applies to</th><th /></tr></thead>
          <tbody>
            {slabs.map((sl, i) => {
              const set = (p: any) => setSlabs(slabs.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="p-1"><input type="number" className={input} disabled={ro} value={sl.from} onChange={(e) => set({ from: Number(e.target.value) })} /></td>
                  <td className="p-1"><input type="number" className={input} disabled={ro} value={sl.to ?? ''} onChange={(e) => set({ to: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                  <td className="p-1"><input type="number" className={input} disabled={ro} value={sl.amount} onChange={(e) => set({ amount: Number(e.target.value) })} /></td>
                  <td className="p-1"><input type="number" className={input} disabled={ro} value={sl.febAmount ?? ''} onChange={(e) => set({ febAmount: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
                  <td className="p-1"><select className={input} disabled={ro} value={sl.gender || 'ANY'} onChange={(e) => set({ gender: e.target.value })}><option value="ANY">Everyone</option><option value="M">Men</option><option value="F">Women</option></select></td>
                  <td className="p-1">{canManage && <button className={btnDanger} onClick={() => setSlabs(slabs.filter((_, j) => j !== i))}>×</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canManage && <button className={`${btnGhost} mt-2`} onClick={() => setSlabs([...slabs, { from: 0, to: null, amount: 0, gender: 'ANY' }])}>Add slab</button>}
        {slabs.length === 0 && <div className="text-xs text-slate-400 mt-2">No slabs for {ptState}: professional tax is 0 for people in this state until you add them.</div>}
      </Card>
    </div>
  );
};
