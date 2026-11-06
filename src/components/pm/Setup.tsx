import React, { useEffect, useState } from 'react';
import { Check, X, Plus, Trash2, Sparkles, Circle } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, useLoad } from '../common/loadUi';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner, ConfirmButton } from '../leave/ui';
import { Empty, Explain, GuardedButton, Intro, ResultNote } from './common';
import { kpiProblem, weightsProblem, type KpiDef } from '../../../shared/pmEngine';

const STEPS = [
  { key: 'weights', label: '1. Weights' }, { key: 'behaviours', label: '2. Behaviours' }, { key: 'sops', label: '3. SOPs' },
  { key: 'templates', label: '4. KRA/KPI by role' }, { key: 'finish', label: '5. Timing & finish' },
];

/** HR's 5-step wizard. Each step saves on its own and cannot be saved with a mistake in it. */
export const Setup: React.FC = () => {
  const { data, error, loading, reload } = useLoad(() => pmService.get('setup'), []);
  const [step, setStep] = useState('weights');
  if (!data) return <Loading error={error} loading={loading} />;
  const r = data.readiness;
  const stepOk = (k: string) => r.items.filter((i: any) => i.step === k).every((i: any) => i.ok);
  return (
    <div className="space-y-4">
      <Intro title="Performance setup" what={data.settings.setupDone ? 'Setup is finished. You can still change anything here; changes apply straight away to plans that have not started yet.' : 'Five short steps, about 30 minutes. Nothing starts for employees until you press "Finish setup" in step 5.'} todo={data.settings.setupDone ? undefined : 'Go through the steps in order. Each step has defaults you can keep.'} />
      <Card title={data.settings.setupDone ? 'Status: running' : 'Not ready yet'} subtitle="Red items stop plans from starting. Amber items are allowed, but check them.">
        <ul className="space-y-1 text-sm">{r.items.map((i: any, n: number) => (
          <li key={n} className="flex items-start gap-2">{i.ok ? <Check className="w-4 h-4 text-emerald-600 mt-0.5" /> : i.block ? <X className="w-4 h-4 text-rose-600 mt-0.5" /> : <Circle className="w-4 h-4 text-amber-500 mt-0.5" />}<span className={i.ok ? 'text-slate-600' : i.block ? 'text-rose-700' : 'text-amber-800'}>{i.text}</span></li>
        ))}</ul>
      </Card>
      <div className="flex flex-wrap gap-1.5">
        {STEPS.map((s) => <button key={s.key} onClick={() => setStep(s.key)} className={step === s.key ? btnPrimary : btnGhost}>{s.key !== 'finish' && stepOk(s.key) && <Check className="w-3.5 h-3.5" />}{s.label}</button>)}
      </div>
      {step === 'weights' && <Weights data={data} reload={reload} next={() => setStep('behaviours')} />}
      {step === 'behaviours' && <Behaviours data={data} reload={reload} next={() => setStep('sops')} />}
      {step === 'sops' && <Sops data={data} reload={reload} next={() => setStep('templates')} />}
      {step === 'templates' && <Templates data={data} reload={reload} next={() => setStep('finish')} />}
      {step === 'finish' && <Finish data={data} reload={reload} />}
    </div>
  );
};

