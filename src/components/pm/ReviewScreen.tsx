import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, Pill } from '../common/loadUi';
import { Card, Field, Notice, btnBig, btnGhost, btnPrimary, input, useRunner, ConfirmButton } from '../leave/ui';
import { Empty, Explain, Intro, Note, RatingPick, ResultNote, StatusChip, Steps, RATING_WORDS, money } from './common';

const STEPS = [
  { key: 'OPEN', label: 'Self-assessment' }, { key: 'SELF_ASSESSED', label: 'Manager evaluates' }, { key: 'MANAGER_EVALUATED', label: 'Discussion' }, { key: 'DISCUSSED', label: 'HR check' },
  { key: 'HR_REVIEWED', label: 'Approval' }, { key: 'APPROVED', label: 'Shared' }, { key: 'PUBLISHED', label: 'Employee responds' }, { key: 'ACKNOWLEDGED', label: 'Done' },
];
const stepIndex = (s: string) => { const i = STEPS.findIndex((x) => x.key === s); return s === 'DISPUTED' ? 6 : s === 'DEFERRED' || s === 'CONFIGURATION_PENDING' ? 0 : i < 0 ? 0 : i; };

const NEXT: Record<string, string> = {
  OPEN: 'The employee writes a self-assessment.', SELF_ASSESSED: 'The manager rates each target and behaviour, using evidence.', MANAGER_EVALUATED: 'The manager talks it through with the employee, then records that it happened.',
  DISCUSSED: 'HR checks that it is complete and fair.', HR_REVIEWED: 'An authorized approver (not the employee, not the manager alone) gives the final rating.', APPROVED: 'HR or the approver shares it with the employee.',
  PUBLISHED: 'The employee reads it and either agrees or records that they disagree.', ACKNOWLEDGED: 'Finished. Next: a development plan and the next cycle.', DISPUTED: 'The disagreement is recorded as written. HR holds a formal review.',
  DEFERRED: 'Paused (for example approved long leave). HR can resume it.', CONFIGURATION_PENDING: 'This review cannot start until the missing setup is done. See the reasons below.',
};

export const ReviewList: React.FC<{ scope: 'team' | 'all' | 'approve'; open: (id: string) => void; title: string; what: string; todo?: string }> = ({ scope, open, title, what, todo }) => {
  const [items, setItems] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null); const [f, setF] = useState('');
  useEffect(() => { pmService.get('review-list', { scope }).then((r) => setItems(r.items)).catch((e) => setErr(e.message)); }, [scope]);
  if (!items) return <Loading error={err} loading={!err} />;
  const shown = items.filter((r) => !f || `${r.employeeName} ${r.cycleName} ${r.department}`.toLowerCase().includes(f.toLowerCase()));
  return (
    <div>
      <Intro title={title} what={what} todo={todo} />
      <input className={`${input} mb-3 max-w-xs`} placeholder="Search by name" value={f} onChange={(e) => setF(e.target.value)} aria-label="Search" />
      {shown.length === 0 ? <Empty text="Nothing here." /> : (
        <div className="space-y-2">{shown.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="min-w-0"><div className="text-sm font-bold text-slate-800">{r.employeeName} <span className="text-xs font-medium text-slate-400">{r.department}</span></div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1"><span className="text-xs text-slate-500">{r.cycleName}</span><StatusChip status={r.status} />{r.overdue && <Pill tone="red">overdue (was due {r.due})</Pill>}{r.leaveFlag >= 30 && <Pill tone="amber">long leave</Pill>}</div>
              {r.blockers?.length > 0 && <div className="text-xs text-amber-700 mt-1">{r.blockers[0]}</div>}</div>
            <button className={btnPrimary} onClick={() => open(r.id)}>Open</button>
          </div>
        ))}</div>
      )}
    </div>
  );
};

/** One review, start to finish. What you see depends on who you are and where the review is. */
export const ReviewScreen: React.FC<{ id: string; back: () => void }> = ({ id, back }) => {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [tick, setTick] = useState(0);
  useEffect(() => { setD(null); pmService.get('review-get', { id }).then(setD).catch((e) => setErr(e.message)); }, [id, tick]);
  const reload = () => setTick((t) => t + 1);
  if (!d) return <div><button className={btnGhost} onClick={back}><ArrowLeft className="w-4 h-4" />Back</button><div className="mt-3"><Loading error={err} loading={!err} /></div></div>;
  const rv = d.item;
  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={back}><ArrowLeft className="w-4 h-4" />Back to the list</button>
      <div>
        <h2 className="text-lg font-extrabold text-slate-900">{rv.employeeName} <span className="text-slate-400 font-medium">- {rv.cycleName}</span></h2>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500"><StatusChip status={rv.status} /><span>{rv.periodStart} to {rv.periodEnd}</span><span>Manager: {rv.managerName || 'none'}</span></div>
      </div>
      <Steps steps={STEPS} current={stepIndex(rv.status)} />
      <Notice tone={rv.status === 'CONFIGURATION_PENDING' ? 'warn' : 'info'}><b>What happens next:</b> {NEXT[rv.status]}</Notice>
      {rv.blockers?.length > 0 && rv.status === 'CONFIGURATION_PENDING' && <Card title="Why this is waiting"><ul className="list-disc pl-5 text-sm space-y-1">{rv.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></Card>}
      {rv.leaveFlag >= 30 && <Notice tone="warn">{rv.employeeName} was on approved leave for {rv.leaveFlag} days of this period. HR can pause or adjust this review.</Notice>}
      <Body d={d} reload={reload} />
      <Scores d={d} />
      <Timeline rv={rv} approvals={d.approvals} />
    </div>
  );
};

