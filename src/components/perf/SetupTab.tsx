import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, ConfirmButton, Field, Notice, Segmented, btnGhost, btnPrimary, input, niceDate, range, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from './shared';

const CATS = [['INDIVIDUAL', 'Individual contributor'], ['MANAGER', 'Manager'], ['LEADERSHIP', 'Leadership'], ['SALES', 'Sales / BD'], ['SPECIALIST', 'Specialist']];
const GROUPS = ['CORE', 'MANAGER', 'BUSINESS_DEVELOPMENT', 'TECHNICAL', 'CREATIVE'];

const Competencies: React.FC<{ set: any; reload: () => void }> = ({ set, reload }) => {
  const { busy, note, run } = useRunner();
  const [rows, setRows] = useState<any[]>(set.competencies);
  const upd = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <Card title="Behaviour competencies" subtitle="Observable, work-related standards only. Core ones apply to everyone; others are added per role family."
      right={<button className={btnGhost} onClick={() => setRows([...rows, { id: '', name: '', standard: '', evidence: '', group: 'CORE', active: true }])}>Add</button>}>
      <div className="space-y-2">{rows.map((c, i) => (
        <div key={i} className="grid md:grid-cols-[1.2fr_2fr_9rem_auto] gap-2 items-start border-b border-slate-100 pb-2">
          <input className={input} placeholder="Name" value={c.name} onChange={(e) => upd(i, { name: e.target.value })} />
          <input className={input} placeholder="Expected standard" value={c.standard} onChange={(e) => upd(i, { standard: e.target.value })} />
          <select className={input} value={c.group} onChange={(e) => upd(i, { group: e.target.value })}>{GROUPS.map((g) => <option key={g} value={g}>{g.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
          <label className="flex items-center gap-1 text-xs mt-2"><input type="checkbox" checked={c.active} onChange={(e) => upd(i, { active: e.target.checked })} /> active</label>
        </div>))}</div>
      {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}
      <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.saveSettings({ competencies: rows, roleFamilies: set.roleFamilies }); reload(); }, 'Saved.')}>Save competencies</button></div>
    </Card>
  );
};

