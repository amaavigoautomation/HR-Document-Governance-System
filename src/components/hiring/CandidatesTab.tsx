import React, { useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, ClipboardList, Eye, FileText, Handshake, ListFilter, Search, UserCheck, Users } from 'lucide-react';
import { Avatar } from '../home/parts';
import { pipelineService } from '../../services/pipelineService';
import { User } from '../../types';
import { CandidateAi } from './AiTab';
import { Card, Drawer, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';
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

export const CandidateDrawer: React.FC<{ id: string; users: User[]; onClose: () => void; onChanged: () => void }> = ({ id, users, onClose, onChanged }) => {
  const d = useLoad(() => pipelineService.candidate(id), [id]);
  const { run, busy, note } = useRunner();
  const a = d.data?.application;
  const [fields, setFields] = useState<Record<string, string>>({});
  const val = (k: string) => fields[k] ?? (a && a[k] !== undefined && a[k] !== 0 ? String(a[k]) : '');
  const [scr, setScr] = useState({ outcome: 'PASS', notes: '', communication: '', currentCtcLpa: '', expectedCtcLpa: '', noticePeriod: '' });
  const [asg, setAsg] = useState({ title: '', type: 'TECHNICAL', maxScore: '100', passScore: '60', link: '', dueOn: '' });
  const [iv, setIv] = useState({ startLocal: '', durationMinutes: '45', mode: 'Video', location: '', round: 'Interview', panel: [] as string[], guests: '' });
  const google = useLoad(() => pipelineService.googleStatus(), []);
  const [conflict, setConflict] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reload = async () => { await d.reload(); onChanged(); };
  const staff = users.filter((u) => u.active !== false).sort((x, y) => x.name.localeCompare(y.name));
  const schedule = (force = false) => run(async () => {
    try {
      await pipelineService.schedule({ ...iv, guests: iv.guests.split(/[,;\s]+/).filter(Boolean), applicationId: id, startIso: new Date(iv.startLocal).toISOString(), durationMinutes: Number(iv.durationMinutes), force });
      setConflict(null);
      await reload();
    } catch (e: any) {
      if (/already has an interview/i.test(e?.message || '')) setConflict([{}]);
      throw e;
    }
  }, 'Interview scheduled. The schedule email and calendar invite went to the candidate, the panel and any guests.');

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

          <CandidateAi applicationId={id} onChanged={reload} />

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
                {Array.isArray(i.guests) && i.guests.length > 0 && <div className="text-slate-500">Also invited: {i.guests.join(', ')}</div>}
                {i.status !== 'CANCELLED' && /^https?:\/\//i.test(i.location || '') && <div><a className="text-[#FA7014] underline" href={i.location} target="_blank" rel="noreferrer">{i.meetProvider === 'google' ? 'Join Google Meet' : 'Meeting link'}</a></div>}
                {i.status !== 'CANCELLED' && <button className={`${btnGhost} mt-1`} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide feedback' : 'Feedback'}</button>}
                {open === i.id && <div className="mt-2"><FeedbackPanel interviewId={i.id} manager onChanged={reload} /></div>}
              </div>
            ))}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Field label="Date and time (your time)"><input className={input} type="datetime-local" value={iv.startLocal} onChange={(e) => setIv({ ...iv, startLocal: e.target.value })} /></Field>
              <Field label="Round"><input className={input} value={iv.round} onChange={(e) => setIv({ ...iv, round: e.target.value })} /></Field>
              <Field label="Mode"><select className={input} value={iv.mode} onChange={(e) => setIv({ ...iv, mode: e.target.value })}><option>Video</option><option>Phone</option><option>In person</option></select></Field>
              <Field label="Minutes"><input className={input} type="number" value={iv.durationMinutes} onChange={(e) => setIv({ ...iv, durationMinutes: e.target.value })} /></Field>
              <div className="md:col-span-2"><Field label={iv.mode === 'Video' && google.data?.connected ? 'Meeting link (leave empty to create a Google Meet)' : 'Meeting link or address'}><input className={input} value={iv.location} onChange={(e) => setIv({ ...iv, location: e.target.value })} placeholder={iv.mode === 'Video' && google.data?.connected ? 'A Google Meet link is created for you' : ''} /></Field>
                {iv.mode === 'Video' && google.data && !google.data.connected && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {google.data.needsReconnect ? 'The Google Calendar connection stopped working. ' : 'Google Calendar is not connected, so paste a meeting link. '}
                    {google.data.canManage ? 'Connect it under Administration > Integrations to get Google Meet links automatically.' : 'Ask a Company Admin to connect it under Administration > Integrations.'}
                  </p>
                )}
                {iv.mode === 'Video' && google.data?.connected && <p className="mt-1 text-[11px] text-slate-500">Meetings are created on {google.data.email || 'the connected Google account'}.</p>}</div>
              <div className="md:col-span-2"><Field label="Other people to invite (optional, email addresses separated by commas)"><input className={input} value={iv.guests} onChange={(e) => setIv({ ...iv, guests: e.target.value })} placeholder="founder@company.com, manager@company.com" /></Field>
                <p className="mt-1 text-[11px] text-slate-500">Guests get the schedule email and invite. Only the interviewers below fill in feedback after the interview.</p></div>
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

