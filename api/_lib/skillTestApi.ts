/**
 * App-given skills tests (reached through hiringRouter.ts as /api/recruitment/<action>):
 *
 *   stest-list / stest-get       the tests that exist (one per job title) and one test with its answers (HR only)
 *   stest-generate               the AI writes a multiple-choice test from the job description
 *   stest-save / stest-delete    HR edits the questions by hand, or removes the test
 *   stest-public-get / -start / -submit   the candidate's own page (/?test=<token>, no sign-in)
 *
 * One test per job title, so every applicant for the role gets the same questions and the scores can be compared.
 * A candidate's attempt is a normal "assessment" item (so Candidates and Who is where already show it) that also carries
 * a secret token, a snapshot of the questions with answers, and the timings. The answers never leave the server.
 * The flow engine calls observeAiTest(): it sends the invite, waits, marks the result and reports pass/fail.
 */
import { createHash, randomBytes } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { designationKey, getApplication, getCompanyName, listRequisitionJds, rateLimited, type ApplicationDoc } from './recruitmentData.js';
import { MANAGE_PERMS, getItem, listItems, putItem, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import { listJobDescriptions } from './jobDescriptions.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { aiEnabled, aiJson } from './openaiHelper.js';
import { flowAdvanceHook } from './flowApi.js';
import { testSettings } from '../../shared/flowEngine.js';

type Result = { status: number; json: any };
const db = () => adminDb();
let nowFn: () => Date = () => new Date();
export const __setTestNow = (f: () => Date) => { nowFn = f; };
let mailFn: (m: { to: string; name: string; fromName: string; subject: string; body: string }) => Promise<{ ok: boolean; error?: string }> = async (m) => {
  try { const r = await dispatchLiveEmail({ to: m.to, recipientName: m.name, subject: m.subject, body: m.body, fromName: m.fromName }); return { ok: !!r.success, error: (r as any).error }; }
  catch (e: any) { return { ok: false, error: e?.message || 'Email failed' }; }
};
export const __setTestMailer = (f: typeof mailFn) => { mailFn = f; };
let writerFn: (cid: string, designation: string, jd: string, count: number) => Promise<{ questions?: any[]; error?: string; off?: boolean }> = async (cid, designation, jd, count) => {
  const r = await aiJson({
    cid, feature: 'skill-test', maxTokens: 5000,
    system: 'You write fair multiple-choice screening tests for hiring. Reply with JSON only: {"questions":[{"q":"...","options":["...","...","...","..."],"answer":0,"topic":"..."}]}. Every question has exactly 4 different options and exactly one correct option; "answer" is the 0-based index of it. Test the skills and knowledge the job description asks for, mixing easy, medium and hard questions. No trick questions, no questions about the company, and no questions that need a picture. Spread the correct answers across all four positions.',
    user: `Job title: ${designation}\n\nJob description:\n${jd.slice(0, 12000)}\n\nWrite ${count} questions.`,
  });
  if (r.off) return { off: true };
  if (r.error) return { error: r.error };
  return { questions: Array.isArray(r.data?.questions) ? r.data.questions : [] };
};
export const __setTestWriter = (f: typeof writerFn) => { writerFn = f; };

const nowIso = () => nowFn().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GRACE_MS = 2 * 60_000;   // a little room for a slow connection when the candidate presses Submit at the last second
const baseUrl = (origin?: string) => (process.env.APP_BASE_URL || origin || '').replace(/\/$/, '');
const isHr = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));

export interface Question { id: string; q: string; options: string[]; answer: number; topic?: string }