const Body: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const rv = d.item; const role = d.role; const s = rv.status;
  const isEmp = role === 'EMPLOYEE'; const isMgr = role === 'MANAGER';
  return (
    <div className="space-y-4">
      {isEmp && s === 'OPEN' && <SelfForm d={d} reload={reload} />}
      {isEmp && ['SELF_ASSESSED', 'MANAGER_EVALUATED', 'DISCUSSED', 'HR_REVIEWED', 'APPROVED'].includes(s) && <Card><p className="text-sm text-slate-700">You have submitted your self-assessment. The next steps are done by others. You will be told when your review is shared with you.</p></Card>}
      {isEmp && ['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'].includes(s) && <Result d={d} reload={reload} />}
      {!isEmp && <SelfRead d={d} />}
      {isMgr && ['OPEN'].includes(s) && <Waive d={d} reload={reload} />}
      {!isEmp && ['SELF_ASSESSED', 'MANAGER_EVALUATED', 'DISCUSSED', 'HR_REVIEWED'].includes(s) && <ReviewPack d={d} />}
      {isMgr && ['SELF_ASSESSED', 'MANAGER_EVALUATED'].includes(s) && <ManagerForm d={d} reload={reload} />}
      {isMgr && s === 'MANAGER_EVALUATED' && <Discuss d={d} reload={reload} />}
      {!isEmp && s === 'DISCUSSED' && d.canHr && <HrCheck d={d} reload={reload} />}
      {!isEmp && s === 'HR_REVIEWED' && d.canApprove && <Approve d={d} reload={reload} />}
      {!isEmp && s === 'HR_REVIEWED' && !d.canApprove && <Notice tone="info">Waiting for an authorized approver.</Notice>}
      {!isEmp && s === 'APPROVED' && (d.canHr || d.canApprove) && <Publish d={d} reload={reload} />}
      {!isEmp && s === 'DISPUTED' && (d.canHr || d.canApprove) && <Resolve d={d} reload={reload} />}
      {!isEmp && ['APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'].includes(s) && d.canApprove && <Amend d={d} reload={reload} />}
      {!isEmp && ['APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'].includes(s) && <FinalView rv={rv} />}
      {!isEmp && d.canHr && !['APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'DEFERRED', 'CONFIGURATION_PENDING'].includes(s) && <Defer d={d} reload={reload} />}
      {!isEmp && d.canHr && s === 'DEFERRED' && <Card><button className={btnPrimary} onClick={() => pmService.post('review-defer', { id: rv.id, resume: true }).then(reload)}>Resume this review</button></Card>}
      {!isEmp && <AiBox d={d} />}
    </div>
  );
};

// ------------------------------------------------------------------ employee: self-assessment

const SelfForm: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const rv = d.item;
  const [s, setS] = useState({ achievements: rv.self?.achievements || '', improvements: rv.self?.improvements || '', trainingNeeds: rv.self?.trainingNeeds || '', comments: rv.self?.comments || '' });
  const [comps, setComps] = useState<Record<string, any>>(() => Object.fromEntries(d.comps.map((c: any) => [c.competencyId, { selfRating: c.selfRating, selfEvidence: c.selfEvidence }])));
  const [kpis, setKpis] = useState<Record<string, string>>(() => Object.fromEntries((rv.kpis || []).map((k: any) => [k.targetId, k.employeeNote || ''])));
  const [evIds, setEvIds] = useState<Record<string, string[]>>(() => Object.fromEntries((rv.kpis || []).map((k: any) => [k.targetId, k.evidenceIds || []])));
  const [fillNote, setFillNote] = useState('');
  const { busy, note, run } = useRunner();
  const payload = (submit: boolean) => ({ id: rv.id, submit, ...s, comps: Object.entries(comps).map(([competencyId, v]: any) => ({ competencyId, ...v })), kpis: Object.entries(kpis).map(([targetId, employeeNote]) => ({ targetId, employeeNote, evidenceIds: evIds[targetId] || [] })) });
  // Fills what is still empty from the work recorded for this person. Nothing already written is overwritten.
  const fill = () => run(async () => {
    const r = await pmService.get('self-prefill', { reviewId: rv.id });
    setFillNote(r.note || '');
    if (r.achievements) setS((cur) => ({ ...cur, achievements: cur.achievements.trim() ? cur.achievements : r.achievements }));
    setKpis((cur) => { const n = { ...cur }; for (const k of r.kpis || []) if (!n[k.targetId]?.trim() && k.employeeNote) n[k.targetId] = k.employeeNote; return n; });
    setEvIds((cur) => { const n = { ...cur }; for (const k of r.kpis || []) n[k.targetId] = Array.from(new Set([...(n[k.targetId] || []), ...k.evidenceIds])).slice(0, 30); return n; });
  });
  const left = d.comps.filter((c: any) => !comps[c.competencyId]?.selfRating).length;
  return (
    <Card title="Your self-assessment" subtitle="Be honest and specific. Your manager will also see your examples. You can save and come back.">
      <div className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center gap-3"><button className={btnGhost} disabled={busy} onClick={fill}>Fill empty boxes from my recorded work</button><span className="text-xs text-slate-600">{fillNote || 'Uses the work already recorded for you in this period. You check it and make it yours. Anything you have written stays as it is.'}</span></div>
        <Note label="1. What did you achieve in this period?" value={s.achievements} onChange={(v) => setS({ ...s, achievements: v })} hint="Examples with results are best, like 'Closed 14 tickets a week, up from 10'." />
        {(rv.kpis || []).length > 0 && (
          <div className="space-y-2"><div className="text-xs font-bold text-slate-700">2. Your targets: add a note on each (optional)</div>
            {rv.kpis.map((k: any) => <Field key={k.targetId} label={`${k.kraName}: ${k.kpiName} (target: ${k.target || 'not set'})`}><input className={input} value={kpis[k.targetId] || ''} onChange={(e) => setKpis({ ...kpis, [k.targetId]: e.target.value })} /></Field>)}</div>
        )}
        <div className="space-y-3"><div className="text-xs font-bold text-slate-700">3. Rate yourself on each behaviour ({left ? `${left} still to rate` : 'all rated'})</div>
          {d.comps.map((c: any) => (
            <div key={c.competencyId} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-sm font-bold text-slate-800">{c.name}</div>{c.expectedBehaviour && <div className="text-xs text-slate-500">{c.expectedBehaviour}</div>}
              <RatingPick value={comps[c.competencyId]?.selfRating} onChange={(v) => setComps({ ...comps, [c.competencyId]: { ...comps[c.competencyId], selfRating: typeof v === 'number' ? v : null } })} />
              <input className={input} placeholder="An example that shows this" value={comps[c.competencyId]?.selfEvidence || ''} onChange={(e) => setComps({ ...comps, [c.competencyId]: { ...comps[c.competencyId], selfEvidence: e.target.value } })} />
            </div>))}
        </div>
        <Note label="4. What could you improve?" value={s.improvements} onChange={(v) => setS({ ...s, improvements: v })} />
        <Note label="5. What training or support would help? (one per line)" value={s.trainingNeeds} onChange={(v) => setS({ ...s, trainingNeeds: v })} rows={2} />
        <Note label="6. Anything else?" value={s.comments} onChange={(v) => setS({ ...s, comments: v })} rows={2} />
        <ResultNote note={note} />
        <div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-self', payload(false)); }, 'Draft saved.')}>Save draft</button>
          <ConfirmButton className={btnBig} disabled={busy} question="Send to your manager? You cannot change it after this." yes="Yes, submit" onConfirm={() => run(async () => { await pmService.post('review-self', payload(true)); reload(); }, 'Submitted.')}>Submit to my manager</ConfirmButton></div>
      </div>
    </Card>
  );
};