const PAGE = 10;
const TONES: Record<string, { tile: string; icon: string }> = {
  orange: { tile: 'bg-orange-50 border-orange-100', icon: 'bg-orange-100 text-[#FA7014]' },
  blue: { tile: 'bg-sky-50 border-sky-100', icon: 'bg-sky-100 text-sky-600' },
  violet: { tile: 'bg-violet-50 border-violet-100', icon: 'bg-violet-100 text-violet-600' },
  amber: { tile: 'bg-amber-50 border-amber-100', icon: 'bg-amber-100 text-amber-600' },
  green: { tile: 'bg-emerald-50 border-emerald-100', icon: 'bg-emerald-100 text-emerald-600' },
};
const SELECT = 'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:border-[#FA7014] focus:ring-2 focus:ring-[#FA7014]/20';
const SOURCE_LABEL: Record<string, string> = { WEBSITE: 'Website', REFERRAL: 'Referral', MANUAL: 'Manual', CSV: 'CSV import' };
const sourceLabel = (s: string) => SOURCE_LABEL[s] || (s ? s.charAt(0) + s.slice(1).toLowerCase() : '—');

/** What needs doing next for one candidate, from what the board already knows. */
const nextStep = (r: any): { text: string; sub: string } => {
  if (r.status === 'Rejected') return { text: 'Closed', sub: 'Rejected' };
  if (r.nextInterview) return { text: 'Interview', sub: when(r.nextInterview) };
  if (r.assessmentsPending > 0) return { text: 'Assessment pending', sub: `${r.assessmentsPending} to be scored` };
  if (!r.screening) return { text: 'Screening call', sub: 'Not recorded yet' };
  return { text: 'Review profile', sub: 'Open to continue' };
};

