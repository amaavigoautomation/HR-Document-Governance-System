import React, { useState } from 'react';
import { ArrowLeft, Check, X, Upload } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, useLoad } from '../common/loadUi';
import { Card, Field, Notice, btnGhost, btnPrimary, input, todayIst, addDaysIso, useRunner } from '../leave/ui';
import { Empty, GuardedButton, Intro, Note, ResultNote, StatusChip } from './common';
import { GROWTH_WORDS, kpiProblem } from '../../../shared/pmEngine';
import type { Go } from './Home';

/** A manager's page: the team at a glance, then each kind of task in its own box. */
export const Team: React.FC<{ go: Go }> = ({ go }) => {
  const { data, error, loading, reload } = useLoad(() => pmService.get('team'), []);
  if (!data) return <Loading error={error} loading={loading} />;
  return (
    <div className="space-y-4">
      <Intro title="My team" what="The people who report to you: their targets, work to verify, check-ins, reviews and growth plans." todo="Work through the boxes from top to bottom. Empty boxes mean nothing is waiting." />
      <Card title="People">
        {data.people.length === 0 ? <Empty text="Nobody reports to you in the portal." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Person</th><th>Targets</th><th>Latest review</th><th className="text-right">Work to verify</th></tr></thead>
            <tbody>{data.people.map((p: any) => (
              <tr key={p.uid} className="border-t border-slate-100">
                <td className="py-1.5"><b>{p.name}</b><div className="text-xs text-slate-500">{p.designation}</div></td>
                <td>{p.plan ? (p.plan.status === 'SET_TARGETS' ? <button className={btnPrimary} onClick={() => go.targets(p.plan.id)}>Set targets</button> : <StatusChip status={p.plan.status} kind="plan" />) : '-'}
                  {p.plan?.status === 'ON_HOLD' && <div className="text-[11px] text-amber-700 mt-0.5">{p.plan.holds.join(' ')}</div>}</td>
                <td>{p.review ? <button className="text-left" onClick={() => go.review(p.review.id)}><StatusChip status={p.review.status} kind="review" /><div className="text-[11px] text-slate-500">{p.review.cycleName}</div></button> : '-'}</td>
                <td className="text-right">{p.pending || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <VerifyBox items={data.evidence} reload={reload} />
      <CheckinBox items={data.checkins} reload={reload} />
      <GrowthBox items={data.growth} reload={reload} />
      <ImportBox reload={reload} />
    </div>
  );
};

const VerifyBox: React.FC<{ items: any[]; reload: () => void }> = ({ items, reload }) => {
  const { busy, note, run } = useRunner();
  const [why, setWhy] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState('');
  return (
    <Card title={`Work to verify${items.length ? ` (${items.length})` : ''}`} subtitle="Does this work count toward the KPI? Verified work shows up in the review. It never becomes a rating on its own.">
      <ResultNote note={note} />
      {items.length === 0 ? <Empty text="Nothing to verify." /> : items.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2 text-sm">
          <span><b>{e.name}</b> · {e.date} · {e.link ? <a className="underline" href={e.link} target="_blank" rel="noreferrer">{e.title}</a> : e.title} <span className="text-xs text-slate-500">→ {e.kpiName}</span></span>
          {rejecting === e.id ? (
            <span className="flex gap-2 items-center">
              <input className={input} placeholder="Why does it not count?" value={why[e.id] || ''} onChange={(ev) => setWhy({ ...why, [e.id]: ev.target.value })} />
              <GuardedButton busy={busy} missing={(why[e.id] || '').trim().length < 3 ? ['you say why'] : []} onClick={() => run(async () => { await pmService.post('ev-verify', { id: e.id, ok: false, note: why[e.id] }); setRejecting(''); reload(); }, 'Marked as not counting.')}>Confirm</GuardedButton>
              <button className={btnGhost} onClick={() => setRejecting('')}>Cancel</button>
            </span>
          ) : (
            <span className="flex gap-2">
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('ev-verify', { id: e.id, ok: true }); reload(); }, 'Verified.')}><Check className="w-4 h-4" />Counts</button>
              <button className={btnGhost} disabled={busy} onClick={() => setRejecting(e.id)}><X className="w-4 h-4" />Does not count</button>
            </span>
          )}
        </div>
      ))}
    </Card>
  );
};