const testId = (cid: string, designation: string) => `stest_${cid}_${createHash('sha1').update(designationKey(designation)).digest('hex').slice(0, 12)}`.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Keeps only well-formed questions. `strict` (HR typing them in) reports the first bad one instead of dropping it. */
export function cleanQuestions(raw: unknown, strict: boolean): { questions: Question[]; error?: string } {
  const out: Question[] = [];
  const list = Array.isArray(raw) ? raw.slice(0, 60) : [];
  for (let i = 0; i < list.length; i++) {
    const x: any = list[i] || {};
    const q = str(x.q, 500);
    const options = (Array.isArray(x.options) ? x.options : []).map((o: unknown) => str(o, 250));
    const answer = Number(x.answer);
    const good = !!q && options.length === 4 && options.every(Boolean) && new Set(options.map((o: string) => o.toLowerCase())).size === 4 && Number.isInteger(answer) && answer >= 0 && answer <= 3;
    if (!good) { if (strict) return { questions: [], error: `Question ${i + 1} needs a question, four different answers and one marked correct.` }; continue; }
    out.push({ id: /^[a-z0-9]{4,16}$/i.test(String(x.id || '')) ? String(x.id) : randomBytes(4).toString('hex'), q, options, answer, topic: str(x.topic, 80) || undefined });
  }
  return { questions: out };
}

function shuffleOptions(qs: Question[]): Question[] {
  return qs.map((q) => {
    const order = q.options.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
  });
}

async function jdFor(cid: string, designation: string): Promise<string> {
  const key = designationKey(designation);
  const lib = (await listJobDescriptions(cid)).get(key);
  if (lib?.text?.trim()) return lib.text;
  const hit = (await listRequisitionJds(cid)).filter((r) => designationKey(r.designation) === key).sort((a, b) => Number(b.open) - Number(a.open) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  return hit?.text || '';
}

const testView = (t: Item | null) => (t ? { designation: t.designation, source: t.source, questions: t.questions, updatedAt: t.updatedAt, updatedBy: t.updatedBy } : null);

// ------------------------------------------------------------------ HR: the tests themselves

async function listTests(cid: string): Promise<Result> {
  const tests = await listItems(cid, 'skillTest');
  return ok({ aiOn: aiEnabled(), tests: tests.map((t) => ({ designation: t.designation, designationKey: t.designationKey, count: (t.questions || []).length, source: t.source, updatedAt: t.updatedAt })) });
}

async function getTest(cid: string, q: any): Promise<Result> {
  const designation = str(q.designation, 120);
  if (!designation) return fail(400, 'Choose the job title.');
  const t = await getItem(cid, testId(cid, designation), 'skillTest');
  return ok({ aiOn: aiEnabled(), hasJd: !!(await jdFor(cid, designation)), test: testView(t) });
}

async function saveDoc(ctx: AuthContext, designation: string, questions: Question[], source: string): Promise<Item> {
  const cid = ctx.companyId!;
  const prev = await getItem(cid, testId(cid, designation), 'skillTest');
  const doc: Item = { id: testId(cid, designation), companyId: cid, kind: 'skillTest', designation, designationKey: designationKey(designation), questions, source, createdAt: prev?.createdAt || nowIso(), updatedAt: nowIso(), updatedBy: await whoIs(ctx) };
  await putItem(doc);
  return doc;
}

async function generate(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const designation = str(b.designation, 120);
  if (!designation) return fail(400, 'Choose the job title.');
  const count = Math.min(30, Math.max(5, Math.round(Number(b.count)) || 15));
  const jd = await jdFor(cid, designation);
  if (!jd) return fail(400, `There is no job description for "${designation}" yet. Add one first, or type the questions yourself.`);
  if (rateLimited(`stest-gen:${cid}`, 10, 10 * 60_000)) return fail(429, 'Too many tests made in a short time. Wait a few minutes and try again.');
  const r = await writerFn(cid, designation, jd, count + 3);   // a few extra, because the odd one comes back unusable
  if (r.off) return fail(400, 'The AI is not switched on for this company. You can still type the questions yourself.');
  if (r.error) return fail(502, r.error);
  const { questions } = cleanQuestions(r.questions, false);
  if (questions.length < Math.min(5, count)) return fail(502, 'The AI did not return enough usable questions. Try again.');
  const doc = await saveDoc(ctx, designation, shuffleOptions(questions).slice(0, count), 'AI');
  return ok({ test: testView(doc) });
}

async function saveTest(ctx: AuthContext, b: any): Promise<Result> {
  const designation = str(b.designation, 120);
  if (!designation) return fail(400, 'Choose the job title.');
  const { questions, error } = cleanQuestions(b.questions, true);
  if (error) return fail(400, error);
  if (questions.length < 5) return fail(400, 'A test needs at least 5 questions.');
  const prev = await getItem(ctx.companyId!, testId(ctx.companyId!, designation), 'skillTest');
  const doc = await saveDoc(ctx, designation, questions, prev?.source === 'AI' ? 'AI, edited by HR' : prev?.source || 'HR');
  return ok({ test: testView(doc) });
}

async function deleteTest(ctx: AuthContext, b: any): Promise<Result> {
  const designation = str(b.designation, 120);
  if (!designation) return fail(400, 'Choose the job title.');
  await db().collection('hiringItems').doc(testId(ctx.companyId!, designation)).delete();
  return ok({});
}

// ------------------------------------------------------------------ the engine side: invite, wait, mark

/** Only this applicant's assessments are read, to keep Firestore reads low. */
const forApplicant = async (cid: string, applicationId: string): Promise<Item[]> => (await db().collection('hiringItems').where('companyId', '==', cid).where('kind', '==', 'assessment').where('applicationId', '==', applicationId).get()).docs.map((d: any) => d.data() as Item);

const attemptsOf = (list: Item[], runId: string, stepId: string) => list.filter((x) => x.mode === 'AI_TEST' && x.runId === runId && x.stepId === stepId).sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)));