const SelfRead: React.FC<{ d: any }> = ({ d }) => {
  const rv = d.item; if (!rv.self?.submittedAt && !rv.self?.waived) return null;
  return (
    <Card title="What the employee wrote about themselves">
      {rv.self.waived ? <p className="text-sm text-slate-600">Self-assessment skipped: {rv.self.waived}</p> : (
        <div className="text-sm space-y-1.5"><p><b>Achievements:</b> {rv.self.achievements || '-'}</p><p><b>To improve:</b> {rv.self.improvements || '-'}</p><p><b>Training wanted:</b> {rv.self.trainingNeeds || '-'}</p><p><b>Other:</b> {rv.self.comments || '-'}</p>
          <ul className="text-xs text-slate-600 list-disc pl-5">{d.comps.filter((c: any) => c.selfRating).map((c: any) => <li key={c.competencyId}>{c.name}: {c.selfRating} - {RATING_WORDS[c.selfRating]}{c.selfEvidence ? ` ("${c.selfEvidence}")` : ''}</li>)}</ul></div>
      )}
    </Card>
  );
};

const Waive: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [r, setR] = useState(''); const { busy, note, run } = useRunner();
  return <Card title="Employee cannot do a self-assessment?" subtitle="If they are away or it cannot be done in time, you can skip it. A reason is recorded."><div className="flex flex-wrap gap-2 items-end"><div className="flex-1 min-w-[200px]"><Field label="Reason"><input className={input} value={r} onChange={(e) => setR(e.target.value)} /></Field></div><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-waive', { id: d.item.id, reason: r }); reload(); }, 'Skipped.')}>Skip self-assessment</button></div><ResultNote note={note} /></Card>;
};

// ------------------------------------------------------------------ manager evaluation