const CheckinBox: React.FC<{ items: any[]; reload: () => void }> = ({ items, reload }) => {
  const [open, setOpen] = useState('');
  const [comment, setComment] = useState('');
  const { busy, note, run } = useRunner();
  return (
    <Card title={`Monthly check-ins${items.length ? ` (${items.length})` : ''}`} subtitle="Talk for a few minutes: what went well, what is blocking, focus for next month. Then write a one-line summary.">
      <ResultNote note={note} />
      {items.length === 0 ? <Empty text="No check-ins waiting." /> : items.map((ci) => (
        <div key={ci.id} className="border-t border-slate-100 py-2">
          <div className="flex items-center justify-between"><span className="text-sm"><b>{ci.name}</b> · {ci.month}</span>{open !== ci.id && <button className={btnGhost} onClick={() => { setOpen(ci.id); setComment(ci.managerComment || ''); }}>Do the check-in</button>}</div>
          {open === ci.id && (
            <div className="mt-2 space-y-2">
              {(ci.wentWell || ci.blockers || ci.nextFocus) ? <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2">Their notes: went well: {ci.wentWell || '-'} · blocking: {ci.blockers || '-'} · next: {ci.nextFocus || '-'}</div> : <p className="text-xs text-slate-500">They did not add notes (that is fine).</p>}
              <Note label="Summary of the conversation" rows={2} value={comment} onChange={setComment} />
              <GuardedButton busy={busy} missing={comment.trim().length < 5 ? ['you write a short summary'] : []} onClick={() => run(async () => { await pmService.post('checkin-save', { id: ci.id, managerComment: comment, done: true }); setOpen(''); reload(); }, 'Check-in done.')}>Mark done</GuardedButton>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
};

const GrowthBox: React.FC<{ items: any[]; reload: () => void }> = ({ items, reload }) => {
  const [edit, setEdit] = useState<any>(null);
  const { busy, note, run } = useRunner();
  const save = (confirm: boolean) => run(async () => { await pmService.post('growth-save', { ...edit, actions: edit.actions.filter((a: any) => a.text.trim()), confirm }); setEdit(null); reload(); }, confirm ? 'Confirmed and shared.' : 'Saved.');
  const missing = edit ? [
    edit.objective.trim().length < 5 && 'you write the objective',
    !(edit.reviewDate > todayIst()) && 'you pick a follow-up date in the future',
    edit.type !== 'RECOGNITION' && !edit.actions.some((a: any) => a.text.trim()) && 'you add at least one action',
    edit.type === 'IMPROVEMENT' && edit.expected.trim().length < 5 && 'you write the expected standard',
    edit.type === 'IMPROVEMENT' && edit.support.trim().length < 5 && 'you write the support you will give',
  ].filter(Boolean) as string[] : [];
  return (
    <Card title={`Growth plans${items.length ? ` (${items.length})` : ''}`} subtitle="After each review the system drafts a plan from the outcome. Check it, change anything, and confirm.">
      <ResultNote note={note} />
      {items.length === 0 ? <Empty text="No growth plans waiting." /> : items.map((g) => (
        <div key={g.id} className="border-t border-slate-100 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm"><b>{g.name}</b> · {GROWTH_WORDS[g.type as keyof typeof GROWTH_WORDS]} after {g.cycleName}</span>
            <span className="flex gap-2 items-center"><StatusChip status={g.status} kind="growth" />
              {g.status === 'PROPOSED' && edit?.id !== g.id && <button className={btnPrimary} onClick={() => setEdit({ id: g.id, type: g.type, objective: g.objective, expected: g.expected || '', support: g.support || '', reviewDate: g.reviewDate, actions: [...g.actions, { text: '' }] })}>Check and confirm</button>}
              {g.status === 'ACTIVE' && <CloseGrowth g={g} reload={reload} />}
            </span>
          </div>
          {edit?.id === g.id && (
            <div className="mt-2 space-y-2">
              <Field label="Type"><select className={input} value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{Object.entries(GROWTH_WORDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Note label="Objective" rows={2} value={edit.objective} onChange={(v) => setEdit({ ...edit, objective: v })} />
              {edit.type === 'IMPROVEMENT' && <div className="grid md:grid-cols-2 gap-2"><Note label="Expected standard" rows={2} value={edit.expected} onChange={(v) => setEdit({ ...edit, expected: v })} /><Note label="Support you will give" rows={2} value={edit.support} onChange={(v) => setEdit({ ...edit, support: v })} /></div>}
              {edit.type !== 'RECOGNITION' && <Field label="Actions (training, coaching, a stretch task…)">
                <div className="space-y-1">{edit.actions.map((a: any, i: number) => <input key={i} className={input} value={a.text} placeholder={`Action ${i + 1}`} onChange={(e) => { const actions = edit.actions.map((x: any, j: number) => (j === i ? { ...x, text: e.target.value } : x)); if (i === actions.length - 1 && e.target.value) actions.push({ text: '' }); setEdit({ ...edit, actions }); }} />)}</div>
              </Field>}
              <Field label="Follow-up date"><input type="date" className={input} min={addDaysIso(todayIst(), 1)} value={edit.reviewDate} onChange={(e) => setEdit({ ...edit, reviewDate: e.target.value })} /></Field>
              <div className="flex gap-2 items-start"><GuardedButton busy={busy} missing={missing} onClick={() => save(true)}>Confirm and share</GuardedButton><button className={btnGhost} onClick={() => save(false)}>Save for later</button><button className={btnGhost} onClick={() => setEdit(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
};

const CloseGrowth: React.FC<{ g: any; reload: () => void }> = ({ g, reload }) => {
  const [open, setOpen] = useState(false); const [outcome, setOutcome] = useState('');
  const { busy, run } = useRunner();
  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>Record outcome</button>;
  return (
    <span className="flex gap-2 items-center">
      <input className={input} placeholder="What happened?" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      <GuardedButton busy={busy} missing={outcome.trim().length < 5 ? ['you write the outcome'] : []} onClick={() => run(async () => { await pmService.post('growth-close', { id: g.id, outcome }); reload(); }, 'Completed.')}>Complete</GuardedButton>
    </span>
  );
};

/** Upload a CSV of finished work (from a task tool or a sheet). Rows that match nobody are listed, never guessed. */
export const ImportBox: React.FC<{ reload: () => void }> = ({ reload }) => {
  const { busy, note, run } = useRunner();
  const [problems, setProblems] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const onFile = (f: File | undefined) => {
    if (!f) return;
    setMsg('');
    f.text().then((csv) => run(async () => { const r = await pmService.post('ev-import', { csv }); setProblems(r.problems || []); setMsg(r.message || ''); reload(); }));
  };
  return (
    <Card title="Import work from a file" subtitle="Optional. A CSV with columns: email, date (YYYY-MM-DD), kpi (the KPI wording), title, link. Imported work waits for the manager to verify it.">
      {msg && <Notice tone="ok">{msg}</Notice>}
      <ResultNote note={note} />
      <label className={`${btnGhost} cursor-pointer`}><Upload className="w-4 h-4" />Choose CSV file<input type="file" accept=".csv,text/csv" className="hidden" disabled={busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      {problems.length > 0 && <ul className="mt-2 text-xs text-rose-700 list-disc pl-5 space-y-0.5">{problems.slice(0, 20).map((p, i) => <li key={i}>{p}</li>)}{problems.length > 20 && <li>…and {problems.length - 20} more</li>}</ul>}
    </Card>
  );
};

/** The manager fills one box per KPI. "Send to HR" stays locked until every target is filled and weights total 100. */
export const TargetsScreen: React.FC<{ id: string; back: () => void }> = ({ id, back }) => {
  const { data, error, loading } = useLoad(() => pmService.get('plan', { id }), [id]);
  const [kpis, setKpis] = useState<any[] | null>(null);
  const { busy, note, run } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const plan = data.plan;
  const rows = kpis || plan.kpis.map((k: any) => ({ ...k }));
  const total = rows.reduce((s: number, k: any) => s + (Number(k.weight) || 0), 0);
  const weightProblem = kpiProblem(rows.map((k: any) => ({ ...k, weight: Number(k.weight) })));
  const missing = [...rows.filter((k: any) => !String(k.target || '').trim()).map((k: any) => `a target for "${k.kpi}"`), ...(weightProblem ? [weightProblem.replace(/\.$/, '')] : [])];
  const save = (send: boolean) => run(async () => { await pmService.post('plan-targets', { id, kpis: rows.map((k: any) => ({ id: k.id, target: k.target, weight: Number(k.weight) })), send }); if (send) back(); }, send ? 'Sent to HR for approval.' : 'Saved.');
  return (
    <div>
      <button className={`${btnGhost} mb-3`} onClick={back}><ArrowLeft className="w-4 h-4" />Back</button>
      <Intro title={`Targets for ${plan.name}`} what={`${plan.designation} · ${plan.department}. The KPIs come from HR's template for this role. You set the numbers.`} todo="Fill one target per KPI (a number, a % or a deadline), then press Send to HR." />
      {plan.hrNote && <Notice tone="warn">HR asked for a change: "{plan.hrNote}"</Notice>}
      <ResultNote note={note} />
      {!data.canSetTargets ? <Notice tone="info">These targets are not waiting for you ({plan.status.replace(/_/g, ' ').toLowerCase()}).</Notice> : (
        <Card>
          <div className="space-y-3">
            {rows.map((k: any, i: number) => (
              <div key={k.id} className="grid md:grid-cols-[1fr_1fr_90px] gap-2 items-end border-b border-slate-100 pb-3">
                <div><b className="text-sm">{k.kpi}</b><div className="text-xs text-slate-500">{k.kra}{k.measure ? ` · measured by ${k.measure}` : ''}</div></div>
                <Field label="Target"><input className={input} value={k.target || ''} placeholder="e.g. 20 per month, 95% on time" onChange={(e) => setKpis(rows.map((x: any, j: number) => (j === i ? { ...x, target: e.target.value } : x)))} /></Field>
                <Field label="Weight %"><input type="number" min={1} max={100} className={input} value={k.weight} onChange={(e) => setKpis(rows.map((x: any, j: number) => (j === i ? { ...x, weight: e.target.value } : x)))} /></Field>
              </div>
            ))}
            <p className={`text-xs font-bold ${total === 100 ? 'text-emerald-700' : 'text-rose-700'}`}>Weights total: {total}% {total === 100 ? '✓' : '(must be 100%)'}</p>
            <div className="flex gap-2 items-start"><GuardedButton busy={busy} missing={missing} onClick={() => save(true)}>Send to HR</GuardedButton><button className={btnGhost} disabled={busy || !!weightProblem} onClick={() => save(false)}>Save for later</button></div>
          </div>
        </Card>
      )}
    </div>
  );
};