async function createOnce(it: Item): Promise<boolean> {
  const ref = db().collection('hiringItems').doc(it.id);
  let created = false;
  await db().runTransaction(async (tx: any) => { const s = await tx.get(ref); if (s.exists) return; created = true; tx.set(ref, clean(it)); });
  return created;
}

/** Sends the invite exactly once, even if two engines look at the applicant at the same moment. */
async function ensureMailed(it: Item, a: ApplicationDoc, minutes: number): Promise<{ ok: boolean; error?: string }> {
  if (it.mailedAt) return { ok: true };
  const ref = db().collection('hiringItems').doc(it.id);
  let mine = false;
  await db().runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const cur = s.data() as Item;
    if (!cur || cur.mailedAt || (cur.mailClaim && Date.parse(cur.mailClaim) > nowFn().getTime() - 2 * 60_000)) return;
    mine = true; tx.set(ref, clean({ ...cur, mailClaim: nowIso() }));
  });
  if (!mine) { const cur = await getItem(a.companyId, it.id, 'assessment'); return { ok: !!cur?.mailedAt }; }
  if (!baseUrl()) { await putItem({ ...((await getItem(a.companyId, it.id, 'assessment')) || it), mailClaim: '' }); return { ok: false, error: 'the website address (APP_BASE_URL) is not set on the server' }; }
  const company = await getCompanyName(a.companyId);
  const link = `${baseUrl()}/?test=${it.token}`;
  const r = await mailFn({
    to: a.email, name: a.name, fromName: company, subject: `Skills test for ${a.designation} at ${company}`,
    body: [`Hello ${a.name},`, '', `Thank you for applying for the ${a.designation} role at ${company}. The next step is a short online test.`, '',
      `It has ${(it.questions || []).length} multiple-choice questions and you will have ${minutes} minutes once you press Start. You can only take it once, so choose a quiet time and a steady internet connection.`, '',
      `Open your test: ${link}`, `Please start it by ${String(it.expiresAt).slice(0, 10)}. The link is private to you, please do not share it.`, '', 'Good luck!', company].join('\n'),
  });
  const cur = (await getItem(a.companyId, it.id, 'assessment')) || it;
  await putItem(r.ok ? { ...cur, mailedAt: nowIso(), mailClaim: '' } : { ...cur, mailClaim: '' });
  return r;
}

