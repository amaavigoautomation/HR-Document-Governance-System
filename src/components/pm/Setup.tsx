import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Plus, Trash2, ArrowRight } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { pmNav } from './pmNav';
import { User } from '../../types';
import { Loading, Pill } from '../common/loadUi';
import { Card, Field, Notice, btnBig, btnGhost, btnPrimary, btnDanger, input, useRunner, ConfirmButton } from '../leave/ui';
import { Empty, Explain, Intro, Note, ResultNote, StatusChip, Tabs } from './common';

const GO: Record<string, string> = { framework: 'framework', sops: 'sops', templates: 'templates', plans: 'plans', cycles: 'cycles', evidence: 'evidence', ai: 'governance' };

/** The checklist. One big button always shows the next thing to do. */
export const StartHere: React.FC = () => {
  const [d, setD] = useState<any>(null); const [tick, setTick] = useState(0); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('setup-status').then(setD); }, [tick]);
  if (!d) return <Loading loading />;
  const next = d.steps.find((s: any) => !s.done);
  return (
    <div>
      <Intro title="Start here" what="Seven steps to get Performance running. Do them in order. Each step shows a button that takes you there." todo={next ? `Step ${d.steps.indexOf(next) + 1}: ${next.title}.` : 'Everything is set up.'} />
      <ResultNote note={note} />
      {d.steps.findIndex((s: any) => s.key === 'competency') === 0 && !d.steps[0].done && (
        <Card className="mb-4" title="Quick start (recommended)" subtitle="One press loads the standard behaviours, a starting set of scoring rules (60 / 25 / 15) and your job roles from your people list. Nothing goes live until you approve it.">
          <button className={btnBig} disabled={busy} onClick={() => run(async () => { const r = await pmService.post('quickstart'); setTick((t) => t + 1); pmNav.setSection('framework'); }, 'Done. Now check the scoring rules and approve them.')}>Load the standard set-up</button>
        </Card>
      )}
      <div className="space-y-2">
        {d.steps.map((s: any, i: number) => (
          <div key={s.key} className={`flex items-center gap-3 border rounded-xl px-4 py-3 ${s.done ? 'bg-emerald-50/50 border-emerald-200' : s === next ? 'bg-white border-[#FA7014] shadow-sm' : 'bg-white border-slate-200'}`}>
            {s.done ? <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" /> : <Circle className="w-6 h-6 text-slate-300 shrink-0" />}
            <div className="flex-1 min-w-0"><div className="text-sm font-bold text-slate-800">{i + 1}. {s.title}</div><div className="text-xs text-slate-500">{s.plain}</div><div className="text-xs text-slate-700 mt-0.5">{s.detail}</div></div>
            <button className={s === next ? btnBig : btnGhost} onClick={() => pmNav.setSection(GO[s.key] || s.go)}>{s.done ? 'Open' : 'Go'}<ArrowRight className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      <Explain title="What do the words mean?"><p><b>KRA</b>: an area of responsibility (like "Customer support"). <b>KPI</b>: how it is measured (like "Tickets closed per week"). <b>SOP</b>: an approved step-by-step process. <b>Competency</b>: a behaviour expected at work (like "Teamwork").</p></Explain>
    </div>
  );
};

// ------------------------------------------------------------------ scoring rules (framework)

const CAT: Record<string, string> = { INDIVIDUAL_CONTRIBUTOR: 'Individual contributors', MANAGER: 'Managers', LEADERSHIP: 'Leadership', SALES: 'Sales / business development', SPECIALIST: 'Specialists' };
export const Framework: React.FC<{ canApprove: boolean }> = ({ canApprove }) => {
  const [items, setItems] = useState<any[] | null>(null); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>(null); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('fw-list').then((r) => setItems(r.items)); }, [tick]);
  if (!items) return <Loading loading />;
  const total = form ? (Number(form.kraWeight) || 0) + (Number(form.behaviourWeight) || 0) + (Number(form.sopWeight) || 0) : 0;
  const start = (f?: any) => setForm(f ? { ...f } : { name: '', employeeCategory: 'INDIVIDUAL_CONTRIBUTOR', kraWeight: 60, behaviourWeight: 25, sopWeight: 15, reviewFrequency: 'QUARTERLY', effectiveFrom: new Date().toISOString().slice(0, 10) });
  return (
    <div>
      <Intro title="Scoring rules" what="How much each part of a review counts: results (KRA/KPI), behaviour, and following processes (SOPs). The three must add up to 100." todo="Check the numbers, then ask an approver to approve." />
      <ResultNote note={note} />
      {items.length === 0 && <Notice tone="info">Nothing here yet. Use "Start here" to load a ready-made draft, or add one below.</Notice>}
      <div className="space-y-2 my-3">{items.map((f) => (
        <div key={f.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div><div className="text-sm font-bold text-slate-800">{f.name} <span className="text-xs text-slate-400 font-medium">v{f.version}</span></div>
            <div className="text-xs text-slate-500">{CAT[f.employeeCategory] || 'Everyone'}{f.roleFamily ? ` - ${f.roleFamily}` : ''} - Results {f.kraWeight}% / Behaviour {f.behaviourWeight}% / Processes {f.sopWeight}% - from {f.effectiveFrom}</div></div>
          <div className="flex items-center gap-2"><StatusChip status={f.status} />
            {f.status !== 'RETIRED' && <button className={btnGhost} onClick={() => start(f)}>{f.status === 'APPROVED' ? 'Change (new version)' : 'Edit'}</button>}
            {f.status === 'DRAFT' && canApprove && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('fw-approve', { id: f.id }); setTick((t) => t + 1); }, 'Approved.')}>Approve</button>}
            {f.status === 'DRAFT' && !canApprove && <span className="text-xs text-slate-500">Needs an approver</span>}
            {f.status !== 'RETIRED' && <ConfirmButton className={btnDanger} question={f.status === 'DRAFT' ? 'Delete this draft?' : 'Retire this framework?'} yes="Yes" onConfirm={() => run(async () => { await pmService.post('fw-retire', { id: f.id }); setTick((t) => t + 1); })}><Trash2 className="w-4 h-4" /></ConfirmButton>}</div>
        </div>))}</div>
      {!form ? <button className={btnPrimary} onClick={() => start()}><Plus className="w-4 h-4" />Add scoring rules</button> : (
        <Card title={form.id ? 'Edit scoring rules' : 'New scoring rules'}>
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Name"><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Who is it for?"><select className={input} value={form.employeeCategory} onChange={(e) => setForm({ ...form, employeeCategory: e.target.value })}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="How often are people reviewed?"><select className={input} value={form.reviewFrequency} onChange={(e) => setForm({ ...form, reviewFrequency: e.target.value })}><option value="MONTHLY_CHECKIN">Monthly check-in</option><option value="PROBATION">Probation</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></Field>
            <Field label="Starts on"><input type="date" className={input} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
            <Field label="Results (KRA/KPI) %"><input className={input} value={form.kraWeight} onChange={(e) => setForm({ ...form, kraWeight: e.target.value })} /></Field>
            <Field label="Behaviour %"><input className={input} value={form.behaviourWeight} onChange={(e) => setForm({ ...form, behaviourWeight: e.target.value })} /></Field>
            <Field label="Processes (SOP) %"><input className={input} value={form.sopWeight} onChange={(e) => setForm({ ...form, sopWeight: e.target.value })} /></Field>
            <div className={`text-sm font-bold self-end pb-2 ${Math.abs(total - 100) < 0.005 ? 'text-emerald-700' : 'text-rose-700'}`}>Total: {total}% {Math.abs(total - 100) < 0.005 ? '(good)' : '(must be exactly 100)'}</div>
          </div>
          <ResultNote note={note} />
          <div className="flex gap-2 mt-3"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('fw-save', form); setForm(null); setTick((t) => t + 1); }, 'Saved as a draft.')}>Save</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
        </Card>
      )}
      <Explain><p>Changing approved rules never rewrites history. It makes a new draft version. When approved it takes over from its start date and the old one is kept on record.</p></Explain>
    </div>
  );
};

