import React, { useEffect, useState } from 'react';
import { csvToObjects } from '../../../shared/csv';
import { leaveService } from '../../services/leaveService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, dayName, input, useRunner } from './ui';

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'item';

const WeeklyOffEditor: React.FC<{ value: Record<string, any>; onChange: (v: Record<string, any>) => void }> = ({ value, onChange }) => (
  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
    {DAYS.map((d) => {
      const rule = value[String(d)];
      const mode = !rule ? 'WORK' : rule === 'ALL' ? 'ALL' : 'WEEKS';
      const label = dayName(`2026-10-${String(11 + d).padStart(2, '0')}`);
      const set = (m: string, weeks: number[] = Array.isArray(rule) ? rule : []) => {
        const next = { ...value };
        if (m === 'WORK') delete next[String(d)];
        else next[String(d)] = m === 'ALL' ? 'ALL' : weeks;
        onChange(next);
      };
      return (
        <div key={d} className="flex items-center gap-2 text-xs">
          <span className="w-9 font-semibold text-slate-600">{label}</span>
          <select className="border border-slate-300 rounded px-1.5 py-1" value={mode} onChange={(e) => set(e.target.value, e.target.value === 'WEEKS' ? [2, 4] : [])}>
            <option value="WORK">Working</option><option value="ALL">Off every week</option><option value="WEEKS">Off on some weeks</option>
          </select>
          {mode === 'WEEKS' && [1, 2, 3, 4, 5].map((w) => (
            <label key={w} className="flex items-center gap-0.5">
              <input type="checkbox" checked={(rule as number[]).includes(w)} onChange={(e) => set('WEEKS', e.target.checked ? [...rule, w] : (rule as number[]).filter((x) => x !== w))} />{w}
            </label>
          ))}
        </div>
      );
    })}
  </div>
);