const Families: React.FC<{ set: any; reload: () => void }> = ({ set, reload }) => {
  const { busy, note, run } = useRunner();
  const [rows, setRows] = useState<any[]>(set.roleFamilies);
  const upd = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const extras = set.competencies.filter((c: any) => c.group !== 'CORE');
  return (
    <Card title="Role families" subtitle="A role family decides which template, framework and extra competencies apply. People are matched by department, then by designation keywords."
      right={<button className={btnGhost} onClick={() => setRows([...rows, { id: '', name: '', departmentName: '', designationKeywords: [], category: 'INDIVIDUAL', competencyIds: [], active: true }])}>Add</button>}>
      <div className="space-y-3">{rows.map((r, i) => (
        <div key={i} className="border border-slate-200 rounded-lg p-3 grid sm:grid-cols-2 gap-2">
          <Field label="Name"><input className={input} value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
          <Field label="Department"><select className={input} value={r.departmentName} onChange={(e) => upd(i, { departmentName: e.target.value })}><option value="">–</option>{set.departments.map((d: string) => <option key={d}>{d}</option>)}</select></Field>
          <Field label="Designation keywords (comma separated, blank = whole department)"><input className={input} value={(r.designationKeywords || []).join(', ')} onChange={(e) => upd(i, { designationKeywords: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></Field>
          <Field label="Employee category"><select className={input} value={r.category} onChange={(e) => upd(i, { category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Extra competencies"><select multiple className={`${input} h-20`} value={r.competencyIds} onChange={(e) => upd(i, { competencyIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{extras.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <label className="flex items-center gap-1.5 text-sm mt-6"><input type="checkbox" checked={r.active} onChange={(e) => upd(i, { active: e.target.checked })} /> active</label>
        </div>))}</div>
      {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}
      <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.saveSettings({ competencies: set.competencies, roleFamilies: rows }); reload(); }, 'Saved.')}>Save role families</button></div>
    </Card>
  );
};

const Frameworks: React.FC<{ set: any; me: any }> = ({ set, me }) => {
  const q = useLoad(() => perfService.frameworks(), []);
  const { busy, note, run } = useRunner();
  const [f, setF] = useState<any | null>(null);
  const total = f ? (Number(f.weights.kra) || 0) + (Number(f.weights.behaviour) || 0) + (Number(f.weights.sop) || 0) : 0;
  return (
    <div className="space-y-4">
      <Card title="Performance frameworks" subtitle="Weights are proposals until approved. Only approved, in-date frameworks are used."
        right={<button className={btnPrimary} onClick={() => setF({ id: '', name: '', employeeCategory: 'INDIVIDUAL', roleFamilyId: '', weights: { kra: 60, behaviour: 25, sop: 15 }, reviewFrequency: 'QUARTERLY', effectiveFrom: '', effectiveTo: '' })}>New framework</button>}>
        <Loading error={q.error} loading={q.loading} />
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <ul className="divide-y divide-slate-100">{(q.data?.items || []).map((x: any) => (
          <li key={x.id} className="py-2.5 flex items-center justify-between gap-2 flex-wrap">
            <div><p className="text-sm font-semibold text-slate-800">{x.name} <span className="text-slate-400 font-normal">v{x.version}</span> <Pill tone={x.status === 'APPROVED' ? 'green' : x.status === 'DRAFT' ? 'amber' : 'slate'}>{x.status.toLowerCase()}</Pill></p>
              <p className="text-xs text-slate-500">KRA {x.weights.kra} / Behaviour {x.weights.behaviour} / SOP {x.weights.sop} · {CATS.find(([v]) => v === x.employeeCategory)?.[1]}{x.roleFamilyId ? ` · ${set.roleFamilies.find((r: any) => r.id === x.roleFamilyId)?.name || ''}` : ''} · from {niceDate(x.effectiveFrom)}{x.effectiveTo ? ` to ${niceDate(x.effectiveTo)}` : ''}</p></div>
            <div className="flex gap-2">
              {x.status === 'DRAFT' && <button className={btnGhost} onClick={() => setF({ ...x })}>Edit</button>}
              {x.status === 'DRAFT' && (me.canManage || me.canApprove) && <ConfirmButton className={btnPrimary} question="Approve and start using?" yes="Approve" onConfirm={() => run(async () => { await perfService.approveFramework(x.id); await q.reload(); }, 'Approved.')}>Approve</ConfirmButton>}
              {x.status === 'APPROVED' && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.cloneFramework(x.id); await q.reload(); }, 'New draft version created.')}>New version</button>}
              {x.status !== 'RETIRED' && <ConfirmButton className={btnGhost} question="Retire?" yes="Retire" onConfirm={() => run(async () => { await perfService.retireFramework(x.id); await q.reload(); })}>Retire</ConfirmButton>}
            </div>
          </li>))}</ul>
      </Card>
      {f && (
        <Card title={f.id ? 'Edit framework' : 'New framework'} right={<button className={btnGhost} onClick={() => setF(null)}>Cancel</button>}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name"><input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Employee category"><select className={input} value={f.employeeCategory} onChange={(e) => setF({ ...f, employeeCategory: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Only for role family (optional)"><select className={input} value={f.roleFamilyId} onChange={(e) => setF({ ...f, roleFamilyId: e.target.value })}><option value="">Whole category</option>{set.roleFamilies.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Review frequency"><select className={input} value={f.reviewFrequency} onChange={(e) => setF({ ...f, reviewFrequency: e.target.value })}>{['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'].map((v) => <option key={v}>{v}</option>)}</select></Field>
            <Field label="Effective from"><input type="date" className={input} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
            <Field label="Effective to (optional)"><input type="date" className={input} value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">{(['kra', 'behaviour', 'sop'] as const).map((k) => <Field key={k} label={`${k === 'kra' ? 'KRA / KPI' : k === 'sop' ? 'SOP' : 'Behaviour'} weight %`}><input className={input} inputMode="numeric" value={f.weights[k]} onChange={(e) => setF({ ...f, weights: { ...f.weights, [k]: e.target.value } })} /></Field>)}</div>
          <p className={`text-xs font-bold mt-1 ${total === 100 ? 'text-emerald-600' : 'text-rose-600'}`}>Weights total {total}% (must be 100%)</p>
          <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.saveFramework(f); setF(null); await q.reload(); }, 'Saved as draft.')}>Save draft</button></div>
        </Card>)}
    </div>
  );
};

