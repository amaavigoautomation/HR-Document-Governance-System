import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronUp, Lock, Play, Plus, Trash2, X } from 'lucide-react';
import { Card, Field, Notice, btnBig, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';
import { flowService, type FlowState } from '../../services/flowService';
import {
  CONDITION_FIELDS, CONDITION_OPS, MAX_INTERVIEW_ROUNDS, OUTCOME_WORDS, PLACEHOLDERS, STEP_INFO, STEP_ORDER, UNKNOWN_CHOICES,
  makeStep, simulate, stepSentence, validateFlow, type FlowDoc, type FlowStep, type Problem, type SimOutput, type StepType,
} from '../../../shared/flowEngine';

type Person = FlowState['people'][number];

// ------------------------------------------------------------------ the fixed part and the start/end markers

const FixedPart: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <button type="button" className="w-full flex items-center gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Lock className="w-4 h-4 text-slate-500 shrink-0" />
        <span className="text-sm font-bold text-slate-700">Before the job is posted <span className="font-medium text-slate-500">· already set up, you cannot change this part</span></span>
        {open ? <ChevronUp className="w-4 h-4 ml-auto text-slate-500" /> : <ChevronDown className="w-4 h-4 ml-auto text-slate-500" />}
      </button>
      {open && (
        <ol className="mt-2 text-sm text-slate-600 list-decimal pl-6 space-y-0.5">
          <li>A manager asks for a new hire (the hiring request).</li>
          <li>The department budget is checked and the founder approves.</li>
          <li>The job description is written and approved.</li>
          <li>The job is posted on your website.</li>
        </ol>
      )}
    </div>
  );
};

