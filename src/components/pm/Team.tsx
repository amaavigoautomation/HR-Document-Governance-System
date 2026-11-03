import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Upload, Copy } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { User } from '../../types';
import { Loading, Pill } from '../common/loadUi';
import { Card, Field, Notice, btnBig, btnGhost, btnPrimary, btnDanger, input, useRunner, ConfirmButton } from '../leave/ui';
import { Empty, Explain, Intro, Note, ResultNote, StatusChip, Tabs } from './common';
import { PlanView } from './Today';

// ------------------------------------------------------------------ plans: set targets, validate, approve

export const PlanEditor: React.FC<{ id: string; who: 'manager' | 'hr' | 'approver'; canApprove?: boolean; done: () => void }> = ({ id, who, canApprove, done }) => {
  const [p, setP] = useState<any>(null); const [tick, setTick] = useState(0); const { busy, note, run } = useRunner(); const [n, setN] = useState(''); const [problems, setProblems] = useState<string[]>([]);
  const [edit, setEdit] = useState<Record<string, any>>({}); const [add, setAdd] = useState<any[]>([]);
  useEffect(() => { pmService.get('plan-get', { id }).then((r) => { setP(r.item); setEdit({}); setAdd([]); }); }, [id, tick]);
  if (!p) return <Loading loading />;
  const editable = ['GENERATED', 'CUSTOMISED'].includes(p.status) && (who === 'manager' || who === 'hr');
  const total = [...p.kpis.map((k: any) => Number(edit[k.id]?.weightage ?? k.weightage) || 0), ...add.map((a) => Number(a.weightage) || 0)].reduce((s, x) => s + x, 0);
  const reload = () => setTick((t) => t + 1);
  const act = (action: string, ok: string) => run(async () => { try { await pmService.post('plan-act', { id: p.id, action, note: n }); setProblems([]); reload(); done(); } catch (e: any) { setProblems(e?.data?.problems || []); throw e; } }, ok);
  const save = () => run(async () => { await pmService.post('plan-save', { id: p.id, targets: Object.entries(edit).map(([targetId, v]: any) => ({ targetId, ...v })), add: add.filter((a) => a.kraName && a.kpiName) }); reload(); }, 'Saved.');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{p.employeeName} - {p.roleName}</span><StatusChip status={p.status} /></div>
      {p.status === 'CONFIGURATION_PENDING' && <Notice tone="warn">Waiting for setup: {(p.configIssues || []).map((i: any) => i.text).join(' ')}</Notice>}
      {!editable ? <PlanView id={p.id} /> : (
        <div className="space-y-2">
          <Notice tone="info">Set a clear <b>target</b> for each line (a number or a plain statement) and make the <b>weights add up to 100</b>. Currently: <b className={Math.abs(total - 100) < 0.01 ? 'text-emerald-700' : 'text-rose-700'}>{total}%</b>.</Notice>
          {p.kpis.map((k: any) => (
            <div key={k.id} className="border border-slate-200 rounded-lg p-3 grid md:grid-cols-12 gap-2 items-end">
              <div className="md:col-span-4"><div className="text-sm font-bold text-slate-800">{k.kpiName}</div><div className="text-xs text-slate-500">{k.kraName} - {k.measurement}</div></div>
              <div className="md:col-span-5"><Field label="Target"><input className={input} defaultValue={k.target} placeholder="e.g. 95% on time" onChange={(e) => setEdit({ ...edit, [k.id]: { ...edit[k.id], target: e.target.value } })} /></Field></div>
              <div className="md:col-span-2"><Field label="Weight %"><input className={input} defaultValue={k.weightage} onChange={(e) => setEdit({ ...edit, [k.id]: { ...edit[k.id], weightage: e.target.value } })} /></Field></div>
              <div className="md:col-span-1"><ConfirmButton className={btnDanger} question="Remove?" yes="Remove" onConfirm={() => run(async () => { await pmService.post('plan-save', { id: p.id, targets: [{ targetId: k.id, remove: true }] }); reload(); })}><Trash2 className="w-4 h-4" /></ConfirmButton></div>
            </div>))}
          {add.map((a, i) => (
            <div key={i} className="border border-dashed border-slate-300 rounded-lg p-3 grid md:grid-cols-12 gap-2">
              <div className="md:col-span-3"><input className={input} placeholder="Responsibility (KRA)" value={a.kraName || ''} onChange={(e) => setAdd(add.map((x, j) => (j === i ? { ...x, kraName: e.target.value } : x)))} /></div>
              <div className="md:col-span-3"><input className={input} placeholder="Measure (KPI)" value={a.kpiName || ''} onChange={(e) => setAdd(add.map((x, j) => (j === i ? { ...x, kpiName: e.target.value } : x)))} /></div>
              <div className="md:col-span-3"><input className={input} placeholder="Target" value={a.target || ''} onChange={(e) => setAdd(add.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} /></div>
              <div className="md:col-span-2"><input className={input} placeholder="Weight %" value={a.weightage || ''} onChange={(e) => setAdd(add.map((x, j) => (j === i ? { ...x, weightage: e.target.value } : x)))} /></div>
              <button className={btnGhost} onClick={() => setAdd(add.filter((_, j) => j !== i))}>x</button>
            </div>))}
          <div className="flex gap-2"><button className={btnGhost} onClick={() => setAdd([...add, {}])}><Plus className="w-4 h-4" />Add a line</button><button className={btnPrimary} disabled={busy} onClick={save}>Save changes</button></div>
        </div>
      )}
      {problems.length > 0 && <Notice tone="warn"><b>Fix these first:</b><ul className="list-disc pl-5">{problems.map((x, i) => <li key={i}>{x}</li>)}</ul></Notice>}
      <ResultNote note={note} />
      <Note label="Note (needed if you send it back)" value={n} onChange={setN} rows={2} />
      <div className="flex flex-wrap gap-2">
        {p.status === 'GENERATED' && <button className={btnBig} disabled={busy} onClick={() => act('submit', 'Sent to HR.')}>Send to HR for checking</button>}
        {p.status === 'CUSTOMISED' && who === 'hr' && <button className={btnBig} disabled={busy} onClick={() => act('validate', 'Validated.')}>HR: validate</button>}
        {p.status === 'VALIDATED' && (who === 'approver' || canApprove) && <button className={btnBig} disabled={busy} onClick={() => act('approve', 'Approved. The employee will be asked to acknowledge it.')}>Approve</button>}
        {['CUSTOMISED', 'VALIDATED'].includes(p.status) && who !== 'manager' && <button className={btnGhost} disabled={busy} onClick={() => act('return', 'Sent back.')}>Send back</button>}
        {p.status === 'ACTIVE' && <Revise id={p.id} done={() => { reload(); done(); }} />}
      </div>
    </div>
  );
};

