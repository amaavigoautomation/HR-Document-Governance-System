import React, { useState } from 'react';
import { aiService, dashService, screenLinkService } from '../../services/hiringExtraService';
import { pipelineService } from '../../services/pipelineService';
import { Card, ConfirmButton, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';

const VTONE: Record<string, 'green' | 'blue' | 'amber' | 'red'> = { HIRE: 'green', CONSIDER: 'blue', HOLD: 'amber', NO_HIRE: 'red' };

/** Per-candidate AI actions, shown inside the candidate drawer. */
export const CandidateAi: React.FC<{ applicationId: string; onChanged: () => void }> = ({ applicationId, onChanged }) => {
  const { run, busy, note } = useRunner();
  const [res, setRes] = useState<any>(null);
  const [rec, setRec] = useState<any>(null);
  const [draft, setDraft] = useState<{ purpose: string; subject: string; body: string } | null>(null);
  const [purpose, setPurpose] = useState('next_round');
  return (
    <Card title="AI help" subtitle="AI reads and writes. The score and verdict come from fixed rules. Names are never sent to the AI.">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await aiService.resume(applicationId); setRes(r); onChanged(); })}>Read resume with AI</button>
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => setRec(await aiService.recommend(applicationId)))}>Hiring recommendation</button>
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await screenLinkService.create(applicationId, true); }, 'Screening link emailed to the candidate.')}>Send screening link</button>
      </div>
      {res?.aiOff && <Notice tone="warn">{res.note}</Notice>}
      {res?.analysis && (
        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <p>{res.extraction.summary}</p>
          <p className="text-xs">Skills: {res.extraction.skills.join(', ') || 'none found'}. Certifications: {res.extraction.certifications.join(', ') || 'none'}.</p>
          <p className="text-xs">{res.analysis.jobs} jobs, average stay {res.analysis.averageTenureMonths ?? '-'} months, stability {res.analysis.stabilityScore ?? '-'}/100.</p>
          {res.analysis.gaps.length > 0 && <p className="text-xs text-amber-700">Gaps: {res.analysis.gaps.map((g: any) => `${g.from} to ${g.to} (${g.months} months)`).join('; ')}</p>}
        </div>
      )}
      {rec && (
        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <Pill tone={VTONE[rec.verdict] || 'slate' as any}>{rec.verdictLabel}</Pill> <span className="text-xs text-slate-500">{rec.points} points</span>
          <p>{rec.narrative}</p>
          {rec.note && <p className="text-[11px] text-slate-400">{rec.note}</p>}
        </div>
      )}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${input} max-w-[220px]`} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            <option value="next_round">Move to next round</option><option value="reject">Polite rejection</option><option value="hold">Still deciding</option><option value="reference">Ask for references</option><option value="offer_call">Offer call</option>
          </select>
          <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await aiService.followup(applicationId, purpose); setDraft({ purpose, subject: r.subject, body: r.body }); })}>Draft email</button>
        </div>
        {draft && (
          <div className="mt-2 space-y-2">
            <input className={input} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            <textarea className={`${input} h-40`} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await aiService.followupSend(applicationId, draft.subject, draft.body); setDraft(null); }, 'Email sent.')}>Send to candidate</button>
          </div>
        )}
      </div>
    </Card>
  );
};

const SL_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue'> = { COMPLETED: 'green', PENDING: 'blue', RESCHEDULE: 'amber', NO_RESPONSE: 'red' };
const ScreeningLinks: React.FC = () => {
  const l = useLoad(() => screenLinkService.list(), []);
  const items: any[] = l.data?.items || [];
  return (
    <Card title="Candidate screening links" subtitle="Status of the forms sent to candidates. No answer after 3 days becomes No response.">
      <Loading error={l.error} loading={l.loading} />
      {!l.loading && items.length === 0 && <p className="text-xs text-slate-500">None sent yet. Open a candidate and press Send screening link.</p>}
      <ul className="divide-y divide-slate-100 text-sm">{items.map((x) => (
        <li key={x.id} className="py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{x.candidateName}</b> - {x.designation}</span><Pill tone={SL_TONE[x.status] || 'blue'}>{String(x.status).replace('_', ' ').toLowerCase()}</Pill></div>
          {x.answers && <p className="text-xs text-slate-600">{x.answers.currentCompany && `${x.answers.currentCompany}. `}Notice {x.answers.noticePeriod || '-'}, expects {x.answers.expectedCtc || '-'}. Available: {(x.answers.slots || []).map((s: string) => s.replace('T', ' ')).join('; ') || '-'}</p>}</li>
      ))}</ul>
    </Card>
  );
};

/** Duplicate candidates, side-by-side comparison and AI status. */
export const AiTab: React.FC = () => {
  const st = useLoad(() => aiService.status(), []);
  const dups = useLoad(() => aiService.dupScan(), []);
  const board = useLoad(() => pipelineService.board(), []);
  const integ = useLoad(() => dashService.integrations(), []);
  const { run, busy, note } = useRunner();
  const [pick, setPick] = useState<string[]>([]);
  const [cmp, setCmp] = useState<any>(null);
  const u = st.data?.usage;
  const rows: any[] = board.data?.rows || [];
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="AI status">
        <Loading error={st.error} loading={st.loading} />
        {u && (u.enabled ? <p className="text-sm text-slate-700">AI is on. {u.used} of {u.cap} calls used this month.</p> : <Notice tone="warn">AI is off. Add OPENAI_API_KEY in Vercel to turn it on. Everything still works from fixed rules.</Notice>)}
        {(integ.data?.integrations || []).length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">{integ.data.integrations.map((i: any) => <li key={i.key}><Pill tone={i.on ? 'green' : 'slate'}>{i.on ? 'on' : 'off'}</Pill> {i.label}{i.on ? '' : ` - ${i.manual}`}</li>)}</ul>
        )}
      </Card>
      <ScreeningLinks />
      <Card title="Possible duplicates" subtitle="The same person applying more than once. Merging keeps one record and moves everything onto it." right={<button className={btnGhost} onClick={dups.reload}>Scan again</button>}>
        <Loading error={dups.error} loading={dups.loading} />
        {!dups.loading && (dups.data?.groups || []).length === 0 && <EmptyState title="No duplicates found" />}
        {(dups.data?.groups || []).map((g: any, i: number) => (
          <div key={i} className="mb-3 rounded-lg border border-slate-200 p-3">
            <div className="mb-1 flex items-center gap-2"><Pill tone={g.confidence === 'SURE' ? 'red' : 'amber'}>{g.confidence === 'SURE' ? 'Same person' : 'Possibly the same'}</Pill><span className="text-xs text-slate-500">{g.reasons.join('; ')}</span></div>
            {g.candidates.map((c: any, k: number) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
                <span>{c.name} - {c.email} - {c.designation} ({c.status})</span>
                <ConfirmButton className={btnGhost} question="Keep this one and merge the rest?" yes="Merge" disabled={busy} onConfirm={() => run(async () => { await aiService.dupMerge(c.id, g.candidates.filter((x: any) => x.id !== c.id).map((x: any) => x.id)); await dups.reload(); }, 'Merged.')}>Keep this</ConfirmButton>
              </div>
            ))}
          </div>
        ))}
      </Card>
      <Card title="Compare candidates" subtitle="Pick 2 to 4. Ranking uses score, screening, tests and interview results (only counted once the whole panel has given feedback).">
        <div className="max-h-48 space-y-1 overflow-y-auto">{rows.map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pick.includes(r.id)} disabled={!pick.includes(r.id) && pick.length >= 4} onChange={(e) => setPick(e.target.checked ? [...pick, r.id] : pick.filter((x) => x !== r.id))} />{r.name} <span className="text-xs text-slate-500">{r.designation}</span></label>
        ))}</div>
        <button className={`${btnPrimary} mt-2`} disabled={busy || pick.length < 2} onClick={() => run(async () => setCmp(await aiService.compare(pick)))}>Compare</button>
        {cmp && (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-slate-700">{cmp.narrative}</p>
            {cmp.note && <p className="text-[11px] text-slate-400">{cmp.note}</p>}
            <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th>Candidate</th><th>Verdict</th><th>Score</th><th>Interview</th><th>Stability</th></tr></thead><tbody>{cmp.rows.map((r: any) => (
              <tr key={r.applicationId} className="border-t border-slate-100"><td className="py-1 font-bold">{r.name}</td><td>{r.recommendation.verdict.replace('_', ' ').toLowerCase()} ({r.recommendation.points})</td><td>{r.weightedScore ?? '-'}</td><td>{typeof r.interview === 'object' ? r.interview.average : r.interviewsPending ? 'pending' : '-'}</td><td>{r.employmentStability ?? '-'}</td></tr>
            ))}</tbody></table>
          </div>
        )}
      </Card>
    </div>
  );
};
void Field;
