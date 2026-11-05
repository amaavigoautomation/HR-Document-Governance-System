/**
 * Hiring pipeline, part 2 (reached through hiringRouter.ts as /api/recruitment/<action>):
 *
 *   screen-get / screen-save                    HR screening call: answers, notes, communication rating, outcome
 *   assess-list / assess-assign / assess-result tests and assignments with a pass mark
 *   int-schedule / int-reschedule / int-cancel  interviews with a Google Meet link (when the company connected Google), extra guests, and a calendar invite (.ics) emailed to the candidate, panel and guests
 *   int-list                                    HR sees every interview; an interviewer sees the ones they are on
 *   int-feedback-get / int-feedback-submit      blind scorecards (see shared/interviewEngine.ts)
 *   int-ai-summary                              summary of the panel's feedback, once everyone has submitted
 *   int-send-reminders                          emails the 24-hour and 1-hour reminders that are due (cron or HR)
 *   cand-detail / pipe-board                    one candidate with everything, and the board of all candidates
 */
import { flowAdvanceHook } from './flowApi.js';
import { createTeamsMeeting, sendWhatsApp } from './integrations.js';
import { cancelGoogleMeeting, createGoogleMeeting, updateGoogleMeeting } from './googleCalendar.js';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getApplication, listApplications, type ApplicationDoc } from './recruitmentData.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { MANAGE_PERMS, getItem, listItems, newId, putItem, saveRating, scoreFor, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import {
  DEFAULT_CRITERIA, RECOMMENDATION_LABEL, blindView, buildIcs, reminderTimes, summarise, validateScorecard, type Scorecard,
} from '../../shared/interviewEngine.js';

type Result = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const isManager = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ------------------------------------------------------------------ screening

const OUTCOMES = ['PASS', 'HOLD', 'FAIL'] as const;
const OUTCOME_STAGE: Record<string, string> = { PASS: 'Shortlisted', HOLD: 'On Hold', FAIL: 'Rejected' };

async function screenGet(cid: string, q: any): Promise<Result> {
  const items = await listItems(cid, 'screening');
  return ok({ screening: items.find((s) => s.applicationId === str(q.applicationId, 100)) || null });
}

async function screenSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const outcome = str(b.outcome, 10);
  if (!OUTCOMES.includes(outcome as any)) return fail(400, 'Choose an outcome: pass, hold or fail.');
  const notes = str(b.notes, 3000);
  if (outcome === 'FAIL' && !notes) return fail(400, 'Add a note explaining why the candidate did not pass.');
  const comm = num(b.communication);
  if (comm !== null && (comm < 0 || comm > 100)) return fail(400, 'Communication must be between 0 and 100.');
  const ans = b.answers && typeof b.answers === 'object' ? b.answers : {};
  const answers = {
    currentCtcLpa: num(ans.currentCtcLpa), expectedCtcLpa: num(ans.expectedCtcLpa), noticePeriod: str(ans.noticePeriod, 60),
    relocation: str(ans.relocation, 60), availability: str(ans.availability, 100), reasonForChange: str(ans.reasonForChange, 500),
  };
  for (const k of ['currentCtcLpa', 'expectedCtcLpa'] as const) if (answers[k] !== null && (answers[k]! < 0 || answers[k]! > 1000)) return fail(400, 'CTC must be in lakhs per annum.');
  const prior = (await listItems(cid, 'screening')).find((s) => s.applicationId === a.id);
  const who = await whoIs(ctx);
  const it: Item = { id: prior?.id || newId(), companyId: cid, kind: 'screening', applicationId: a.id, answers, notes, communication: comm, outcome, screenedBy: who, screenedAt: nowIso(), history: [...(prior?.history || []), { at: nowIso(), by: who, outcome }].slice(-10) };
  await putItem(it);

  // Keep the candidate database in step with what was learned on the call.
  const patch: Record<string, any> = { updatedAt: nowIso() };
  if (answers.currentCtcLpa !== null) patch.currentCtcLpa = answers.currentCtcLpa;
  if (answers.expectedCtcLpa !== null) patch.expectedCtcLpa = answers.expectedCtcLpa;
  if (answers.noticePeriod) patch.noticePeriod = answers.noticePeriod;
  // Only move candidates who have not progressed further: a screening note must not pull someone back from interview.
  if (['New Applicant', 'On Hold', 'Shortlisted'].includes(a.status)) patch.status = OUTCOME_STAGE[outcome];
  await db().collection('applications').doc(a.id).update(patch);
  if (comm !== null) await saveRating(ctx, a.id, { communication: comm });
  await flowAdvanceHook(cid, a.id);
  return ok({ screening: it, stage: patch.status || a.status });
}

