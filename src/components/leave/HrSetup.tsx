import React, { useEffect, useState } from 'react';
import { CalendarRange, ChevronDown, Clock, FileCheck2, ListChecks, MapPin, Settings2, Tags } from 'lucide-react';
import { csvToObjects } from '../../../shared/csv';
import { leaveService } from '../../services/leaveService';
import { PolicyChanges } from './PolicyChanges';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, dayName, input, niceDate, Skeleton, useRunner } from './ui';

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type Section = 'basics' | 'hours' | 'locations' | 'types' | 'policies' | 'versions';
const SECTIONS: { key: Section; label: string; hint: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'basics', label: 'Leave year & approvals', hint: 'When the year starts, who approves, alerts', icon: Settings2 },
  { key: 'hours', label: 'Working hours', hint: 'Shift, late rule, full and half day', icon: Clock },
  { key: 'locations', label: 'Offices & holidays', hint: 'Weekly offs and holiday list per office', icon: MapPin },
  { key: 'types', label: 'Leave types', hint: 'Casual, sick, earned… and their rules', icon: Tags },
  { key: 'policies', label: 'Leave policies', hint: 'How many days each group gets', icon: ListChecks },
  { key: 'versions', label: 'Policy changes', hint: 'Versions, approval and history', icon: FileCheck2 },
];

const WeeklyOffEditor: React.FC<{ value: Record<string, any>; onChange: (v: Record<string, any>) => void }> = ({ value, onChange }) => (
  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
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
        <div key={d} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-9 font-semibold text-slate-600">{label}</span>
          <select className="border border-slate-300 rounded-lg px-2 py-1" value={mode} onChange={(e) => set(e.target.value, e.target.value === 'WEEKS' ? [2, 4] : [])}>
            <option value="WORK">Working day</option><option value="ALL">Off every week</option><option value="WEEKS">Off some weeks</option>
          </select>
          {mode === 'WEEKS' && (
            <span className="flex items-center gap-1.5 text-slate-500">
              {[1, 2, 3, 4, 5].map((w) => (
                <label key={w} className="flex items-center gap-0.5">
                  <input type="checkbox" className="accent-[#FA7014]" checked={(rule as number[]).includes(w)} onChange={(e) => set('WEEKS', e.target.checked ? [...rule, w] : (rule as number[]).filter((x) => x !== w))} />{['1st', '2nd', '3rd', '4th', '5th'][w - 1]}
                </label>
              ))}
            </span>
          )}
        </div>
      );
    })}
  </div>
);