const Revise: React.FC<{ id: string; done: () => void }> = ({ id, done }) => {
  const [open, setOpen] = useState(false); const [r, setR] = useState(''); const { busy, note, run } = useRunner();
  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>Change these targets (start a new version)</button>;
  return <div className="w-full space-y-2"><Notice tone="info">The current targets stay in force, with their history, until the new version is approved and acknowledged.</Notice><Note label="Why are they changing?" value={r} onChange={setR} rows={2} /><ResultNote note={note} /><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('plan-revise', { id, reason: r }); done(); }, 'New version started.')}>Start new version</button></div>;
};

export const PlanList: React.FC<{ scope: 'team' | 'all'; who: 'manager' | 'hr' | 'approver'; canApprove?: boolean; title: string; what: string; todo?: string }> = ({ scope, who, canApprove, title, what, todo }) => {
  const [items, setItems] = useState<any[] | null>(null); const [open, setOpen] = useState(''); const [tick, setTick] = useState(0); const [filter, setFilter] = useState('');
  const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('plan-list', { scope }).then((r) => setItems(r.items)); }, [scope, tick]);
  if (!items) return <Loading loading />;
  const rows = items.filter((p) => !filter || (filter === 'wait' ? ['GENERATED', 'CUSTOMISED', 'VALIDATED', 'CONFIGURATION_PENDING', 'APPROVED'].includes(p.status) : p.status === filter) );
  return (
    <div>
      <Intro title={title} what={what} todo={todo} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Tabs value={filter} onChange={setFilter} items={[{ key: '', label: 'All' }, { key: 'wait', label: 'Needs action', count: items.filter((p) => ['GENERATED', 'CUSTOMISED', 'VALIDATED', 'CONFIGURATION_PENDING', 'APPROVED'].includes(p.status)).length }, { key: 'ACTIVE', label: 'Active' }]} />
        {who === 'hr' && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await pmService.post('sync'); setTick((t) => t + 1); }, 'Checked. New joiners, transfers and manager changes are now up to date.')}>Check for changes</button>}
      </div>
      <ResultNote note={note} />
      {rows.length === 0 ? <Empty text="Nothing here." /> : rows.map((p) => (
        <div key={p.id} className="bg-white border border-slate-200 rounded-xl mb-2">
          <button className="w-full flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => setOpen(open === p.id ? '' : p.id)}>
            <div><div className="text-sm font-bold text-slate-800">{p.employeeName} <span className="text-xs text-slate-400 font-medium">{p.roleName}</span></div><div className="text-xs text-slate-500 mt-0.5">{p.kpiCount} lines{p.missingTargets ? `, ${p.missingTargets} without a target` : ''}</div></div>
            <StatusChip status={p.status} />
          </button>
          {open === p.id && <div className="px-4 pb-4 border-t border-slate-100 pt-3"><PlanEditor id={p.id} who={who} canApprove={canApprove} done={() => setTick((t) => t + 1)} /></div>}
        </div>
      ))}
    </div>
  );
};