// ------------------------------------------------------------------ review cycles

export const Cycles: React.FC<{ users: User[]; openReview: (id: string) => void }> = ({ users }) => {
  const [items, setItems] = useState<any[] | null>(null); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>(null); const { busy, note, run } = useRunner(); const [depts, setDepts] = useState<string[]>([]); const [msg, setMsg] = useState('');
  useEffect(() => { pmService.get('cycle-list').then((r) => setItems(r.items)); setDepts(Array.from(new Set(users.map((u: any) => u.department).filter(Boolean))) as string[]); }, [tick, users]);
  if (!items) return <Loading loading />;
  const set = (p: any) => setForm({ ...form, ...p });
  return (
    <div>
      <Intro title="Review cycles" what="A cycle is one round of reviews (for example 'Q4 2026'). Create it, then press 'Open reviews' and everyone gets a review." todo="Create the cycle, set the dates, press Open reviews." />
      <ResultNote note={note} />
      <div className="space-y-2 mb-3">{items.length === 0 && <Empty text="No cycles yet." />}{items.map((c) => (
        <div key={c.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div><div className="text-sm font-bold">{c.name} {c.lockStatus === 'LOCKED' && <Pill tone="slate">locked</Pill>} {c.openedAt && <Pill tone="green">open</Pill>}</div><div className="text-xs text-slate-500">{c.periodStart} to {c.periodEnd} - self-review by {c.selfReviewDeadline || '-'}, manager by {c.managerDeadline || '-'}, HR by {c.hrDeadline || '-'}</div></div>
          <div className="flex gap-2">
            {c.lockStatus !== 'LOCKED' && <ConfirmButton className={btnPrimary} question={c.openedAt ? 'Add any missing people (nobody is duplicated)?' : 'Create a review for everyone covered?'} yes="Yes, open" onConfirm={() => run(async () => { const r = await pmService.post('cycle-open', { id: c.id }); setTick((t) => t + 1); setForm(null); setMsg(r.message); }, undefined)}>{c.openedAt ? 'Add missing reviews' : 'Open reviews'}</ConfirmButton>}
            {c.lockStatus !== 'LOCKED' && <button className={btnGhost} onClick={() => setForm({ ...c })}>Edit</button>}
            <button className={btnGhost} disabled={busy} onClick={() => run(async () => { try { await pmService.post('cycle-lock', { id: c.id, lock: c.lockStatus !== 'LOCKED' }); } catch (e: any) { if (e?.data?.needsConfirm && window.confirm(`${e.message}`)) await pmService.post('cycle-lock', { id: c.id, lock: true, force: true }); else throw e; } setTick((t) => t + 1); }, undefined)}>{c.lockStatus === 'LOCKED' ? 'Unlock' : 'Lock'}</button>
            {!c.openedAt && <ConfirmButton className={btnDanger} question="Delete?" yes="Delete" onConfirm={() => run(async () => { await pmService.post('cycle-delete', { id: c.id }); setTick((t) => t + 1); })}><Trash2 className="w-4 h-4" /></ConfirmButton>}
          </div>
        </div>))}</div>
      {msg && <Notice tone="ok">{msg}</Notice>}
      {!form ? <button className={btnPrimary} onClick={() => setForm({ name: '', reviewType: 'QUARTERLY', scope: 'ALL', departments: [], periodStart: '', periodEnd: '', selfReviewDeadline: '', managerDeadline: '', hrDeadline: '' })}><Plus className="w-4 h-4" />New cycle</button> : (
        <Card title={form.id ? 'Edit cycle' : 'New cycle'}>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Name"><input className={input} value={form.name} placeholder="Q4 2026 review" onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Type"><select className={input} value={form.reviewType} onChange={(e) => set({ reviewType: e.target.value })}><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option><option value="PROBATION">Probation</option><option value="IMPROVEMENT_PLAN">Improvement plan</option><option value="MONTHLY_CHECKIN">Monthly</option></select></Field>
            <Field label="Who is reviewed?"><select className={input} value={form.scope} onChange={(e) => set({ scope: e.target.value })}><option value="ALL">Everyone</option><option value="DEPARTMENT">Some departments</option><option value="SELECTED">Chosen people</option></select></Field>
            <Field label="Period starts"><input type="date" className={input} value={form.periodStart} onChange={(e) => set({ periodStart: e.target.value })} /></Field>
            <Field label="Period ends"><input type="date" className={input} value={form.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} /></Field>
            <div />
            <Field label="Employees finish self-review by"><input type="date" className={input} value={form.selfReviewDeadline} onChange={(e) => set({ selfReviewDeadline: e.target.value })} /></Field>
            <Field label="Managers finish by"><input type="date" className={input} value={form.managerDeadline} onChange={(e) => set({ managerDeadline: e.target.value })} /></Field>
            <Field label="HR finishes by"><input type="date" className={input} value={form.hrDeadline} onChange={(e) => set({ hrDeadline: e.target.value })} /></Field>
          </div>
          {form.scope === 'DEPARTMENT' && <div className="mt-3 flex flex-wrap gap-2">{depts.map((d) => <label key={d} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={form.departments.includes(d)} onChange={(e) => set({ departments: e.target.checked ? [...form.departments, d] : form.departments.filter((x: string) => x !== d) })} />{d}</label>)}</div>}
          {form.scope === 'SELECTED' && <div className="mt-3 max-h-48 overflow-auto grid md:grid-cols-3 gap-1">{users.filter((u) => u.active !== false).map((u) => <label key={u.id} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={(form.employeeUids || []).includes(u.id)} onChange={(e) => set({ employeeUids: e.target.checked ? [...(form.employeeUids || []), u.id] : (form.employeeUids || []).filter((x: string) => x !== u.id) })} />{u.name}</label>)}</div>}
          <ResultNote note={note} />
          <div className="flex gap-2 mt-3"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('cycle-save', form); setForm(null); setTick((t) => t + 1); }, 'Saved. Now press "Open reviews".')}>Save cycle</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
        </Card>
      )}
    </div>
  );
};