const ManagerForm: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const rv = d.item;
  const [k, setK] = useState<Record<string, any>>(() => Object.fromEntries((rv.kpis || []).map((x: any) => [x.targetId, { rating: x.rating, insufficientEvidence: !!x.insufficientEvidence, managerNote: x.managerNote || '' }])));
  const [c, setC] = useState<Record<string, any>>(() => Object.fromEntries(d.comps.map((x: any) => [x.competencyId, { managerRating: x.managerRating, observedExamples: x.observedExamples, evidenceRefs: x.evidenceRefs, managerComment: x.managerComment }])));
  const [m, setM] = useState({ managerEvaluation: rv.manager?.evaluation || '', achievements: rv.manager?.achievements || '', improvements: rv.manager?.improvements || '', trainingNeeds: rv.manager?.trainingNeeds || '', sopNotAssessedReason: rv.manager?.sopNotAssessedReason || '' });
  const { busy, note, run } = useRunner(); const [problems, setProblems] = useState<string[]>([]);
  const payload = (submit: boolean) => ({ id: rv.id, submit, ...m, kpis: Object.entries(k).map(([targetId, v]: any) => ({ targetId, ...v })), comps: Object.entries(c).map(([competencyId, v]: any) => ({ competencyId, ...v })) });
  const send = (submit: boolean) => run(async () => { try { await pmService.post('review-manager', payload(submit)); setProblems([]); if (submit) reload(); } catch (e: any) { setProblems(e?.data?.problems || []); throw e; } }, submit ? 'Saved. Next: the feedback discussion.' : 'Draft saved.');
  return (
    <div className="space-y-4">
      <Explain title="How to rate fairly"><p>Rate what the evidence shows. If there is <b>no evidence</b> for a target, tick "Not enough evidence": it is left out of the score, <b>not counted as zero</b>. If you have not seen a behaviour, choose "Not observed". Compare with the work evidence listed below.</p></Explain>
      <Card title="Targets (KRA/KPI)" subtitle="Rate each target from 1 to 5.">
        <div className="space-y-3">{(rv.kpis || []).map((x: any) => {
          const ev = (d.evidence || []).filter((e: any) => e.kpiTargetId === x.targetId);
          return (
            <div key={x.targetId} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="text-sm font-bold text-slate-800">{x.kpiName} <span className="text-xs text-slate-400 font-medium">({x.kraName}, weight {x.weightage}%)</span></div>
              <div className="text-xs text-slate-500">Target: {x.target || 'not set'} - Evidence on record: {ev.length} item{ev.length === 1 ? '' : 's'}{ev.length ? ` (${ev.filter((e: any) => e.status === 'VERIFIED').length} verified)` : ''}</div>
              {rv.kpis.find((q: any) => q.targetId === x.targetId)?.employeeNote && <div className="text-xs text-slate-600 italic">Employee says: {rv.kpis.find((q: any) => q.targetId === x.targetId).employeeNote}</div>}
              <RatingPick value={k[x.targetId]?.rating} disabled={k[x.targetId]?.insufficientEvidence} onChange={(v) => setK({ ...k, [x.targetId]: { ...k[x.targetId], rating: typeof v === 'number' ? v : null } })} />
              <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={!!k[x.targetId]?.insufficientEvidence} onChange={(e) => setK({ ...k, [x.targetId]: { ...k[x.targetId], insufficientEvidence: e.target.checked, rating: e.target.checked ? null : k[x.targetId]?.rating } })} />Not enough evidence to rate (left out of the score, not zero)</label>
              <input className={input} placeholder="Your note on this target" value={k[x.targetId]?.managerNote || ''} onChange={(e) => setK({ ...k, [x.targetId]: { ...k[x.targetId], managerNote: e.target.value } })} />
            </div>);
        })}</div>
      </Card>
      <Card title="Behaviours" subtitle="Rate each behaviour from 1 to 5, or choose Not observed.">
        <div className="space-y-3">{d.comps.map((x: any) => (
          <div key={x.competencyId} className="border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="text-sm font-bold text-slate-800">{x.name}</div>{x.expectedBehaviour && <div className="text-xs text-slate-500">{x.expectedBehaviour}</div>}
            {x.selfRating && <div className="text-xs text-slate-600">Employee rated themselves {x.selfRating}{x.selfEvidence ? `: "${x.selfEvidence}"` : ''}</div>}
            <RatingPick allowNotObserved value={c[x.competencyId]?.managerRating} onChange={(v) => setC({ ...c, [x.competencyId]: { ...c[x.competencyId], managerRating: v } })} />
            <input className={input} placeholder="A specific example you saw (what happened, when)" value={c[x.competencyId]?.observedExamples || ''} onChange={(e) => setC({ ...c, [x.competencyId]: { ...c[x.competencyId], observedExamples: e.target.value } })} />
            <input className={input} placeholder="Comment (optional)" value={c[x.competencyId]?.managerComment || ''} onChange={(e) => setC({ ...c, [x.competencyId]: { ...c[x.competencyId], managerComment: e.target.value } })} />
          </div>))}</div>
      </Card>
      <SopCheck d={d} reload={reload} />
      <Card title="Your overall evaluation">
        <div className="space-y-3"><Note label="Overall evaluation (required)" value={m.managerEvaluation} onChange={(v) => setM({ ...m, managerEvaluation: v })} hint="Describe results and behaviour using facts." />
          <Note label="Key achievements" value={m.achievements} onChange={(v) => setM({ ...m, achievements: v })} rows={2} /><Note label="Areas to improve" value={m.improvements} onChange={(v) => setM({ ...m, improvements: v })} rows={2} />
          <Note label="Training or support needed (one per line)" value={m.trainingNeeds} onChange={(v) => setM({ ...m, trainingNeeds: v })} rows={2} />
          {d.assignments?.length > 0 && d.sop?.score === null && <Field label="No SOP checks were made. Why? (needed to submit)"><input className={input} value={m.sopNotAssessedReason} onChange={(e) => setM({ ...m, sopNotAssessedReason: e.target.value })} /></Field>}
        </div>
        {problems.length > 0 && <Notice tone="warn"><b>Fix these first:</b><ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Notice>}
        <ResultNote note={note} />
        <div className="flex gap-2 mt-3"><button className={btnGhost} disabled={busy} onClick={() => send(false)}>Save draft</button><button className={btnBig} disabled={busy} onClick={() => send(true)}>Finish evaluation</button></div>
      </Card>
    </div>
  );
};

