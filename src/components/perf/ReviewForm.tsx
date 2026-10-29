import React, { useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { perfService } from '../../services/perfService';
import { Card, ConfirmButton, Field, Notice, btnGhost, btnPrimary, input, niceDate, shortDate, useRunner } from '../leave/ui';
import { Loading, Pill, RatingSelect, ReviewPill, fmtScore, useLoad } from './shared';

const SOP_RESULTS = [['COMPLIANT', 'Compliant'], ['NON_COMPLIANT', 'Non-compliant'], ['NOT_APPLICABLE', 'Not applicable'], ['NOT_VERIFIED', 'Not verified']];
const FINAL = ['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'CLOSED'];

const ScoreStrip: React.FC<{ s: any; weights: any }> = ({ s, weights }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
    {[['KRA / KPI', s.kra, weights.kra], ['Behaviour', s.behaviour, weights.behaviour], ['SOP compliance', s.sop, weights.sop]].map(([l, v, w]: any) => (
      <div key={l} className="border border-slate-200 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">{l} · {w}%</p><p className="text-lg font-bold text-slate-800">{fmtScore(v)}</p></div>
    ))}
    <div className="border border-[#FA7014]/40 bg-[#FA7014]/5 rounded-lg p-2.5"><p className="text-[11px] text-slate-500">Overall</p><p className="text-lg font-bold text-slate-900">{fmtScore(s.overall)} <span className="text-xs font-semibold text-slate-500">{s.band}</span></p></div>
  </div>
);

export const ReviewForm: React.FC<{ id: string; me: any; onBack: () => void; onChanged: () => void }> = ({ id, me, onBack, onChanged }) => {
  const q = useLoad(() => perfService.review(id), [id]);
  const { busy, note, setNote, run } = useRunner();
  const [item, setItem] = useState<any | null>(null);
  const [text, setText] = useState('');
  const [adj, setAdj] = useState<Record<string, { to: string; reason: string }>>({});
  const [crit, setCrit] = useState(false);
  const [part, setPart] = useState(false);
  const [ai, setAi] = useState<string | null>(null);
  React.useEffect(() => { if (q.data?.item) setItem(q.data.item); }, [q.data]);
  if (!q.data || !item) return <div className="space-y-3"><button className={btnGhost} onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> Back</button><Loading error={q.error} loading={q.loading} /></div>;

  const rel = q.data.rel as 'SELF' | 'MANAGER' | 'HR';
  const evidence: any[] = q.data.evidence || [];
  const st = item.status as string;
  const sees = q.data.canSeeScores !== false && item.scores;
  const kpis: any[] = item.kras.flatMap((k: any) => k.kpis.map((p: any) => ({ ...p, kra: k.name })));
  const ka = (kpiId: string) => item.kpiAssessments.find((a: any) => a.kpiId === kpiId) || {};
  const ca = (cid: string) => item.competencyAssessments.find((a: any) => a.competencyId === cid) || {};
  const setK = (kpiId: string, patch: any) => setItem({ ...item, kpiAssessments: item.kpiAssessments.map((a: any) => (a.kpiId === kpiId ? { ...a, ...patch } : a)) });
  const setC = (cid: string, patch: any) => setItem({ ...item, competencyAssessments: item.competencyAssessments.map((a: any) => (a.competencyId === cid ? { ...a, ...patch } : a)) });
  const setS = (i: number, patch: any) => setItem({ ...item, sopChecks: item.sopChecks.map((c: any, j: number) => (j === i ? { ...c, ...patch } : c)) });
  const after = async () => { await q.reload(); onChanged(); };
  const act = (fn: () => Promise<any>, done: string) => run(async () => { await fn(); await after(); }, done);

  const selfBody = () => ({
    id, achievements: item.achievements,
    kpis: item.kpiAssessments.map((a: any) => ({ kpiId: a.kpiId, selfNote: a.selfNote, selfScore: a.selfScore })),
    competencies: item.competencyAssessments.map((a: any) => ({ competencyId: a.competencyId, selfRating: a.selfRating, selfNotObserved: a.selfNotObserved, selfExamples: a.selfExamples })),
  });
  const mgrBody = () => ({
    id, strengths: item.strengths, improvements: item.improvements, trainingNeeds: item.trainingNeeds, managerComments: item.managerComments,
    kpis: item.kpiAssessments.map((a: any) => ({ kpiId: a.kpiId, managerNote: a.managerNote, managerScore: a.managerScore, insufficientEvidence: a.insufficientEvidence, evidenceIds: a.evidenceIds })),
    competencies: item.competencyAssessments.map((a: any) => ({ competencyId: a.competencyId, managerRating: a.managerRating, managerNotObserved: a.managerNotObserved, managerExamples: a.managerExamples, evidenceRefs: a.evidenceRefs })),
    sopChecks: item.sopChecks.map((c: any) => ({ sopId: c.sopId, checkpointId: c.checkpointId, result: c.result, evidence: c.evidence, severity: c.severity, correctiveAction: c.correctiveAction })),
  });
  const adjList = () => Object.entries(adj).filter(([, v]) => v.to !== '' || v.reason).map(([target, v]) => ({ target, to: v.to === '' ? null : Number(v.to), reason: v.reason }));

  const selfEdit = rel === 'SELF' && st === 'SELF_PENDING';
  const mgrEdit = rel === 'MANAGER' && st === 'MANAGER_PENDING';
  const hrEdit = rel === 'HR' && me.canManage && st === 'HR_REVIEW';
  const showSelfCols = !(rel === 'MANAGER' && !item.selfSubmittedAt) && !(rel === 'SELF' && !FINAL.includes(st) && !selfEdit && false);
  const calib = hrEdit || (rel === 'HR' && (me.canManage || me.canApprove) && FINAL.includes(st));

  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" /> Back to reviews</button>
      <Card title={`${item.employeeName} · ${item.cycleName}`} subtitle={`${shortDate(item.periodStart)} – ${shortDate(item.periodEnd)} · ${item.department || ''} · manager ${q.data.managerName || 'not set'}`} right={<ReviewPill status={st} />}>
        {item.pendingReason && <Notice tone="warn">{item.pendingReason}</Notice>}
        {sees && item.scores && <ScoreStrip s={item.scores} weights={item.weights} />}
        {sees && item.scores?.partial && <div className="mt-2"><Notice tone="warn">Part of this review had no scorable evidence ({item.scores.missing.join(', ')}). The overall score is built from the rest.</Notice></div>}
        {sees && item.scores?.criticalFindings?.length > 0 && (
          <div className="mt-2"><Notice tone="error"><strong>Critical SOP findings (reported separately from the average):</strong> {item.scores.criticalFindings.map((f: any) => `${f.sopTitle}: ${f.checkpoint}`).join('; ')}</Notice></div>
        )}
        {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}
      </Card>

      {rel === 'SELF' && !FINAL.includes(st) && !selfEdit && st !== 'CONFIGURATION_PENDING' && st !== 'DEFERRED' && <Notice>Your self-assessment is in. Your manager and HR will complete the rest. You will see the result once it is published.</Notice>}

      {/* KRA / KPI */}
      {kpis.length > 0 && (
        <Card title="1. Results (KRA / KPI)" subtitle="Rate achievement against the agreed target, using evidence. If there is not enough evidence, say so: it is left out of the score, never counted as zero.">
          <div className="space-y-4">
            {kpis.map((p) => {
              const a = ka(p.id);
              const proof = evidence.filter((e) => e.kpiId === p.id);
              return (
                <div key={p.id} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-slate-800">{p.code && <span className="text-slate-400 mr-1">{p.code}</span>}{p.description}</p><span className="text-xs font-bold text-slate-500">{p.weightage}%</span></div>
                  <p className="text-xs text-slate-500">{p.kra} · Target: <span className="text-slate-700">{p.target || 'not set'}</span></p>
                  {proof.length > 0 && <ul className="text-[11px] text-slate-500 list-disc pl-4">{proof.map((e) => <li key={e.id}>{shortDate(e.occurredAt)}: {e.description || e.reference} <span className="text-slate-400">({e.status.toLowerCase()})</span></li>)}</ul>}
                  {(selfEdit || a.selfNote || a.selfScore) && showSelfCols && (
                    <div className="bg-slate-50 rounded-lg p-2 space-y-1.5"><p className="text-[11px] font-bold text-slate-500">Employee's view</p>
                      {selfEdit ? (<><textarea className={input} rows={2} placeholder="What did you achieve?" value={a.selfNote || ''} onChange={(e) => setK(p.id, { selfNote: e.target.value })} /><RatingSelect value={a.selfScore ?? null} onChange={(v) => setK(p.id, { selfScore: v })} /></>) : (<p className="text-sm text-slate-700">{a.selfNote || '–'} {a.selfScore ? <Pill tone="blue">self {a.selfScore}</Pill> : null}</p>)}
                    </div>
                  )}
                  {(mgrEdit || (rel !== 'SELF' || FINAL.includes(st))) && (mgrEdit || a.managerNote || a.managerScore || a.insufficientEvidence) && (
                    <div className="bg-amber-50/50 rounded-lg p-2 space-y-1.5"><p className="text-[11px] font-bold text-slate-500">Manager's assessment</p>
                      {mgrEdit ? (<>
                        <textarea className={input} rows={2} placeholder="Evidence-based note" value={a.managerNote || ''} onChange={(e) => setK(p.id, { managerNote: e.target.value })} />
                        <RatingSelect value={a.managerScore ?? null} disabled={a.insufficientEvidence} onChange={(v) => setK(p.id, { managerScore: v })} notObserved={a.insufficientEvidence} onNotObserved={(v) => setK(p.id, { insufficientEvidence: v, managerScore: null })} naLabel="Insufficient evidence" />
                      </>) : (<p className="text-sm text-slate-700">{a.managerNote || '–'} {a.insufficientEvidence ? <Pill tone="slate">insufficient evidence</Pill> : a.managerScore ? <Pill tone="amber">{a.managerScore}</Pill> : null}{a.finalScore ? <Pill tone="green">final {a.finalScore}</Pill> : null}</p>)}
                    </div>
                  )}
                  {calib && (
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-slate-500">Change to</span>
                      <select className={`${input} !w-20`} value={adj[`kpi:${p.id}`]?.to ?? ''} onChange={(e) => setAdj({ ...adj, [`kpi:${p.id}`]: { to: e.target.value, reason: adj[`kpi:${p.id}`]?.reason || '' } })}><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
                      <input className={`${input} flex-1 min-w-[10rem]`} placeholder="Reason (required)" value={adj[`kpi:${p.id}`]?.reason || ''} onChange={(e) => setAdj({ ...adj, [`kpi:${p.id}`]: { to: adj[`kpi:${p.id}`]?.to ?? '', reason: e.target.value } })} /></div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Behaviour */}
      {item.competencies.length > 0 && (
        <Card title="2. Behaviour" subtitle="Rate only what has been observed at work, with an example. Mark 'Not observed' when there is nothing to base a rating on.">
          <div className="space-y-3">
            {item.competencies.map((c: any) => {
              const a = ca(c.competencyId);
              return (
                <div key={c.competencyId} className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-semibold text-slate-800">{c.name}</p><p className="text-xs text-slate-500">{c.standard}</p>
                  {showSelfCols && (selfEdit || a.selfRating || a.selfNotObserved || a.selfExamples) && (
                    <div className="bg-slate-50 rounded-lg p-2 space-y-1.5"><p className="text-[11px] font-bold text-slate-500">Employee's view</p>
                      {selfEdit ? (<><RatingSelect value={a.selfRating ?? null} onChange={(v) => setC(c.competencyId, { selfRating: v })} notObserved={a.selfNotObserved} onNotObserved={(v) => setC(c.competencyId, { selfNotObserved: v })} />
                        <input className={input} placeholder="An example" value={a.selfExamples || ''} onChange={(e) => setC(c.competencyId, { selfExamples: e.target.value })} /></>) : (<p className="text-sm text-slate-700">{a.selfNotObserved ? 'Not observed' : a.selfRating || '–'} {a.selfExamples ? `· ${a.selfExamples}` : ''}</p>)}
                    </div>
                  )}
                  {(mgrEdit || (rel !== 'SELF' || FINAL.includes(st))) && (mgrEdit || a.managerRating || a.managerNotObserved) && (
                    <div className="bg-amber-50/50 rounded-lg p-2 space-y-1.5"><p className="text-[11px] font-bold text-slate-500">Manager's assessment</p>
                      {mgrEdit ? (<><RatingSelect value={a.managerRating ?? null} onChange={(v) => setC(c.competencyId, { managerRating: v })} notObserved={a.managerNotObserved} onNotObserved={(v) => setC(c.competencyId, { managerNotObserved: v })} />
                        <input className={input} placeholder="Observed example (needed for a 1, 2 or 5)" value={a.managerExamples || ''} onChange={(e) => setC(c.competencyId, { managerExamples: e.target.value })} />
                        <input className={input} placeholder="Evidence reference (optional)" value={a.evidenceRefs || ''} onChange={(e) => setC(c.competencyId, { evidenceRefs: e.target.value })} /></>) : (<p className="text-sm text-slate-700">{a.managerNotObserved ? 'Not observed' : a.managerRating || '–'} {a.managerExamples ? `· ${a.managerExamples}` : ''}{a.finalRating ? <Pill tone="green">final {a.finalRating}</Pill> : null}</p>)}
                    </div>
                  )}
                  {calib && (
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-slate-500">Change to</span>
                      <select className={`${input} !w-20`} value={adj[`competency:${c.competencyId}`]?.to ?? ''} onChange={(e) => setAdj({ ...adj, [`competency:${c.competencyId}`]: { to: e.target.value, reason: adj[`competency:${c.competencyId}`]?.reason || '' } })}><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
                      <input className={`${input} flex-1 min-w-[10rem]`} placeholder="Reason (required)" value={adj[`competency:${c.competencyId}`]?.reason || ''} onChange={(e) => setAdj({ ...adj, [`competency:${c.competencyId}`]: { to: adj[`competency:${c.competencyId}`]?.to ?? '', reason: e.target.value } })} /></div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* SOP */}
      {rel !== 'SELF' || FINAL.includes(st) ? (item.sopChecks.length > 0 && (
        <Card title="3. SOP compliance" subtitle="Reading an SOP is not the same as following it. Mark what you have checked. Critical controls (security, legal, financial) are reported on their own.">
          <div className="space-y-2">
            {item.sopChecks.map((c: any, i: number) => (
              <div key={`${c.sopId}-${c.checkpointId}`} className={`border rounded-lg p-3 space-y-1.5 ${c.critical ? 'border-rose-200' : 'border-slate-200'}`}>
                <p className="text-sm text-slate-800"><span className="text-slate-400 text-xs mr-1.5">{c.sopTitle} v{c.versionNumber}</span>{c.checkpoint} {c.critical && <Pill tone="red">critical</Pill>}</p>
                {mgrEdit ? (<div className="grid sm:grid-cols-2 gap-2">
                  <select className={input} value={c.result} onChange={(e) => setS(i, { result: e.target.value })}>{SOP_RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  <input className={input} placeholder="Evidence" value={c.evidence} onChange={(e) => setS(i, { evidence: e.target.value })} />
                  {c.result === 'NON_COMPLIANT' && (<><select className={input} value={c.severity} onChange={(e) => setS(i, { severity: e.target.value })}>{['LOW', 'MEDIUM', 'HIGH'].map((v) => <option key={v}>{v}</option>)}</select>
                    <input className={input} placeholder="Corrective action (required)" value={c.correctiveAction} onChange={(e) => setS(i, { correctiveAction: e.target.value })} /></>)}
                </div>) : <p className="text-xs text-slate-600">{SOP_RESULTS.find(([v]) => v === c.result)?.[1]}{c.evidence ? ` · ${c.evidence}` : ''}{c.correctiveAction ? ` · action: ${c.correctiveAction}` : ''}</p>}
              </div>
            ))}
          </div>
        </Card>
      )) : null}

      {/* narrative */}
      {selfEdit && (
        <Card title="My achievements"><textarea className={input} rows={4} placeholder="What are you proud of this period?" value={item.achievements || ''} onChange={(e) => setItem({ ...item, achievements: e.target.value })} /></Card>
      )}
      {!selfEdit && item.achievements && showSelfCols && <Card title="Employee's achievements"><p className="text-sm text-slate-700 whitespace-pre-wrap">{item.achievements}</p></Card>}
      {mgrEdit && (
        <Card title="Manager's summary">
          <div className="space-y-2">
            <Field label="Overall comments"><textarea className={input} rows={3} value={item.managerComments || ''} onChange={(e) => setItem({ ...item, managerComments: e.target.value })} /></Field>
            <Field label="Strengths"><textarea className={input} rows={2} value={item.strengths || ''} onChange={(e) => setItem({ ...item, strengths: e.target.value })} /></Field>
            <Field label="Areas to improve"><textarea className={input} rows={2} value={item.improvements || ''} onChange={(e) => setItem({ ...item, improvements: e.target.value })} /></Field>
            <Field label="Training needs"><textarea className={input} rows={2} value={item.trainingNeeds || ''} onChange={(e) => setItem({ ...item, trainingNeeds: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2 items-center">
              <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await perfService.aiDraft(id); setAi(r.ai ? (r.draft || r.message || '') : r.message); })}><Sparkles className="w-3.5 h-3.5" /> Draft an evidence summary</button>
              <span className="text-[11px] text-slate-400">AI only restates the evidence list, citing each item. It never rates or decides.</span>
            </div>
            {ai !== null && <Notice tone="info"><span className="whitespace-pre-wrap">{ai || 'Nothing to summarise.'}</span> {ai && <button className="underline font-bold ml-2" onClick={() => setItem({ ...item, managerComments: `${item.managerComments ? item.managerComments + '\n' : ''}${ai}` })}>Add to comments</button>}</Notice>}
          </div>
        </Card>
      )}
      {!mgrEdit && !selfEdit && rel !== 'SELF' && (item.managerComments || item.strengths || item.improvements) && (
        <Card title="Manager's summary"><div className="text-sm text-slate-700 space-y-1 whitespace-pre-wrap">{item.managerComments && <p>{item.managerComments}</p>}{item.strengths && <p><strong>Strengths:</strong> {item.strengths}</p>}{item.improvements && <p><strong>To improve:</strong> {item.improvements}</p>}{item.trainingNeeds && <p><strong>Training:</strong> {item.trainingNeeds}</p>}</div></Card>
      )}
      {rel === 'SELF' && FINAL.includes(st) && (item.managerComments || item.strengths) && (
        <Card title="Your manager's feedback"><div className="text-sm text-slate-700 space-y-1 whitespace-pre-wrap">{item.managerComments && <p>{item.managerComments}</p>}{item.strengths && <p><strong>Strengths:</strong> {item.strengths}</p>}{item.improvements && <p><strong>To improve:</strong> {item.improvements}</p>}{item.finalComments && <p><strong>Final note:</strong> {item.finalComments}</p>}</div></Card>
      )}

      {/* actions */}
      {selfEdit && (
        <div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => act(() => perfService.selfSave(selfBody()), 'Draft saved.')}>Save draft</button>
          <ConfirmButton className={btnPrimary} question="Submit? You cannot change it afterwards." yes="Submit" onConfirm={() => act(() => perfService.selfSubmit(selfBody()), 'Self-assessment submitted.')}>Submit self-assessment</ConfirmButton></div>
      )}
      {mgrEdit && (
        <div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => act(() => perfService.mgrSave(mgrBody()), 'Draft saved.')}>Save draft</button>
          <button className={btnPrimary} disabled={busy} onClick={() => act(() => perfService.mgrSubmit(mgrBody()), 'Assessment submitted.')}>Submit assessment</button></div>
      )}
      {rel === 'MANAGER' && st === 'DISCUSSION_PENDING' && (
        <Card title="Feedback discussion" subtitle="Talk the ratings through with the employee, then record what was covered.">
          <textarea className={input} rows={3} placeholder="What was discussed? Any points the employee raised?" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-2"><button className={btnPrimary} disabled={busy || !text.trim()} onClick={() => act(() => perfService.discussion(id, text), 'Recorded. HR will review next.')}>Discussion held</button></div>
        </Card>
      )}
      {hrEdit && (
        <Card title="HR review and calibration" subtitle="Check consistency and evidence. Any change to a rating needs a reason, which is recorded.">
          {item.scores?.criticalFindings?.length > 0 && <label className="flex items-center gap-2 text-sm mb-1.5"><input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} /> I have looked at the critical SOP findings separately</label>}
          {item.scores?.partial && <label className="flex items-center gap-2 text-sm mb-1.5"><input type="checkbox" checked={part} onChange={(e) => setPart(e.target.checked)} /> I accept a partial score (some parts had no scorable evidence)</label>}
          <textarea className={input} rows={2} placeholder="HR note (optional)" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2 mt-2">
            <button className={btnGhost} disabled={busy} onClick={() => act(() => perfService.hrSave({ id, adjustments: adjList(), hrNote: text, hrCriticalAcknowledged: crit, hrPartialAcknowledged: part }), 'Calibration saved.')}>Save changes</button>
            <button className={btnPrimary} disabled={busy} onClick={() => act(() => perfService.hrForward({ id, adjustments: adjList(), hrNote: text, hrCriticalAcknowledged: crit, hrPartialAcknowledged: part }), 'Sent for final approval.')}>Send for approval</button>
            <ConfirmButton className={btnGhost} question="Send back to the manager?" yes="Send back" onConfirm={() => { if (!text.trim()) { setNote({ tone: 'error', text: 'Write what needs another look in the HR note first.' }); return; } return act(() => perfService.returnReview(id, text), 'Sent back to the manager.'); }}>Send back to manager</ConfirmButton>
          </div>
        </Card>
      )}
      {rel === 'HR' && st === 'APPROVAL_PENDING' && me.canApprove && (
        <Card title="Final approval" subtitle="You cannot approve your own review, or one you evaluated.">
          {item.hrNote && <p className="text-sm text-slate-600 mb-2">HR note: {item.hrNote}</p>}
          <textarea className={input} rows={2} placeholder="Final comments (optional) / reason if sending back" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2 mt-2"><button className={btnPrimary} disabled={busy} onClick={() => act(() => perfService.approveReview(id, text), 'Approved and published.')}>Approve and publish</button>
            <button className={btnGhost} disabled={busy || !text.trim()} onClick={() => act(() => perfService.returnReview(id, text), 'Sent back to HR.')}>Send back to HR</button></div>
        </Card>
      )}
      {rel === 'SELF' && st === 'PUBLISHED' && (
        <Card title="Your response" subtitle="You can accept this review or say you disagree. Disagreement is looked at by someone other than your manager.">
          <textarea className={input} rows={3} placeholder="Comment (needed if you disagree)" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2 mt-2"><button className={btnPrimary} disabled={busy} onClick={() => act(() => perfService.respond(id, 'ACKNOWLEDGE', text), 'Thank you. Your review is acknowledged.')}>I have read and acknowledge it</button>
            <button className={btnGhost} disabled={busy || !text.trim()} onClick={() => act(() => perfService.respond(id, 'DISAGREE', text), 'Your disagreement was sent to HR.')}>I disagree</button></div>
        </Card>
      )}
      {item.employeeResponse?.decision && <Notice tone={item.employeeResponse.decision === 'DISAGREED' ? 'warn' : 'ok'}>Employee {item.employeeResponse.decision === 'DISAGREED' ? 'disagreed' : 'acknowledged'} on {niceDate(item.employeeResponse.at.slice(0, 10))}{item.employeeResponse.comment ? `: ${item.employeeResponse.comment}` : ''}</Notice>}
      {rel === 'HR' && st === 'DISPUTED' && (me.canManage || me.canApprove) && (
        <Card title="Resolve the dispute">
          <textarea className={input} rows={3} placeholder="Outcome and reasons" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2 mt-2"><button className={btnPrimary} disabled={busy || !text.trim()} onClick={() => act(() => perfService.resolveDispute(id, 'UPHELD', text), 'Dispute closed.')}>Rating stands</button>
            <button className={btnGhost} disabled={busy || !text.trim()} onClick={() => act(() => perfService.resolveDispute(id, 'AMENDED', text), 'Dispute closed (amended).')}>Closed after amending</button></div>
        </Card>
      )}
      {rel === 'HR' && FINAL.includes(st) && (me.canManage || me.canApprove) && adjList().length > 0 && (
        <button className={btnPrimary} disabled={busy} onClick={() => act(() => perfService.amend(id, adjList()), 'Review amended and recorded.')}>Amend this finalised review ({adjList().length} change{adjList().length === 1 ? '' : 's'})</button>
      )}
      {rel !== 'SELF' && ['CONFIGURATION_PENDING', 'SELF_PENDING', 'MANAGER_PENDING', 'DEFERRED'].includes(st) && me.canManage && (
        <div className="flex gap-2 items-center">
          {st === 'DEFERRED' ? <button className={btnGhost} disabled={busy} onClick={() => act(() => perfService.defer(id, true), 'Review resumed.')}>Resume review</button>
            : <ConfirmButton className={btnGhost} question="Defer this review?" yes="Defer" onConfirm={() => act(() => perfService.defer(id, false, text || 'Approved leave / not available'), 'Review deferred.')}>Defer review</ConfirmButton>}
        </div>
      )}
      {rel !== 'SELF' && (item.managerUid === me.uid || me.canManage) && (
        <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Concern about conduct, safety or harassment?</summary>
          <p className="mt-1">These do not belong in a performance review. Refer them to the confidential HR process; only the fact of the referral is recorded here.</p>
          <ConfirmButton className={`${btnGhost} mt-1`} question="Refer to confidential HR process?" yes="Refer" onConfirm={() => act(() => perfService.referral(id), 'Referred. Please pass the details to HR directly.')}>Refer to confidential process</ConfirmButton></details>
      )}
      {item.history?.length > 0 && rel !== 'SELF' && (
        <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">History ({item.history.length})</summary>
          <ul className="mt-1 space-y-0.5">{item.history.map((h: any, i: number) => <li key={i}>{niceDate(h.at.slice(0, 10))} · {h.by} · {h.action.toLowerCase().replace(/_/g, ' ')}{h.note ? ` · ${h.note}` : ''}</li>)}</ul></details>
      )}
    </div>
  );
};