export const ApprovalsScreen: React.FC<{ openReview: (id: string) => void }> = ({ openReview }) => {
  const [t, setT] = useState('reviews'); const [rv, setRv] = useState<any[] | null>(null);
  useEffect(() => { pmService.get('review-list', { scope: 'approve' }).then((r) => setRv(r.items)).catch(() => setRv([])); }, []);
  return (
    <div>
      <Intro title="Approvals" what="Things only an authorized approver can sign off: final reviews, KRA/KPI plans, scoring rules and role templates." todo="Open the first item." />
      <Tabs value={t} onChange={setT} items={[{ key: 'reviews', label: 'Final reviews', count: rv?.length }, { key: 'plans', label: 'KRA/KPI plans' }]} />
      {t === 'reviews' ? (rv ? (rv.length === 0 ? <Empty text="No reviews are waiting for you." /> : rv.map((r) => <div key={r.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-3 mb-2"><div className="text-sm font-bold">{r.employeeName} <span className="text-xs text-slate-500 font-medium">{r.cycleName}</span></div><button className={btnPrimary} onClick={() => openReview(r.id)}>Review and approve</button></div>)) : <Loading loading />) : <PlanList scope="all" who="approver" title="Plans waiting for approval" what="Plans HR has validated." />}
      <p className="text-xs text-slate-500 mt-3">Scoring rules and role templates are approved on their own screens ("Scoring rules" and "KRA/KPI by role").</p>
    </div>
  );
};

// ------------------------------------------------------------------ monthly check-ins (manager)

export const TeamCheckins: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null); const [tick, setTick] = useState(0); const [f, setF] = useState<Record<string, any>>({}); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('checkin-list', { scope: 'team' }).then((r) => setItems(r.items)); }, [tick]);
  if (!items) return <Loading loading />;
  return (
    <div>
      <Intro title="Monthly check-ins" what="A short chat each month. Write down what went well, what to focus on, any concerns and what support is needed." todo="Open one marked 'To do'." />
      <ResultNote note={note} />
      {items.length === 0 ? <Empty text="No check-ins yet. They are created automatically each month for people who have a manager." /> : items.map((c) => {
        const v = f[c.id] || c;
        return (
          <Card key={c.id} title={`${c.employeeName} - ${c.month}`} right={<span className="flex gap-1.5">{c.overdue && <Pill tone="red">overdue</Pill>}<StatusChip status={c.status} /></span>} className="mb-3">
            {c.status === 'DONE' ? <div className="text-sm space-y-1"><p><b>Good:</b> {c.wins || '-'}</p><p><b>Focus:</b> {c.focus || '-'}</p><p><b>Concerns:</b> {c.concerns || '-'}</p><p><b>Support:</b> {c.support || '-'}</p>{c.employeeComment && <p className="italic">Employee: {c.employeeComment}</p>}</div> : (
              <div className="space-y-2">{(['wins', 'focus', 'concerns', 'support'] as const).map((k) => <Note key={k} label={{ wins: 'What went well', focus: 'What to focus on next', concerns: 'Any concerns', support: 'Support the person needs' }[k]} value={v[k] || ''} onChange={(x) => setF({ ...f, [c.id]: { ...v, [k]: x } })} rows={2} />)}
                <div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('checkin-save', { id: c.id, ...v }); setTick((t) => t + 1); }, 'Saved.')}>Save draft</button><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('checkin-save', { id: c.id, ...v, done: true }); setTick((t) => t + 1); }, 'Check-in recorded.')}>Mark as done</button></div></div>)}
          </Card>);
      })}
    </div>
  );
};