// ------------------------------------------------------------------ assessments

const ASSESS_TYPES = ['TECHNICAL', 'APTITUDE', 'ASSIGNMENT', 'OTHER'];

/** App-given tests carry a secret link and the answer key. HR sees the result, never those. */
const assessView = (it: Item): Item => { const { token, questions, answers, mailClaim, ...rest } = it as any; return { ...rest, questionCount: Array.isArray(questions) ? questions.length : rest.totalQuestions }; };

async function assessList(cid: string, q: any): Promise<Result> {
  let items = await listItems(cid, 'assessment');
  if (q.applicationId) items = items.filter((i) => i.applicationId === String(q.applicationId));
  return ok({ items: items.map(assessView).sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt))) });
}

async function assessAssign(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const title = str(b.title, 120);
  if (!title) return fail(400, 'Give the assessment a title.');
  const type = ASSESS_TYPES.includes(str(b.type, 20)) ? str(b.type, 20) : 'TECHNICAL';
  const maxScore = num(b.maxScore) ?? 100;
  const passScore = num(b.passScore) ?? Math.round(maxScore * 0.6);
  if (maxScore <= 0 || maxScore > 1000) return fail(400, 'Maximum score is not valid.');
  if (passScore < 0 || passScore > maxScore) return fail(400, 'The pass mark must be between 0 and the maximum score.');
  const link = str(b.link, 500);
  if (link && !/^https?:\/\//i.test(link)) return fail(400, 'The link must start with http:// or https://.');
  const it: Item = { id: newId(), companyId: cid, kind: 'assessment', applicationId: a.id, candidateName: a.name, title, type, link, dueOn: str(b.dueOn, 10), maxScore, passScore, status: 'ASSIGNED', assignedAt: nowIso(), assignedBy: await whoIs(ctx) };
  await putItem(it);
  if (EMAIL_RE.test(a.email)) {
    await safeMail(a.email, a.name, `Assessment for ${a.designation}: ${title}`, [`Hello ${a.name},`, '', `As the next step for the ${a.designation} role, please complete: ${title}.`, link ? `Link: ${link}` : '', it.dueOn ? `Please finish by ${it.dueOn}.` : '', '', 'Thank you.'].filter((x, i, arr) => !(x === '' && arr[i - 1] === '')).join('\n'));
  }
  return ok({ item: it });
}

async function assessResult(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const it = await getItem(cid, str(b.id, 100), 'assessment');
  if (!it) return fail(404, 'Assessment not found.');
  if (it.mode === 'AI_TEST') return fail(400, 'This test is marked automatically when the candidate hands it in.');
  const score = num(b.score);
  if (score === null || score < 0 || score > it.maxScore) return fail(400, `Score must be between 0 and ${it.maxScore}.`);
  const next: Item = { ...it, score, status: 'SCORED', result: score >= it.passScore ? 'PASS' : 'FAIL', notes: str(b.notes, 1000), scoredAt: nowIso(), scoredBy: await whoIs(ctx) };
  await putItem(next);
  await flowAdvanceHook(cid, it.applicationId);
  return ok({ item: next });
}

// ------------------------------------------------------------------ interviews

interface PanelMember { uid: string; name: string; email: string }

let mailer: typeof dispatchLiveEmail = dispatchLiveEmail;
/** Tests replace the mail sender (pass null to restore the real one). */
export const __setInterviewMailer = (fn: typeof dispatchLiveEmail | null) => { mailer = fn || dispatchLiveEmail; };

async function safeMail(to: string, name: string, subject: string, body: string, ics?: { content: string; method: 'REQUEST' | 'CANCEL' }): Promise<boolean> {
  try {
    const r = await mailer({ to, recipientName: name, subject, body, ics });
    return !!r.success;
  } catch (e: any) {
    console.warn('[Interview] email failed:', e?.message || e);
    return false;
  }
}

/** Panel members are given as employee ids or sign-in ids; both are looked up in this company's employees only. */
async function resolvePanel(cid: string, raw: unknown): Promise<{ panel?: PanelMember[]; error?: string }> {
  const ids = Array.isArray(raw) ? raw.map((x) => str(x, 100)).filter(Boolean) : [];
  if (!ids.length) return { error: 'Add at least one interviewer.' };
  if (ids.length > 8) return { error: 'A panel can have up to 8 interviewers.' };
  const snap = await db().collection('employees').where('companyId', '==', cid).get();
  const panel: PanelMember[] = [];
  for (const id of new Set(ids)) {
    const d = snap.docs.find((x) => x.id === id || x.get('authUid') === id);
    if (!d || d.get('active') === false) return { error: 'One of the interviewers was not found in your company.' };
    panel.push({ uid: String(d.get('authUid') || d.id), name: String(d.get('name') || ''), email: String(d.get('email') || '') });
  }
  return { panel };
}

const overlaps = (aStart: number, aMin: number, bStart: number, bMin: number) => aStart < bStart + bMin * 60000 && bStart < aStart + aMin * 60000;

async function findConflicts(cid: string, panel: PanelMember[], startIso: string, minutes: number, ignoreId?: string): Promise<{ name: string; with: string; at: string }[]> {
  const start = new Date(startIso).getTime();
  const out: { name: string; with: string; at: string }[] = [];
  for (const i of await listItems(cid, 'interview')) {
    if (i.status !== 'SCHEDULED' || i.id === ignoreId) continue;
    if (!overlaps(start, minutes, new Date(i.startIso).getTime(), i.durationMinutes)) continue;
    for (const p of panel) if ((i.panel as PanelMember[]).some((q) => q.uid === p.uid)) out.push({ name: p.name, with: i.candidateName, at: i.startIso });
  }
  return out;
}

/** Extra people who should be in the meeting but are not interviewers (they get the invite, not a scorecard). */
const guestList = (i: Item): string[] => (Array.isArray(i.guests) ? i.guests : []).map((g: any) => String(g || '').trim().toLowerCase()).filter((g: string) => EMAIL_RE.test(g));

function inviteFor(i: Item, organizer: { name: string; email: string }, cancel = false): string {
  return buildIcs({
    uid: `${i.id}@amaavigo-hiring`, startIso: i.startIso, durationMinutes: i.durationMinutes, sequence: i.sequence, cancel,
    title: `${i.round}: ${i.candidateName} for ${i.positionTitle}`,
    description: `${i.mode} interview for ${i.positionTitle}.${i.location ? `\n${i.location}` : ''}`,
    location: i.location || i.mode, organizerName: organizer.name, organizerEmail: organizer.email,
    attendees: [{ name: i.candidateName, email: i.candidateEmail }, ...(i.panel as PanelMember[]).map((p) => ({ name: p.name, email: p.email })), ...guestList(i).map((email) => ({ name: email.split('@')[0], email }))].filter((x) => EMAIL_RE.test(x.email)),
  });
}

const whenText = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' }) + ' IST';

async function sendInvites(i: Item, organizer: { name: string; email: string }, kind: 'new' | 'moved' | 'cancelled'): Promise<number> {
  const cancel = kind === 'cancelled';
  const ics = { content: inviteFor(i, organizer, cancel), method: (cancel ? 'CANCEL' : 'REQUEST') as 'REQUEST' | 'CANCEL' };
  let sent = 0;
  const verb = kind === 'new' ? 'scheduled' : kind === 'moved' ? 'rescheduled' : 'cancelled';
  const people = [{ name: i.candidateName, email: i.candidateEmail, candidate: true }, ...(i.panel as PanelMember[]).map((p) => ({ ...p, candidate: false })), ...guestList(i).map((email) => ({ name: email.split('@')[0], email, candidate: false }))];
  for (const p of people) {
    if (!EMAIL_RE.test(p.email)) continue;
    const lines = [
      `Hello ${p.name},`, '',
      p.candidate ? `Your ${i.round} for ${i.positionTitle} has been ${verb}.` : `${i.round} with ${i.candidateName} for ${i.positionTitle} has been ${verb}.`,
      cancel ? '' : `When: ${whenText(i.startIso)} (${i.durationMinutes} minutes)`,
      cancel ? '' : `Mode: ${i.mode}${i.location && !/^https?:\/\//i.test(i.location) ? ` - ${i.location}` : ''}`,
      cancel || !/^https?:\/\//i.test(i.location || '') ? '' : `Join link: ${i.location}`,
      '', cancel ? 'The calendar event has been cancelled.' : 'A calendar invite is attached.',
    ].filter((x, idx, arr) => !(x === '' && arr[idx - 1] === ''));
    if (await safeMail(p.email, p.name, `${cancel ? 'Cancelled: ' : ''}${i.round} - ${i.candidateName} - ${i.positionTitle}`, lines.join('\n'), ics)) sent++;
  }
  return sent;
}

async function intSchedule(ctx: AuthContext, b: any, existing?: Item): Promise<Result> {
  const cid = ctx.companyId!;
  const a = existing ? await getApplication(cid, existing.applicationId) : await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const parsedStart = new Date(str(b.startIso, 40));
  const startIso = Number.isNaN(parsedStart.getTime()) ? '' : parsedStart.toISOString();
  if (!startIso) return fail(400, 'Choose a valid date and time.');
  if (new Date(startIso).getTime() < Date.now() - 5 * 60000) return fail(400, 'The interview time is in the past.');
  const minutes = num(b.durationMinutes) ?? 45;
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 480) return fail(400, 'Duration must be between 10 and 480 minutes.');
  const { panel, error } = await resolvePanel(cid, b.panel ?? existing?.panel?.map((p: PanelMember) => p.uid));
  if (!panel) return fail(400, error || 'Panel is not valid.');
  const conflicts = await findConflicts(cid, panel, startIso, minutes, existing?.id);
  if (conflicts.length && !b.force) return fail(409, 'An interviewer already has an interview at that time.', { conflicts, canForce: true });
  const mode = ['Video', 'Phone', 'In person'].includes(str(b.mode, 20)) ? str(b.mode, 20) : existing?.mode || 'Video';
  const who = await whoIs(ctx);
  // Guests: other people who should be in the meeting (not interviewers), given as email addresses.
  const rawGuests = Array.isArray(b.guests) ? b.guests : typeof b.guests === 'string' ? b.guests.split(/[,;\s]+/) : (existing?.guests || []);
  const guests = [...new Set(rawGuests.map((g: any) => str(g, 200).toLowerCase()).filter(Boolean))] as string[];
  const badGuest = guests.find((g) => !EMAIL_RE.test(g));
  if (badGuest) return fail(400, `"${badGuest}" is not a valid email address.`);
  if (guests.length > 20) return fail(400, 'Add up to 20 guests.');

  // Video: Google Meet when the company connected Google (the link is made, or the existing event moved), else a Teams link if
  // Teams is switched on, else HR pastes a link as before. A link HR types or pastes is always kept as typed.
  const endIso = new Date(new Date(startIso).getTime() + minutes * 60000).toISOString();
  let location = str(b.location, 300) ?? '';
  let teamsLink = false;
  let googleEventId: string = existing?.googleEventId || '';
  let meetProvider: string = existing?.meetProvider || (location ? 'manual' : '');
  let meetNote = '';
  const meeting = {
    title: `${str(b.round, 60) || existing?.round || 'Interview'}: ${a.name} for ${a.designation}`.slice(0, 250), description: `Interview for ${a.designation}.`,
    startIso, endIso, attendees: [a.email, ...panel.map((p) => p.email), ...guests], requestId: `iv-${existing?.id || 'new'}-${Date.now()}`,
  };
  if (mode === 'Video') {
    const ownLink = !!location && location !== existing?.location;   // HR typed or pasted a different link
    if (ownLink) {
      if (googleEventId) { await cancelGoogleMeeting(cid, googleEventId); googleEventId = ''; }
      meetProvider = 'manual';
    } else if (googleEventId) {
      const g = await updateGoogleMeeting(cid, googleEventId, meeting);
      if (g.ok) { location = g.link || existing?.location || ''; meetProvider = 'google'; } else { location = existing?.location || ''; meetNote = `The Google event could not be moved: ${g.error}`; }
    } else if (!location) {
      const g = await createGoogleMeeting(cid, meeting);
      if (g.ok) { location = g.link!; googleEventId = g.eventId!; meetProvider = 'google'; }
      else {
        if (!g.notConnected) meetNote = `Google Meet link could not be made: ${g.error}`;
        const link = await createTeamsMeeting(`${a.designation} interview`, startIso, endIso);
        if (link) { location = link; teamsLink = true; meetProvider = 'teams'; meetNote = ''; }
      }
    }
  } else if (googleEventId) {
    await cancelGoogleMeeting(cid, googleEventId);
    googleEventId = ''; meetProvider = '';
  }
  // Google is connected but failed: schedule nothing, so no invite ever goes out without its link. HR can try again or paste a link.
  if (meetNote) return fail(502, `${meetNote} Nothing was scheduled and no email was sent. Try again in a moment, or paste a meeting link yourself.`);
  const it: Item = {
    ...(existing || {}), id: existing?.id || newId(), companyId: cid, kind: 'interview', applicationId: a.id, candidateName: a.name, candidateEmail: a.email, positionTitle: a.designation,
    round: str(b.round, 60) || existing?.round || 'Interview', mode, location, teamsLink, googleEventId, meetProvider, guests, candidateMobile: a.mobile || '', startIso, durationMinutes: minutes, panel,
    status: 'SCHEDULED', sequence: existing ? (existing.sequence || 0) + 1 : 0, criteria: existing?.criteria || [...DEFAULT_CRITERIA],
    scorecards: existing?.scorecards || [], reminders: reminderTimes(startIso, nowIso()).map((r) => ({ ...r, sent: false })),
    createdBy: existing?.createdBy || who, createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso(),
  };
  await putItem(it);
  await db().collection('applications').doc(a.id).update({ status: 'Interview Scheduled', interviewDate: startIso.slice(0, 10), updatedAt: nowIso() });
  const sent = await sendInvites(it, { name: who, email: ctx.email }, existing ? 'moved' : 'new');
  return ok({ interview: it, invitesSent: sent, meet: { provider: meetProvider, link: mode === 'Video' ? location : '', note: meetNote } });
}

