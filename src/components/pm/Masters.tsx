import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { User } from '../../types';
import { Loading, Pill } from '../common/loadUi';
import { Card, Field, Notice, btnBig, btnGhost, btnPrimary, btnDanger, input, useRunner, ConfirmButton } from '../leave/ui';
import { Empty, Explain, Intro, Note, ResultNote, StatusChip, Tabs } from './common';
import { PlanList } from './Team';

const CATS: Record<string, string> = { CORE: 'Everyone', MANAGER: 'Managers', BUSINESS_DEVELOPMENT: 'Business development', TECHNICAL: 'Technical', CREATIVE: 'Creative' };

// ------------------------------------------------------------------ behaviours (competencies) and roles

export const CompsRoles: React.FC = () => {
  const [tab, setTab] = useState('comps'); const [comps, setComps] = useState<any[] | null>(null); const [roles, setRoles] = useState<any[]>([]); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>(null); const [role, setRole] = useState<any>(null); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('comp-list').then((r) => setComps(r.items)); pmService.get('role-list').then((r) => setRoles(r.items)); }, [tick]);
  if (!comps) return <Loading loading />;
  return (
    <div>
      <Intro title="Behaviours & roles" what="Behaviours are how people are expected to work (Teamwork, Ownership...). Roles are the job titles. Each role gets a set of behaviours." todo="Fill in any behaviour marked 'needs a definition', then check each role's behaviours." />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'comps', label: 'Behaviours', count: comps.length }, { key: 'roles', label: 'Roles', count: roles.length }]} />
      <ResultNote note={note} />
      {tab === 'comps' && (<>
        {comps.length === 0 && <Notice tone="info">Nothing yet. Open "Start here" and press "Load the standard set-up".</Notice>}
        {comps.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><div className="text-sm font-bold text-slate-800">{c.name} <Pill tone="slate">{CATS[c.category] || c.category}</Pill> {c.needsDefinition && <Pill tone="amber">needs a definition</Pill>}</div><div className="text-xs text-slate-500">{c.standard || 'No standard written yet. The standard says what "good" looks like.'}</div></div>
            <div className="flex gap-2"><button className={btnGhost} onClick={() => setForm({ ...c })}>Edit</button><ConfirmButton className={btnDanger} question="Delete?" yes="Delete" onConfirm={() => run(async () => { await pmService.post('comp-delete', { id: c.id }); setTick((t) => t + 1); })}><Trash2 className="w-4 h-4" /></ConfirmButton></div>
          </div>))}
        {!form ? <button className={btnPrimary} onClick={() => setForm({ name: '', category: 'CORE', standard: '', exampleEvidence: '', definition: '' })}><Plus className="w-4 h-4" />Add a behaviour</button> : (
          <Card title={form.id ? 'Edit behaviour' : 'New behaviour'}><div className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3"><Field label="Name"><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Who is it for?"><select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
            <Note label="What does 'good' look like? (the standard)" value={form.standard} onChange={(v) => setForm({ ...form, standard: v })} rows={2} />
            <Note label="What evidence would show it? (examples)" value={form.exampleEvidence} onChange={(v) => setForm({ ...form, exampleEvidence: v })} rows={2} />
            <ResultNote note={note} /><div className="flex gap-2"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('comp-save', form); setForm(null); setTick((t) => t + 1); }, 'Saved.')}>Save</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div></div></Card>
        )}
      </>)}
      {tab === 'roles' && (<>
        <div className="flex gap-2 mb-3"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await pmService.post('role-auto'); setTick((t) => t + 1); }, 'Roles refreshed from your people list.')}>Create roles from my people list</button></div>
        {roles.length === 0 && <Empty text="No roles yet." />}
        {roles.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-2 flex flex-wrap items-center justify-between gap-2">
            <div><div className="text-sm font-bold text-slate-800">{r.name} <span className="text-xs text-slate-400 font-medium">{r.department}</span></div><div className="text-xs text-slate-500">{r.people} people - {r.competencyIds.length} behaviours - {r.sopCount} SOPs - {r.hasTemplate ? 'has approved KRA/KPI' : 'no approved KRA/KPI yet'}</div></div>
            <button className={btnGhost} onClick={() => setRole({ ...r, sel: Object.fromEntries(r.competencyIds.map((x: any) => [x.competencyId, x])) })}>Choose behaviours</button>
          </div>))}
        {role && (
          <Card title={`Behaviours for ${role.name}`} subtitle="Tick the behaviours this role is judged on. Level 3 means 'meets expectations'. Weight 1 is normal; use 2 for something that matters twice as much.">
            <div className="space-y-1.5 max-h-80 overflow-auto">{comps.map((c) => { const x = role.sel[c.id]; return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-2 flex-1 min-w-[200px]"><input type="checkbox" checked={!!x} onChange={(e) => { const sel = { ...role.sel }; if (e.target.checked) sel[c.id] = { competencyId: c.id, expectedLevel: 3, weight: 1 }; else delete sel[c.id]; setRole({ ...role, sel }); }} />{c.name}</label>
                {x && <><span className="text-xs text-slate-500">Level</span><input className={`${input} !w-16`} value={x.expectedLevel} onChange={(e) => setRole({ ...role, sel: { ...role.sel, [c.id]: { ...x, expectedLevel: e.target.value } } })} /><span className="text-xs text-slate-500">Weight</span><input className={`${input} !w-16`} value={x.weight} onChange={(e) => setRole({ ...role, sel: { ...role.sel, [c.id]: { ...x, weight: e.target.value } } })} /></>}</div>); })}</div>
            <ResultNote note={note} /><div className="flex gap-2 mt-3"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('rolecomp-save', { roleId: role.id, competencies: Object.values(role.sel) }); setRole(null); setTick((t) => t + 1); }, 'Saved.')}>Save</button><button className={btnGhost} onClick={() => setRole(null)}>Cancel</button></div>
          </Card>
        )}
      </>)}
    </div>
  );
};