/** Marks an attempt. Only the first marking counts. */
async function markAttempt(cid: string, id: string, answers: Record<string, number>, late: boolean): Promise<Item | null> {
  const ref = db().collection('hiringItems').doc(id);
  let result: Item | null = null;
  await db().runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const cur = s.exists ? (s.data() as Item) : null;
    if (!cur || cur.companyId !== cid || cur.status === 'SCORED') return;
    const qs = (cur.questions || []) as Question[];
    const given: Record<string, number> = {};
    let correct = 0;
    for (const q of qs) { const v = Number(answers[q.id]); if (Number.isInteger(v) && v >= 0 && v <= 3) { given[q.id] = v; if (v === q.answer) correct++; } }
    const pct = qs.length ? Math.round((correct / qs.length) * 100) : 0;
    const started = cur.startedAt ? Date.parse(cur.startedAt) : nowFn().getTime();
    const next: Item = {
      ...cur, answers: given, correctCount: correct, totalQuestions: qs.length, score: pct, status: 'SCORED', result: pct >= cur.passScore ? 'PASS' : 'FAIL',
      submittedAt: nowIso(), timeTakenSec: Math.max(0, Math.round((nowFn().getTime() - started) / 1000)), late,
      notes: late ? 'Submitted after the time limit.' : Object.keys(given).length === 0 ? 'No answers were submitted.' : '', scoredAt: nowIso(), scoredBy: 'Automatic marking',
    };
    tx.set(ref, clean(next)); result = next;
  });
  return result;
}

export type AiTestSeen =
  | { kind: 'wait'; why: string; ask?: string }
  | { kind: 'move'; result: 'done' | 'fail'; note: string }
  | { kind: 'stuck'; reason: string };

/** What the flow engine asks every time it looks at an applicant who is on an app-given test step. */
export async function observeAiTest(
  cid: string, run: { id: string; applicationId: string; decisions: Record<string, any> }, step: { id: string; settings: Record<string, any>; ownerName?: string }, a: ApplicationDoc,
): Promise<AiTestSeen> {
  const s = testSettings(step as any);
  for (let pass = 0; pass < 3; pass++) {
    const list = attemptsOf(await forApplicant(cid, a.id), run.id, step.id);
    const cur = list.find((x) => x.status !== 'SUPERSEDED');   // replaced links still count for numbering the next one
    if (!cur) {
      const t = await getItem(cid, testId(cid, a.designation), 'skillTest');
      const qs = ((t?.questions || []) as Question[]).slice(0, s.questions);
      if (!qs.length) return { kind: 'stuck', reason: `No test has been made for "${a.designation}" yet. Open this step in the flow builder, make the test, then press Retry.` };
      if (!EMAIL_RE.test(a.email || '')) return { kind: 'stuck', reason: `${a.name} has no valid email address, so the test cannot be sent. Fix the email, then press Retry.` };
      const id = `atest_${run.id}_${step.id}_${list.length + 1}`;
      await createOnce({
        id, companyId: cid, kind: 'assessment', mode: 'AI_TEST', applicationId: a.id, candidateName: a.name, title: `Skills test: ${a.designation}`, type: 'TECHNICAL', link: '', dueOn: new Date(nowFn().getTime() + s.expiryDays * 86400000).toISOString().slice(0, 10),
        maxScore: 100, passScore: s.passPercent, status: 'ASSIGNED', assignedAt: nowIso(), assignedBy: 'Automation', runId: run.id, stepId: step.id, minutes: s.minutes,
        expiresAt: new Date(nowFn().getTime() + s.expiryDays * 86400000).toISOString(), token: randomBytes(24).toString('hex'), questions: qs, testSource: t?.source || '',
      });
      continue;
    }
    if (cur.status === 'SCORED') {
      const pct = Number(cur.score);
      if (cur.result === 'PASS') return { kind: 'move', result: 'done', note: `Test passed with ${pct}% (${cur.correctCount} of ${cur.totalQuestions} right, pass mark ${cur.passScore}%).` };
      const fact = `Test score ${pct}% (${cur.correctCount ?? '?'} of ${cur.totalQuestions ?? '?'} right), below the pass mark of ${cur.passScore}%.`;
      if (s.onBelow !== 'ask') return { kind: 'move', result: 'fail', note: fact };
      const d = run.decisions[step.id];
      if (d?.result === 'yes') return { kind: 'move', result: 'done', note: `${fact} ${d.by || 'Someone'} let the candidate through.` };
      if (d?.result === 'no') return { kind: 'move', result: 'fail', note: `${fact} ${d.by || 'Someone'} decided not to continue${d.note ? `: ${d.note}` : ''}.` };
      return { kind: 'wait', why: `${fact} Waiting for ${step.ownerName || 'a person'} to decide.`, ask: `${a.name} scored ${pct}% on the skills test (pass mark ${cur.passScore}%). Should they still move forward?` };
    }
    if (cur.startedAt) {
      if (nowFn().getTime() > Date.parse(cur.startedAt) + cur.minutes * 60_000 + GRACE_MS + 3 * 60_000) { await markAttempt(cid, cur.id, {}, true); continue; }   // started but never handed in: marked with what was saved (nothing)
      return { kind: 'wait', why: `${a.name} has started the test. Waiting for it to be handed in.` };
    }
    if (nowFn().toISOString() > cur.expiresAt) {
      if (cur.status !== 'EXPIRED') await putItem({ ...cur, status: 'EXPIRED' });
      return { kind: 'stuck', reason: `${a.name} did not start the test before the link ran out on ${String(cur.expiresAt).slice(0, 10)}. Press Retry to send a new link, or reject the candidate.` };
    }
    const m = await ensureMailed(cur, a, cur.minutes);
    if (!m.ok) return { kind: 'stuck', reason: `The test email to ${a.email} could not be sent${m.error ? ` (${m.error})` : ''}. Press Retry to try again.` };
    return { kind: 'wait', why: `Test emailed to ${a.email}. Waiting for ${a.name} to take it (link valid until ${String(cur.expiresAt).slice(0, 10)}).` };
  }
  return { kind: 'wait', why: 'Preparing the test.' };
}