async function intCancel(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const it = await getItem(cid, str(b.id, 100), 'interview');
  if (!it) return fail(404, 'Interview not found.');
  if (it.status === 'CANCELLED') return fail(409, 'Already cancelled.');
  const next: Item = { ...it, status: 'CANCELLED', sequence: (it.sequence || 0) + 1, cancelReason: str(b.reason, 300), updatedAt: nowIso(), reminders: [] };
  await putItem(next);
  if (it.googleEventId) { await cancelGoogleMeeting(cid, it.googleEventId); await putItem({ ...next, googleEventId: '' }); }
  const others = (await listItems(cid, 'interview')).some((i) => i.applicationId === it.applicationId && i.status === 'SCHEDULED' && i.id !== it.id);
  const a = await getApplication(cid, it.applicationId);
  if (a && a.status === 'Interview Scheduled' && !others) await db().collection('applications').doc(a.id).update({ status: 'Shortlisted', interviewDate: '', updatedAt: nowIso() });
  const sent = await sendInvites(next, { name: await whoIs(ctx), email: ctx.email }, 'cancelled');
  return ok({ interview: next, invitesSent: sent });
}

async function intList(ctx: AuthContext, q: any): Promise<Result> {
  const cid = ctx.companyId!;
  let items = await listItems(cid, 'interview');
  const mgr = isManager(ctx);
  if (!mgr) items = items.filter((i) => (i.panel as PanelMember[]).some((p) => p.uid === ctx.uid));
  if (q.applicationId) items = items.filter((i) => i.applicationId === String(q.applicationId));
  // Scorecards are never part of the list: they go through the blind view only.
  const out = items.sort((a, b) => String(a.startIso).localeCompare(String(b.startIso))).map(({ scorecards, ...rest }) => ({
    ...rest, submittedCount: (scorecards || []).length, iSubmitted: (scorecards || []).some((s: Scorecard) => s.interviewerId === ctx.uid),
    iAmOnPanel: (rest.panel as PanelMember[]).some((p) => p.uid === ctx.uid),
  }));
  return ok({ items: out, manager: mgr });
}