export const HrSetup: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [s, setS] = useState<any | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loc, setLoc] = useState(0);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '', optional: false });
  const { busy, note, run } = useRunner();

  const load = () => leaveService.settings().then((r) => { setS(r.settings); setConfigured(r.configured && r.settings.types.length > 0); });
  useEffect(() => { load(); }, []);
  if (!s) return <div className="text-sm text-slate-500">Loading…</div>;

  const patch = (p: any) => setS({ ...s, ...p });
  const save = () => run(async () => { const r = await leaveService.saveSettings(s); setS(r.settings); setConfigured(true); onChanged(); }, 'Saved.');

  if (!configured) {
    return (
      <Card title="Set up leave for your company">
        <p className="text-xs text-slate-600 mb-3">Start from a ready template (casual, sick, earned, compensatory-off, maternity, bereavement and loss-of-pay, plus the national holidays). You can change everything afterwards.</p>
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await leaveService.applyStarter({ yearStartMonth: 4 }); await load(); onChanged(); }, 'Template applied.')}>Financial year (Apr–Mar)</button>
          <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await leaveService.applyStarter({ yearStartMonth: 1 }); await load(); onChanged(); }, 'Template applied.')}>Calendar year (Jan–Dec)</button>
        </div>
        {note && <div className="mt-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      </Card>
    );
  }

  const location = s.locations[loc];
  const setLocation = (p: any) => patch({ locations: s.locations.map((l: any, i: number) => (i === loc ? { ...l, ...p } : l)) });
  const setType = (i: number, p: any) => patch({ types: s.types.map((t: any, j: number) => (j === i ? { ...t, ...p } : t)) });
  const setPolicy = (i: number, p: any) => patch({ policies: s.policies.map((t: any, j: number) => (j === i ? { ...t, ...p } : t)) });
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="space-y-4">
      <Card title="Leave year, attendance and approvals" right={<button className={btnPrimary} disabled={busy} onClick={save}>Save all changes</button>}>
        {note && <div className="mb-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Leave year starts in" hint="April = financial year, January = calendar year">
            <select className={input} value={s.yearStartMonth} onChange={(e) => patch({ yearStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}{i === 0 ? ' (calendar year)' : i === 3 ? ' (financial year)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Weekends/holidays between leave days"><select className={input} value={s.sandwichRule ? '1' : '0'} onChange={(e) => patch({ sandwichRule: e.target.value === '1' })}><option value="0">Not counted</option><option value="1">Counted (sandwich rule)</option></select></Field>
          <Field label="Shift start"><input type="time" className={input} value={s.shift.start} onChange={(e) => patch({ shift: { ...s.shift, start: e.target.value } })} /></Field>
          <Field label="Shift end"><input type="time" className={input} value={s.shift.end} onChange={(e) => patch({ shift: { ...s.shift, end: e.target.value } })} /></Field>
          <Field label="Late grace (minutes)"><input type="number" className={input} value={s.shift.graceMinutes} onChange={(e) => patch({ shift: { ...s.shift, graceMinutes: num(e.target.value) } })} /></Field>
          <Field label="Minutes for a full day"><input type="number" className={input} value={s.shift.fullDayMinutes} onChange={(e) => patch({ shift: { ...s.shift, fullDayMinutes: num(e.target.value) } })} /></Field>
          <Field label="Minutes for a half day"><input type="number" className={input} value={s.shift.halfDayMinutes} onChange={(e) => patch({ shift: { ...s.shift, halfDayMinutes: num(e.target.value) } })} /></Field>
          <Field label="Late marks per half-day deduction" hint="0 = off"><input type="number" className={input} value={s.lateMarksPerHalfDay} onChange={(e) => patch({ lateMarksPerHalfDay: num(e.target.value) })} /></Field>
          <Field label="Add HR step above (days)" hint="0 = only when the leave type asks"><input type="number" className={input} value={s.hrApprovalAboveDays} onChange={(e) => patch({ hrApprovalAboveDays: num(e.target.value) })} /></Field>
          <Field label="Remind HR after (days)" hint="0 = never"><input type="number" className={input} value={s.escalateAfterDays} onChange={(e) => patch({ escalateAfterDays: num(e.target.value) })} /></Field>
          <Field label="HR email(s) for alerts" hint="comma separated"><input className={input} value={s.notifyEmails.join(', ')} onChange={(e) => patch({ notifyEmails: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} /></Field>
          <Field label="Allowed check-in IPs" hint="optional, comma separated; end with a dot for a prefix"><input className={input} value={s.allowedIps.join(', ')} onChange={(e) => patch({ allowedIps: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} /></Field>
        </div>
      </Card>

      <Card title="Locations, weekly offs and holidays" right={
        <div className="flex gap-2">
          <select className="border border-slate-300 rounded px-2 py-1 text-xs" value={loc} onChange={(e) => setLoc(Number(e.target.value))}>{s.locations.map((l: any, i: number) => <option key={l.id + i} value={i}>{l.name}</option>)}</select>
          <button className={btnGhost} onClick={() => { patch({ locations: [...s.locations, { id: '', name: `Location ${s.locations.length + 1}`, weeklyOff: { '0': 'ALL' }, holidays: [] }] }); setLoc(s.locations.length); }}>Add location</button>
        </div>}>
        {!location ? <div className="text-xs text-slate-500">Add a location.</div> : (
          <div className="space-y-4">
            <div className="flex items-end gap-3">
              <div className="max-w-xs flex-1"><Field label="Location name"><input className={input} value={location.name} onChange={(e) => setLocation({ name: e.target.value })} /></Field></div>
              {s.locations.length > 1 && <button className={btnDanger} onClick={() => { patch({ locations: s.locations.filter((_: any, i: number) => i !== loc) }); setLoc(0); }}>Remove location</button>}
            </div>
            <div><div className="text-xs font-semibold text-slate-600 mb-1">Weekly offs</div><WeeklyOffEditor value={location.weeklyOff} onChange={(v) => setLocation({ weeklyOff: v })} /></div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Holidays ({location.holidays.length})</div>
              <div className="flex flex-wrap gap-2 items-end mb-2">
                <input type="date" className={`${input} max-w-[10rem]`} value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} />
                <input className={`${input} max-w-xs`} placeholder="Holiday name" value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} />
                <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={newHoliday.optional} onChange={(e) => setNewHoliday({ ...newHoliday, optional: e.target.checked })} /> Optional</label>
                <button className={btnGhost} onClick={() => { if (!newHoliday.date) return; setLocation({ holidays: [...location.holidays.filter((h: any) => h.date !== newHoliday.date), newHoliday].sort((a: any, b: any) => a.date.localeCompare(b.date)) }); setNewHoliday({ date: '', name: '', optional: false }); }}>Add</button>
                <label className={`${btnGhost} cursor-pointer`}>Import CSV
                  <input type="file" accept=".csv" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
                    const rows = csvToObjects(await f.text());
                    const added = rows.map((r) => { const k: Record<string, string> = {}; Object.entries(r).forEach(([a, b]) => (k[a.toLowerCase()] = b)); return { date: k.date, name: k.name || k.holiday || 'Holiday', optional: /^(y|yes|true|1|optional)$/i.test(k.optional || '') }; }).filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date));
                    const merged = new Map<string, any>(location.holidays.map((h: any) => [h.date, h]));
                    added.forEach((h) => merged.set(h.date, h));
                    setLocation({ holidays: Array.from(merged.values()).sort((a, b) => a.date.localeCompare(b.date)) });
                  }} />
                </label>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">CSV columns: date (YYYY-MM-DD), name, optional (yes/no). Festival dates change every year, so add or import them each year.</p>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {location.holidays.map((h: any) => (
                  <div key={h.date} className="flex justify-between items-center px-3 py-1.5 text-xs">
                    <span><b className="text-slate-700">{h.date}</b> {dayName(h.date)} · {h.name}{h.optional ? ' (optional)' : ''}</span>
                    <button className="text-rose-600" onClick={() => setLocation({ holidays: location.holidays.filter((x: any) => x.date !== h.date) })}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Leave types" right={<button className={btnGhost} onClick={() => patch({ types: [...s.types, { id: '', code: 'NEW', name: 'New leave type', paid: true, active: true, requiresBalance: true, halfDay: true, dayCounting: 'WORKING', minNoticeDays: 0, maxDaysPerRequest: 0, docRequiredAfterDays: 0, gender: 'ANY', minServiceDays: 0, allowNegative: false, approval: 'MANAGER' }] })}>Add type</button>}>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-[1100px] w-full">
            <thead className="text-left text-slate-500"><tr>{['Name', 'Code', 'Paid', 'Has balance', 'Half day', 'Counts', 'Notice', 'Max/request', 'Doc after', 'For', 'Min service', 'Can go negative', 'Approval', 'Year starts', 'Active', ''].map((h) => <th key={h} className="p-1.5 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {s.types.map((t: any, i: number) => (
                <tr key={t.id + i} className="border-t border-slate-100">
                  <td className="p-1"><input className={input} value={t.name} onChange={(e) => setType(i, { name: e.target.value })} /></td>
                  <td className="p-1 w-16"><input className={input} value={t.code} onChange={(e) => setType(i, { code: e.target.value.toUpperCase() })} /></td>
                  <td className="p-1"><input type="checkbox" checked={t.paid} onChange={(e) => setType(i, { paid: e.target.checked })} /></td>
                  <td className="p-1"><input type="checkbox" checked={t.requiresBalance} disabled={t.isLop} onChange={(e) => setType(i, { requiresBalance: e.target.checked })} /></td>
                  <td className="p-1"><input type="checkbox" checked={t.halfDay} onChange={(e) => setType(i, { halfDay: e.target.checked })} /></td>
                  <td className="p-1"><select className={input} value={t.dayCounting} onChange={(e) => setType(i, { dayCounting: e.target.value })}><option value="WORKING">Working days</option><option value="CALENDAR">Calendar days</option></select></td>
                  <td className="p-1 w-16"><input type="number" className={input} value={t.minNoticeDays} onChange={(e) => setType(i, { minNoticeDays: num(e.target.value) })} /></td>
                  <td className="p-1 w-20"><input type="number" className={input} value={t.maxDaysPerRequest} onChange={(e) => setType(i, { maxDaysPerRequest: num(e.target.value) })} /></td>
                  <td className="p-1 w-16"><input type="number" className={input} value={t.docRequiredAfterDays} onChange={(e) => setType(i, { docRequiredAfterDays: num(e.target.value) })} /></td>
                  <td className="p-1"><select className={input} value={t.gender} onChange={(e) => setType(i, { gender: e.target.value })}><option value="ANY">Everyone</option><option value="F">Women</option><option value="M">Men</option></select></td>
                  <td className="p-1 w-20"><input type="number" className={input} value={t.minServiceDays} onChange={(e) => setType(i, { minServiceDays: num(e.target.value) })} /></td>
                  <td className="p-1"><input type="checkbox" checked={t.allowNegative} onChange={(e) => setType(i, { allowNegative: e.target.checked })} /></td>
                  <td className="p-1"><select className={input} value={t.approval} onChange={(e) => setType(i, { approval: e.target.value })}><option value="MANAGER">Manager</option><option value="MANAGER_HR">Manager, then HR</option><option value="HR">HR only</option></select></td>
                  <td className="p-1"><select className={input} value={t.startMonth || 0} onChange={(e) => setType(i, { startMonth: Number(e.target.value) || undefined })}><option value={0}>Company default</option>{MONTHS.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}</select></td>
                  <td className="p-1"><input type="checkbox" checked={t.active} onChange={(e) => setType(i, { active: e.target.checked })} /></td>
                  <td className="p-1"><button className="text-rose-600" onClick={() => patch({ types: s.types.filter((_: any, j: number) => j !== i), policies: s.policies.map((p: any) => ({ ...p, entries: p.entries.filter((en: any) => en.typeId !== t.id) })) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Save after adding a type so it gets an id, then add it to a policy below. Statutory leave such as maternity should be checked with your labour-law advisor.</p>
      </Card>

      <Card title="Leave policies" right={<button className={btnGhost} onClick={() => patch({ policies: [...s.policies, { id: '', name: `Policy ${s.policies.length + 1}`, isDefault: s.policies.length === 0, entries: [] }] })}>Add policy</button>}>
        <div className="space-y-5">
          {s.policies.map((p: any, pi: number) => (
            <div key={p.id + pi} className="border border-slate-200 rounded-lg p-3">
              <div className="flex flex-wrap items-end gap-3 mb-2">
                <div className="max-w-xs flex-1"><Field label="Policy name"><input className={input} value={p.name} onChange={(e) => setPolicy(pi, { name: e.target.value })} /></Field></div>
                <label className="text-xs flex items-center gap-1"><input type="radio" checked={!!p.isDefault} onChange={() => patch({ policies: s.policies.map((x: any, j: number) => ({ ...x, isDefault: j === pi })) })} /> Default for new people</label>
                {s.policies.length > 1 && <button className={btnDanger} onClick={() => patch({ policies: s.policies.filter((_: any, j: number) => j !== pi) })}>Remove</button>}
              </div>
              <table className="text-xs w-full">
                <thead className="text-left text-slate-500"><tr><th className="p-1">Leave type</th><th className="p-1">Days per year</th><th className="p-1">Credited</th><th className="p-1">Carry forward</th><th className="p-1">Carry limit</th><th /></tr></thead>
                <tbody>
                  {p.entries.map((en: any, ei: number) => {
                    const t = s.types.find((x: any) => x.id === en.typeId);
                    const setEntry = (q: any) => setPolicy(pi, { entries: p.entries.map((x: any, j: number) => (j === ei ? { ...x, ...q } : x)) });
                    return (
                      <tr key={en.typeId} className="border-t border-slate-100">
                        <td className="p-1 font-semibold text-slate-700">{t?.name || en.typeId}</td>
                        <td className="p-1 w-24"><input type="number" className={input} value={en.quota} onChange={(e) => setEntry({ quota: num(e.target.value) })} /></td>
                        <td className="p-1"><select className={input} value={en.accrual} onChange={(e) => setEntry({ accrual: e.target.value })}><option value="NONE">No automatic credit</option><option value="UPFRONT">Upfront at start of year</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></td>
                        <td className="p-1"><input type="checkbox" checked={en.carryForward} onChange={(e) => setEntry({ carryForward: e.target.checked })} /></td>
                        <td className="p-1 w-24"><input type="number" className={input} disabled={!en.carryForward} value={en.carryCap} onChange={(e) => setEntry({ carryCap: num(e.target.value) })} /></td>
                        <td className="p-1"><button className="text-rose-600" onClick={() => setPolicy(pi, { entries: p.entries.filter((_: any, j: number) => j !== ei) })}>Remove</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <select className="mt-2 border border-slate-300 rounded px-2 py-1 text-xs" value="" onChange={(e) => e.target.value && setPolicy(pi, { entries: [...p.entries, { typeId: e.target.value, quota: 0, accrual: 'NONE', carryForward: false, carryCap: 0 }] })}>
                <option value="">+ Add a leave type to this policy</option>
                {s.types.filter((t: any) => t.id && !p.entries.some((en: any) => en.typeId === t.id)).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