const SOP_RESULTS = [{ v: 'COMPLIANT', l: 'Followed' }, { v: 'NON_COMPLIANT', l: 'Not followed' }, { v: 'NOT_APPLICABLE', l: 'Does not apply' }, { v: 'NOT_VERIFIED', l: 'Could not check' }];
const SopCheck: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const rv = d.item; const [items, setItems] = useState<any[] | null>(null); const [rows, setRows] = useState<Record<string, Record<string, any>>>({}); const { busy, note, run } = useRunner();
  useEffect(() => { pmService.get('sop-for', { employeeUid: rv.uid, cycleId: rv.cycleId }).then((r) => { setItems(r.items); const o: any = {}; for (const it of r.items) { o[it.sopId] = {}; for (const x of it.check?.rows || []) o[it.sopId][x.checkpointId] = x; } setRows(o); }).catch(() => setItems([])); }, [rv.uid, rv.cycleId]);
  if (!items) return null;
  if (items.length === 0) return <Card title="Processes (SOPs)"><p className="text-sm text-slate-500">No processes are assigned to this person.</p></Card>;
  return (
    <Card title="Processes (SOPs)" subtitle="For each control, say whether it was followed. A critical control that was not followed is handled on its own; it is never averaged away.">
      <div className="space-y-4">{items.map((it) => (
        <div key={it.sopId} className="border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="text-sm font-bold text-slate-800">{it.title} {it.criticality === 'CRITICAL' && <Pill tone="red">critical</Pill>} {!it.acknowledged && <Pill tone="amber">not acknowledged by employee</Pill>}</div>
          {it.checkpoints.map((cp: any) => { const r = rows[it.sopId]?.[cp.id] || {}; const set = (p: any) => setRows({ ...rows, [it.sopId]: { ...rows[it.sopId], [cp.id]: { ...r, checkpointId: cp.id, ...p } } });
            return (<div key={cp.id} className="bg-slate-50 rounded-lg p-2 space-y-1.5"><div className="text-sm text-slate-700">{cp.control} {cp.critical && <Pill tone="red">critical</Pill>}</div>
              <div className="flex flex-wrap gap-1.5">{SOP_RESULTS.map((o) => <button key={o.v} type="button" onClick={() => set({ result: o.v })} className={`px-2 py-1 rounded-lg border text-xs font-bold ${r.result === o.v ? (o.v === 'NON_COMPLIANT' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-[#FA7014] border-[#FA7014] text-white') : 'bg-white border-slate-300 text-slate-700'}`}>{o.l}</button>)}</div>
              {r.result === 'NON_COMPLIANT' && <input className={input} placeholder="What will be done to fix it? (required)" value={r.correctiveAction || ''} onChange={(e) => set({ correctiveAction: e.target.value })} />}
              <input className={input} placeholder="Evidence (optional)" value={r.evidence || ''} onChange={(e) => set({ evidence: e.target.value })} /></div>);
          })}
          <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('sopcheck-save', { employeeUid: rv.uid, sopId: it.sopId, cycleId: rv.cycleId, rows: Object.values(rows[it.sopId] || {}).filter((x: any) => x.result) }); reload(); }, 'SOP check saved.')}>Save this check</button>
        </div>))}</div>
      <ResultNote note={note} />
    </Card>
  );
};

const Discuss: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [t, setT] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const { busy, note, run } = useRunner();
  return <Card title="Feedback discussion" subtitle="Talk it through with the employee. Then record that it happened."><div className="space-y-3"><Field label="Date of discussion"><input type="date" className={input} value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></Field><Note label="What was discussed?" value={t} onChange={setT} /><ResultNote note={note} /><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('review-discuss', { id: d.item.id, heldOn: date, notes: t }); reload(); }, 'Recorded.')}>Record the discussion</button></div></Card>;
};

// ------------------------------------------------------------------ HR, approver, publish

const HrCheck: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [n, setN] = useState(''); const [partial, setPartial] = useState(false); const [crit, setCrit] = useState(false); const { busy, note, run } = useRunner();
  return (
    <Card title="HR check" subtitle="Check that it is complete and fair, then pass it on or send it back.">
      {d.flags?.length > 0 && <Notice tone="warn"><b>Things to look at:</b><ul className="list-disc pl-5">{d.flags.map((f: any, i: number) => <li key={i}>{f.message}</li>)}</ul></Notice>}
      {d.overall?.partial && <label className="flex items-start gap-2 text-sm my-2"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="mt-1" />I accept that one part could not be scored for lack of evidence, and the others are re-weighted.</label>}
      {d.sop?.criticalFailures > 0 && <label className="flex items-start gap-2 text-sm my-2"><input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} className="mt-1" />I have reviewed the {d.sop.criticalFailures} critical SOP failure(s).</label>}
      <Note label="Note (needed if you send it back)" value={n} onChange={setN} rows={2} />
      <ResultNote note={note} />
      <div className="flex gap-2 mt-2"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('review-hr', { id: d.item.id, decision: 'PASS', note: n, acceptPartial: partial, criticalAck: crit }); reload(); }, 'Passed to the approver.')}>Pass to approver</button>
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-hr', { id: d.item.id, decision: 'RETURN', note: n }); reload(); }, 'Sent back to the manager.')}>Send back to manager</button></div>
    </Card>
  );
};