const Cycles: React.FC<{ set: any }> = ({ set }) => {
  const q = useLoad(() => perfService.cycles(), []);
  const { busy, note, run } = useRunner();
  const [f, setF] = useState<any | null>(null);
  return (
    <div className="space-y-4">
      <Card title="Review cycles" subtitle="Opening a cycle creates one review per person, once. Opening it again only fills in what is missing."
        right={<button className={btnPrimary} onClick={() => setF({ id: '', name: '', reviewType: 'QUARTERLY', periodStart: '', periodEnd: '', selfDeadline: '', managerDeadline: '', hrDeadline: '', scope: { departmentName: '', uids: [] } })}>New cycle</button>}>
        <Loading error={q.error} loading={q.loading} />
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <ul className="divide-y divide-slate-100">{(q.data?.items || []).map((c: any) => (
          <li key={c.id} className="py-2.5 flex items-center justify-between gap-2 flex-wrap">
            <div><p className="text-sm font-semibold text-slate-800">{c.name} <Pill tone={c.status === 'OPEN' ? 'green' : c.status === 'DRAFT' ? 'amber' : 'slate'}>{c.status.toLowerCase()}</Pill></p>
              <p className="text-xs text-slate-500">{range(c.periodStart, c.periodEnd)} · self by {niceDate(c.selfDeadline)}, manager by {niceDate(c.managerDeadline)}, HR by {niceDate(c.hrDeadline)}{c.scope.departmentName ? ` · ${c.scope.departmentName}` : ''}</p></div>
            <div className="flex gap-2">
              {c.status !== 'LOCKED' && <button className={btnGhost} onClick={() => setF({ ...c })}>Edit</button>}
              {c.status !== 'LOCKED' && <ConfirmButton className={btnPrimary} question={c.status === 'OPEN' ? 'Add any missing reviews?' : 'Open and create reviews?'} yes="Go" onConfirm={() => run(async () => { const r = await perfService.openCycle(c.id); await q.reload(); }, c.status === 'OPEN' ? 'Missing reviews added.' : 'Cycle opened. Reviews created.')}>{c.status === 'OPEN' ? 'Refresh reviews' : 'Open cycle'}</ConfirmButton>}
              {c.status === 'OPEN' && <ConfirmButton className={btnGhost} question="Lock this cycle?" yes="Lock" onConfirm={() => run(async () => { await perfService.lockCycle(c.id); await q.reload(); }, 'Locked.')}>Lock</ConfirmButton>}
            </div>
          </li>))}</ul>
      </Card>
      {f && (
        <Card title={f.id ? 'Edit cycle' : 'New cycle'} right={<button className={btnGhost} onClick={() => setF(null)}>Cancel</button>}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name"><input className={input} value={f.name} placeholder="Q2 FY26-27 review" onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Review type"><select className={input} value={f.reviewType} onChange={(e) => setF({ ...f, reviewType: e.target.value })}>{[['QUARTERLY', 'Quarterly performance review'], ['PROBATION', 'Probation review'], ['ANNUAL', 'Annual summary'], ['IMPROVEMENT', 'Improvement plan review'], ['MONTHLY_CHECKIN', 'Monthly check-in']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Period start"><input type="date" className={input} disabled={f.status === 'OPEN'} value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
            <Field label="Period end"><input type="date" className={input} disabled={f.status === 'OPEN'} value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
            <Field label="Self-assessment due"><input type="date" className={input} value={f.selfDeadline} onChange={(e) => setF({ ...f, selfDeadline: e.target.value })} /></Field>
            <Field label="Manager review due"><input type="date" className={input} value={f.managerDeadline} onChange={(e) => setF({ ...f, managerDeadline: e.target.value })} /></Field>
            <Field label="HR review due"><input type="date" className={input} value={f.hrDeadline} onChange={(e) => setF({ ...f, hrDeadline: e.target.value })} /></Field>
            <Field label="Only this department (optional)"><select className={input} disabled={f.status === 'OPEN'} value={f.scope?.departmentName || ''} onChange={(e) => setF({ ...f, scope: { ...f.scope, departmentName: e.target.value } })}><option value="">Everyone</option>{set.departments.map((d: string) => <option key={d}>{d}</option>)}</select></Field>
          </div>
          <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.saveCycle(f); setF(null); await q.reload(); }, 'Saved.')}>Save cycle</button></div>
        </Card>)}
    </div>
  );
};