export const CandidatesTab: React.FC<{ users: User[] }> = ({ users }) => {
  const board = useLoad(() => pipelineService.board(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [stage, setStage] = useState('');
  const [source, setSource] = useState('');
  const [quick, setQuick] = useState<'' | 'noscreen' | 'assess' | 'interview'>('');
  const [page, setPage] = useState(1);
  const all: any[] = board.data?.rows || [];
  const live = (r: any) => r.status !== 'Rejected';
  const roles = useMemo(() => Array.from(new Set(all.map((r) => r.designation).filter(Boolean))).sort() as string[], [all]);
  const stages = useMemo(() => Array.from(new Set(all.map((r) => r.status).filter(Boolean))).sort() as string[], [all]);
  const sources = useMemo(() => Array.from(new Set(all.map((r) => r.source).filter(Boolean))).sort() as string[], [all]);
  const rows = all.filter((r: any) =>
    (!q || `${r.name} ${r.designation} ${r.email}`.toLowerCase().includes(q.toLowerCase()))
    && (!role || r.designation === role) && (!stage || r.status === stage) && (!source || r.source === source)
    && (quick === '' || (quick === 'noscreen' && live(r) && !r.screening) || (quick === 'assess' && r.assessmentsPending > 0) || (quick === 'interview' && !!r.nextInterview)));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const change = (fn: () => void) => { fn(); setPage(1); };
  const stageCount = (terms: string[]) => all.filter((r) => terms.some((term) => String(r.status || '').toLowerCase().includes(term))).length;
  const metrics = [
    { label: 'Total candidates', value: all.length, tone: 'orange', Icon: Users },
    { label: 'Screening', value: stageCount(['screen']), tone: 'blue', Icon: FileText },
    { label: 'Interview', value: stageCount(['interview']), tone: 'violet', Icon: Eye },
    { label: 'Offer', value: stageCount(['offer', 'selected']), tone: 'amber', Icon: Handshake },
    { label: 'Joining', value: stageCount(['joining', 'joined', 'hired']), tone: 'green', Icon: UserCheck },
  ];
  const noScreen = all.filter((r) => live(r) && !r.screening).length;
  const assessPending = all.reduce((n, r) => n + (r.assessmentsPending || 0), 0);
  const upcoming = all.filter((r) => r.nextInterview).length;
  const actions = [
    { key: 'noscreen' as const, count: noScreen, text: `Record screening for ${noScreen} candidate${noScreen === 1 ? '' : 's'}`, Icon: ClipboardList },
    { key: 'assess' as const, count: assessPending, text: `Score ${assessPending} pending assessment${assessPending === 1 ? '' : 's'}`, Icon: FileText },
    { key: 'interview' as const, count: upcoming, text: `Prepare for ${upcoming} upcoming interview${upcoming === 1 ? '' : 's'}`, Icon: CalendarClock },
  ].filter((a) => a.count > 0);
  const pageButtons = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - cur) <= 1);

  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">{metrics.map((m) => { const t = TONES[m.tone]; return (
      <div key={m.label} className={`flex items-center gap-4 rounded-2xl border px-4 py-4 ${t.tile}`}>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${t.icon}`}><m.Icon className="h-6 w-6" /></span>
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-700">{m.label}</div><div className="text-3xl font-black tabular-nums leading-tight text-slate-900">{board.loading && !board.data ? '—' : m.value}</div></div>
      </div>); })}</div>

    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:border-[#FA7014] focus:ring-2 focus:ring-[#FA7014]/20" placeholder="Search candidates by name, email or role..." value={q} onChange={(e) => change(() => setQ(e.target.value))} aria-label="Search candidates" /></div>
          <select className={SELECT} value={role} onChange={(e) => change(() => setRole(e.target.value))} aria-label="Role"><option value="">Role: All</option>{roles.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className={SELECT} value={stage} onChange={(e) => change(() => setStage(e.target.value))} aria-label="Stage"><option value="">Stage: All</option>{stages.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className={SELECT} value={source} onChange={(e) => change(() => setSource(e.target.value))} aria-label="Source"><option value="">Source: All</option>{sources.map((x) => <option key={x} value={x}>{sourceLabel(x)}</option>)}</select>
          {(role || stage || source || quick || q) && <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-[#FA7014] hover:text-[#FA7014]" onClick={() => change(() => { setQ(''); setRole(''); setStage(''); setSource(''); setQuick(''); })}><ListFilter className="h-4 w-4" />Clear filters</button>}
        </div>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Loading error={board.error} loading={board.loading} />
          {!board.loading && rows.length === 0 && <div className="p-5"><EmptyState title="No candidates found" text={all.length ? 'Nothing matches these filters.' : 'Candidates arrive from your website, referrals, manual entry or CSV import (Applications screen).'} /></div>}
          {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-4 py-3 font-semibold">Candidate</th><th className="px-4 py-3 font-semibold">Role</th><th className="px-4 py-3 font-semibold">Stage</th><th className="px-4 py-3 font-semibold">Screening</th><th className="px-4 py-3 font-semibold">Source</th><th className="px-4 py-3 font-semibold">Next step</th><th className="px-4 py-3 text-right font-semibold">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{shown.map((r: any) => { const n = nextStep(r); return (
              <tr key={r.id} className="transition-colors hover:bg-orange-50/40">
                <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={r.name || '?'} /><div className="min-w-0"><div className="truncate font-semibold text-slate-900">{r.name}</div><div className="truncate text-xs text-slate-500">{r.email}</div></div></div></td>
                <td className="px-4 py-3 text-slate-700">{r.designation || '—'}</td>
                <td className="px-4 py-3"><Pill tone={stageTone(r.status)}>{r.status}</Pill></td>
                <td className="px-4 py-3">{r.screening ? <Pill tone={r.screening === 'PASS' ? 'green' : r.screening === 'FAIL' ? 'red' : 'amber'}>{r.screening}</Pill> : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-3 text-slate-700">{sourceLabel(r.source)}{r.referredByName ? <div className="text-xs text-slate-500">by {r.referredByName}</div> : null}</td>
                <td className="px-4 py-3"><div className="font-medium text-slate-800">{n.text}</div><div className="text-xs text-slate-500">{n.sub}</div></td>
                <td className="px-4 py-3 text-right"><button onClick={() => setOpen(r.id)} className="rounded-lg bg-orange-50 px-4 py-1.5 text-xs font-bold text-[#FA7014] hover:bg-orange-100">View</button></td>
              </tr>); })}</tbody></table></div>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>Showing {rows.length === 0 ? 0 : (cur - 1) * PAGE + 1} &ndash; {Math.min(cur * PAGE, rows.length)} of {rows.length} candidate{rows.length === 1 ? '' : 's'}</span>
            {pages > 1 && <nav className="flex items-center gap-1" aria-label="Pages">
              <button type="button" disabled={cur === 1} onClick={() => setPage(cur - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              {pageButtons.map((n, i) => <React.Fragment key={n}>{i > 0 && n - pageButtons[i - 1] > 1 && <span className="px-1">...</span>}<button type="button" onClick={() => setPage(n)} className={`h-8 min-w-8 rounded-lg px-2 text-sm font-semibold ${n === cur ? 'bg-[#F36B21] text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-[#FA7014]'}`} aria-current={n === cur ? 'page' : undefined}>{n}</button></React.Fragment>)}
              <button type="button" disabled={cur === pages} onClick={() => setPage(cur + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </nav>}
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><ListFilter className="h-4 w-4" />Pipeline health</h3><p className="mt-1 text-xs text-slate-500">Candidates by current stage.</p>
          {[['Screening', stageCount(['screen'])], ['Interview', stageCount(['interview'])], ['Offer', stageCount(['offer', 'selected'])], ['Joining', stageCount(['joining', 'joined', 'hired'])]].map(([label, value]) => <div key={label} className="mt-4"><div className="mb-1 flex justify-between text-sm"><span className="text-slate-700">{label}</span><b className="text-slate-900">{value}</b></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#F36B21]" style={{ width: `${all.length ? Math.round(Number(value) / all.length * 100) : 0}%` }} /></div></div>)}</section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><ClipboardList className="h-4 w-4" />Next actions{actions.length ? ` (${actions.length})` : ''}</h3><p className="mt-1 text-xs text-slate-500">Tap one to filter the list.</p>
          {actions.length === 0 ? <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">Nothing is waiting. The pipeline is up to date.</p> : <ul className="mt-3 space-y-1">{actions.map((a) => <li key={a.key}><button type="button" onClick={() => change(() => setQuick(quick === a.key ? '' : a.key))} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-medium hover:bg-orange-50 ${quick === a.key ? 'bg-orange-50 text-[#FA7014]' : 'text-slate-800'}`}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-[#FA7014]"><a.Icon className="h-4 w-4" /></span><span className="flex-1">{a.text}</span><ChevronRight className="h-4 w-4 text-slate-300" /></button></li>)}</ul>}</section>
      </aside>
    </div>
    {open && <CandidateDrawer id={open} users={users} onClose={() => setOpen(null)} onChanged={board.reload} />}
  </div>;
};