const Approve: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [rating, setRating] = useState<number | null>(d.band?.value ?? null); const [txt, setTxt] = useState(''); const [back, setBack] = useState(''); const { busy, note, run } = useRunner();
  return (
    <Card title="Approval" subtitle="Give the final rating and the comments the employee will read. You cannot approve your own review.">
      <div className="space-y-3">
        {d.band && <Notice tone="info">The scores suggest <b>{d.band.value} - {d.band.label}</b> ({money(d.overall.score)}). You decide the final rating.</Notice>}
        <Field label="Final rating"><RatingPick value={rating} onChange={(v) => setRating(typeof v === 'number' ? v : null)} /></Field>
        <Note label="Final comments (the employee will read this)" value={txt} onChange={setTxt} />
        <ResultNote note={note} />
        <button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('review-approve', { id: d.item.id, decision: 'APPROVE', finalRating: rating, finalComments: txt }); reload(); }, 'Approved.')}>Approve</button>
        <div className="border-t border-slate-200 pt-3"><Note label="Or send it back: what needs to change?" value={back} onChange={setBack} rows={2} /><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-approve', { id: d.item.id, decision: 'RETURN', note: back }); reload(); }, 'Sent back.')}>Send back</button></div>
      </div>
    </Card>
  );
};

const Publish: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const { busy, note, run } = useRunner();
  return <Card title="Share with the employee"><p className="text-sm text-slate-600 mb-2">The employee cannot see the manager's ratings or the result until you share it.</p><ResultNote note={note} /><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('review-publish', { id: d.item.id }); reload(); }, 'Shared. The employee has been told.')}>Share with the employee now</button></Card>;
};

const Result: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const rv = d.item; const [c, setC] = useState(''); const { busy, note, run } = useRunner();
  return (
    <div className="space-y-4">
      <FinalView rv={rv} />
      <Card title="Your manager's feedback">
        <div className="text-sm space-y-1.5"><p><b>Overall:</b> {rv.manager?.evaluation}</p><p><b>Achievements:</b> {rv.manager?.achievements || '-'}</p><p><b>To improve:</b> {rv.manager?.improvements || '-'}</p>
          <ul className="text-xs list-disc pl-5">{d.comps.map((x: any) => <li key={x.competencyId}>{x.name}: {x.finalRating === 'NOT_OBSERVED' || x.managerRating === 'NOT_OBSERVED' ? 'Not observed' : `${x.finalRating ?? x.managerRating} - ${RATING_WORDS[(x.finalRating ?? x.managerRating) as number] || ''}`}{x.observedExamples ? ` ("${x.observedExamples}")` : ''}</li>)}</ul></div>
      </Card>
      {rv.status === 'PUBLISHED' && (
        <Card title="Your response" subtitle="You can agree, or record that you disagree and why. Either way your words are kept exactly as you write them.">
          <Note label="Comment (needed if you disagree)" value={c} onChange={setC} /><ResultNote note={note} />
          <div className="flex gap-2 mt-2"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('review-respond', { id: rv.id, response: 'ACKNOWLEDGE', comment: c }); reload(); }, 'Thank you.')}>I have read it and agree</button>
            <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-respond', { id: rv.id, response: 'DISAGREE', comment: c }); reload(); }, 'Your disagreement is recorded.')}>I disagree</button></div>
        </Card>
      )}
      {rv.response && <Card title="Your recorded response"><p className="text-sm"><b>{rv.response.type === 'DISAGREE' ? 'You disagreed' : 'You agreed'}:</b> {rv.response.comment || '-'}</p>{rv.response.resolution && <p className="text-sm mt-1"><b>Formal review outcome:</b> {rv.response.resolution.outcome.toLowerCase()} - {rv.response.resolution.note}</p>}</Card>}
    </div>
  );
};

const FinalView: React.FC<{ rv: any }> = ({ rv }) => !rv.final ? null : (
  <Card title="Final result">
    <div className="flex flex-wrap items-center gap-4"><div className="text-3xl font-extrabold text-[#FA7014]">{rv.final.finalRating}<span className="text-base text-slate-400">/5</span></div><div className="text-sm text-slate-700"><b>{RATING_WORDS[rv.final.finalRating]}</b><div className="text-xs text-slate-500">Calculated score {money(rv.final.overall)} - approved by {rv.final.approvedBy}</div></div></div>
    <p className="text-sm text-slate-700 mt-2">{rv.final.comments}</p>
    {rv.final.partial && <p className="text-xs text-amber-700 mt-1">One part could not be scored for lack of evidence, so it was left out (not counted as zero).</p>}
  </Card>
);

