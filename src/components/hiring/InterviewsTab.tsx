import React, { useState } from 'react';
import { pipelineService } from '../../services/pipelineService';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';

const RECS: [string, string][] = [['STRONG_YES', 'Strong yes'], ['YES', 'Yes'], ['NO', 'No'], ['STRONG_NO', 'Strong no']];
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

/** Scorecard form and, once allowed, the panel's cards. Until everyone has submitted, an interviewer sees only their own. */
export const FeedbackPanel: React.FC<{ interviewId: string; manager: boolean; onChanged?: () => void }> = ({ interviewId, manager, onChanged }) => {
  const fb = useLoad(() => pipelineService.feedback(interviewId), [interviewId]);
  const { run, busy, note } = useRunner();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [rec, setRec] = useState('YES');
  const [strengths, setStrengths] = useState('');
  const [concerns, setConcerns] = useState('');
  const d = fb.data;
  const view = d?.view;
  const submit = () => run(async () => { await pipelineService.submitFeedback(interviewId, { ratings, recommendation: rec, strengths, concerns }); await fb.reload(); onChanged?.(); }, 'Scorecard submitted. It cannot be changed.');

  return (
    <div className="space-y-3">
      <Loading error={fb.error} loading={fb.loading} />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {d?.onPanel && !d.iSubmitted && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="text-xs text-slate-500">Rate each point from 1 (weak) to 5 (excellent). You will not see colleagues' scorecards until you and everyone else on the panel have submitted.</p>
          {(d.criteria as string[]).map((c) => (
            <div key={c} className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700">{c}</span>
              <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setRatings({ ...ratings, [c]: n })} className={`h-7 w-7 rounded-md border text-xs font-bold ${ratings[c] === n ? 'border-[#FA7014] bg-[#FA7014] text-white' : 'border-slate-300 bg-white text-slate-600'}`}>{n}</button>)}</div>
            </div>
          ))}
          <Field label="Recommendation"><select className={input} value={rec} onChange={(e) => setRec(e.target.value)}>{RECS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Strengths"><textarea className={input} rows={2} value={strengths} onChange={(e) => setStrengths(e.target.value)} /></Field>
          <Field label="Concerns"><textarea className={input} rows={2} value={concerns} onChange={(e) => setConcerns(e.target.value)} /></Field>
          <button className={btnPrimary} disabled={busy} onClick={submit}>Submit scorecard</button>
        </div>
      )}
      {view && (
        <div className="text-xs text-slate-500">
          {view.submittedCount} of {view.expectedCount} scorecards submitted.
          {view.hiddenCount > 0 && ` ${view.hiddenCount} hidden until the panel is complete.`}
        </div>
      )}
      {view?.summary && (
        <Notice tone="info">Panel read: <strong>{view.summary.recommendation}</strong> - average {view.summary.average} / 5 ({Object.entries(view.summary.split).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})</Notice>
      )}
      {(view?.visible || []).map((c: any) => (
        <div key={c.interviewerId} className="rounded-lg border border-slate-200 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between"><span className="font-bold text-slate-800">{c.interviewerName}</span><Pill tone={c.recommendation.includes('YES') ? 'green' : 'red'}>{c.recommendation.replace('_', ' ').toLowerCase()}</Pill></div>
          <div className="text-slate-500">{Object.entries(c.ratings).map(([k, v]) => `${k}: ${v}`).join(' - ')}</div>
          {c.strengths && <p className="mt-1 text-slate-700"><strong>Strengths:</strong> {c.strengths}</p>}
          {c.concerns && <p className="text-slate-700"><strong>Concerns:</strong> {c.concerns}</p>}
        </div>
      ))}
      {manager && view?.summary && (
        <div className="space-y-2">
          <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pipelineService.aiSummary(interviewId); await fb.reload(); }, 'Summary ready.')}>Summarise the feedback</button>
          {d.aiSummary && <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{d.aiSummary.text}</pre>}
        </div>
      )}
    </div>
  );
};

/** Interviews: HR sees all; an interviewer sees the ones they are on and can open the scorecard. */
export const InterviewsTab: React.FC = () => {
  const list = useLoad(() => pipelineService.interviews(), []);
  const [open, setOpen] = useState<string | null>(null);
  const { run, busy, note } = useRunner();
  const items: any[] = list.data?.items || [];
  const manager = !!list.data?.manager;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Loading error={list.error} loading={list.loading} />
      {!list.loading && items.length === 0 && <EmptyState title="No interviews" text={manager ? 'Schedule one from a candidate.' : 'Interviews you are asked to take will show here.'} />}
      {items.map((i) => (
        <Card key={i.id} title={`${i.round}: ${i.candidateName}`} subtitle={`${i.positionTitle} - ${when(i.startIso)} - ${i.mode}${i.location ? ` - ${i.location}` : ''}`}
          right={<Pill tone={i.status === 'COMPLETED' ? 'green' : i.status === 'CANCELLED' ? 'slate' : 'blue'}>{i.status.toLowerCase()}</Pill>}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Panel: {(i.panel as any[]).map((p) => p.name).join(', ')}</span>
            <span>- {i.submittedCount}/{(i.panel as any[]).length} scorecards</span>
            {i.iAmOnPanel && !i.iSubmitted && i.status !== 'CANCELLED' && <Pill tone="amber">Your scorecard is due</Pill>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(i.iAmOnPanel || manager) && i.status !== 'CANCELLED' && <button className={btnGhost} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide' : i.iAmOnPanel && !i.iSubmitted ? 'Give feedback' : 'View feedback'}</button>}
            {manager && i.status === 'SCHEDULED' && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pipelineService.cancel(i.id, ''); await list.reload(); }, 'Interview cancelled and everyone notified.')}>Cancel</button>}
          </div>
          {open === i.id && <div className="mt-3"><FeedbackPanel interviewId={i.id} manager={manager} onChanged={list.reload} /></div>}
        </Card>
      ))}
    </div>
  );
};