const Weights: React.FC<{ data: any; reload: () => void; next: () => void }> = ({ data, reload, next }) => {
  const [w, setW] = useState({ ...data.settings.weights });
  const { busy, note, run } = useRunner();
  const p = weightsProblem({ results: Number(w.results), behaviour: Number(w.behaviour), sop: Number(w.sop) });
  return (
    <Card title="How much each part counts" subtitle="Recommended start: Results 60%, Behaviour 25%, SOP 15%. The three must add up to 100.">
      <div className="grid grid-cols-3 gap-3 max-w-md">
        {(['results', 'behaviour', 'sop'] as const).map((k) => <Field key={k} label={k === 'results' ? 'Results (KPIs)' : k === 'behaviour' ? 'Behaviour' : 'SOP compliance'}><input type="number" min={0} max={100} className={input} value={w[k]} onChange={(e) => setW({ ...w, [k]: e.target.value })} /></Field>)}
      </div>
      <p className={`text-xs font-bold mt-1 ${p ? 'text-rose-700' : 'text-emerald-700'}`}>{p || 'Adds up to 100 ✓'}</p>
      <ResultNote note={note} />
      <div className="mt-2"><GuardedButton busy={busy} missing={p ? [p.replace(/\.$/, '')] : []} onClick={() => run(async () => { await pmService.post('setup-save', { step: 'weights', weights: { results: Number(w.results), behaviour: Number(w.behaviour), sop: Number(w.sop) } }); await reload(); next(); }, 'Saved.')}>Save and continue</GuardedButton></div>
    </Card>
  );
};

const Behaviours: React.FC<{ data: any; reload: () => void; next: () => void }> = ({ data, reload, next }) => {
  const [list, setList] = useState<any[]>(data.settings.competencies.map((x: any) => ({ ...x })));
  const [extras, setExtras] = useState<boolean>(data.settings.managerExtras !== false);
  const { busy, note, run } = useRunner();
  const names = list.map((x) => x.name.trim().toLowerCase()).filter(Boolean);
  const missing = [!names.length && 'at least one behaviour', new Set(names).size !== names.length && 'no two behaviours have the same name'].filter(Boolean) as string[];
  return (
    <Card title="Behaviours everyone is rated on" subtitle="The 12 standard ones are filled in. Remove or rename any, or add your own. Rate observable work behaviour only.">
      <div className="space-y-1.5">{list.map((x, i) => (
        <div key={x.id} className="grid md:grid-cols-[1fr_2fr_auto] gap-2">
          <input className={input} value={x.name} placeholder="Name" onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
          <input className={input} value={x.standard} placeholder="What good looks like" onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, standard: e.target.value } : y)))} />
          <button aria-label="Remove" className={btnGhost} onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}</div>
      <button className={`${btnGhost} mt-2`} onClick={() => setList([...list, { id: `c_${Date.now().toString(36)}`, name: '', standard: '' }])}><Plus className="w-4 h-4" />Add a behaviour</button>
      <label className="flex items-center gap-2 text-sm mt-3"><input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} />Managers are also rated on coaching, delegation, fair decisions and team development (added automatically for anyone with people reporting to them)</label>
      <ResultNote note={note} />
      <div className="mt-2"><GuardedButton busy={busy} missing={missing} onClick={() => run(async () => { await pmService.post('setup-save', { step: 'behaviours', competencies: list.filter((x) => x.name.trim()), managerExtras: extras }); await reload(); next(); }, 'Saved.')}>Save and continue</GuardedButton></div>
    </Card>
  );
};