/** HR pressed Retry on a test step: an expired or lost invite is replaced by a fresh one on the next look. */
export async function retryAiTest(cid: string, runId: string, stepId: string, applicationId: string): Promise<void> {
  const list = attemptsOf(await forApplicant(cid, applicationId), runId, stepId);
  const cur = list.find((x) => x.status !== 'SUPERSEDED');
  if (cur && cur.status !== 'SCORED' && !cur.startedAt && (cur.status === 'EXPIRED' || nowFn().toISOString() > cur.expiresAt)) await putItem({ ...cur, status: 'SUPERSEDED', expiresAt: nowIso() });
  else if (cur && cur.status !== 'SCORED' && !cur.mailedAt) await putItem({ ...cur, mailClaim: '' });
}

// ------------------------------------------------------------------ the candidate's page (no sign-in)

async function attemptByToken(token: string): Promise<Item | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const s = await db().collection('hiringItems').where('token', '==', token).get();
  return s.docs.map((x: any) => x.data() as Item).find((x: Item) => x.kind === 'assessment' && x.mode === 'AI_TEST') || null;
}

const secondsLeft = (it: Item) => Math.max(0, Math.round((Date.parse(it.startedAt) + it.minutes * 60_000 - nowFn().getTime()) / 1000));
const candidateQuestions = (it: Item) => ((it.questions || []) as Question[]).map((q) => ({ id: q.id, q: q.q, options: q.options }));

async function publicState(it: Item): Promise<Record<string, any>> {
  const a = await getApplication(it.companyId, it.applicationId);
  const base = { companyName: await getCompanyName(it.companyId), candidateName: it.candidateName, designation: a?.designation || '', minutes: it.minutes, questionCount: (it.questions || []).length, expiresOn: String(it.expiresAt).slice(0, 10) };
  if (it.status === 'SCORED') return { ...base, state: 'DONE' };
  if (it.status === 'SUPERSEDED') return { ...base, state: 'REPLACED' };
  if (!it.startedAt && nowFn().toISOString() > it.expiresAt) return { ...base, state: 'EXPIRED' };
  if (it.startedAt) return { ...base, state: 'IN_PROGRESS', secondsLeft: secondsLeft(it), questions: candidateQuestions(it) };
  return { ...base, state: 'READY' };
}