const Resolve: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [n, setN] = useState(''); const { busy, note, run } = useRunner();
  return (
    <Card title="The employee disagrees" subtitle="Their exact words are below. Hold the formal review, then record the outcome.">
      <p className="text-sm italic bg-slate-50 rounded-lg p-3 mb-3">"{d.item.response?.comment}"</p>
      <Note label="Outcome of the formal review" value={n} onChange={setN} rows={2} /><ResultNote note={note} />
      <div className="flex gap-2 mt-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('review-resolve', { id: d.item.id, outcome: 'UPHELD', note: n }); reload(); }, 'Recorded.')}>Review stands</button><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-resolve', { id: d.item.id, outcome: 'AMENDED', note: n }); reload(); }, 'Recorded.')}>Review was amended (amend first)</button></div>
    </Card>
  );
};

const Amend: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [open, setOpen] = useState(false); const [rating, setRating] = useState<number | null>(d.item.final?.finalRating ?? null); const [reason, setReason] = useState(''); const [txt, setTxt] = useState(d.item.final?.comments || ''); const { busy, note, run } = useRunner();
  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>Amend this final review</button>;
  return (
    <Card title="Amend a final review" subtitle="A final review is never silently changed. Both the old and new values are kept, with your reason.">
      <div className="space-y-3"><Field label="New final rating"><RatingPick value={rating} onChange={(v) => setRating(typeof v === 'number' ? v : null)} /></Field><Note label="Final comments" value={txt} onChange={setTxt} rows={2} /><Note label="Reason for the amendment (required)" value={reason} onChange={setReason} rows={2} /><ResultNote note={note} />
        <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('review-amend', { id: d.item.id, finalRating: rating, finalComments: txt, reason }); setOpen(false); reload(); }, 'Amended and recorded.')}>Save amendment</button><button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button></div></div>
    </Card>
  );
};

const Defer: React.FC<{ d: any; reload: () => void }> = ({ d, reload }) => {
  const [r, setR] = useState(''); const [days, setDays] = useState('30'); const { busy, note, run } = useRunner();
  return <Card title="Pause this review" subtitle="For approved long leave and similar. The deadlines move by the days you choose."><div className="flex flex-wrap gap-2 items-end"><div className="flex-1 min-w-[180px]"><Field label="Reason"><input className={input} value={r} onChange={(e) => setR(e.target.value)} /></Field></div><div className="w-24"><Field label="Extend by (days)"><input className={input} value={days} onChange={(e) => setDays(e.target.value)} /></Field></div><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('review-defer', { id: d.item.id, reason: r, extendDays: Number(days) }); reload(); }, 'Paused.')}>Pause</button></div><ResultNote note={note} /></Card>;
};

// ------------------------------------------------------------------ AI helper (optional, advisory)