const Sops: React.FC<{ data: any; reload: () => void; next: () => void }> = ({ data, reload, next }) => {
  const [sops, setSops] = useState<any[]>(data.settings.sops.map((x: any) => ({ ...x })));
  const [pick, setPick] = useState('');
  const { busy, note, run } = useRunner();
  const unused = data.documents.filter((d: any) => !sops.some((x) => x.documentId === d.documentId));
  const add = () => { const d = data.documents.find((x: any) => x.documentId === pick); if (!d) return; setSops([...sops, { documentId: d.documentId, title: d.title, departments: d.department && data.departments.includes(d.department) ? [d.department] : [], designations: [], critical: false }]); setPick(''); };
  const toggle = (i: number, key: 'departments' | 'designations', v: string) => setSops(sops.map((x, j) => (j === i ? { ...x, [key]: x[key].includes(v) ? x[key].filter((y: string) => y !== v) : [...x[key], v] } : x)));
  return (
    <Card title="Which SOPs apply to whom" subtitle="Pick published documents from Document Governance. Leave departments empty for 'everyone'. Leave designations empty for 'everyone in those departments'.">
      {data.documents.length === 0 && <Notice tone="warn">There are no published documents yet. Publish your SOPs in Documents first, or skip this step (people will have no SOPs to acknowledge).</Notice>}
      <div className="flex gap-2 items-end">
        <Field label="Add a document"><select className={input} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Pick a published document…</option>{unused.map((d: any) => <option key={d.documentId} value={d.documentId}>{d.title} ({d.documentId}, v{d.versionNumber})</option>)}</select></Field>
        <button className={btnGhost} disabled={!pick} onClick={add}><Plus className="w-4 h-4" />Add</button>
      </div>
      <div className="space-y-3 mt-3">
        {sops.length === 0 ? <Empty text="No SOPs chosen." /> : sops.map((x, i) => (
          <div key={x.documentId} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2"><b className="text-sm">{x.title}</b><button aria-label="Remove" className={btnGhost} onClick={() => setSops(sops.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button></div>
            <div className="text-xs text-slate-500 mt-1">Departments ({x.departments.length ? x.departments.length : 'everyone'}):</div>
            <div className="flex flex-wrap gap-1 mt-1">{data.departments.map((d: string) => <button key={d} onClick={() => toggle(i, 'departments', d)} className={`px-2 py-0.5 rounded-full text-[11px] border ${x.departments.includes(d) ? 'bg-[#FA7014] text-white border-[#FA7014]' : 'bg-white border-slate-300'}`}>{d}</button>)}</div>
            <div className="text-xs text-slate-500 mt-2">Only these designations (optional):</div>
            <div className="flex flex-wrap gap-1 mt-1">{data.designations.map((d: any) => <button key={d.designation} onClick={() => toggle(i, 'designations', d.designation)} className={`px-2 py-0.5 rounded-full text-[11px] border ${x.designations.includes(d.designation) ? 'bg-slate-700 text-white border-slate-700' : 'bg-white border-slate-300'}`}>{d.designation}</button>)}</div>
            <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={x.critical} onChange={(e) => setSops(sops.map((y, j) => (j === i ? { ...y, critical: e.target.checked } : y)))} />Critical (security, legal or money). A "not compliant" here is never averaged away; HR must look at it.</label>
          </div>
        ))}
      </div>
      <ResultNote note={note} />
      <div className="mt-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('setup-save', { step: 'sops', sops }); await reload(); next(); }, 'Saved.')}>Save and continue</button></div>
    </Card>
  );
};

