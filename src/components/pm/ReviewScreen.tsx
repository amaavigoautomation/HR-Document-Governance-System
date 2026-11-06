import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, Sparkles, Check } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, useLoad } from '../common/loadUi';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, todayIst, useRunner } from '../leave/ui';
import { GuardedButton, Intro, Note, RatingPick, ResultNote, SopPick, StatusChip, ratingText, score, when } from './common';
import { SOP_WORDS, scoreReview, type SopResult } from '../../../shared/pmEngine';

const STEPS = [{ key: 'SELF', label: 'Self-review' }, { key: 'MANAGER', label: 'Manager' }, { key: 'HR', label: 'HR approval' }, { key: 'PUBLISHED', label: 'Shared' }, { key: 'DONE', label: 'Done' }];
const stepIndex = (s: string) => ({ SELF: 0, MANAGER: 1, HR: 2, APPROVED: 3, PUBLISHED: 3, DISPUTED: 3, ACKNOWLEDGED: 5, RESOLVED: 5 } as Record<string, number>)[s] ?? 0;

/** One screen for every step of a review. It shows only what this person may do now; everything else is read-only. */
export const ReviewScreen: React.FC<{ id: string; back: () => void }> = ({ id, back }) => {
  const { data, error, loading, reload } = useLoad(() => pmService.get('review', { id }), [id]);
  if (!data) return <div><button className={`${btnGhost} mb-3`} onClick={back}><ArrowLeft className="w-4 h-4" />Back</button><Loading error={error} loading={loading} /></div>;
  const rv = data.review; const can = data.can;
  const cur = stepIndex(rv.status);
  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={back}><ArrowLeft className="w-4 h-4" />Back</button>
      <Intro title={`${rv.name} · ${rv.cycleName}`} what={`${rv.snap?.designation || ''}${rv.snap?.department ? ` · ${rv.snap.department}` : ''}${rv.managerName ? ` · Manager: ${rv.managerName}` : ''}`} />
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip status={rv.status} kind="review" />
        {['SELF', 'MANAGER', 'HR'].includes(rv.status) && <span className="text-xs text-slate-500">Self-review due {rv.selfDue} · manager due {rv.managerDue} · HR due {rv.hrDue}</span>}
        {rv.amended && <span className="text-xs font-bold text-amber-700">Amended ({rv.amendments.length})</span>}
      </div>
      {!['ON_HOLD', 'DEFERRED'].includes(rv.status) && (
        <ol className="flex flex-wrap gap-1.5" aria-label="Progress">{STEPS.map((s, i) => (
          <li key={s.key} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${i < cur ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : i === cur ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'bg-white border-slate-200 text-slate-400'}`}>{i < cur ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}{s.label}</li>
        ))}</ol>
      )}
      {rv.status === 'ON_HOLD' && <Notice tone="warn">This review is waiting for approved targets. It starts by itself once they are approved.</Notice>}
      {rv.status === 'DEFERRED' && <Notice tone="info">Paused: {rv.deferReason}</Notice>}
      {rv.leaveDays > 0 && !['ON_HOLD'].includes(rv.status) && <p className="text-xs text-slate-500">Context only (never a rating): {rv.leaveDays} day(s) of approved leave in this quarter.</p>}
      {rv.hrReturnNote && rv.status === 'MANAGER' && <Notice tone="warn">HR asked for a change: "{rv.hrReturnNote}"</Notice>}

      {can.self ? <SelfForm rv={rv} evidence={data.evidence} reload={reload} />
        : can.manager ? <ManagerForm rv={rv} evidence={data.evidence} checkins={data.checkins} canAi={can.aiDraft} reload={reload} />
        : rv.snap && <ReadOnly rv={rv} evidence={data.evidence} />}

      <Actions rv={rv} can={can} reload={reload} back={back} />
      {data.history?.length > 0 && (
        <Card title="History" subtitle="Every step is recorded and cannot be changed.">
          <ul className="text-xs text-slate-600 space-y-0.5">{data.history.map((h: any, i: number) => <li key={i}><span className="text-slate-400">{when(h.at)}</span> · {h.action.replace(/_/g, ' ').toLowerCase()} · {h.actor}{h.detail ? ` · ${h.detail}` : ''}</li>)}</ul>
        </Card>
      )}
    </div>
  );
};

const workFor = (evidence: any[], kpiId: string) => evidence.filter((e) => e.kpiId === kpiId);
const WorkList: React.FC<{ items: any[] }> = ({ items }) => items.length === 0 ? <p className="text-[11px] text-slate-400">No recorded work for this KPI.</p> : (
  <ul className="text-[11px] text-slate-600 mt-1 space-y-0.5">{items.slice(0, 6).map((e) => <li key={e.id}>{e.date} · {e.title}{e.status === 'PENDING' ? ' (not verified yet)' : ''}</li>)}{items.length > 6 && <li>…and {items.length - 6} more</li>}</ul>
);

const SelfForm: React.FC<{ rv: any; evidence: any[]; reload: () => void }> = ({ rv, evidence, reload }) => {
  const [f, setF] = useState(() => ({ kpis: { ...(rv.self?.kpis || {}) }, comps: { ...(rv.self?.comps || {}) }, achievements: rv.self?.achievements || '', improve: rv.self?.improve || '', training: rv.self?.training || '' }));
  const { busy, note, run } = useRunner();
  const missing = [...rv.snap.kpis.filter((k: any) => !f.kpis[k.id]).map((k: any) => `a rating for "${k.kpi}"`), ...rv.snap.comps.filter((x: any) => !f.comps[x.id]).map((x: any) => `a rating for "${x.name}"`), ...(f.achievements.trim().length < 10 ? ['a few words about what you achieved'] : [])];
  const save = (submit: boolean) => run(async () => { await pmService.post('review-self', { id: rv.id, ...f, submit }); await reload(); }, submit ? 'Sent to your manager.' : 'Saved. You can finish later.');
  return (
    <>
      <Card title="1. My results (KPIs)" subtitle="Pick 1–5 for each, or 'Not observed' if there is nothing to show. Hover a number to see what it means.">
        {rv.snap.kpis.map((k: any) => (
          <div key={k.id} className="border-t border-slate-100 py-3 first:border-t-0">
            <div className="text-sm"><b>{k.kpi}</b> <span className="text-xs text-slate-500">· target: {k.target} · weight {k.weight}%</span></div>
            <WorkList items={workFor(evidence, k.id)} />
            <div className="mt-2"><RatingPick label={k.kpi} value={f.kpis[k.id]} onChange={(v) => setF({ ...f, kpis: { ...f.kpis, [k.id]: v } })} /></div>
          </div>
        ))}
      </Card>
      <Card title="2. How I work (behaviours)">
        {rv.snap.comps.map((x: any) => (
          <div key={x.id} className="border-t border-slate-100 py-2 first:border-t-0">
            <div className="text-sm"><b>{x.name}</b>{x.standard && <span className="text-xs text-slate-500"> · {x.standard}</span>}</div>
            <div className="mt-1.5"><RatingPick label={x.name} value={f.comps[x.id]} onChange={(v) => setF({ ...f, comps: { ...f.comps, [x.id]: v } })} /></div>
          </div>
        ))}
      </Card>
      <Card title="3. In my own words">
        <Note label="What I achieved this quarter" value={f.achievements} onChange={(v) => setF({ ...f, achievements: v })} />
        <Note label="What I want to improve" rows={2} value={f.improve} onChange={(v) => setF({ ...f, improve: v })} />
        <Note label="Training or support I need (one per line)" rows={2} value={f.training} onChange={(v) => setF({ ...f, training: v })} />
        <ResultNote note={note} />
        <div className="flex gap-2 items-start"><GuardedButton busy={busy} missing={missing} onClick={() => save(true)}>Send to my manager</GuardedButton><button className={btnGhost} disabled={busy} onClick={() => save(false)}>Save for later</button></div>
      </Card>
    </>
  );
};

const ManagerForm: React.FC<{ rv: any; evidence: any[]; checkins: any[]; canAi: boolean; reload: () => void }> = ({ rv, evidence, checkins, canAi, reload }) => {
  const m = rv.manager || {};
  const [f, setF] = useState(() => ({ kpis: { ...(m.kpis || {}) }, comps: { ...(m.comps || {}) }, sops: { ...(m.sops || {}) } as Record<string, SopResult>, strengths: m.strengths || '', improve: m.improve || '', training: m.training || '', comment: m.comment || '', discussedOn: m.discussedOn || '' }));
  const { busy, note, run } = useRunner();
  const [aiNote, setAiNote] = useState('');
  const live = useMemo(() => scoreReview({
    kpis: rv.snap.kpis.map((k: any) => ({ id: k.id, weight: k.weight, rating: f.kpis[k.id] })),
    comps: rv.snap.comps.map((x: any) => ({ id: x.id, rating: f.comps[x.id] })),
    sops: rv.snap.sops.map((x: any) => ({ id: x.id, critical: x.critical, result: f.sops[x.id] })),
  }, rv.snap.weights), [f, rv]);
  const missing = [
    ...rv.snap.kpis.filter((k: any) => !f.kpis[k.id]).map((k: any) => `a rating for "${k.kpi}"`),
    ...rv.snap.comps.filter((x: any) => !f.comps[x.id]).map((x: any) => `a rating for "${x.name}"`),
    ...rv.snap.sops.filter((x: any) => !f.sops[x.id]).map((x: any) => `an answer for SOP "${x.title}"`),
    ...live.blocking,
    ...(!f.discussedOn ? ['you enter the date you discussed it with them'] : []),
    ...(f.comment.trim().length < 10 ? ['an overall comment'] : []),
  ];
  const save = (submit: boolean) => run(async () => { await pmService.post('review-manager', { id: rv.id, ...f, submit }); await reload(); }, submit ? 'Sent to HR.' : 'Saved.');
  const draft = () => run(async () => { const r = await pmService.post('ai-draft', { id: rv.id }); setF((x) => ({ ...x, strengths: x.strengths || r.draft.strengths, improve: x.improve || r.draft.improve, training: x.training || r.draft.training })); setAiNote(r.note || ''); });
  const self = rv.self || {};
  return (
    <>
      {rv.selfSkipped && <Notice tone="info">{rv.name} did not do the self-review by {rv.selfDue}. You can continue without it.</Notice>}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border border-slate-200 rounded-xl px-4 py-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>Results <b>{score(live.results)}</b></span><span>Behaviour <b>{score(live.behaviour)}</b></span><span>SOP <b>{live.sop === null ? 'left out' : score(live.sop)}</b></span>
        <span>Overall <b className="text-[#FA7014]">{score(live.overall)}</b> {live.overall !== null && <span className="text-slate-500">({live.band})</span>}</span>
        {live.criticalBreach && <span className="text-rose-700 font-bold flex items-center gap-1"><AlertTriangle className="w-4 h-4" />Critical SOP breach: HR must look at it</span>}
      </div>
      <Card title="1. Results (KPIs)" subtitle="Their own rating is shown in grey. The recorded work for the quarter is under each KPI.">
        {rv.snap.kpis.map((k: any) => (
          <div key={k.id} className="border-t border-slate-100 py-3 first:border-t-0">
            <div className="text-sm"><b>{k.kpi}</b> <span className="text-xs text-slate-500">· target: {k.target} · weight {k.weight}%</span></div>
            <div className="text-xs text-slate-500">They said: {ratingText(self.kpis?.[k.id])}</div>
            <WorkList items={workFor(evidence, k.id)} />
            <div className="mt-2"><RatingPick label={k.kpi} value={f.kpis[k.id]} onChange={(v) => setF({ ...f, kpis: { ...f.kpis, [k.id]: v } })} /></div>
          </div>
        ))}
      </Card>
      <Card title="2. Behaviours" subtitle="Rate what you observed at work. Never personality, motives or private life.">
        {rv.snap.comps.map((x: any) => (
          <div key={x.id} className="border-t border-slate-100 py-2 first:border-t-0">
            <div className="text-sm"><b>{x.name}</b>{x.standard && <span className="text-xs text-slate-500"> · {x.standard}</span>} <span className="text-xs text-slate-400">· they said: {ratingText(self.comps?.[x.id])}</span></div>
            <div className="mt-1.5"><RatingPick label={x.name} value={f.comps[x.id]} onChange={(v) => setF({ ...f, comps: { ...f.comps, [x.id]: v } })} /></div>
          </div>
        ))}
      </Card>
      <Card title="3. SOPs followed" subtitle="Did they follow each process this quarter? 'Not applicable' and 'Not verified' are left out of the score.">
        {rv.snap.sops.length === 0 ? <p className="text-sm text-slate-500">No SOPs apply. This part is left out and the other weights are rescaled.</p> : rv.snap.sops.map((x: any) => (
          <div key={x.id} className="border-t border-slate-100 py-2 first:border-t-0">
            <div className="text-sm"><b>{x.title}</b> <span className="text-xs text-slate-500">v{x.versionNumber}</span>{x.critical && <span className="ml-1 text-[11px] font-bold text-rose-700">CRITICAL</span>}</div>
            <div className="mt-1.5"><SopPick value={f.sops[x.id]} onChange={(v) => setF({ ...f, sops: { ...f.sops, [x.id]: v } })} /></div>
          </div>
        ))}
      </Card>
      {checkins.length > 0 && (
        <Card title="Check-ins this quarter">
          <ul className="text-xs text-slate-600 space-y-1">{checkins.map((c: any) => <li key={c.id}><b>{c.month}</b> · {c.status === 'DONE' ? c.managerComment : 'not done'}</li>)}</ul>
        </Card>
      )}
      <Card title="4. Your words" right={canAi && <button className={btnGhost} disabled={busy} onClick={draft}><Sparkles className="w-4 h-4" />Draft from recorded work</button>}>
        {aiNote && <Notice tone="info">{aiNote}</Notice>}
        {self.achievements && <p className="text-xs text-slate-500 mb-2">They wrote: "{self.achievements}"</p>}
        <Note label="Strengths" rows={2} value={f.strengths} onChange={(v) => setF({ ...f, strengths: v })} />
        <Note label="Areas to improve" rows={2} value={f.improve} onChange={(v) => setF({ ...f, improve: v })} />
        <Note label="Training or support (one per line)" rows={2} value={f.training} onChange={(v) => setF({ ...f, training: v })} hint="These go to the development plan and to HRBP." />
        <Note label="Overall comment" rows={3} value={f.comment} onChange={(v) => setF({ ...f, comment: v })} />
        <Field label="Date you discussed this review with them" hint="The review cannot go to HR before you have talked it through."><input type="date" className={input} min={rv.from} max={todayIst()} value={f.discussedOn} onChange={(e) => setF({ ...f, discussedOn: e.target.value })} /></Field>
        <ResultNote note={note} />
        <div className="flex gap-2 items-start mt-2"><GuardedButton busy={busy} missing={missing} onClick={() => save(true)}>Send to HR</GuardedButton><button className={btnGhost} disabled={busy} onClick={() => save(false)}>Save for later</button></div>
      </Card>
    </>
  );
};

const ReadOnly: React.FC<{ rv: any; evidence: any[] }> = ({ rv, evidence }) => {
  const self = rv.self || {}; const m = rv.manager || {}; const hasM = Object.keys(m).length > 0;
  return (
    <>
      {rv.score && (
        <Card title="Score">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>Results <b>{score(rv.score.results)}</b></span><span>Behaviour <b>{score(rv.score.behaviour)}</b></span><span>SOP <b>{rv.score.sop === null ? 'left out' : score(rv.score.sop)}</b></span>
            <span>Overall <b className="text-[#FA7014] text-base">{score(rv.score.overall)}</b> ({rv.score.band})</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Weights used: results {rv.score.used.results}%, behaviour {rv.score.used.behaviour}%, SOP {rv.score.used.sop}%.</p>
        </Card>
      )}
      {rv.flags?.length > 0 && <Notice tone="warn"><b>For HR to check:</b> {rv.flags.join(' · ')}</Notice>}
      <Card title="Ratings">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Item</th><th>Self</th>{hasM && <th>Manager</th>}</tr></thead>
          <tbody>
            {rv.snap.kpis.map((k: any) => <tr key={k.id} className="border-t border-slate-100"><td className="py-1.5"><b>{k.kpi}</b><div className="text-[11px] text-slate-500">target {k.target} · {k.weight}% · {workFor(evidence, k.id).length} work item(s)</div></td><td>{ratingText(self.kpis?.[k.id])}</td>{hasM && <td>{ratingText(m.kpis?.[k.id])}</td>}</tr>)}
            {rv.snap.comps.map((x: any) => <tr key={x.id} className="border-t border-slate-100"><td className="py-1">{x.name}</td><td>{ratingText(self.comps?.[x.id])}</td>{hasM && <td>{ratingText(m.comps?.[x.id])}</td>}</tr>)}
            {hasM && rv.snap.sops.map((x: any) => <tr key={x.id} className="border-t border-slate-100"><td className="py-1">SOP: {x.title}{x.critical ? ' (critical)' : ''}</td><td>-</td><td>{SOP_WORDS[m.sops?.[x.id] as SopResult] || '-'}</td></tr>)}
          </tbody>
        </table>
      </Card>
      <Card title="Comments">
        {self.achievements && <p className="text-sm mb-2"><b>Employee:</b> {self.achievements}{self.improve ? ` · Wants to improve: ${self.improve}` : ''}</p>}
        {hasM && <div className="text-sm space-y-1"><p><b>Strengths:</b> {m.strengths || '-'}</p><p><b>To improve:</b> {m.improve || '-'}</p><p><b>Training:</b> {m.training || '-'}</p><p><b>Manager's comment:</b> {m.comment}</p><p className="text-xs text-slate-500">Discussed on {m.discussedOn}</p></div>}
        {!hasM && !self.achievements && <p className="text-sm text-slate-500">Nothing written yet.</p>}
        {rv.hr?.note && <p className="text-sm mt-2"><b>HR note:</b> {rv.hr.note}</p>}
        {rv.response && <p className="text-sm mt-2"><b>Employee response:</b> {rv.response.agree ? 'Acknowledged.' : `Disagrees: "${rv.response.comment}"`}</p>}
        {rv.resolution && <p className="text-sm mt-2"><b>HR decision:</b> {rv.resolution.note}</p>}
      </Card>
    </>
  );
};

/** Only the actions this person may take right now. Each one asks for exactly what it needs. */
const Actions: React.FC<{ rv: any; can: any; reload: () => void; back: () => void }> = ({ rv, can, reload }) => {
  const { busy, note, run } = useRunner();
  const [text, setText] = useState(''); const [mode, setMode] = useState('');
  useEffect(() => { setText(''); setMode(''); }, [rv.status]);
  const act = (action: string, body: any, done: string) => run(async () => { await pmService.post(action, { id: rv.id, ...body }); setMode(''); setText(''); await reload(); }, done);
  const any = Object.entries(can).some(([k, v]) => v && !['self', 'manager', 'aiDraft'].includes(k));
  if (!any) return null;
  const needText = (min: number, what: string) => (text.trim().length < min ? [what] : []);
  return (
    <Card title="What you can do now">
      <ResultNote note={note} />
      <div className="space-y-3">
        {can.skipSelf && <div><p className="text-sm text-slate-600 mb-1">The self-review was due on {rv.selfDue} and is not done.</p><button className={btnPrimary} disabled={busy} onClick={() => act('review-skip-self', {}, 'You can now do your part.')}>Continue without the self-review</button></div>}
        {can.approve && (
          <div className="space-y-2">
            {rv.score?.criticalBreach && <Notice tone="error">A critical SOP was marked not compliant. Write what you checked before approving. Misconduct follows the separate investigation process.</Notice>}
            <Note label={rv.score?.criticalBreach ? 'What you checked (required)' : 'Note (optional)'} rows={2} value={mode === 'approve' ? text : ''} onChange={(v) => { setMode('approve'); setText(v); }} />
            <div className="flex gap-2 items-start">
              <GuardedButton busy={busy} missing={rv.score?.criticalBreach ? needText(10, 'you write what you checked') : []} onClick={() => act('review-approve', { note: mode === 'approve' ? text : '' }, 'Approved.')}>Approve</GuardedButton>
              <button className={btnGhost} onClick={() => { setMode('return'); setText(''); }}>Send back to manager</button>
            </div>
            {mode === 'return' && <div className="space-y-2"><Note label="What should the manager change?" rows={2} value={text} onChange={setText} /><GuardedButton busy={busy} missing={needText(5, 'you write what to change')} onClick={() => act('review-return', { note: text }, 'Sent back.')}>Send back</GuardedButton></div>}
          </div>
        )}
        {can.publish && <div><p className="text-sm text-slate-600 mb-1">Approved. It will be shared with {rv.name} on {rv.publishOn}.</p><button className={btnPrimary} disabled={busy} onClick={() => act('review-publish', {}, 'Shared.')}>Share now</button></div>}
        {can.respond && (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">Please read your review above, then:</p>
            <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => act('review-respond', { agree: true }, 'Thank you. Your review is complete.')}>I have read it and acknowledge it</button><button className={btnGhost} onClick={() => setMode('disagree')}>I disagree with something</button></div>
            {mode === 'disagree' && <div className="space-y-2"><Note label="What do you disagree with? It is kept exactly as you write it." value={text} onChange={setText} /><GuardedButton busy={busy} missing={needText(10, 'you write what you disagree with')} onClick={() => act('review-respond', { agree: false, comment: text }, 'Recorded. HR has been told.')}>Record my disagreement</GuardedButton></div>}
          </div>
        )}
        {can.resolve && <div className="space-y-2"><Note label="HR decision on the disagreement (the employee sees this)" rows={2} value={mode === 'resolve' ? text : ''} onChange={(v) => { setMode('resolve'); setText(v); }} /><GuardedButton busy={busy} missing={mode === 'resolve' ? needText(10, 'you write the decision') : ['you write the decision']} onClick={() => act('review-resolve', { note: text }, 'Resolved.')}>Record decision</GuardedButton><p className="text-[11px] text-slate-500">If the review itself must change, use "Amend" below instead.</p></div>}
        {can.amend && (mode === 'amend' ? (
          <div className="space-y-2"><Note label="Reason for the amendment (kept on the record)" rows={2} value={text} onChange={setText} /><GuardedButton busy={busy} className={btnDanger} missing={needText(10, 'you write the reason')} onClick={() => act('review-amend', { reason: text }, 'Reopened for the manager.')}>Reopen for amendment</GuardedButton></div>
        ) : <button className={btnGhost} onClick={() => { setMode('amend'); setText(''); }}>Amend this review…</button>)}
        {can.defer && (mode === 'defer' ? (
          <div className="space-y-2"><Note label="Why is it paused?" rows={2} value={text} onChange={setText} /><GuardedButton busy={busy} missing={needText(5, 'you write why')} onClick={() => act('review-defer', { reason: text }, 'Paused.')}>Pause review</GuardedButton></div>
        ) : <button className={btnGhost} onClick={() => { setMode('defer'); setText(''); }}>Pause (e.g. long leave)…</button>)}
        {can.resume && <button className={btnPrimary} disabled={busy} onClick={() => act('review-resume', {}, 'Resumed.')}>Resume review</button>}
      </div>
    </Card>
  );
};