// ------------------------------------------------------------------ SOPs

export const Sops: React.FC<{ users: User[] }> = ({ users }) => {
  const [items, setItems] = useState<any[] | null>(null); const [roles, setRoles] = useState<any[]>([]); const [docs, setDocs] = useState<any[]>([]); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>(null); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('sop-list').then((r) => setItems(r.items)); pmService.get('role-list').then((r) => setRoles(r.items)); pmService.get('sop-docs').then((r) => setDocs(r.items)).catch(() => {}); }, [tick]);
  if (!items) return <Loading loading />;
  const depts = Array.from(new Set([...(users as any[]).map((u) => u.department), ...roles.map((r) => r.department)].filter(Boolean))) as string[];
  const set = (p: any) => setForm({ ...form, ...p });
  return (
    <div>
      <Intro title="Processes (SOPs)" what="The approved step-by-step processes each department follows. Link each one to a published document, say which roles follow it, and list the controls a manager can check." todo="Add an SOP, or press 'Update from documents' after publishing a new version." />
      <ResultNote note={note} />
      <div className="flex gap-2 mb-3"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('sop-sync'); setTick((t) => t + 1); }, 'Checked against your published documents.')}>Update from documents</button></div>
      {items.length === 0 && <Empty text="No SOPs yet." />}
      {items.map((s) => (
        <div key={s.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><div className="text-sm font-bold text-slate-800">{s.title} <span className="text-xs text-slate-400">v{s.versionNumber || '-'}</span> {s.criticality === 'CRITICAL' && <Pill tone="red">critical</Pill>}</div><div className="text-xs text-slate-500">{s.department} - {s.roleIds.length} role(s) - {s.checkpoints?.length || 0} controls - {s.acknowledged}/{s.assigned} acknowledged</div></div>
          <div className="flex gap-2"><StatusChip status={s.status} /><button className={btnGhost} onClick={() => setForm({ ...s })}>Edit</button><ConfirmButton className={btnDanger} question="Retire / delete?" yes="Yes" onConfirm={() => run(async () => { await pmService.post('sop-delete', { id: s.id }); setTick((t) => t + 1); })}><Trash2 className="w-4 h-4" /></ConfirmButton></div>
        </div>))}
      {!form ? <button className={btnPrimary} onClick={() => setForm({ title: '', department: '', documentId: '', criticality: 'NORMAL', acknowledgementRequired: true, trainingRequired: false, managerVerificationRequired: false, roleIds: [], checkpoints: [{ control: '', critical: false }] })}><Plus className="w-4 h-4" />Add an SOP</button> : (
        <Card title={form.id ? 'Edit SOP' : 'New SOP'}><div className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Title"><input className={input} value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Department"><select className={input} value={form.department} onChange={(e) => set({ department: e.target.value })}><option value="">Choose...</option>{depts.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Linked document (optional)" hint="Only published documents from Document Governance are listed."><select className={input} value={form.documentId || ''} onChange={(e) => set({ documentId: e.target.value })}><option value="">None</option>{docs.map((d) => <option key={d.documentId} value={d.documentId}>{d.title} (v{d.versionNumber})</option>)}</select></Field>
            <Field label="Process owner"><select className={input} value={form.processOwnerUid || ''} onChange={(e) => set({ processOwnerUid: e.target.value })}><option value="">None</option>{users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="How important?"><select className={input} value={form.criticality} onChange={(e) => set({ criticality: e.target.value })}><option value="NORMAL">Normal</option><option value="CRITICAL">Critical (failures are never averaged away)</option></select></Field>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">{[['acknowledgementRequired', 'Employees must acknowledge'], ['trainingRequired', 'Training required'], ['managerVerificationRequired', 'Manager must verify']].map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!!form[k]} onChange={(e) => set({ [k]: e.target.checked })} />{l}</label>)}</div>
          <div><div className="text-xs font-bold text-slate-600 mb-1">Which roles follow it?</div><div className="flex flex-wrap gap-x-4 gap-y-1 max-h-32 overflow-auto">{roles.filter((r) => !form.department || r.department === form.department || true).map((r) => <label key={r.id} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={form.roleIds.includes(r.id)} onChange={(e) => set({ roleIds: e.target.checked ? [...form.roleIds, r.id] : form.roleIds.filter((x: string) => x !== r.id) })} />{r.name} <span className="text-xs text-slate-400">{r.department}</span></label>)}</div></div>
          <div className="space-y-2"><div className="text-xs font-bold text-slate-600">Controls a manager can check (for example "Budget approved before launch")</div>
            {form.checkpoints.map((cp: any, i: number) => <div key={i} className="flex gap-2 items-center"><input className={input} value={cp.control} onChange={(e) => set({ checkpoints: form.checkpoints.map((x: any, j: number) => (j === i ? { ...x, control: e.target.value } : x)) })} /><label className="text-xs flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={!!cp.critical} onChange={(e) => set({ checkpoints: form.checkpoints.map((x: any, j: number) => (j === i ? { ...x, critical: e.target.checked } : x)) })} />critical</label><button className={btnGhost} onClick={() => set({ checkpoints: form.checkpoints.filter((_: any, j: number) => j !== i) })}>x</button></div>)}
            <button className={btnGhost} onClick={() => set({ checkpoints: [...form.checkpoints, { control: '', critical: false }] })}><Plus className="w-4 h-4" />Add control</button></div>
          <ResultNote note={note} /><div className="flex gap-2"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('sop-save', form); setForm(null); setTick((t) => t + 1); }, 'Saved. Assignments will update.')}>Save</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div></div></Card>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ KRA/KPI by role

export const Templates: React.FC<{ canApprove: boolean }> = ({ canApprove }) => {
  const [tpls, setTpls] = useState<any[] | null>(null); const [roles, setRoles] = useState<any[]>([]); const [sops, setSops] = useState<any[]>([]); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>(null); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('tpl-list').then((r) => setTpls(r.items)); pmService.get('role-list').then((r) => setRoles(r.items)); pmService.get('sop-list').then((r) => setSops(r.items)); }, [tick]);
  if (!tpls) return <Loading loading />;
  const rows = form?.items || []; const total = rows.reduce((s: number, r: any) => s + (Number(r.weightage) || 0), 0);
  const upd = (i: number, p: any) => setForm({ ...form, items: rows.map((r: any, j: number) => (j === i ? { ...r, ...p } : r)) });
  return (
    <div>
      <Intro title="KRA/KPI by role" what="For each job role, write what results are expected (KRA) and how each is measured (KPI). When someone joins that role they get these automatically, and their manager sets the exact targets." todo="Pick a role, add lines whose weights add up to 100, save, then ask an approver to approve." />
      <ResultNote note={note} />
      {tpls.map((t) => (
        <div key={t.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><div className="text-sm font-bold text-slate-800">{t.roleName} <span className="text-xs text-slate-400">v{t.version} - {t.department}</span></div><div className="text-xs text-slate-500">{t.items.length} lines</div></div>
          <div className="flex gap-2 items-center"><StatusChip status={t.status} />{t.status === 'DRAFT' && canApprove && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('tpl-approve', { id: t.id }); setTick((x) => x + 1); }, 'Approved.')}>Approve</button>}
            <button className={btnGhost} onClick={() => setForm({ id: t.status === 'DRAFT' ? t.id : '', roleId: t.roleId, items: t.items.map((x: any) => ({ ...x })) })}>{t.status === 'APPROVED' ? 'Change (new version)' : 'Edit'}</button>
            {t.status === 'DRAFT' && <ConfirmButton className={btnDanger} question="Delete draft?" yes="Delete" onConfirm={() => run(async () => { await pmService.post('tpl-delete', { id: t.id }); setTick((x) => x + 1); })}><Trash2 className="w-4 h-4" /></ConfirmButton>}</div>
        </div>))}
      {!form ? <button className={btnPrimary} onClick={() => setForm({ roleId: '', items: [{ kraName: '', kpiName: '', measurement: '', weightage: '', frequency: 'MONTHLY', evidenceSource: 'TASK_SYSTEM' }] })}><Plus className="w-4 h-4" />New template for a role</button> : (
        <Card title="Template"><div className="space-y-3">
          <Field label="Role"><select className={input} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}><option value="">Choose a role...</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name} - {r.department}</option>)}</select></Field>
          {rows.map((r: any, i: number) => (
            <div key={i} className="border border-slate-200 rounded-lg p-3 grid md:grid-cols-12 gap-2">
              <div className="md:col-span-3"><input className={input} placeholder="Responsibility (KRA)" value={r.kraName} onChange={(e) => upd(i, { kraName: e.target.value })} /></div>
              <div className="md:col-span-3"><input className={input} placeholder="Measure (KPI)" value={r.kpiName} onChange={(e) => upd(i, { kpiName: e.target.value })} /></div>
              <div className="md:col-span-3"><input className={input} placeholder="How it is measured" value={r.measurement} onChange={(e) => upd(i, { measurement: e.target.value })} /></div>
              <div className="md:col-span-2"><input className={input} placeholder="Weight %" value={r.weightage} onChange={(e) => upd(i, { weightage: e.target.value })} /></div>
              <button className={btnGhost} onClick={() => setForm({ ...form, items: rows.filter((_: any, j: number) => j !== i) })}>x</button>
              <div className="md:col-span-4"><select className={input} value={r.frequency} onChange={(e) => upd(i, { frequency: e.target.value })}><option value="WEEKLY">Checked weekly</option><option value="MONTHLY">Checked monthly</option><option value="QUARTERLY">Checked quarterly</option></select></div>
              <div className="md:col-span-4"><select className={input} value={r.evidenceSource} onChange={(e) => upd(i, { evidenceSource: e.target.value })}><option value="TASK_SYSTEM">Evidence: task system</option><option value="DASHBOARD">Evidence: dashboard</option><option value="QA_REVIEW">Evidence: QA review</option><option value="CRM">Evidence: CRM</option><option value="REPORT">Evidence: report</option><option value="OTHER">Evidence: other</option></select></div>
              <div className="md:col-span-4"><select className={input} value={r.sopId || ''} onChange={(e) => upd(i, { sopId: e.target.value })}><option value="">No linked process</option>{sops.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></div>
            </div>))}
          <div className="flex items-center gap-3"><button className={btnGhost} onClick={() => setForm({ ...form, items: [...rows, { kraName: '', kpiName: '', measurement: '', weightage: '', frequency: 'MONTHLY', evidenceSource: 'TASK_SYSTEM' }] })}><Plus className="w-4 h-4" />Add a line</button><span className={`text-sm font-bold ${Math.abs(total - 100) < 0.005 ? 'text-emerald-700' : 'text-rose-700'}`}>Weights total {total}% {Math.abs(total - 100) < 0.005 ? '(good)' : '(must be 100)'}</span></div>
          <ResultNote note={note} /><div className="flex gap-2"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('tpl-save', form); setForm(null); setTick((x) => x + 1); }, 'Saved as a draft. An approver now needs to approve it.')}>Save</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div></div></Card>
      )}
    </div>
  );
};

export const AllPlans: React.FC<{ canApprove: boolean }> = ({ canApprove }) => (
  <PlanList scope="all" who="hr" canApprove={canApprove} title="Everyone's targets" what="Every person's KRA/KPI plan. Plans are created automatically when someone joins, moves department or gets a new manager." todo="Press 'Check for changes', then open any plan marked 'Needs action'." />
);