// ------------------------------------------------------------------ feedback (blind)

function viewFor(it: Item, ctx: AuthContext) {
  const expected = (it.panel as PanelMember[]).map((p) => p.uid);
  return blindView(it.scorecards || [], expected, ctx.uid, isManager(ctx));
}

async function feedbackGet(ctx: AuthContext, q: any): Promise<Result> {
  const it = await getItem(ctx.companyId!, str(q.interviewId, 100), 'interview');
  if (!it) return fail(404, 'Interview not found.');
  const onPanel = (it.panel as PanelMember[]).some((p) => p.uid === ctx.uid);
  if (!onPanel && !isManager(ctx)) return fail(403, 'You are not on this interview.');
  const v = viewFor(it, ctx);
  return ok({ interviewId: it.id, criteria: it.criteria, onPanel, iSubmitted: (it.scorecards || []).some((s: Scorecard) => s.interviewerId === ctx.uid), view: v, aiSummary: v.summary ? it.aiSummary || null : null });
}

async function feedbackSubmit(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const id = str(b.interviewId, 100);
  const first = await getItem(cid, id, 'interview');
  if (!first) return fail(404, 'Interview not found.');
  const me = (first.panel as PanelMember[]).find((p) => p.uid === ctx.uid);
  if (!me) return fail(403, 'Only the interviewers on this panel can submit a scorecard.');
  if (first.status === 'CANCELLED') return fail(409, 'This interview was cancelled.');
  const parsed = validateScorecard(b.scorecard, first.criteria);
  if (!parsed.value) return fail(400, parsed.error || 'Scorecard is not valid.');

  // Re-read inside a transaction so two interviewers submitting together cannot overwrite each other.
  const ref = db().collection('hiringItems').doc(id);
  const outcome = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as Item) : null;
    if (!cur || cur.companyId !== cid) return { error: fail(404, 'Interview not found.') };
    if ((cur.scorecards || []).some((s: Scorecard) => s.interviewerId === ctx.uid)) return { error: fail(409, 'You have already submitted your scorecard. It cannot be changed.') };
    const card: Scorecard = { ...parsed.value!, interviewerId: ctx.uid, interviewerName: me.name || ctx.email, submittedAt: nowIso() };
    const cards = [...(cur.scorecards || []), card];
    const done = (cur.panel as PanelMember[]).every((p) => cards.some((c) => c.interviewerId === p.uid));
    const next = { ...cur, scorecards: cards, status: done ? 'COMPLETED' : cur.status, updatedAt: nowIso() };
    tx.set(ref, JSON.parse(JSON.stringify(next)));
    return { next, done };
  });
  if ('error' in outcome && outcome.error) return outcome.error;
  const { next, done } = outcome as { next: Item; done: boolean };
  if (done) {
    const a = await getApplication(cid, next.applicationId);
    if (a && a.status === 'Interview Scheduled') await db().collection('applications').doc(a.id).update({ status: 'Interviewed', updatedAt: nowIso() });
  }
  if (done) await flowAdvanceHook(cid, next.applicationId);
  return ok({ panelComplete: done, view: viewFor(next, ctx) });
}

