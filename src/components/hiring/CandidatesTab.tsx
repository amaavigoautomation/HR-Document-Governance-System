import React, { useState } from 'react';
import { pipelineService } from '../../services/pipelineService';
import { User } from '../../types';
import { Card, Drawer, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';
import { FeedbackPanel } from './InterviewsTab';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const stageTone = (s: string) => (s === 'Selected' ? 'green' : s === 'Rejected' ? 'red' : s === 'On Hold' ? 'amber' : s.startsWith('Interview') ? 'blue' : 'slate') as 'green' | 'red' | 'amber' | 'blue' | 'slate';

const ScoreBlock: React.FC<{ score: any }> = ({ score }) => (
  <div>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-black text-slate-900">{score.earned}</span><span className="text-xs text-slate-500">out of 100 so far</span>
      {score.normalised !== null && !score.complete && <span className="text-xs text-slate-500">({score.normalised}% of what has been judged)</span>}
    </div>
    <div className="mt-2 space-y-1">
      {score.lines.map((l: any) => (
        <div key={l.part} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-slate-600">{l.label} <span className="text-slate-400">({l.weight})</span></span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">{!l.pending && <div className="h-full bg-[#FA7014]" style={{ width: `${l.rating}%` }} />}</div>
          <span className="w-16 text-right font-semibold text-slate-700">{l.pending ? 'pending' : `${l.points}`}</span>
        </div>
      ))}
    </div>
  </div>
);

const CandidateDrawer: React.FC<{ id: string; users: User[]; onClose: () => void; onChanged: () => void }> = ({ id, users, onClose, onChanged }) => {
  const d = useLoad(() => pipelineService.candidate(id), [id]);
  const { run, busy, note } = useRunner();
  const a = d.data?.application;
  const [fields, setFields] = useState<Record<string, string>>({});
  const val = (k: string) => fields[k] ?? (a && a[k] !== undefined && a[k] !== 0 ? String(a[k]) : '');
  const [scr, setScr] = useState({ outcome: 'PASS', notes: '', communication: '', currentCtcLpa: '', expectedCtcLpa: '', noticePeriod: '' });
  const [asg, setAsg] = useState({ title: '', type: 'TECHNICAL', maxScore: '100', passScore: '60', link: '', dueOn: '' });
  const [iv, setIv] = useState({ startLocal: '', durationMinutes: '45', mode: 'Video', location: '', round: 'Interview', panel: [] as string[] });
  const [conflict, setConflict] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reload = async () => { await d.reload(); onChanged(); };
  const staff = users.filter((u) => u.active !== false).sort((x, y) => x.name.localeCompare(y.name));
  const schedule = (force = false) => run(async () => {
    try {
      await pipelineService.schedule({ ...iv, applicationId: id, startIso: new Date(iv.startLocal).toISOString(), durationMinutes: Number(iv.durationMinutes), force });
      setConflict(null);
      await reload();
    } catch (e: any) {
      if (/already has an interview/i.test(e?.message || '')) setConflict([{}]);
      throw e;
    }
  }, 'Interview scheduled. Invites sent to the candidate and the panel.');

  return (
    <Drawer open onClose={onClose} title={a?.name || 'Candidate'} subtitle={a ? `${a.designation} - ${a.email}` : ''}>
      <Loading error={d.error} loading={d.loading} />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {a && d.data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={stageTone(a.status)}>{a.status}</Pill>{d.data.referral && <Pill tone="blue">Referred by {d.data.referral.by}</Pill>}{a.resumeUrl && <a className="text-xs text-[#FA7014] underline" href={a.resumeUrl} target="_blank" rel="noreferrer">Resume</a>}</div>

          <Card title="Score" right={a.resumeUrl ? <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pipelineService.extractResume(id); await reload(); }, 'Resume read.')}>Read resume</button> : undefined}>
            <ScoreBlock score={d.data.score} />
            {d.data.resumeFacts && <p className="mt-2 text-xs text-slate-500">From the resume: {d.data.resumeFacts.years ? `${d.data.resumeFacts.years} years mentioned. ` : ''}Skills found: {d.data.resumeFacts.skillsFound.join(', ') || 'none'}. Missing: {d.data.resumeFacts.skillsMissing.join(', ') || 'none'}.</p>}
          </Card>

          <Card title="Candidate details">
            <div className="grid gap-3 md:grid-cols-2">
              {([['currentCtcLpa', 'Current CTC (LPA)'], ['expectedCtcLpa', 'Expected CTC (LPA)'], ['totalExperienceYears', 'Total experience (years)'], ['employersCount', 'Employers so far'], ['noticePeriod', 'Notice period'], ['qualification', 'Qualification'], ['portfolioUrl', 'Portfolio link']] as const).map(([k, l]) => (
                <Field key={k} label={l}><input className={input} value={val(k)} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} /></Field>
              ))}
            </div>
            <button className={`${btnPrimary} mt-3`} disabled={busy || !Object.keys(fields).length} onClick={() => run(async () => { await pipelineService.candSave({ applicationId: id, ...fields }); setFields({}); await reload(); }, 'Saved.')}>Save details</button>
          </Card>

          <Card title="HR screening" subtitle={d.data.screening ? `Last: ${d.data.screening.outcome.toLowerCase()} by ${d.data.screening.screenedBy}` : 'Record the screening call. Pass shortlists, fail rejects, hold parks the candidate.'}>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Outcome"><select className={input} value={scr.outcome} onChange={(e) => setScr({ ...scr, outcome: e.target.value })}><option value="PASS">Pass</option><option value="HOLD">Hold</option><option value="FAIL">Fail</option></select></Field>
              <Field label="Communication (0-100)"><input className={input} type="number" min={0} max={100} value={scr.communication} onChange={(e) => setScr({ ...scr, communication: e.target.value })} /></Field>
              <Field label="Notice period"><input className={input} value={scr.noticePeriod} onChange={(e) => setScr({ ...scr, noticePeriod: e.target.value })} /></Field>
              <Field label="Current CTC (LPA)"><input className={input} type="number" value={scr.currentCtcLpa} onChange={(e) => setScr({ ...scr, currentCtcLpa: e.target.value })} /></Field>
              <Field label="Expected CTC (LPA)"><input className={input} type="number" value={scr.expectedCtcLpa} onChange={(e) => setScr({ ...scr, expectedCtcLpa: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><textarea className={`${input} mt-2`} rows={2} value={scr.notes} onChange={(e) => setScr({ ...scr, notes: e.target.value })} /></Field>
            <button className={`${btnPrimary} mt-3`} disabled={busy} onClick={() => run(async () => { await pipelineService.screenSave({ applicationId: id, outcome: scr.outcome, notes: scr.notes, communication: scr.communication, answers: { currentCtcLpa: scr.currentCtcLpa, expectedCtcLpa: scr.expectedCtcLpa, noticePeriod: scr.noticePeriod } }); await reload(); }, 'Screening saved.')}>Save screening</button>
          </Card>

          <Card title="Assessments">
            {d.data.assessments.length === 0 && <p className="text-xs text-slate-500">None assigned.</p>}
            {d.data.assessments.map((x: any) => (
              <div key={x.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 text-xs">
                <div><div className="font-bold text-slate-800">{x.title}</div><div className="text-slate-500">pass mark {x.passScore} / {x.maxScore}{x.dueOn ? ` - due ${x.dueOn}` : ''}</div></div>
                {x.status === 'SCORED' ? <Pill tone={x.result === 'PASS' ? 'green' : 'red'}>{x.score} - {x.result.toLowerCase()}</Pill> : (
                  <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('s') as HTMLInputElement).value; run(async () => { await pipelineService.assessResult({ id: x.id, score: v }); await reload(); }, 'Result saved.'); }}>
                    <input name="s" type="number" min={0} max={x.maxScore} className={`${input} w-20`} placeholder="Score" /><button className={btnGhost}>Save</button>
                  </form>
                )}
              </div>
            ))}
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Field label="Title"><input className={input} value={asg.title} onChange={(e) => setAsg({ ...asg, title: e.target.value })} /></Field>
              <Field label="Type"><select className={input} value={asg.type} onChange={(e) => setAsg({ ...asg, type: e.target.value })}><option>TECHNICAL</option><option>APTITUDE</option><option>ASSIGNMENT</option><option>OTHER</option></select></Field>
              <Field label="Due date"><input className={input} type="date" value={asg.dueOn} onChange={(e) => setAsg({ ...asg, dueOn: e.target.value })} /></Field>
              <Field label="Max score"><input className={input} type="number" value={asg.maxScore} onChange={(e) => setAsg({ ...asg, maxScore: e.target.value })} /></Field>
              <Field label="Pass mark"><input className={input} type="number" value={asg.passScore} onChange={(e) => setAsg({ ...asg, passScore: e.target.value })} /></Field>
              <Field label="Test link"><input className={input} value={asg.link} onChange={(e) => setAsg({ ...asg, link: e.target.value })} placeholder="https://" /></Field>
            </div>
            <button className={`${btnPrimary} mt-3`} disabled={busy || !asg.title} onClick={() => run(async () => { await pipelineService.assessAssign({ applicationId: id, ...asg }); setAsg({ ...asg, title: '', link: '' }); await reload(); }, 'Assigned. The candidate has been emailed.')}>Assign and email</button>
          </Card>

          <Card title="Interviews">
            {d.data.interviews.map((i: any) => (
              <div key={i.id} className="border-b border-slate-100 py-2 text-xs">
                <div className="flex items-center justify-between gap-2"><div><span className="font-bold text-slate-800">{i.round}</span> <span className="text-slate-500">{when(i.startIso)} - {i.mode}</span></div><Pill tone={i.status === 'COMPLETED' ? 'green' : i.status === 'CANCELLED' ? 'slate' : 'blue'}>{i.status.toLowerCase()}</Pill></div>
                <div className="text-slate-500">Panel: {(i.panel as any[]).map((p) => p.name).join(', ')} - {i.submittedCount}/{(i.panel as any[]).length} scorecards</div>
                {i.status !== 'CANCELLED' && <button className={`${btnGhost} mt-1`} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide feedback' : 'Feedback'}</button>}
                {open === i.id && <div className="mt-2"><FeedbackPanel interviewId={i.id} manager onChanged={reload} /></div>}
              </div>
            ))}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label="Date and time (your time)"><input className={input} type="datetime-local" value={iv.startLocal} onChange={(e) => setIv({ ...iv, startLocal: e.target.value })} /></Field>
              <Field label="Round"><input className={input} value={iv.round} onChange={(e) => setIv({ ...iv, round: e.target.value })} /></Field>
              <Field label="Mode"><select className={input} value={iv.mode} onChange={(e) => setIv({ ...iv, mode: e.target.value })}><option>Video</option><option>Phone</option><option>In person</option></select></Field>
              <Field label="Minutes"><input className={input} type="number" value={iv.durationMinutes} onChange={(e) => setIv({ ...iv, durationMinutes: e.target.value })} /></Field>
              <div className="md:col-span-2"><Field label="Meeting link or address"><input className={input} value={iv.location} onChange={(e) => setIv({ ...iv, location: e.target.value })} /></Field></div>
              <div className="md:col-span-2"><Field label="Interviewers (hold Ctrl or Cmd to pick several)">
                <select multiple className={`${input} h-28`} value={iv.panel} onChange={(e) => setIv({ ...iv, panel: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}{u.departmentName ? ` - ${u.departmentName}` : ''}</option>)}
                </select></Field></div>
            </div>
            {conflict && <Notice tone="warn">An interviewer is already booked then. Pick another time, or <button className="underline" onClick={() => schedule(true)}>schedule anyway</button>.</Notice>}
            <button className={`${btnPrimary} mt-3`} disabled={busy || !iv.startLocal || iv.panel.length === 0} onClick={() => schedule(false)}>Schedule and send invites</button>
          </Card>
        </div>
      )}
    </Drawer>
  );
};