const Marker: React.FC<{ tone: 'start' | 'end'; text: string }> = ({ tone, text }) => (
  <div className={`text-xs font-bold rounded-full px-3 py-1.5 w-fit mx-auto ${tone === 'start' ? 'bg-sky-50 text-sky-800 border border-sky-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>{text}</div>
);
const Line: React.FC = () => <div className="w-0.5 h-4 bg-slate-300 mx-auto" aria-hidden />;

// ------------------------------------------------------------------ add-a-step picker

const GROUPS = ['Check the candidate', 'Decide', 'Talk to the candidate', 'Finish'] as const;
const StepPicker: React.FC<{ onPick: (t: StepType) => void; onClose: () => void; current: FlowStep[] }> = ({ onPick, onClose, current }) => {
  const rounds = current.filter((s) => s.type === 'interview').length;
  const has = (t: StepType) => current.some((s) => s.type === t);
  const blocked = (t: StepType): string => {
    if (t === 'interview' && rounds >= MAX_INTERVIEW_ROUNDS) return `You already have ${MAX_INTERVIEW_ROUNDS} interviews, the most allowed.`;
    if ((t === 'offer' || t === 'onboard') && has(t)) return 'You already have this step.';
    return '';
  };
  return (
    <div className="rounded-xl border-2 border-[#FA7014]/50 bg-white p-4 shadow-sm" role="dialog" aria-label="Choose a step to add">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div><h3 className="text-base font-extrabold text-slate-900">What should happen here?</h3><p className="text-xs text-slate-500">Click the one you want. You can change everything about it afterwards.</p></div>
        <button className="p-1.5 rounded-lg hover:bg-slate-100" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      {GROUPS.map((g) => (
        <div key={g} className="mb-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">{g}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {STEP_ORDER.filter((t) => STEP_INFO[t].group === g).map((t) => {
              const info = STEP_INFO[t]; const why = blocked(t);
              return (
                <button key={t} type="button" disabled={!!why} onClick={() => onPick(t)} title={why}
                  className="text-left rounded-xl border border-slate-200 p-3 hover:border-[#FA7014] hover:bg-orange-50/40 disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white flex gap-3">
                  <span className="text-2xl leading-none" aria-hidden>{info.icon}</span>
                  <span><span className="block text-sm font-bold text-slate-900">{info.label}</span><span className="block text-xs text-slate-600 mt-0.5">{why || info.does}</span>
                    <span className="block text-[11px] mt-1 font-semibold text-slate-500">{info.manual ? 'A person does this' : 'Automatic'}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ one step card

const ChipRow: React.FC<{ onInsert: (t: string) => void }> = ({ onInsert }) => (
  <div className="flex flex-wrap gap-1 mt-1">
    <span className="text-[11px] text-slate-500 mr-1 self-center">Click to put into the message:</span>
    {PLACEHOLDERS.map((p) => (
      <button key={p} type="button" onClick={() => onInsert(`{{${p}}}`)} className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 border border-slate-200 hover:bg-orange-100">{p === 'hrName' ? 'HR name' : p}</button>
    ))}
  </div>
);

interface CardProps {
  step: FlowStep; index: number; flow: Pick<FlowDoc, 'steps'>; people: Person[]; editing: boolean; open: boolean; problems: Problem[];
  onToggle: () => void; onChange: (s: FlowStep) => void; onMove: (d: -1 | 1) => void; onDelete: () => void;
}

const StepCard: React.FC<CardProps> = ({ step, index, flow, people, editing, open, problems, onToggle, onChange, onMove, onDelete }) => {
  const info = STEP_INFO[step.type];
  const later = flow.steps.slice(index + 1);
  const set = (patch: Partial<FlowStep>) => onChange({ ...step, ...patch });
  const setS = (k: string, v: any) => onChange({ ...step, settings: { ...step.settings, [k]: v } });
  const bad = problems.length > 0;
  const jumpOptions = (withNext: boolean) => (
    <>
      {withNext && <option value="next">Carry on to the next step</option>}
      <option value="reject">Reject the candidate</option>
      <option value="hold">Stop and let HR decide</option>
      {later.map((l) => <option key={l.id} value={l.id}>Skip ahead to step {flow.steps.indexOf(l) + 1}: {l.title}</option>)}
    </>
  );
  const f = CONDITION_FIELDS.find((x) => x.value === step.settings?.field);

  return (
    <div id={`step-${step.id}`} className={`rounded-xl border bg-white ${bad ? 'border-amber-400' : 'border-slate-200'} shadow-sm`}>
      <div className="flex items-start gap-3 p-3">
        <div className="flex flex-col items-center gap-1 shrink-0">
          <span className="w-8 h-8 rounded-full bg-[#FA7014] text-white text-sm font-extrabold flex items-center justify-center" aria-label={`Step ${index + 1}`}>{index + 1}</span>
          <span className="text-xl leading-none" aria-hidden>{info.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-extrabold text-slate-900">{step.title || info.label}</h4>
            <Pill tone={info.manual ? 'blue' : 'slate'}>{info.manual ? (step.ownerName ? `${step.ownerName} does this` : 'A person does this') : 'Automatic'}</Pill>
            {bad && <Pill tone="amber">Needs attention</Pill>}
          </div>
          <p className="text-xs text-slate-600 mt-1">{stepSentence(step, flow)}</p>
          {bad && !open && <p className="text-xs text-amber-800 mt-1 font-semibold">{problems[0].message}</p>}
        </div>
        {editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up" title="Move up"><ArrowUp className="w-4 h-4" /></button>
            <button className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30" disabled={index === flow.steps.length - 1} onClick={() => onMove(1)} aria-label="Move down" title="Move down"><ArrowDown className="w-4 h-4" /></button>
            <button className={btnGhost} onClick={onToggle} aria-expanded={open}>{open ? 'Done' : 'Change'}</button>
          </div>
        )}
      </div>

      {editing && open && (
        <div className="border-t border-slate-200 bg-slate-50/60 p-4 space-y-3 rounded-b-xl">
          {problems.length > 0 && <Notice tone="warn"><ul className="list-disc pl-4">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul></Notice>}
          <Field label="Name of this step" hint="This is what your team sees in their task list.">
            <input className={input} value={step.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} />
          </Field>

          {info.manual && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Who does this step?" hint="They get a task and an email.">
                <select className={`${input} ${!step.ownerUid ? 'border-amber-400' : ''}`} value={step.ownerUid || ''} onChange={(e) => set({ ownerUid: e.target.value, ownerName: people.find((p) => p.uid === e.target.value)?.name || '' })}>
                  <option value="">Choose a person...</option>
                  {people.map((p) => <option key={p.uid} value={p.uid}>{p.name}{p.title ? ` (${p.title})` : ''}</option>)}
                </select>
              </Field>
              <Field label="How many days do they get?" hint="After this the task shows as late.">
                <input className={input} type="number" min={1} max={90} value={step.deadlineDays ?? 3} onChange={(e) => set({ deadlineDays: Number(e.target.value) })} />
              </Field>
            </div>
          )}

          {step.type !== 'condition' && info.fields.map((fl) => {
            const v = step.settings?.[fl.key];
            if (step.type === 'reject' && fl.key !== 'sendEmail' && !step.settings?.sendEmail) return null;
            if (fl.kind === 'bool') return (
              <label key={fl.key} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" className="w-4 h-4" checked={!!v} onChange={(e) => setS(fl.key, e.target.checked)} />{fl.label}</label>
            );
            return (
              <Field key={fl.key} label={fl.label} hint={fl.hint}>
                {fl.kind === 'longtext' ? (<>
                  <textarea className={input} rows={5} value={v ?? ''} onChange={(e) => setS(fl.key, e.target.value)} />
                  {fl.key === 'body' && <ChipRow onInsert={(t) => setS(fl.key, `${v ?? ''}${t}`)} />}
                </>) : fl.kind === 'number' ? (
                  <input className={input} type="number" min={fl.min} max={fl.max} value={v ?? ''} onChange={(e) => setS(fl.key, e.target.value === '' ? '' : Number(e.target.value))} />
                ) : (
                  <input className={input} value={v ?? ''} onChange={(e) => setS(fl.key, e.target.value)} />
                )}
              </Field>
            );
          })}

          {step.type === 'condition' && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-slate-700 mb-1">Check this about the candidate:</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select className={input} value={step.settings?.field || ''} onChange={(e) => onChange({ ...step, settings: { ...step.settings, field: e.target.value, value: e.target.value === 'screeningOutcome' ? 'PASS' : '', ...(e.target.value === 'screeningOutcome' ? { op: '=' } : {}) } })} aria-label="What to check">
                    <option value="">Choose...</option>{CONDITION_FIELDS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <select className={input} value={step.settings?.op || ''} onChange={(e) => setS('op', e.target.value)} aria-label="How to compare">
                    <option value="">Choose...</option>{CONDITION_OPS.filter((o) => f?.kind !== 'outcome' || o.value === '=' || o.value === '!=').map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {f?.kind === 'outcome' ? (
                    <select className={input} value={step.settings?.value || ''} onChange={(e) => setS('value', e.target.value)} aria-label="Value">{Object.entries(OUTCOME_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select>
                  ) : (
                    <input className={input} type="number" value={step.settings?.value ?? ''} onChange={(e) => setS('value', e.target.value === '' ? '' : Number(e.target.value))} placeholder="Number" aria-label="Value" />
                  )}
                </div>
                {f && <p className="text-[11px] text-slate-500 mt-1">{f.hint}</p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="If the answer is YES"><select className={input} value={step.ifYes || 'next'} onChange={(e) => set({ ifYes: e.target.value })}>{jumpOptions(true)}</select></Field>
                <Field label="If the answer is NO"><select className={input} value={step.ifNo || 'next'} onChange={(e) => set({ ifNo: e.target.value })}>{jumpOptions(true)}</select></Field>
              </div>
              <Field label="If the app does not know the answer yet" hint="For example the candidate did not give their expected salary.">
                <select className={input} value={step.settings?.ifUnknown || 'ask'} onChange={(e) => setS('ifUnknown', e.target.value)}>{UNKNOWN_CHOICES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
              </Field>
            </div>
          )}

          {info.canFail && (
            <Field label="If this does not work out" hint={step.type === 'offer' ? 'For example the candidate says no or does not reply.' : 'For example the candidate does not pass.'}>
              <select className={input} value={step.onFail || 'reject'} onChange={(e) => set({ onFail: e.target.value })}>{jumpOptions(false)}</select>
            </Field>
          )}

          <div className="flex justify-between items-center pt-1">
            <button className="text-xs font-bold text-rose-700 hover:underline inline-flex items-center gap-1" onClick={onDelete}><Trash2 className="w-3.5 h-3.5" />Delete this step</button>
            <button className={btnPrimary} onClick={onToggle}>Done with this step</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ try it out

const TryItOut: React.FC<{ flow: Pick<FlowDoc, 'steps'>; onClose: () => void }> = ({ flow, onClose }) => {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const sim: SimOutput = useMemo(() => simulate(flow, answers), [flow, answers]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Try your flow">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 top-10 sm:top-0 sm:left-auto sm:w-[34rem] bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div><h2 className="text-base font-extrabold text-slate-900">Try your flow with a pretend candidate</h2><p className="text-xs text-slate-500">Nothing is sent and nobody is told. Click the answers to see where the candidate goes.</p></div>
          <button className="p-1.5 -m-1.5 rounded-lg hover:bg-slate-100" onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {flow.steps.length === 0 && <Notice tone="warn">Add a step first, then come back to try it.</Notice>}
          {sim.lines.map((l, i) => (
            <div key={i} className={`rounded-xl border p-3 text-sm ${l.text.startsWith('End:') ? 'bg-emerald-50 border-emerald-200 font-bold text-emerald-900' : 'bg-white border-slate-200 text-slate-800'}`}>
              {l.text}
              {l.ask && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {l.ask.options.map((o) => <button key={o.value} className={btnPrimary} onClick={() => setAnswers((a) => ({ ...a, [l.stepId]: o.value }))}>{o.label}</button>)}
                </div>
              )}
              {!l.ask && !l.text.startsWith('End:') && answers[l.stepId] && (
                <button className="block mt-1.5 text-[11px] font-bold text-slate-500 hover:underline" onClick={() => setAnswers((a) => { const n = { ...a }; delete n[l.stepId]; return n; })}>Change this answer</button>
              )}
            </div>
          ))}
          {sim.ended === 'FELL_OFF' && <Notice tone="error">This flow does not end in a hire or a rejection. Fix it before publishing.</Notice>}
        </div>
        <div className="border-t border-slate-200 px-5 py-3 bg-slate-50 flex justify-between">
          <button className={btnGhost} onClick={() => setAnswers({})}>Start over</button>
          <button className={btnPrimary} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ the whole screen

const useDebounced = (fn: () => void, deps: unknown[], ms: number, enabled: boolean) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!enabled) return; const t = setTimeout(fn, ms); return () => clearTimeout(t); }, deps);
};

export const FlowBuilder: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const { data, error, loading, reload } = useLoad(() => flowService.state(), []);
  const { busy, note, setNote, run } = useRunner();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [trying, setTrying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const loadedDraft = useRef<string | null>(null);

  const st = data as (FlowState & { success: true }) | null;
  const draft = st?.draft || null;
  const live = st?.active || null;
  const people = st?.people || [];

  // Pick up the draft from the server once (and again when a different draft appears).
  useEffect(() => {
    if (draft && loadedDraft.current !== draft.id) { loadedDraft.current = draft.id; setName(draft.name); setSteps(draft.steps); setDirty(false); setSaved('idle'); }
    if (!draft) loadedDraft.current = null;
  }, [draft]);

  const flowNow = useMemo(() => ({ name, steps }), [name, steps]);
  const problems = useMemo(() => validateFlow(flowNow), [flowNow]);
  const byStep = (id: string) => problems.filter((p) => p.stepId === id);
  const general = problems.filter((p) => !p.stepId);

  const edit = useCallback((fn: (s: FlowStep[]) => FlowStep[]) => { setSteps((s) => fn(s)); setDirty(true); setSaved('idle'); }, []);

  // Everything is saved by itself a moment after the last change, so nothing is ever lost.
  const save = useCallback(async () => {
    setSaved('saving');
    try { await flowService.save(name, steps); setSaved('saved'); setDirty(false); } catch { setSaved('error'); }
  }, [name, steps]);
  useDebounced(save, [name, steps], 900, dirty && !!draft);

  const finish = async () => { onChanged?.(); await reload(); };
  const publishLabel = `Publish as Version ${(Math.max(0, ...(st?.versions.map((v) => v.version) || [0]))) + 1}`;

  if (loading && !st) return <Loading loading />;
  if (error && !st) return <Loading error={error} />;
  if (!st) return null;
  if (!st.canManage) return <Notice tone="info">Only the people who manage hiring can change the hiring flow. You can see your own tasks under "My tasks".</Notice>;

  // ---------------- nothing built yet
  if (!draft && !live) {
    return (
      <div className="space-y-4 max-w-3xl">
        <FixedPart />
        <Card>
          <h2 className="text-lg font-extrabold text-slate-900">Set up how you hire, step by step</h2>
          <p className="text-sm text-slate-600 mt-1">After someone applies, they go through a list of steps: check them, interview them, make an offer, welcome them. You decide the steps and who does each one. The app does the boring parts (emails, waiting, reminders) by itself.</p>
          <ol className="mt-4 grid gap-2 sm:grid-cols-5 text-center text-xs font-bold">
            {['Candidate applies', 'We score the resume', 'Phone screening', 'Interview', 'Offer and joining'].map((t, i) => (
              <li key={t} className="rounded-xl bg-orange-50 border border-orange-200 text-slate-800 px-2 py-3"><span className="block text-[#FA7014] text-base">{i + 1}</span>{t}</li>
            ))}
          </ol>
          <p className="text-xs text-slate-500 mt-2">This is the standard process. You can add, remove and change anything afterwards.</p>
          {note && <div className="mt-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-3">
            <button className={btnBig} disabled={busy} onClick={() => run(async () => { await flowService.startStandard(); await finish(); })}>Start with the standard process (easiest)</button>
            <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await flowService.save('Our hiring flow', []); await finish(); })}>Start with an empty flow</button>
          </div>
        </Card>
      </div>
    );
  }

  // ---------------- a live flow and no draft: read only, with one clear way to change it
  if (!draft && live) {
    return (
      <div className="space-y-4 max-w-3xl">
        <FixedPart />
        <Card title={<>{live.name} <Pill tone="green">Version {live.version} is live</Pill></>} subtitle={live.activatedAt ? `Published ${niceDate(live.activatedAt.slice(0, 10))}${live.activatedBy ? ` by ${live.activatedBy}` : ''}. Every new applicant follows these steps.` : undefined}
          right={<button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await flowService.edit(); await finish(); })}>Change this flow</button>}>
          {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
          <div className="space-y-0">
            <Marker tone="start" text="Applicant applies" />
            {live.steps.map((s, i) => (<React.Fragment key={s.id}><Line /><StepCard step={s} index={i} flow={live} people={people} editing={false} open={false} problems={[]} onToggle={() => undefined} onChange={() => undefined} onMove={() => undefined} onDelete={() => undefined} /></React.Fragment>))}
            <Line /><Marker tone="end" text="Hired, or rejected" />
          </div>
          <p className="text-xs text-slate-500 mt-4">When you change the flow, you work on a copy. Nothing changes for anyone until you publish it, and applicants already in the flow finish on the version they started with.</p>
        </Card>
        {st.versions.length > 1 && (
          <Card title="Earlier versions">
            <ul className="divide-y divide-slate-100 text-sm">
              {st.versions.map((v) => (<li key={v.id} className="py-2 flex flex-wrap gap-x-3"><b>Version {v.version}</b><span className="text-slate-500">{v.activatedAt ? niceDate(v.activatedAt.slice(0, 10)) : ''}{v.activatedBy ? ` · ${v.activatedBy}` : ''} · {v.steps} steps</span>{v.note && <span className="text-slate-600">"{v.note}"</span>}{v.status === 'ACTIVE' && <Pill tone="green">Live</Pill>}</li>))}
            </ul>
          </Card>
        )}
      </div>
    );
  }

  // ---------------- editing a draft
  const ready = problems.length === 0;
  const insertAt = (i: number, t: StepType) => {
    const s = makeStep(t, steps, st.me.uid && STEP_INFO[t].manual ? { ownerUid: st.me.uid, ownerName: st.me.name } : {});
    // A new step that can fail sends people to "reject" by default; a new "Reject" step at the end gives that a real home.
    edit((cur) => { const n = [...cur]; n.splice(i, 0, s); return n; });
    setOpen(s.id); setAdding(null);
    setTimeout(() => document.getElementById(`step-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };
  const adder = (i: number) => (adding === i ? <StepPicker current={steps} onPick={(t) => insertAt(i, t)} onClose={() => setAdding(null)} /> : (
    <button type="button" onClick={() => setAdding(i)} className="group mx-auto flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#FA7014] py-0.5" aria-label={`Add a step ${i === 0 ? 'at the start' : `after step ${i}`}`}>
      <span className="w-6 h-6 rounded-full border-2 border-dashed border-slate-300 group-hover:border-[#FA7014] flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></span>Add a step here
    </button>
  ));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
      <div className="space-y-3 min-w-0">
        <FixedPart />
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[12rem]"><Field label="Name of your flow"><input className={input} value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setDirty(true); setSaved('idle'); }} /></Field></div>
            <div className="text-xs font-semibold pb-2.5" aria-live="polite">
              {saved === 'saving' && <span className="text-slate-500">Saving...</span>}
              {saved === 'saved' && <span className="text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />Saved</span>}
              {saved === 'error' && <span className="text-rose-700">Could not save. <button className="underline" onClick={save}>Try again</button></span>}
              {saved === 'idle' && <span className="text-slate-400">Saves by itself</span>}
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2"><b>This is a draft.</b> {live ? `Applicants keep following Version ${live.version} until you publish.` : 'Nobody follows it until you publish it.'}</p>
        </Card>

        <div className="space-y-0">
          <Marker tone="start" text="Applicant applies" />
          <Line />
          {adder(0)}
          {steps.map((s, i) => (
            <React.Fragment key={s.id}>
              <Line />
              <StepCard step={s} index={i} flow={flowNow} people={people} editing open={open === s.id} problems={byStep(s.id)}
                onToggle={() => setOpen(open === s.id ? null : s.id)}
                onChange={(n) => edit((cur) => cur.map((x) => (x.id === s.id ? n : x)))}
                onMove={(d) => edit((cur) => { const n = [...cur]; const j = i + d; if (j < 0 || j >= n.length) return cur; [n[i], n[j]] = [n[j], n[i]]; return n; })}
                onDelete={() => { edit((cur) => cur.filter((x) => x.id !== s.id).map((x) => ({ ...x, ...(x.onFail === s.id ? { onFail: 'reject' } : {}), ...(x.ifYes === s.id ? { ifYes: 'next' } : {}), ...(x.ifNo === s.id ? { ifNo: 'next' } : {}) }))); setOpen(null); }} />
              <Line />
              {adder(i + 1)}
            </React.Fragment>
          ))}
          <Line /><Marker tone="end" text="Hired, or rejected" />
        </div>
      </div>

      <aside className="lg:sticky lg:top-2 space-y-3" aria-label="Is your flow ready?">
        <Card>
          <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">{ready ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}{ready ? 'Everything looks good' : `${problems.length} thing${problems.length === 1 ? '' : 's'} to fix`}</h3>
          {ready ? <p className="text-xs text-slate-600 mt-1">You can try it out and publish it.</p> : (
            <ul className="mt-2 space-y-1.5 text-xs">
              {general.map((p, i) => <li key={`g${i}`} className="text-amber-900 bg-amber-50 rounded-lg px-2 py-1.5">{p.message}</li>)}
              {problems.filter((p) => p.stepId).map((p, i) => (
                <li key={i}><button className="text-left w-full text-amber-900 bg-amber-50 hover:bg-amber-100 rounded-lg px-2 py-1.5" onClick={() => { setOpen(p.stepId!); setTimeout(() => document.getElementById(`step-${p.stepId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); }}>{p.message}</button></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          {note && <div className="mb-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
          <div className="space-y-2">
            <button className={`${btnGhost} w-full`} onClick={() => setTrying(true)}><Play className="w-4 h-4" />Try it with a pretend candidate</button>
            {!confirming ? (
              <button className={`${btnBig} w-full`} disabled={!ready || busy} onClick={() => setConfirming(true)}>{publishLabel}</button>
            ) : (
              <div className="rounded-xl border-2 border-[#FA7014]/50 p-3 text-xs space-y-2">
                <p className="font-bold text-slate-900">Publish now?</p>
                <p className="text-slate-600">New applicants will follow this flow. {live ? `Applicants already in the flow finish on Version ${live.version}.` : ''}</p>
                <div className="flex gap-2">
                  <button className={btnPrimary} disabled={busy} onClick={() => run(async () => {
                    try { await flowService.save(name, steps); await flowService.activate(); setConfirming(false); await finish(); }
                    catch (e: any) { setConfirming(false); throw e; }
                  }, 'Published. Your new applicants will follow this flow.')}>Yes, publish</button>
                  <button className={btnGhost} onClick={() => setConfirming(false)}>Not yet</button>
                </div>
              </div>
            )}
            {!ready && <p className="text-[11px] text-slate-500">Publishing unlocks when everything on the list above is fixed.</p>}
            <div className="pt-1 text-center">
              {live ? (
                <button className="text-xs font-bold text-slate-500 hover:text-rose-700 hover:underline" disabled={busy} onClick={() => { if (window.confirm('Throw away your changes and keep the live flow as it is?')) run(async () => { await flowService.discard(); loadedDraft.current = null; await finish(); }); }}>Throw away my changes</button>
              ) : (
                <button className="text-xs font-bold text-slate-500 hover:text-rose-700 hover:underline" disabled={busy} onClick={() => { if (window.confirm('Delete this draft and start again?')) run(async () => { await flowService.discard(); loadedDraft.current = null; await finish(); }); }}>Delete this draft</button>
              )}
            </div>
          </div>
        </Card>
      </aside>

      {trying && <TryItOut flow={flowNow} onClose={() => setTrying(false)} />}
    </div>
  );
};