async function publicGet(token: string, ip: string): Promise<Result> {
  if (rateLimited(`stest-get:${ip}`, 40)) return fail(429, 'Too many requests. Please try again in a minute.');
  const it = await attemptByToken(token);
  if (!it) return fail(404, 'This link is not valid.');
  return ok(await publicState(it));
}

async function publicStart(b: any, ip: string): Promise<Result> {
  if (rateLimited(`stest-start:${ip}`, 15)) return fail(429, 'Too many requests. Please try again in a minute.');
  const found = await attemptByToken(str(b.token, 80));
  if (!found) return fail(404, 'This link is not valid.');
  const ref = db().collection('hiringItems').doc(found.id);
  let err = '';
  await db().runTransaction(async (tx: any) => {
    const s = await tx.get(ref); const cur = s.data() as Item;
    if (cur.status === 'SCORED') { err = 'You have already handed this test in.'; return; }
    if (cur.status === 'SUPERSEDED') { err = 'This link was replaced. Please use the newest email.'; return; }
    if (cur.startedAt) return;   // pressing Start twice (or reloading) does not restart the clock
    if (nowFn().toISOString() > cur.expiresAt) { err = 'This test link has run out. Please ask HR for a new one.'; return; }
    tx.set(ref, clean({ ...cur, startedAt: nowIso() }));
  });
  if (err) return fail(409, err);
  return ok(await publicState((await getItem(found.companyId, found.id, 'assessment'))!));
}

async function publicSubmit(b: any, ip: string): Promise<Result> {
  if (rateLimited(`stest-sub:${ip}`, 10)) return fail(429, 'Too many requests. Please try again in a minute.');
  const it = await attemptByToken(str(b.token, 80));
  if (!it) return fail(404, 'This link is not valid.');
  if (it.status === 'SCORED') return fail(409, 'You have already handed this test in.');
  if (!it.startedAt) return fail(400, 'Please press Start first.');
  const answers: Record<string, number> = {};
  if (b.answers && typeof b.answers === 'object') for (const [k, v] of Object.entries(b.answers).slice(0, 60)) answers[String(k).slice(0, 20)] = Number(v);
  const late = nowFn().getTime() > Date.parse(it.startedAt) + it.minutes * 60_000 + GRACE_MS;
  await markAttempt(it.companyId, it.id, answers, late);
  await flowAdvanceHook(it.companyId, it.applicationId);
  return ok({ state: 'DONE' });
}

// ------------------------------------------------------------------ routing

const ACTIONS: Record<string, { method: 'GET' | 'POST'; who: 'manage' | 'public' }> = {
  'stest-list': { method: 'GET', who: 'manage' }, 'stest-get': { method: 'GET', who: 'manage' }, 'stest-generate': { method: 'POST', who: 'manage' },
  'stest-save': { method: 'POST', who: 'manage' }, 'stest-delete': { method: 'POST', who: 'manage' },
  'stest-public-get': { method: 'GET', who: 'public' }, 'stest-public-start': { method: 'POST', who: 'public' }, 'stest-public-submit': { method: 'POST', who: 'public' },
};

export async function routeSkillTest(r: PipeRequest & { ip?: string }): Promise<Result | null> {
  const spec = ACTIONS[r.action];
  if (!spec) return null;
  try {
    if (r.method !== spec.method) return fail(405, 'Method not allowed.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (spec.who === 'public') {
      const ip = str(r.ip || (r.headers?.['x-forwarded-for'] as string) || 'unknown', 80).split(',')[0].trim();
      if (r.action === 'stest-public-get') return await publicGet(str(r.query.token, 80), ip);
      return r.action === 'stest-public-start' ? await publicStart(b, ip) : await publicSubmit(b, ip);
    }
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (!isHr(ctx)) return fail(403, 'You do not have permission to do this.');
    switch (r.action) {
      case 'stest-list': return await listTests(ctx.companyId);
      case 'stest-get': return await getTest(ctx.companyId, r.query);
      case 'stest-generate': return await generate(ctx, b);
      case 'stest-save': return await saveTest(ctx, b);
      default: return await deleteTest(ctx, b);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[SkillTest] error:', err);
    return fail(500, err?.message || 'Skills test request failed.');
  }
}