export const CandidatesTab: React.FC<{ users: User[] }> = ({ users }) => {
  const board = useLoad(() => pipelineService.board(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const rows: any[] = (board.data?.rows || []).filter((r: any) => !q || `${r.name} ${r.designation} ${r.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <input className={input} placeholder="Search candidates" value={q} onChange={(e) => setQ(e.target.value)} />
      <Loading error={board.error} loading={board.loading} />
      {!board.loading && rows.length === 0 && <EmptyState title="No candidates yet" text="Candidates arrive from your website, referrals, manual entry or CSV import (Applications screen)." />}
      <div className="grid gap-2">
        {rows.map((r) => (
          <button key={r.id} onClick={() => setOpen(r.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-[#FA7014]">
            <div className="min-w-0"><div className="text-sm font-bold text-slate-800">{r.name}</div><div className="text-xs text-slate-500">{r.designation}{r.referredByName ? ` - referred by ${r.referredByName}` : ''}</div></div>
            <div className="flex flex-wrap items-center gap-1.5">
              {r.screening && <Pill tone={r.screening === 'PASS' ? 'green' : r.screening === 'FAIL' ? 'red' : 'amber'}>screen: {r.screening.toLowerCase()}</Pill>}
              {r.assessmentsPending > 0 && <Pill tone="amber">{r.assessmentsPending} test pending</Pill>}
              {r.nextInterview && <Pill tone="blue">interview {when(r.nextInterview)}</Pill>}
              <Pill tone={stageTone(r.status)}>{r.status}</Pill>
            </div>
          </button>
        ))}
      </div>
      {open && <CandidateDrawer id={open} users={users} onClose={() => setOpen(null)} onChanged={board.reload} />}
    </div>
  );
};