// ------------------------------------------------------------------ development plans

export const Development: React.FC<{ users: User[]; manager: boolean; hr: boolean }> = ({ users, manager, hr }) => {
  const [mine, setMine] = useState<any[] | null>(null); const [team, setTeam] = useState<any[]>([]); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>(null); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('dev-list', { scope: 'mine' }).then((r) => setMine(r.items)); if (manager || hr) pmService.get('dev-list', { scope: hr ? 'all' : 'team' }).then((r) => setTeam(r.items.filter((x: any) => x.uid !== undefined))); }, [tick, manager, hr]);
  if (!mine) return <Loading loading />;
  const tickAction = (p: any, a: any) => run(async () => { await pmService.post('dev-act', { id: p.id, action: 'TICK', actionId: a.id, done: !a.done }); setTick((t) => t + 1); });
  const card = (p: any, mgr: boolean) => (
    <Card key={p.id} title={`${p.title}${mgr ? ` - ${p.employeeName}` : ''}`} right={<span className="flex gap-1.5"><Pill tone={p.type === 'IMPROVEMENT' ? 'amber' : p.type === 'RECOGNITION' ? 'green' : 'blue'}>{p.type.toLowerCase()}</Pill><StatusChip status={p.status} /></span>} className="mb-3">
      {p.goal && <p className="text-sm text-slate-700 mb-2">{p.goal}</p>}
      <ul className="space-y-1">{p.actions.map((a: any) => <li key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.done} disabled={p.status !== 'ACTIVE' || busy} onChange={() => tickAction(p, a)} /><span className={a.done ? 'line-through text-slate-400' : ''}>{a.text}</span>{a.dueDate && <span className="text-xs text-slate-400">by {a.dueDate}</span>}</li>)}</ul>
      {mgr && <div className="flex gap-2 mt-3">
        {p.status === 'PROPOSED' && hr && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('dev-act', { id: p.id, action: 'APPROVE' }); setTick((t) => t + 1); }, 'Approved.')}>HR: approve this plan</button>}
        {['ACTIVE', 'PROPOSED'].includes(p.status) && <button className={btnGhost} disabled={busy} onClick={() => { const note2 = window.prompt('Closing note'); if (note2) run(async () => { await pmService.post('dev-act', { id: p.id, action: 'COMPLETE', note: note2 }); setTick((t) => t + 1); }, 'Closed.'); }}>Mark complete</button>}
      </div>}
    </Card>);
  return (
    <div>
      <Intro title={manager || hr ? 'Development plans' : 'My development'} what="Growth plans agreed after a review: skills to build, support needed, or recognition. They help people grow. They are never started automatically and never used as punishment by the system." />
      <ResultNote note={note} />
      <h3 className="text-sm font-bold text-slate-700 mb-2">My plans</h3>
      {mine.length === 0 ? <Empty text="No plans yet." /> : mine.map((p) => card(p, false))}
      {(manager || hr) && (<>
        <div className="flex items-center justify-between mt-6 mb-2"><h3 className="text-sm font-bold text-slate-700">Plans for my team</h3><button className={btnPrimary} onClick={() => setForm({ type: 'DEVELOPMENT', actions: [{ text: '', dueDate: '' }] })}><Plus className="w-4 h-4" />New plan</button></div>
        {form && <DevForm users={users} form={form} setForm={setForm} done={() => { setForm(null); setTick((t) => t + 1); }} />}
        {team.filter((p) => !mine.some((m) => m.id === p.id)).map((p) => card(p, true))}
      </>)}
    </div>
  );
};