// ------------------------------------------------------------------ AI summary

export function plainSummary(cards: Scorecard[], candidate: string, role: string): string {
  const s = summarise(cards);
  const lines = [
    `${candidate} for ${role}: panel leans "${s.recommendation}" (average rating ${s.average} out of 5, ${cards.length} scorecard${cards.length === 1 ? '' : 's'}).`,
    `Votes: ${Object.entries(s.split).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}.`,
  ];
  const strengths = cards.map((c) => c.strengths).filter(Boolean);
  const concerns = cards.map((c) => c.concerns).filter(Boolean);
  if (strengths.length) lines.push('', 'Strengths raised:', ...strengths.map((x) => `- ${x}`));
  if (concerns.length) lines.push('', 'Concerns raised:', ...concerns.map((x) => `- ${x}`));
  return lines.join('\n');
}

async function aiSummary(cards: Scorecard[], candidate: string, role: string): Promise<{ text: string; generatedBy: 'AI' | 'TEMPLATE'; note?: string }> {
  const base = plainSummary(cards, candidate, role);
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key || key === 'MY_OPENAI_API_KEY') return { text: base, generatedBy: 'TEMPLATE', note: 'OPENAI_API_KEY is not set, so a plain summary was made.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You summarise interview panel feedback for HR. Be neutral and concise (under 180 words). Report where interviewers agree and disagree, the main strengths, the main concerns and a one-line overall read. Do not invent facts and do not mention anything that is not in the scorecards.' },
          { role: 'user', content: `Candidate: ${candidate}\nRole: ${role}\n\n${cards.map((c, i) => `Interviewer ${i + 1}: recommendation ${RECOMMENDATION_LABEL[c.recommendation]}; ratings ${JSON.stringify(c.ratings)}; strengths: ${c.strengths || '-'}; concerns: ${c.concerns || '-'}`).join('\n')}` },
        ],
      }),
    });
    const data: any = await res.json().catch(() => null);
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!res.ok || !text) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return { text, generatedBy: 'AI' };
  } catch (e: any) {
    return { text: base, generatedBy: 'TEMPLATE', note: `AI summary failed (${e?.message || 'error'}); a plain summary was made.` };
  } finally {
    clearTimeout(timer);
  }
}