const Templates: React.FC<{ set: any; me: any }> = ({ set, me }) => {
  const q = useLoad(() => perfService.templates(), []);
  const { busy, note, run } = useRunner();
  const [rf, setRf] = useState('');
  const [kras, setKras] = useState<any[] | null>(null);
  const existing = (q.data?.items || []).find((t: any) => t.roleFamilyId === rf);
  const pick = (id: string) => { setRf(id); const t = (q.data?.items || []).find((x: any) => x.roleFamilyId === id); setKras(t ? JSON.parse(JSON.stringify(t.kras)) : [{ id: '', name: '', description: '', kpis: [] }]); };
  const upK = (ki: number, p: any) => setKras(kras!.map((k, i) => (i === ki ? { ...k, ...p } : k)));
  const upP = (ki: number, pi: number, p: any) => setKras(kras!.map((k, i) => (i !== ki ? k : { ...k, kpis: k.kpis.map((x: any, j: number) => (j === pi ? { ...x, ...p } : x)) })));
  const total = (kras || []).flatMap((k) => k.kpis).reduce((s, p) => s + (Number(p.weightage) || 0), 0);
  return (
    <Card title="KRA / KPI templates" subtitle="A starting point per role family. Leave targets blank: they are agreed per person, client, budget and period, never invented.">
      <Loading error={q.error} loading={q.loading} />
      <Field label="Role family"><select className={input} value={rf} onChange={(e) => pick(e.target.value)}><option value="">Choose…</option>{set.roleFamilies.map((r: any) => { const t = (q.data?.items || []).find((x: any) => x.roleFamilyId === r.id); return <option key={r.id} value={r.id}>{r.name}{t ? ` (${t.status.toLowerCase()})` : ' (none)'}</option>; })}</select></Field>
      {rf && kras && (
        <div className="mt-3 space-y-3">
          {kras.map((k, ki) => (
            <div key={ki} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex gap-2"><input className={input} placeholder="KRA name" value={k.name} onChange={(e) => upK(ki, { name: e.target.value })} /><button className={btnGhost} onClick={() => setKras(kras.filter((_, i) => i !== ki))}>Remove</button></div>
              {k.kpis.map((p: any, pi: number) => (
                <div key={pi} className="grid md:grid-cols-[6rem_2fr_1.5fr_5rem_auto] gap-2">
                  <input className={input} placeholder="Code" value={p.code} onChange={(e) => upP(ki, pi, { code: e.target.value })} />
                  <input className={input} placeholder="KPI description" value={p.description} onChange={(e) => upP(ki, pi, { description: e.target.value })} />
                  <input className={input} placeholder="How measured / evidence" value={p.measurement} onChange={(e) => upP(ki, pi, { measurement: e.target.value, evidenceSource: p.evidenceSource || e.target.value })} />
                  <input className={input} placeholder="%" inputMode="numeric" value={p.weightage} onChange={(e) => upP(ki, pi, { weightage: e.target.value })} />
                  <button className={btnGhost} onClick={() => upK(ki, { kpis: k.kpis.filter((_: any, j: number) => j !== pi) })}>×</button>
                </div>))}
              <button className={btnGhost} onClick={() => upK(ki, { kpis: [...k.kpis, { id: '', code: '', description: '', measurement: '', target: '', weightage: 0, frequency: 'MONTHLY', evidenceSource: '', sopRef: '' }] })}>Add KPI</button>
            </div>))}
          <button className={btnGhost} onClick={() => setKras([...kras, { id: '', name: '', description: '', kpis: [] }])}>Add KRA</button>
          <p className={`text-xs font-bold ${total === 100 ? 'text-emerald-600' : 'text-rose-600'}`}>KPI weights total {total}% (must be 100% to approve)</p>
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.saveTemplate({ roleFamilyId: rf, kras }); await q.reload(); }, 'Saved as draft.')}>Save draft</button>
            {existing && existing.status === 'DRAFT' && (me.canManage || me.canApprove) && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.approveTemplate(existing.id); await q.reload(); }, 'Approved. Plans can now be built from it.')}>Approve template</button>}
            {existing && <Pill tone={existing.status === 'APPROVED' ? 'green' : 'amber'}>{existing.status.toLowerCase()} v{existing.version}</Pill>}
          </div>
        </div>)}
    </Card>
  );
};