const Check: React.FC<{ checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, disabled, onChange, label, hint }) => (
  <label className={`flex items-start gap-2 text-xs ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <input type="checkbox" className="mt-0.5 w-4 h-4 accent-[#FA7014]" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span><span className="font-semibold text-slate-700">{label}</span>{hint && <span className="block text-slate-400">{hint}</span>}</span>
  </label>
);

/** Minutes are stored; people think in hours. */
const HoursInput: React.FC<{ minutes: number; onChange: (m: number) => void }> = ({ minutes, onChange }) => (
  <div className="flex items-center gap-2">
    <input type="number" min={0} step={0.5} className={input} value={minutes ? Math.round((minutes / 60) * 100) / 100 : 0} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 60))} />
    <span className="text-xs text-slate-500">hours</span>
  </div>
);

const typeSummary = (t: any) => [
  t.paid ? 'Paid' : 'Unpaid',
  t.requiresBalance ? 'uses balance' : 'no balance limit',
  t.halfDay ? 'half days OK' : 'full days only',
  t.dayCounting === 'CALENDAR' ? 'counts all days' : 'counts working days',
  t.approval === 'MANAGER' ? 'manager approves' : t.approval === 'HR' ? 'HR approves' : 'manager then HR',
].join(' · ');

export const HrSetup: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [s, setS] = useState<any | null>(null);
  const [configured, setConfigured] = useState(true);
  const [section, setSection] = useState<Section>('basics');
  const [loc, setLoc] = useState(0);
  const [openType, setOpenType] = useState<number | null>(null);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '', optional: false });
  const [saved, setSaved] = useState('');
  const { busy, note, run } = useRunner();

  const load = () => leaveService.settings().then((r) => { setS(r.settings); setSaved(JSON.stringify(r.settings)); setConfigured(r.configured && r.settings.types.length > 0); });
  useEffect(() => { load(); }, []);
  if (!s) return <Skeleton rows={5} />;

  const patch = (p: any) => setS({ ...s, ...p });
  const dirty = JSON.stringify(s) !== saved;
  const save = () => run(async () => {
    if (s.requireApproval) {
      // Policy changes need approval: keep the edit as a draft and go to the Policy changes screen.
      await leaveService.policyDraftSave({ settings: s });
      setSaved(JSON.stringify(s)); setSection('versions');
      return;
    }
    const r = await leaveService.saveSettings(s);
    setS(r.settings); setSaved(JSON.stringify(r.settings)); setConfigured(true); onChanged();
  }, s.requireApproval ? 'Saved as a draft. Add the policy document and send it for approval.' : 'Saved. New rules apply from now on. Leave already credited is not changed.');
  const discard = () => setS(JSON.parse(saved));

  if (!configured) {
    return (
      <Card title="Set up leave for your company" subtitle="Takes 2 minutes. Start from a ready template and change anything later.">
        <ul className="text-xs text-slate-600 list-disc pl-5 space-y-0.5 mb-4">
          <li>Leave types: casual, sick, earned, comp-off, maternity, bereavement, loss of pay</li>
          <li>National holidays, Sunday weekly off, a 9:30–18:30 shift</li>
          <li>One default policy for everyone</li>
        </ul>
        <div className="text-xs font-bold text-slate-700 mb-2">When does your leave year start?</div>
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await leaveService.applyStarter({ yearStartMonth: 4 }); await load(); onChanged(); }, 'Template applied. Check the sections below.')}>April (financial year)</button>
          <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await leaveService.applyStarter({ yearStartMonth: 1 }); await load(); onChanged(); }, 'Template applied. Check the sections below.')}>January (calendar year)</button>
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
  const saveBtn = <button className={btnPrimary} disabled={busy || !dirty} onClick={save}>Save changes</button>;

  return (
    <div className="grid lg:grid-cols-[15rem_1fr] gap-4 items-start">
      {/* section nav: list on desktop, scrollable pills on phones */}
      <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible -mx-1 px-1 lg:sticky lg:top-2" aria-label="Settings sections">
        {SECTIONS.map(({ key, label, hint, icon: Icon }) => (
          <button key={key} onClick={() => setSection(key)}
            className={`shrink-0 text-left rounded-xl px-3 py-2 flex items-start gap-2 border ${section === key ? 'bg-white border-[#FA7014]/50 shadow-sm' : 'border-transparent hover:bg-white/70'}`}>
            <Icon className={`w-4 h-4 mt-0.5 ${section === key ? 'text-[#FA7014]' : 'text-slate-400'}`} />
            <span><span className={`block text-xs font-bold whitespace-nowrap ${section === key ? 'text-slate-900' : 'text-slate-600'}`}>{label}</span><span className="hidden lg:block text-[11px] text-slate-400">{hint}</span></span>
          </button>
        ))}
      </nav>

      <div className="space-y-4 min-w-0">
        {note?.tone === 'error' && <Notice tone="error">{note.text}</Notice>}

        {section === 'versions' && <PolicyChanges onChanged={() => { load(); onChanged(); }} />}

        {section === 'basics' && (
          <Card title="Leave year & approvals" right={saveBtn}>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 max-w-3xl">
              <Field label="Leave year starts in" hint="Balances reset and carry forward on this month">
                <select className={input} value={s.yearStartMonth} onChange={(e) => patch({ yearStartMonth: Number(e.target.value) })}>
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}{i === 0 ? ' (calendar year)' : i === 3 ? ' (financial year)' : ''}</option>)}
                </select>
              </Field>
              <Field label="Weekends inside a leave" hint="Example: off Friday and Monday. Do Saturday and Sunday count as leave too?">
                <select className={input} value={s.sandwichRule ? '1' : '0'} onChange={(e) => patch({ sandwichRule: e.target.value === '1' })}>
                  <option value="0">No, only count working days</option><option value="1">Yes, count them as leave (sandwich rule)</option>
                </select>
              </Field>
              <Field label="Also send to HR when leave is longer than" hint="0 = only for leave types set to need HR">
                <div className="flex items-center gap-2"><input type="number" min={0} className={input} value={s.hrApprovalAboveDays} onChange={(e) => patch({ hrApprovalAboveDays: num(e.target.value) })} /><span className="text-xs text-slate-500">days</span></div>
              </Field>
              <Field label="Probation lasts" hint="Counted from the joining date. Leave types can be switched off during probation. 0 = no probation rule">
                <div className="flex items-center gap-2"><input type="number" min={0} className={input} value={s.probationDays || 0} onChange={(e) => patch({ probationDays: num(e.target.value) })} /><span className="text-xs text-slate-500">days</span></div>
              </Field>
              <Field label="Year end" hint="With review on, carry-forward, lapse and pay-out wait until HR signs off the year in Manage > Year end">
                <select className={input} value={s.yearEndSignoff ? '1' : '0'} onChange={(e) => patch({ yearEndSignoff: e.target.value === '1' })}>
                  <option value="0">Process automatically on the first day of the new year</option><option value="1">HR reviews and signs off first</option>
                </select>
              </Field>
              <Field label="Remind HR if a request waits more than" hint="0 = never remind">
                <div className="flex items-center gap-2"><input type="number" min={0} className={input} value={s.escalateAfterDays} onChange={(e) => patch({ escalateAfterDays: num(e.target.value) })} /><span className="text-xs text-slate-500">days</span></div>
              </Field>
              <Field label="HR email addresses" hint="These get alerts and reminders. Separate with commas.">
                <input className={input} placeholder="hr@company.com, head.hr@company.com" value={s.notifyEmails.join(', ')} onChange={(e) => patch({ notifyEmails: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} />
              </Field>
            </div>
          </Card>
        )}

        {section === 'hours' && (
          <Card title="Working hours" subtitle="Used to mark people present, late or half day." right={saveBtn}>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 max-w-3xl">
              <Field label="Shift starts"><input type="time" className={input} value={s.shift.start} onChange={(e) => patch({ shift: { ...s.shift, start: e.target.value } })} /></Field>
              <Field label="Shift ends"><input type="time" className={input} value={s.shift.end} onChange={(e) => patch({ shift: { ...s.shift, end: e.target.value } })} /></Field>
              <Field label="Late after" hint={`Checking in after ${s.shift.start} plus this many minutes counts as late`}>
                <div className="flex items-center gap-2"><input type="number" min={0} className={input} value={s.shift.graceMinutes} onChange={(e) => patch({ shift: { ...s.shift, graceMinutes: num(e.target.value) } })} /><span className="text-xs text-slate-500">minutes</span></div>
              </Field>
              <Field label="Cut half a day's pay for every" hint="Example: 3 = every 3 late marks cost half a day. 0 = no cut.">
                <div className="flex items-center gap-2"><input type="number" min={0} className={input} value={s.lateMarksPerHalfDay} onChange={(e) => patch({ lateMarksPerHalfDay: num(e.target.value) })} /><span className="text-xs text-slate-500">late marks</span></div>
              </Field>
              <Field label="Attendance cycle starts on day" hint="1 = the calendar month. 26 = from the 26th to the 25th. Used by the Regularization page.">
                <div className="flex items-center gap-2"><input type="number" min={1} max={28} className={input} value={s.cycleStartDay || 1} onChange={(e) => patch({ cycleStartDay: Math.min(28, Math.max(1, num(e.target.value) || 1)) })} /><span className="text-xs text-slate-500">of the month</span></div>
              </Field>
              <Field label="Work this long for a full day" hint="Less than this (but more than a half day) = half day"><HoursInput minutes={s.shift.fullDayMinutes} onChange={(m) => patch({ shift: { ...s.shift, fullDayMinutes: m } })} /></Field>
              <Field label="Half day from (reference)" hint="Any time worked below the full day counts as a half day; only no time worked is absent"><HoursInput minutes={s.shift.halfDayMinutes} onChange={(m) => patch({ shift: { ...s.shift, halfDayMinutes: m } })} /></Field>
              <div className="md:col-span-2">
                <Field label="Only allow check-in from the office network (optional)" hint="Office internet IP addresses, comma separated. Leave empty to allow check-in from anywhere. Ending with a dot (e.g. 103.21.) allows the whole range.">
                  <input className={input} placeholder="Empty = anywhere" value={s.allowedIps.join(', ')} onChange={(e) => patch({ allowedIps: e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean) })} />
                </Field>
              </div>
            </div>
          </Card>
        )}

        {section === 'locations' && (
          <Card title="Offices & holidays" subtitle="Each office can have its own weekly offs and holidays. People are linked to an office in People." right={
            <div className="flex flex-wrap gap-2 justify-end">
              {s.locations.length > 1 && <select className="border border-slate-300 rounded-lg px-2 py-1 text-xs" value={loc} onChange={(e) => setLoc(Number(e.target.value))} aria-label="Office">{s.locations.map((l: any, i: number) => <option key={l.id + i} value={i}>{l.name}</option>)}</select>}
              <button className={btnGhost} onClick={() => { patch({ locations: [...s.locations, { id: '', name: `Office ${s.locations.length + 1}`, weeklyOff: { '0': 'ALL' }, holidays: [] }] }); setLoc(s.locations.length); }}>Add office</button>
              {saveBtn}
            </div>}>
            {!location ? <div className="text-xs text-slate-500">Add an office.</div> : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="max-w-xs flex-1"><Field label="Office name"><input className={input} value={location.name} onChange={(e) => setLocation({ name: e.target.value })} /></Field></div>
                  {s.locations.length > 1 && <button className={btnDanger} onClick={() => { patch({ locations: s.locations.filter((_: any, i: number) => i !== loc) }); setLoc(0); }}>Remove office</button>}
                </div>
                <div><div className="text-xs font-bold text-slate-700 mb-2">Weekly offs</div><WeeklyOffEditor value={location.weeklyOff} onChange={(v) => setLocation({ weeklyOff: v })} /></div>
                <div>
                  <div className="text-xs font-bold text-slate-700 mb-2">Holidays ({location.holidays.length})</div>
                  <div className="flex flex-wrap gap-2 items-end mb-2">
                    <input type="date" aria-label="Holiday date" className={`${input} max-w-[10rem]`} value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} />
                    <input className={`${input} max-w-xs`} placeholder="e.g. Diwali" value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} />
                    <label className="text-xs flex items-center gap-1"><input type="checkbox" className="accent-[#FA7014]" checked={newHoliday.optional} onChange={(e) => setNewHoliday({ ...newHoliday, optional: e.target.checked })} /> Optional</label>
                    <button className={btnGhost} disabled={!newHoliday.date || !newHoliday.name.trim()} onClick={() => { setLocation({ holidays: [...location.holidays.filter((h: any) => h.date !== newHoliday.date), newHoliday].sort((a: any, b: any) => a.date.localeCompare(b.date)) }); setNewHoliday({ date: '', name: '', optional: false }); }}>Add holiday</button>
                    <label className={`${btnGhost} cursor-pointer`}>Import from CSV
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
                  <p className="text-[11px] text-slate-400 mb-2">CSV columns: date (YYYY-MM-DD), name, optional (yes/no). Festival dates change every year, so add them each year.</p>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                    {location.holidays.length === 0 && <div className="p-3 text-xs text-slate-500">No holidays yet.</div>}
                    {location.holidays.map((h: any) => (
                      <div key={h.date} className="flex justify-between items-center px-3 py-1.5 text-xs">
                        <span><b className="text-slate-700">{niceDate(h.date)}</b> <span className="text-slate-400">{dayName(h.date)}</span> · {h.name}{h.optional ? ' (optional)' : ''}</span>
                        <button className="text-rose-600 font-semibold" onClick={() => setLocation({ holidays: location.holidays.filter((x: any) => x.date !== h.date) })}>Remove</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {section === 'types' && (
          <Card title="Leave types" subtitle="Click a type to change its rules. Save after adding a type, then add it to a policy." right={
            <div className="flex gap-2">
              <button className={btnGhost} onClick={() => { patch({ types: [...s.types, { id: '', code: 'NEW', name: 'New leave type', paid: true, active: true, requiresBalance: true, halfDay: true, dayCounting: 'WORKING', minNoticeDays: 0, maxDaysPerRequest: 0, docRequiredAfterDays: 0, gender: 'ANY', minServiceDays: 0, allowNegative: false, approval: 'MANAGER' }] }); setOpenType(s.types.length); }}>Add type</button>
              {saveBtn}
            </div>}>
            <div className="space-y-2">
              {s.types.map((t: any, i: number) => {
                const open = openType === i;
                return (
                  <div key={t.id + i} className={`border rounded-xl ${open ? 'border-[#FA7014]/50' : 'border-slate-200'} ${t.active ? '' : 'opacity-60'}`}>
                    <button className="w-full flex items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpenType(open ? null : i)} aria-expanded={open}>
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 w-12 text-center">{t.code}</span>
                      <span className="flex-1 min-w-0"><span className="block text-sm font-bold text-slate-800">{t.name}{!t.active && <span className="text-xs font-normal text-slate-400"> (switched off)</span>}</span><span className="block text-[11px] text-slate-500 truncate">{typeSummary(t)}</span></span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="border-t border-slate-100 p-3 space-y-4">
                        <div className="grid sm:grid-cols-3 gap-3">
                          <Field label="Name"><input className={input} value={t.name} onChange={(e) => setType(i, { name: e.target.value })} /></Field>
                          <Field label="Short code" hint="Shown on reports, e.g. CL"><input className={input} value={t.code} onChange={(e) => setType(i, { code: e.target.value.toUpperCase() })} /></Field>
                          <Field label="Who approves">
                            <select className={input} value={t.approval} onChange={(e) => setType(i, { approval: e.target.value })}><option value="MANAGER">Manager</option><option value="MANAGER_HR">Manager, then HR</option><option value="HR">HR only</option></select>
                          </Field>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
                          <Check checked={t.active} onChange={(v) => setType(i, { active: v })} label="Switched on" hint="Off = people can no longer apply for it" />
                          <Check checked={t.paid} onChange={(v) => setType(i, { paid: v })} label="Paid leave" />
                          <Check checked={t.requiresBalance} disabled={t.isLop} onChange={(v) => setType(i, { requiresBalance: v })} label="Uses a balance" hint="Off = no limit, e.g. loss of pay" />
                          <Check checked={t.halfDay} onChange={(v) => setType(i, { halfDay: v })} label="Half days allowed" />
                          <Check checked={t.allowNegative} onChange={(v) => setType(i, { allowNegative: v })} label="Can borrow from future balance" hint="Balance may go below zero" />
                          <Check checked={!!t.blockInProbation} onChange={(v) => setType(i, { blockInProbation: v })} label="Not during probation" hint="Set the probation length in Leave year & approvals" />
                          <Check checked={!!t.blockInNotice} onChange={(v) => setType(i, { blockInNotice: v })} label="Not during notice period" hint="Blocked once a resignation is approved" />
                          <Check checked={t.dayCounting === 'CALENDAR'} onChange={(v) => setType(i, { dayCounting: v ? 'CALENDAR' : 'WORKING' })} label="Count weekends and holidays too" hint="On for maternity-style leave" />
                        </div>
                        <div className="grid sm:grid-cols-3 gap-3">
                          <Field label="Apply at least … days before" hint="0 = any time"><input type="number" min={0} className={input} value={t.minNoticeDays} onChange={(e) => setType(i, { minNoticeDays: num(e.target.value) })} /></Field>
                          <Field label="Most days in one request" hint="0 = no limit"><input type="number" min={0} className={input} value={t.maxDaysPerRequest} onChange={(e) => setType(i, { maxDaysPerRequest: num(e.target.value) })} /></Field>
                          <Field label="Need a document after … days" hint="0 = never"><input type="number" min={0} className={input} value={t.docRequiredAfterDays} onChange={(e) => setType(i, { docRequiredAfterDays: num(e.target.value) })} /></Field>
                          <Field label="Only after working … days" hint="Probation, 0 = from day one"><input type="number" min={0} className={input} value={t.minServiceDays} onChange={(e) => setType(i, { minServiceDays: num(e.target.value) })} /></Field>
                          <Field label="Who can take it"><select className={input} value={t.gender} onChange={(e) => setType(i, { gender: e.target.value })}><option value="ANY">Everyone</option><option value="F">Women only</option><option value="M">Men only</option></select></Field>
                          <Field label="Its year starts in"><select className={input} value={t.startMonth || 0} onChange={(e) => setType(i, { startMonth: Number(e.target.value) || undefined })}><option value={0}>Same as company</option>{MONTHS.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}</select></Field>
                        </div>
                        <div className="flex justify-end">
                          <button className={btnDanger} onClick={() => { if (!window.confirm(`Remove ${t.name}? It will also be taken out of every policy.`)) return; patch({ types: s.types.filter((_: any, j: number) => j !== i), policies: s.policies.map((p: any) => ({ ...p, entries: p.entries.filter((en: any) => en.typeId !== t.id) })) }); setOpenType(null); }}>Remove this type</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Statutory leave such as maternity should be checked with your labour-law advisor.</p>
          </Card>
        )}

        {section === 'policies' && (
          <Card title="Leave policies" subtitle="A policy says how many days of each type a group of people gets. Link people to a policy in People." right={
            <div className="flex gap-2"><button className={btnGhost} onClick={() => patch({ policies: [...s.policies, { id: '', name: `Policy ${s.policies.length + 1}`, isDefault: s.policies.length === 0, entries: [] }] })}>Add policy</button>{saveBtn}</div>}>
            <div className="space-y-4">
              {s.policies.map((p: any, pi: number) => (
                <div key={p.id + pi} className="border border-slate-200 rounded-xl p-3">
                  <div className="flex flex-wrap items-end gap-3 mb-3">
                    <div className="max-w-xs flex-1"><Field label="Policy name"><input className={input} value={p.name} onChange={(e) => setPolicy(pi, { name: e.target.value })} /></Field></div>
                    <label className="text-xs flex items-center gap-1.5 pb-2"><input type="radio" className="accent-[#FA7014]" checked={!!p.isDefault} onChange={() => patch({ policies: s.policies.map((x: any, j: number) => ({ ...x, isDefault: j === pi })) })} /> New people get this one</label>
                    {s.policies.length > 1 && <button className={btnDanger} onClick={() => patch({ policies: s.policies.filter((_: any, j: number) => j !== pi) })}>Remove</button>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full min-w-[640px]">
                      <thead className="text-left text-slate-500"><tr><th className="p-1">Leave type</th><th className="p-1">Days a year</th><th className="p-1">How days are added</th><th className="p-1">Unused days</th><th className="p-1">Carry at most</th><th className="p-1">Pay out up to</th><th /></tr></thead>
                      <tbody>
                        {p.entries.map((en: any, ei: number) => {
                          const t = s.types.find((x: any) => x.id === en.typeId);
                          const setEntry = (q: any) => setPolicy(pi, { entries: p.entries.map((x: any, j: number) => (j === ei ? { ...x, ...q } : x)) });
                          return (
                            <tr key={en.typeId} className="border-t border-slate-100">
                              <td className="p-1 font-semibold text-slate-700">{t?.name || en.typeId}</td>
                              <td className="p-1 w-24"><input type="number" min={0} className={input} value={en.quota} onChange={(e) => setEntry({ quota: num(e.target.value) })} /></td>
                              <td className="p-1"><select className={input} value={en.accrual} onChange={(e) => setEntry({ accrual: e.target.value })}><option value="UPFRONT">All at start of year</option><option value="MONTHLY">A little every month</option><option value="QUARTERLY">Every 3 months</option><option value="NONE">Only when HR adds them</option></select></td>
                              <td className="p-1"><select className={input} value={en.carryForward ? '1' : '0'} onChange={(e) => setEntry({ carryForward: e.target.value === '1' })}><option value="0">Expire at year end</option><option value="1">Carry to next year</option></select></td>
                              <td className="p-1 w-24"><input type="number" min={0} className={input} disabled={!en.carryForward} value={en.carryCap} onChange={(e) => setEntry({ carryCap: num(e.target.value) })} title="0 = no limit" /></td>
                              <td className="p-1 w-24"><input type="number" min={0} className={input} value={en.encashCap || 0} onChange={(e) => setEntry({ encashCap: num(e.target.value) })} title="Days above the carry limit that are paid out at year end instead of expiring. 0 = none" /></td>
                              <td className="p-1"><button className="text-rose-600 font-semibold" onClick={() => setPolicy(pi, { entries: p.entries.filter((_: any, j: number) => j !== ei) })}>Remove</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <select className="mt-2 border border-slate-300 rounded-lg px-2 py-1.5 text-xs" value="" onChange={(e) => e.target.value && setPolicy(pi, { entries: [...p.entries, { typeId: e.target.value, quota: 0, accrual: 'UPFRONT', carryForward: false, carryCap: 0 }] })}>
                    <option value="">+ Add a leave type to this policy</option>
                    {s.types.filter((t: any) => t.id && !p.entries.some((en: any) => en.typeId === t.id)).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>
        )}

        {dirty && (
          <div className="sticky bottom-3 z-20">
            <div className="mx-auto max-w-3xl rounded-xl border border-slate-300 bg-white shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
              <CalendarRange className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-700 flex-1">You have unsaved changes. They apply to all sections.</span>
              <button className={btnGhost} disabled={busy} onClick={discard}>Discard</button>
              <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