async function intAiSummary(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const it = await getItem(cid, str(b.id, 100), 'interview');
  if (!it) return fail(404, 'Interview not found.');
  const cards: Scorecard[] = it.scorecards || [];
  const complete = (it.panel as PanelMember[]).every((p) => cards.some((c) => c.interviewerId === p.uid));
  if (!complete) return fail(409, `Waiting for ${(it.panel as PanelMember[]).length - cards.length} more scorecard(s). The summary is made once everyone has submitted, so nobody is influenced early.`);
  const res = await aiSummary(cards, it.candidateName, it.positionTitle);
  const next: Item = { ...it, aiSummary: { text: res.text, generatedBy: res.generatedBy, at: nowIso() } };
  await putItem(next);
  return ok({ aiSummary: next.aiSummary, note: res.note });
}

// ------------------------------------------------------------------ reminders

export async function sendDueReminders(only?: string): Promise<{ sent: number; checked: number }> {
  const snap = await db().collection('hiringItems').where('kind', '==', 'interview').get();
  let sent = 0;
  let checked = 0;
  const now = Date.now();
  for (const d of snap.docs) {
    const i = d.data() as Item;
    if (only && i.companyId !== only) continue;
    if (i.status !== 'SCHEDULED' || new Date(i.startIso).getTime() < now) continue;
    const due = (i.reminders || []).filter((r: any) => !r.sent && new Date(r.at).getTime() <= now);
    checked++;
    if (!due.length) continue;
    // A reminder is sent once. If both the 24h and 1h are overdue (cron ran late), only the closest one goes out.
    const pick = due[due.length - 1];
    const people = [{ name: i.candidateName, email: i.candidateEmail }, ...(i.panel as PanelMember[])];
    for (const p of people) {
      if (!EMAIL_RE.test(p.email)) continue;
      if (p.email === i.candidateEmail && i.candidateMobile) await sendWhatsApp(i.candidateMobile, `Reminder: ${i.round} for ${i.positionTitle} ${pick.kind === '1h' ? 'in about an hour' : 'tomorrow'} (${whenText(i.startIso)}).${i.location ? ` ${i.location}` : ''}`);
      if (await safeMail(p.email, p.name, `Reminder: ${i.round} with ${i.candidateName} ${pick.kind === '1h' ? 'in about an hour' : 'tomorrow'}`, `Hello ${p.name},\n\nA reminder: ${i.round} for ${i.positionTitle}\nWhen: ${whenText(i.startIso)}\nMode: ${i.mode}${i.location ? ` - ${i.location}` : ''}\n`)) sent++;
    }
    const reminders = (i.reminders || []).map((r: any) => (new Date(r.at).getTime() <= now ? { ...r, sent: true } : r));
    await d.ref.update({ reminders });
  }
  return { sent, checked };
}