export const SetupTab: React.FC<{ me: any; onChanged: () => void }> = ({ me, onChanged }) => {
  const set = useLoad(() => perfService.settings(), []);
  const { busy, note, run } = useRunner();
  const [tab, setTab] = useState<'start' | 'competencies' | 'families' | 'frameworks' | 'templates' | 'cycles'>('start');
  if (!set.data) return <Loading error={set.error} loading={set.loading} />;
  const s = set.data;
  const reload = async () => { await set.reload(); onChanged(); };
  const hook = `${window.location.origin}/api/perf/evidence-hook`;
  return (
    <div className="space-y-4">
      <Segmented value={tab} onChange={setTab} options={[{ value: 'start', label: 'Get started' }, { value: 'competencies', label: 'Competencies' }, { value: 'families', label: 'Role families' }, { value: 'frameworks', label: 'Frameworks' }, { value: 'templates', label: 'KRA templates' }, { value: 'cycles', label: 'Cycles' }]} />
      {tab === 'start' && (
        <>
          <Card title="Set up performance management" subtitle="Follow the order below. Everything created here is a draft until a person approves it.">
            <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1">
              <li>Load the starter competencies, a role family per department, a draft framework and an example template.</li>
              <li>Check <strong>Role families</strong> match your departments and designations.</li>
              <li>Edit and approve a <strong>Framework</strong> (weights must total 100%).</li>
              <li>Write and approve a <strong>KRA template</strong> for each role family. Leave targets blank.</li>
              <li>Map <strong>SOPs</strong> for each department (SOP mapping).</li>
              <li>Open <strong>KRA/KPI plans</strong> and create the missing plans. Managers then set targets.</li>
              <li>Create a <strong>Cycle</strong> and open it.</li>
            </ol>
            {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}
            <div className="mt-3"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const r = await perfService.applyStarter(); await reload(); }, 'Starter data loaded. Nothing existing was changed.')}>Load starter data</button></div>
            <p className="text-xs text-slate-500 mt-2">{s.competencies.length} competencies · {s.roleFamilies.length} role families · {s.departments.length} departments</p>
          </Card>
          <Card title="Task tool evidence" subtitle="Optional. A task tool can push completed work to a person's KPI. It becomes pending evidence for the manager to verify; it never creates a rating.">
            <Field label="Webhook address"><input className={input} readOnly value={hook} onFocus={(e) => e.target.select()} /></Field>
            <Field label="Secret key"><input className={input} readOnly value={s.webhookKey || 'not created yet'} onFocus={(e) => e.target.select()} /></Field>
            <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-2 mt-2 overflow-x-auto">{`POST ${hook}\nx-webhook-key: <secret key>\n{ "externalId": "TASK-123", "employeeEmail": "name@company.com", "kpiCode": "CAMP-01",\n  "description": "Campaign launched", "reference": "https://...", "value": 1, "occurredAt": "2026-10-01" }`}</pre>
            <div className="mt-2"><ConfirmButton className={btnGhost} question="Create a new key? The old one stops working." yes="New key" onConfirm={() => run(async () => { await perfService.rotateWebhook(); await reload(); }, 'New key created.')}>{s.webhookKey ? 'Replace key' : 'Create key'}</ConfirmButton></div>
          </Card>
        </>)}
      {tab === 'competencies' && <Competencies key={s.competencyVersion + ':' + s.competencies.length} set={s} reload={reload} />}
      {tab === 'families' && <Families key={s.roleFamilies.length} set={s} reload={reload} />}
      {tab === 'frameworks' && <Frameworks set={s} me={me} />}
      {tab === 'templates' && <Templates set={s} me={me} />}
      {tab === 'cycles' && <Cycles set={s} />}
    </div>
  );
};