const blankKpi = (): KpiDef => ({ id: `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, kra: '', kpi: '', measure: '', weight: 0 });

const Templates: React.FC<{ data: any; reload: () => void; next: () => void }> = ({ data, reload, next }) => {
  const [edit, setEdit] = useState<{ designation: string; kpis: KpiDef[]; extra: string } | null>(null);
  const [checks, setChecks] = useState<Record<string, { problem: string | null; suggestion: string }>>({});
  const { busy, note, run } = useRunner();
  useEffect(() => setChecks({}), [edit?.designation]);
  const open = (designation: string) => {
    const t = data.templates.find((x: any) => x.designation.toLowerCase() === designation.toLowerCase());
    setEdit({ designation, kpis: t ? t.kpis.map((k: any) => ({ ...k })) : [blankKpi()], extra: (t?.extraCompetencies || []).join(', ') });
  };
  const p = edit ? kpiProblem(edit.kpis.map((k) => ({ ...k, weight: Number(k.weight) }))) : null;
  const total = edit ? edit.kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0) : 0;
  const setK = (i: number, patch: Partial<KpiDef>) => setEdit(edit && { ...edit, kpis: edit.kpis.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  if (edit) return (
    <Card title={`KRA/KPI template: ${edit.designation}`} subtitle="What this role is expected to deliver. Managers set the actual numbers (targets) for each person. Weights must total 100.">
      <div className="space-y-2">
        {edit.kpis.map((k, i) => (
          <div key={k.id} className="border border-slate-200 rounded-lg p-2">
            <div className="grid md:grid-cols-[1fr_2fr_1.3fr_80px_auto] gap-2">
              <input className={input} placeholder="Responsibility area (KRA)" value={k.kra} onChange={(e) => setK(i, { kra: e.target.value })} />
              <input className={input} placeholder="KPI: what is delivered" value={k.kpi} onChange={(e) => setK(i, { kpi: e.target.value })} />
              <input className={input} placeholder="Measured by (evidence source)" value={k.measure} onChange={(e) => setK(i, { measure: e.target.value })} />
              <input type="number" min={1} max={100} className={input} placeholder="%" value={k.weight || ''} onChange={(e) => setK(i, { weight: Number(e.target.value) })} />
              <button aria-label="Remove" className={btnGhost} onClick={() => setEdit({ ...edit, kpis: edit.kpis.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></button>
            </div>
            {checks[k.id]?.problem && <p className="text-[11px] text-amber-700 mt-1">{checks[k.id].problem}</p>}
            {checks[k.id]?.suggestion && <p className="text-[11px] text-slate-600 mt-1">Suggestion: {checks[k.id].suggestion} <button className="underline" onClick={() => setK(i, { kpi: checks[k.id].suggestion })}>Use it</button></p>}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <button className={btnGhost} disabled={edit.kpis.length >= 12} onClick={() => setEdit({ ...edit, kpis: [...edit.kpis, blankKpi()] })}><Plus className="w-4 h-4" />Add a KPI</button>
        <select className={`${input} max-w-xs`} value="" onChange={(e) => { const s = data.suggestions[Number(e.target.value)]; if (s) setEdit({ ...edit, kpis: [...edit.kpis.filter((k) => k.kpi || k.kra), { ...blankKpi(), ...s }] }); }}><option value="">Add from suggestions…</option>{data.suggestions.map((s: any, i: number) => <option key={i} value={i}>{s.kra}: {s.kpi}</option>)}</select>
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await pmService.post('kpi-check', { kpis: edit.kpis }); setChecks(Object.fromEntries(r.notes.map((n: any) => [n.id, n]))); })}><Sparkles className="w-4 h-4" />Check the wording</button>
      </div>
      <p className={`text-xs font-bold mt-2 ${total === 100 ? 'text-emerald-700' : 'text-rose-700'}`}>Weights total: {total}% {total === 100 ? '✓' : '(must be 100%)'}</p>
      <Field label="Extra behaviours for this role only (optional, comma-separated)" hint="For example: CRM discipline, Code quality, Brand consistency"><input className={input} value={edit.extra} onChange={(e) => setEdit({ ...edit, extra: e.target.value })} /></Field>
      <ResultNote note={note} />
      <div className="flex gap-2 items-start mt-2">
        <GuardedButton busy={busy} missing={p ? [p.replace(/\.$/, '')] : []} onClick={() => run(async () => { await pmService.post('tpl-save', { designation: edit.designation, kpis: edit.kpis.map((k) => ({ ...k, weight: Number(k.weight) })), extraCompetencies: edit.extra.split(',').map((x) => x.trim()).filter(Boolean) }); setEdit(null); await reload(); }, "Template saved.")}>Save template</GuardedButton>
        <button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button>
      </div>
    </Card>
  );
  return (
    <Card title="KRA/KPI templates by designation" subtitle="One template per designation in use. People whose designation has no template wait (on hold) until you add one.">
      <ResultNote note={note} />
      {data.designations.length === 0 ? <Empty text="Nobody has a designation yet. Set designations in People first." /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Designation</th><th>People</th><th>Template</th><th /></tr></thead>
          <tbody>{data.designations.map((d: any) => {
            const t = data.templates.find((x: any) => x.designation.toLowerCase() === d.designation.toLowerCase());
            return (
              <tr key={d.designation} className="border-t border-slate-100">
                <td className="py-1.5 font-semibold">{d.designation}</td><td>{d.people}</td>
                <td>{t ? <span className="text-emerald-700 text-xs font-bold">{t.kpis.length} KPIs</span> : <span className="text-amber-700 text-xs font-bold">Missing</span>}</td>
                <td className="text-right space-x-2"><button className={t ? btnGhost : btnPrimary} onClick={() => open(d.designation)}>{t ? 'Edit' : 'Create'}</button>{t && <ConfirmButton question="Delete this template? Plans already started keep their KPIs." yes="Delete" onConfirm={() => run(async () => { await pmService.post('tpl-delete', { id: t.id }); await reload(); }, 'Deleted.')}><Trash2 className="w-4 h-4" /></ConfirmButton>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      <div className="mt-3"><button className={btnPrimary} onClick={next}>Continue</button></div>
    </Card>
  );
};

const Finish: React.FC<{ data: any; reload: () => void }> = ({ data, reload }) => {
  const s = data.settings;
  const [t, setT] = useState({ ...s.timing });
  const [feedUrl, setFeedUrl] = useState(s.feedUrl || '');
  const [aiOn, setAiOn] = useState(!!s.aiOn);
  const { busy, note, run } = useRunner();
  const n = (k: keyof typeof t, label: string, hint: string) => <Field label={label} hint={hint}><input type="number" min={0} max={30} className={input} value={t[k]} onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} /></Field>;
  const blocks = data.readiness.items.filter((i: any) => !i.ok && i.block).map((i: any) => i.text.replace(/\.$/, ''));
  return (
    <Card title="Timing, reminders and finish" subtitle="The system chases people for you. These are the defaults; change them only if you need to.">
      <div className="grid md:grid-cols-3 gap-3">
        {n('selfDays', 'Days for the self-review', 'After the quarter opens')}
        {n('managerDays', 'Days for the manager', 'After the self-review deadline')}
        {n('hrDays', 'Days for HR approval', 'After the manager deadline')}
        {n('publishDelayDays', 'Share with employee after (days)', '0 = share as soon as approved')}
        {n('remindEvery', 'Remind every (days)', 'For anything waiting')}
        {n('escalateAfter', 'Tell HR after (days)', 'When something is still late')}
      </div>
      <Field label="Evidence feed: Google Sheet link (optional)" hint="Read every morning. Columns: email, date, kpi, title, link. Share the sheet so anyone with the link can view it."><input className={input} value={feedUrl} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setFeedUrl(e.target.value)} /></Field>
      {s.feedLast && <p className="text-[11px] text-slate-500">Last read: {s.feedLast}</p>}
      <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" checked={aiOn} disabled={!data.aiAvailable} onChange={(e) => setAiOn(e.target.checked)} />Use AI to draft review text and check KPI wording {data.aiAvailable ? '(AI never rates, never decides, never sees names)' : '(AI is not configured on this server)'}</label>
      <ResultNote note={note} />
      <div className="flex flex-wrap gap-2 items-start mt-3">
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('setup-save', { step: 'timing', timing: t, feedUrl, aiOn }); await reload(); }, 'Saved.')}>Save timing</button>
        {!s.setupDone && <GuardedButton busy={busy} missing={blocks} onClick={() => run(async () => { await pmService.post('setup-save', { step: 'timing', timing: t, feedUrl, aiOn }); const r = await pmService.post('setup-save', { step: 'finish' }); await reload(); if (!r.success) throw new Error(r.error); }, 'Setup finished. Plans have started and managers have been asked to set targets.')}>Finish setup and start</GuardedButton>}
      </div>
      <Explain title="What happens when I press Finish?">
        <p>Every employee gets a plan from their designation's template. Their manager is emailed to set targets. Anyone missing something (no manager, no template) shows as "on hold" with the reason, and starts by itself when it is fixed.</p>
        <p>From then on a daily check runs by itself: new joiners, role changes, new SOP versions, monthly check-ins, reminders, opening each quarter's reviews and sharing approved ones.</p>
      </Explain>
    </Card>
  );
};