const DevForm: React.FC<{ users: User[]; form: any; setForm: (f: any) => void; done: () => void }> = ({ users, form, setForm, done }) => {
  const { busy, note, run } = useRunner(); const [rv, setRv] = useState<any[]>([]);
  useEffect(() => { if (form.uid) pmService.get('review-list', { scope: 'team' }).then((r) => setRv(r.items.filter((x: any) => x.uid === form.uid && ['APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'].includes(x.status)))).catch(() => {}); }, [form.uid]);
  const set = (p: any) => setForm({ ...form, ...p });
  return (
    <Card title="New plan" className="mb-4">
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Employee"><select className={input} value={form.uid || ''} onChange={(e) => set({ uid: e.target.value })}><option value="">Choose...</option>{users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Kind of plan"><select className={input} value={form.type} onChange={(e) => set({ type: e.target.value })}><option value="DEVELOPMENT">Development (grow a skill)</option><option value="IMPROVEMENT">Improvement (needs HR approval)</option><option value="RECOGNITION">Recognition</option></select></Field>
        {form.type === 'IMPROVEMENT' && <Field label="Based on which review?"><select className={input} value={form.reviewId || ''} onChange={(e) => set({ reviewId: e.target.value })}><option value="">Choose an approved review...</option>{rv.map((r) => <option key={r.id} value={r.id}>{r.cycleName}</option>)}</select></Field>}
        <Field label="Title"><input className={input} value={form.title || ''} onChange={(e) => set({ title: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Note label="Goal" value={form.goal || ''} onChange={(v) => set({ goal: v })} rows={2} /></div>
      <div className="mt-3 space-y-2"><div className="text-xs font-bold text-slate-600">Actions (what the person will do, and by when)</div>
        {form.actions.map((a: any, i: number) => <div key={i} className="flex gap-2"><input className={input} placeholder="Action" value={a.text} onChange={(e) => set({ actions: form.actions.map((x: any, j: number) => (j === i ? { ...x, text: e.target.value } : x)) })} /><input type="date" className={`${input} max-w-[160px]`} value={a.dueDate} onChange={(e) => set({ actions: form.actions.map((x: any, j: number) => (j === i ? { ...x, dueDate: e.target.value } : x)) })} /></div>)}
        <button className={btnGhost} onClick={() => set({ actions: [...form.actions, { text: '', dueDate: '' }] })}><Plus className="w-4 h-4" />Add action</button></div>
      <div className="mt-3"><Note label="Support from the company" value={form.supportNeeded || ''} onChange={(v) => set({ supportNeeded: v })} rows={2} /></div>
      <ResultNote note={note} />
      <div className="flex gap-2 mt-3"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('dev-save', form); done(); }, 'Saved.')}>Save plan</button><button className={btnGhost} onClick={() => setForm(null)}>Cancel</button></div>
    </Card>
  );
};