const AI_BUTTONS = [{ k: 'EVIDENCE_GAPS', l: 'What evidence is missing?' }, { k: 'CONSISTENCY', l: 'Do the ratings agree with each other?' }, { k: 'TRAINING', l: 'What training might help?' }, { k: 'MANAGER_SUMMARY', l: 'Summarise the evaluation' }, { k: 'WORDING', l: 'Make my comments more specific' }];
const AiBox: React.FC<{ d: any }> = ({ d }) => {
  const [out, setOut] = useState<any>(null); const { busy, note, run } = useRunner();
  return (
    <Card title="Helper (optional)" subtitle="Suggestions only. It cannot guess personality, motives or anything personal, and you can ignore it. The review works fine without it.">
      <div className="flex flex-wrap gap-1.5">{AI_BUTTONS.map((b) => <button key={b.k} className={btnGhost} disabled={busy} onClick={() => run(async () => { setOut(await pmService.post('ai-insight', { reviewId: d.item.id, capability: b.k })); })}>{b.l}</button>)}</div>
      <ResultNote note={note} />
      {out && <div className="mt-3 text-sm"><Pill tone={out.source === 'AI' ? 'blue' : 'slate'}>{out.source === 'AI' ? 'AI suggestion' : 'Simple check'}</Pill>{out.note && <p className="text-xs text-slate-500 mt-1">{out.note}</p>}<ul className="list-disc pl-5 mt-2 space-y-1">{out.points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></div>}
    </Card>
  );
};


// ------------------------------------------------------------------ review pack (evaluators only)

const EV_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { VERIFIED: 'green', PENDING_VERIFICATION: 'amber', REJECTED: 'red', UNMAPPED: 'amber' };
const EV_WORDS: Record<string, string> = { VERIFIED: 'checked', PENDING_VERIFICATION: 'waiting to be checked', REJECTED: 'rejected', UNMAPPED: 'not linked to a target' };
const ReviewPack: React.FC<{ d: any }> = ({ d }) => {
  const [p, setP] = useState<any>(null); const [copied, setCopied] = useState(false); const { busy, note, run } = useRunner();
  const copy = async () => { try { await navigator.clipboard.writeText(p.draft.points.map((x: string) => `- ${x}`).join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the points stay on screen to copy by hand */ } };
  return (
    <Card title="Review pack" subtitle="The recorded facts for this person in one place, with a draft of talking points. It is information only: you give every rating.">
      {!p ? <div><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { setP((await pmService.get('pack-get', { reviewId: d.item.id })).pack); })}>Open the review pack</button><ResultNote note={note} /></div> : (
        <div className="space-y-4">
          <div className="space-y-2">{p.kpis.length === 0 && <p className="text-sm text-slate-500">This review has no targets, so there is nothing to group.</p>}{p.kpis.map((k: any) => (
            <div key={k.targetId} className="border border-slate-200 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-800">{k.kraName}: {k.kpiName}</span><span className="text-xs text-slate-500">target: {k.target || 'not set'}</span>
                <Pill tone={k.gap ? 'amber' : 'green'}>{k.counts.verified} checked</Pill>{k.counts.pending > 0 && <Pill tone="amber">{k.counts.pending} waiting</Pill>}{k.counts.rework > 0 && <Pill tone="slate">{k.counts.rework} rework</Pill>}</div>
              {k.gap && <p className="text-xs text-amber-800 mt-1">No checked evidence yet. Check some in Work evidence, or choose "not enough evidence" when you rate this target.</p>}
              <ul className="mt-2 space-y-1">{k.items.map((i: any) => <li key={i.id} className="text-xs text-slate-700 flex flex-wrap gap-1.5 items-center"><Pill tone={EV_TONE[i.status] || 'slate'}>{EV_WORDS[i.status] || i.status}</Pill>{i.link ? <a href={i.link} target="_blank" rel="noreferrer" className="underline">{i.title}</a> : i.title}{i.completedOn && <span className="text-slate-400">{i.completedOn}</span>}</li>)}</ul>
            </div>))}</div>
          {p.unmapped.length > 0 && <Notice tone="warn"><b>{p.unmapped.length} item(s) are not linked to a target:</b> {p.unmapped.slice(0, 5).map((u: any) => u.title).join('; ')}. Link or reject them in Work evidence before you rate.</Notice>}
          {p.checkins.length > 0 && <div><div className="text-xs font-bold text-slate-700 mb-1">Monthly check-ins</div><ul className="space-y-1">{p.checkins.map((c: any) => <li key={c.month} className="text-xs text-slate-700"><b>{c.month}</b> ({c.status === 'DONE' ? 'recorded' : 'not recorded'}){c.wins ? ` - wins: ${c.wins}` : ''}{c.concerns ? ` - concerns: ${c.concerns}` : ''}{c.employeeComment ? ` - employee added: ${c.employeeComment}` : ''}</li>)}</ul></div>}
          {p.context?.leaveDays > 0 && <p className="text-xs text-slate-600">On approved leave for {p.context.leaveDays} day(s) in this period (context only).</p>}
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
            <div className="flex flex-wrap items-center gap-2 mb-1"><span className="text-sm font-bold text-slate-800">Draft talking points</span><Pill tone={p.draft.source === 'AI' ? 'blue' : 'slate'}>{p.draft.source === 'AI' ? 'AI draft' : 'Simple summary'}</Pill><button className={btnGhost} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
            <p className="text-xs text-slate-500 mb-2">{p.draft.note}</p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-800">{p.draft.points.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      )}
    </Card>
  );
};

// ------------------------------------------------------------------ scores and history

const Scores: React.FC<{ d: any }> = ({ d }) => {
  if (!d.overall) return null;
  const o = d.overall;
  const part = (label: string, key: 'kra' | 'behaviour' | 'sop', w: number) => { const v = o.parts?.[key]; return <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">{label} ({w}%)</div><div className="text-lg font-extrabold text-slate-800">{v === null || v === undefined ? 'Not scored' : money(v)}</div></div>; };
  return (
    <Card title="How the score is worked out" subtitle="Updated as ratings are entered. Parts with no evidence are left out. They are never counted as zero.">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{part('Results (KRA/KPI)', 'kra', d.weights.kra)}{part('Behaviour', 'behaviour', d.weights.behaviour)}{part('Processes (SOP)', 'sop', d.weights.sop)}
        <div className="bg-[#FA7014]/10 rounded-lg p-3"><div className="text-xs text-slate-600">Overall</div><div className="text-lg font-extrabold text-[#FA7014]">{money(o.score)}</div></div></div>
      {o.formula && <p className="text-xs text-slate-500 mt-2">{o.formula}</p>}
      {d.sop?.criticalFailures > 0 && <Notice tone="warn">{d.sop.criticalFailures} critical SOP control(s) were not followed. They are shown here and reviewed separately.</Notice>}
    </Card>
  );
};

const Timeline: React.FC<{ rv: any; approvals: any[] }> = ({ rv, approvals }) => {
  const h = (rv.history || []).slice().reverse();
  if (h.length === 0 && !(rv.amendments || []).length) return null;
  return (
    <Card title="History (cannot be edited)">
      <ul className="text-xs text-slate-600 space-y-1">{h.map((x: any, i: number) => <li key={i}>{new Date(x.at).toLocaleString()} - <b>{String(x.action).replace(/_/g, ' ').toLowerCase()}</b> by {x.by}{x.note ? `: ${x.note}` : ''}</li>)}
        {(rv.amendments || []).map((a: any, i: number) => <li key={`a${i}`} className="text-amber-700">{new Date(a.at).toLocaleString()} - amended by {a.by}: rating {a.before.finalRating} to {a.after.finalRating}. Reason: {a.reason}</li>)}</ul>
      {approvals?.length > 0 && <p className="text-xs text-slate-500 mt-2">Approval decisions on record: {approvals.length}</p>}
    </Card>
  );
};