async function reminders(r: PipeRequest): Promise<Result> {
  const auth = String(r.headers?.authorization || r.headers?.Authorization || '');
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret && auth === `Bearer ${secret}`) return ok(await sendDueReminders());
  const ctx = await requireActiveTenant(r.headers);
  if (!isManager(ctx)) return fail(403, 'You do not have permission to do this.');
  return ok(await sendDueReminders(ctx.companyId!));
}

// ------------------------------------------------------------------ candidate detail and board

async function candDetail(ctx: AuthContext, q: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(q.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const [scoring, screening, assessments, interviews, resume, referral] = await Promise.all([
    scoreFor(cid, a), listItems(cid, 'screening'), listItems(cid, 'assessment'), listItems(cid, 'interview'), listItems(cid, 'resume'), listItems(cid, 'referral'),
  ]);
  return ok({
    application: a, ...scoring,
    screening: screening.find((s) => s.applicationId === a.id) || null,
    assessments: assessments.filter((x) => x.applicationId === a.id).map(assessView),
    interviews: interviews.filter((x) => x.applicationId === a.id).map(({ scorecards, ...rest }) => ({ ...rest, submittedCount: (scorecards || []).length })),
    resumeFacts: resume.find((x) => x.applicationId === a.id)?.facts || null,
    referral: referral.find((x) => x.applicationId === a.id) ? { by: referral.find((x) => x.applicationId === a.id)!.referrerName } : null,
  });
}

async function pipeBoard(cid: string, q: any): Promise<Result> {
  const [apps, screening, assessments, interviews] = await Promise.all([listApplications(cid), listItems(cid, 'screening'), listItems(cid, 'assessment'), listItems(cid, 'interview')]);
  const rows = apps.filter((a) => !q.designation || a.designationKey === String(q.designation).toLowerCase()).map((a: ApplicationDoc) => {
    const ints = interviews.filter((i) => i.applicationId === a.id);
    const next = ints.filter((i) => i.status === 'SCHEDULED').sort((x, y) => String(x.startIso).localeCompare(String(y.startIso)))[0];
    const as = assessments.filter((x) => x.applicationId === a.id);
    return {
      id: a.id, name: a.name, email: a.email, designation: a.designation, status: a.status, source: a.source, referredByName: a.referredByName || '', createdAt: a.createdAt,
      screening: screening.find((s) => s.applicationId === a.id)?.outcome || '', assessmentsPending: as.filter((x) => x.status === 'ASSIGNED').length, assessmentsFailed: as.filter((x) => x.result === 'FAIL').length,
      nextInterview: next ? next.startIso : '', interviewsDone: ints.filter((i) => i.status === 'COMPLETED').length,
    };
  });
  return ok({ rows });
}

// ------------------------------------------------------------------ router

const ACTIONS: Record<string, { method: 'GET' | 'POST'; who: 'manage' | 'tenant' }> = {
  'screen-get': { method: 'GET', who: 'manage' }, 'screen-save': { method: 'POST', who: 'manage' },
  'assess-list': { method: 'GET', who: 'manage' }, 'assess-assign': { method: 'POST', who: 'manage' }, 'assess-result': { method: 'POST', who: 'manage' },
  'int-schedule': { method: 'POST', who: 'manage' }, 'int-reschedule': { method: 'POST', who: 'manage' }, 'int-cancel': { method: 'POST', who: 'manage' },
  'int-list': { method: 'GET', who: 'tenant' }, 'int-feedback-get': { method: 'GET', who: 'tenant' }, 'int-feedback-submit': { method: 'POST', who: 'tenant' },
  'int-ai-summary': { method: 'POST', who: 'manage' }, 'int-send-reminders': { method: 'POST', who: 'tenant' },
  'cand-detail': { method: 'GET', who: 'manage' }, 'pipe-board': { method: 'GET', who: 'manage' },
};

export async function routeInterview(r: PipeRequest): Promise<Result | null> {
  const spec = ACTIONS[r.action];
  if (!spec) return null;
  try {
    // The reminder run is called by Vercel's cron as a GET, and by HR as a POST.
    if (r.action === 'int-send-reminders') return r.method === 'GET' || r.method === 'POST' ? await reminders(r) : fail(405, 'Method not allowed.');
    if (r.method !== spec.method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (spec.who === 'manage' && !isManager(ctx)) return fail(403, 'You do not have permission to do this.');
    const cid = ctx.companyId;
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'screen-get': return await screenGet(cid, r.query);
      case 'screen-save': return await screenSave(ctx, b);
      case 'assess-list': return await assessList(cid, r.query);
      case 'assess-assign': return await assessAssign(ctx, b);
      case 'assess-result': return await assessResult(ctx, b);
      case 'int-schedule': return await intSchedule(ctx, b);
      case 'int-reschedule': {
        const it = await getItem(cid, str(b.id, 100), 'interview');
        if (!it) return fail(404, 'Interview not found.');
        if (it.status === 'CANCELLED') return fail(409, 'This interview was cancelled. Schedule a new one.');
        return await intSchedule(ctx, b, it);
      }
      case 'int-cancel': return await intCancel(ctx, b);
      case 'int-list': return await intList(ctx, r.query);
      case 'int-feedback-get': return await feedbackGet(ctx, r.query);
      case 'int-feedback-submit': return await feedbackSubmit(ctx, b);
      case 'int-ai-summary': return await intAiSummary(ctx, b);
      case 'cand-detail': return await candDetail(ctx, r.query);
      default: return await pipeBoard(cid, r.query);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Interview] error:', err);
    return fail(500, err?.message || 'Interview request failed.');
  }
}