// ------------------------------------------------------------------ work evidence (PM-005)

const CSV_TEMPLATE = 'employee_email,task_id,title,link,completed_on,due_on,kpi,quality,rework_count,project,source,notes\nname@company.com,T-101,Prepared monthly report,https://example.com/doc,2026-10-15,2026-10-16,,GOOD,0,Finance,TASK_SYSTEM,\n';

export const Evidence: React.FC<{ users: User[]; manager: boolean; hr: boolean }> = ({ users, manager, hr }) => {
  const [tab, setTab] = useState('mine'); const [items, setItems] = useState<any[] | null>(null); const [tick, setTick] = useState(0); const [form, setForm] = useState<any>({ source: 'TASK_SYSTEM' }); const { busy, note, run } = useRunner();
  const [csv, setCsv] = useState(''); const [hook, setHook] = useState<any>(null); const [imp, setImp] = useState<any>(null);
  useEffect(() => { setItems(null); pmService.get('ev-list', tab === 'queue' ? { scope: hr ? 'all' : 'team', queue: '1' } : { scope: tab === 'mine' ? 'mine' : hr ? 'all' : 'team' }).then((r) => setItems(r.items)); }, [tab, tick, hr]);
  useEffect(() => { if (hr && tab === 'connect') pmService.get('hook-info').then(setHook); }, [tab, hr]);
  const tabs = [{ key: 'mine', label: 'My work' }, ...(manager || hr ? [{ key: 'queue', label: 'To check' }, { key: 'team', label: 'My team\'s work' }] : []), ...(hr ? [{ key: 'import', label: 'Upload a file' }, { key: 'connect', label: 'Connect task system' }] : [])];
  const url = hook?.webhookKey ? `${window.location.origin}/api/pm/ev-hook?c=${hook.companyId}&key=${hook.webhookKey}` : '';
  return (
    <div>
      <Intro title="Work evidence" what="Proof of completed work (tasks, deliverables, quality checks). Reviews rest on this. Missing evidence is never counted as a low score." todo="Add what you finished. Managers check the items marked 'To check'." />
      <Tabs value={tab} onChange={setTab} items={tabs} />
      <ResultNote note={note} />
      {tab === 'mine' && (
        <Card title="Add a piece of work" className="mb-4"><div className="grid md:grid-cols-3 gap-3">
          {(manager || hr) && <Field label="For"><select className={input} value={form.employeeUid || ''} onChange={(e) => setForm({ ...form, employeeUid: e.target.value })}><option value="">Me</option>{users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
          <Field label="What was done"><input className={input} value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Link to proof (optional)"><input className={input} value={form.link || ''} onChange={(e) => setForm({ ...form, link: e.target.value })} /></Field>
          <Field label="Finished on"><input type="date" className={input} value={form.completedOn || ''} onChange={(e) => setForm({ ...form, completedOn: e.target.value })} /></Field>
          <Field label="Was due on (optional)"><input type="date" className={input} value={form.dueOn || ''} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} /></Field>
          <Field label="Quality"><select className={input} value={form.quality || 'PENDING'} onChange={(e) => setForm({ ...form, quality: e.target.value })}><option value="PENDING">Not checked yet</option><option value="GOOD">Good</option><option value="ACCEPTABLE">Acceptable</option><option value="POOR">Needs rework</option></select></Field>
        </div><div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('ev-add', form); setForm({ source: 'TASK_SYSTEM' }); setTick((t) => t + 1); }, 'Added.')}>Add</button></div></Card>
      )}
      {tab === 'import' && (
        <Card title="Upload a spreadsheet of tasks" subtitle="Save your task list as CSV. Needed columns: employee_email and title. Nothing is added twice.">
          <div className="flex flex-wrap gap-2 mb-3"><a className={btnGhost} href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_TEMPLATE)}`} download="task-evidence-template.csv">Download the template</a>
            <label className={btnGhost}><Upload className="w-4 h-4" />Choose file<input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} /></label></div>
          <textarea className={input} rows={5} placeholder="...or paste the CSV here" value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="mt-3"><button className={btnPrimary} disabled={busy || !csv} onClick={() => run(async () => { setImp(await pmService.post('ev-import', { csv })); setTick((t) => t + 1); }, 'Import finished.')}>Import</button></div>
          {imp && <Notice tone={imp.rejected?.length ? 'warn' : 'ok'}>{imp.stored} added, {imp.updated} updated, {imp.duplicates} already there, {imp.unassigned} not matched to a person.{imp.rejected?.length ? ` ${imp.rejected.length} row(s) skipped: ${imp.rejected.slice(0, 5).map((r: any) => `row ${r.row} (${r.reason})`).join('; ')}` : ''}</Notice>}
        </Card>
      )}
      {tab === 'connect' && (
        <Card title="Connect your task system" subtitle="Any tool that can send a web request when a task changes (Jira, Asana, ClickUp, Zapier, n8n...) can send it here.">
          {!hook ? <Loading loading /> : (<div className="space-y-3 text-sm">
            {!hook.webhookKey ? <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('hook-key'); setHook(await pmService.get('hook-info')); }, 'Key created.')}>Create the connection address</button> : (<>
              <Field label="Send POST requests to this address (keep it secret)"><div className="flex gap-2"><input readOnly className={input} value={url} /><button className={btnGhost} onClick={() => navigator.clipboard?.writeText(url)}><Copy className="w-4 h-4" />Copy</button></div></Field>
              <p className="text-slate-600">Send JSON like: <code className="bg-slate-100 px-1 rounded">{'{"event":"completed","task_id":"T-1","title":"Report","employee_email":"a@b.com","completed_on":"2026-10-15"}'}</code>. Events: {hook.events.join(', ')}. The same task is never counted twice, and deleted or disputed tasks are flagged for the manager. They never change a score on their own.</p>
              <ConfirmButton className={btnGhost} question="The old address will stop working. Continue?" yes="Make a new key" onConfirm={() => run(async () => { await pmService.post('hook-key'); setHook(await pmService.get('hook-info')); }, 'New key created.')}>Replace the key</ConfirmButton></>)}
          </div>)}
        </Card>
      )}
      {['mine', 'queue', 'team'].includes(tab) && (items ? (items.length === 0 ? <Empty text="Nothing here yet." /> : items.map((e) => (
        <div key={e.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{e.title} {e.link && <a className="text-xs text-[#FA7014] underline ml-1" href={e.link} target="_blank" rel="noreferrer">proof</a>}</div><div className="text-xs text-slate-500">{e.employeeName || ''} {e.completedOn ? `- finished ${e.completedOn}` : ''} - <Pill tone={e.status === 'VERIFIED' ? 'green' : e.status === 'REJECTED' ? 'red' : 'amber'}>{String(e.status).replace(/_/g, ' ').toLowerCase()}</Pill></div></div>
          {(tab === 'queue') && <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('ev-verify', { id: e.id, decision: 'VERIFY' }); setTick((t) => t + 1); }, 'Verified.')}>Looks right</button><button className={btnGhost} disabled={busy} onClick={() => { const r = window.prompt('Why is it rejected?'); if (r) run(async () => { await pmService.post('ev-verify', { id: e.id, decision: 'REJECT', note: r }); setTick((t) => t + 1); }); }}>Reject</button></div>}
        </div>))) : <Loading loading />)}
    </div>
  );
};
