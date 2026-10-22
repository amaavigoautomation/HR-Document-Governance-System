/**
 * Skill assessments: AI-written multiple-choice tests with a percentage score per skill.
 *
 * Two uses share one engine:
 *  - a candidate takes a test during onboarding (kind PRE_HIRE, opened from a private emailed link);
 *  - HR triggers a retest for an employee later (kind RETEST) and the result is compared with the first one.
 *
 * Everything is scoped by company id and uses the Firebase Admin SDK, so no browser can read the question
 * bank or the correct answers (see the deny rules in firestore.rules). Shared by server.ts (Express) and
 * api/assess/[action].ts (Vercel).
 *
 * Collections
 *   assessmentQuestions  the reusable question bank (per company, per skill)
 *   assessments          one document per test given to one person: frozen questions, answers, result
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { AuthError, authErrorResponse, requireActiveTenant, requirePermission, type AuthContext } from './authContext.js';
import { dispatchLiveEmail } from './serverEmail.js';
import {
  DIFFICULTIES,
  MAX_QUESTIONS_PER_SKILL,
  MAX_SKILLS_PER_TEST,
  blueprintTotal,
  cleanSkillName,
  compareResults,
  scoreAssessment,
  skillKey,
  splitCount,
  type AssessmentResult,
  type Comparison,
  type Difficulty,
  type DifficultyPreset,
  type SkillBlueprint,
} from '../../shared/assessment.js';

// ------------------------------------------------------------------ types and constants

export type AssessmentKind = 'PRE_HIRE' | 'RETEST' | 'GENERAL';
export type AssessmentStatus = 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

interface BankQuestion {
  id: string;
  companyId: string;
  skill: string;
  skillKey: string;
  difficulty: Difficulty;
  topic: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  status: 'ACTIVE' | 'DISABLED';
  source: 'AI';
  timesUsed: number;
  createdAt: string;
}

/** A question as frozen into one assessment: options already shuffled, correctIndex already remapped. */
interface FrozenQuestion {
  id: string; // id of the bank question
  skill: string;
  difficulty: Difficulty;
  topic: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface AssessmentRequest {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
  origin?: string;
}

interface Result {
  status: number;
  json: any;
}

const GRACE_SECONDS = 90; // network slack after the timer ends
const DEFAULT_DURATION_MIN = 30;
const MAX_DURATION_MIN = 180;
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 30;

const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });
const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v)).trim();

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const db = () => adminDb();
const nowIso = () => new Date().toISOString();

/** Firestore rejects undefined values. */
function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function newToken(): string {
  return randomBytes(24).toString('hex');
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function appBase(origin?: string): string {
  return (process.env.APP_URL || origin || 'http://localhost:3000').replace(/\/+$/, '');
}

// ------------------------------------------------------------------ AI question generation

interface GeneratedQuestion {
  difficulty: Difficulty;
  topic: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function openAiKey(): string {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return !k || k === 'MY_OPENAI_API_KEY' ? '' : k;
}

const ASSESS_SYSTEM_PROMPT = [
  'You write multiple-choice questions for workplace skill assessments. The skill can be technical (a programming language, a tool)',
  'or non-technical (sales, customer support, accounting, design, operations, and so on).',
  'Rules:',
  '- Each question has exactly 4 options and exactly one correct option. Never use "all of the above" or "none of the above".',
  '- Options must be distinct, similar in length and style, and the wrong ones must be plausible to someone with partial knowledge.',
  '- Test practical, job-relevant knowledge. Prefer realistic scenarios over trivia. No trick questions and no ambiguity.',
  '- Easy = fundamentals a beginner should know. Medium = day-to-day working knowledge. Hard = deeper judgement, edge cases or trade-offs.',
  '- Spread the correct answer across positions. Do not repeat or rephrase questions.',
  '- Keep each question under 350 characters and each option under 160 characters. Plain text only.',
  'Return only JSON in exactly this shape: {"questions":[{"difficulty":"easy|medium|hard","topic":"short sub-topic","text":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"one or two sentences"}]}',
].join('\n');

async function callOpenAi(skill: string, difficulty: Difficulty, count: number, context: { company?: string; role?: string }, avoid: string[]): Promise<GeneratedQuestion[]> {
  const apiKey = openAiKey();
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = (process.env.OPENAI_ASSESSMENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const user = [
    `Skill to assess: ${skill}`,
    context.role ? `Role the person is being assessed for: ${context.role}` : '',
    `Write exactly ${count} ${difficulty} question${count > 1 ? 's' : ''}.`,
    avoid.length ? `Do not repeat these existing questions:\n${avoid.slice(0, 25).map((t) => `- ${t.slice(0, 120)}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature: 0.8,
        messages: [
          { role: 'system', content: ASSESS_SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) throw new Error(data?.error?.message || raw.slice(0, 200) || `HTTP ${res.status}`);
    const content = String(data?.choices?.[0]?.message?.content || '');
    return parseGenerated(content, difficulty);
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('The AI took too long to write the questions.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Parses and validates the model output; anything malformed is dropped rather than trusted. */
export function parseGenerated(content: string, fallbackDifficulty: Difficulty): GeneratedQuestion[] {
  let parsed: any;
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?|```$/gm, '').trim());
  } catch {
    return [];
  }
  const list: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : [];
  const out: GeneratedQuestion[] = [];
  for (const q of list) {
    const text = s(q?.text);
    const options: string[] = Array.isArray(q?.options) ? q.options.map((o: unknown) => s(o)) : [];
    const correctIndex = Number(q?.correctIndex);
    if (!text || options.length !== 4 || options.some((o) => !o)) continue;
    if (new Set(options.map(normalizeText)).size !== 4) continue;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) continue;
    if (options.some((o) => /^(all|none) of the above$/i.test(o))) continue;
    const difficulty: Difficulty = DIFFICULTIES.includes(q?.difficulty) ? q.difficulty : fallbackDifficulty;
    out.push({
      difficulty: fallbackDifficulty || difficulty,
      topic: s(q?.topic).slice(0, 60),
      text: text.slice(0, 600),
      options: options.map((o) => o.slice(0, 300)),
      correctIndex,
      explanation: s(q?.explanation).slice(0, 500),
    });
  }
  return out;
}

// ------------------------------------------------------------------ question bank

async function bankFor(companyId: string, key: string): Promise<BankQuestion[]> {
  const snap = await db().collection('assessmentQuestions').where('companyId', '==', companyId).where('skillKey', '==', key).get();
  return snap.docs.map((d) => d.data() as BankQuestion);
}

async function saveGenerated(companyId: string, skill: string, list: GeneratedQuestion[]): Promise<BankQuestion[]> {
  const saved: BankQuestion[] = [];
  const batch = db().batch();
  for (const g of list) {
    const ref = db().collection('assessmentQuestions').doc();
    const q: BankQuestion = {
      id: ref.id,
      companyId,
      skill,
      skillKey: skillKey(skill),
      difficulty: g.difficulty,
      topic: g.topic,
      text: g.text,
      options: g.options,
      correctIndex: g.correctIndex,
      explanation: g.explanation,
      status: 'ACTIVE',
      source: 'AI',
      timesUsed: 0,
      createdAt: nowIso(),
    };
    batch.set(ref, clean(q));
    saved.push(q);
  }
  if (saved.length) await batch.commit();
  return saved;
}

/**
 * Picks the questions for one skill: reuse unused bank questions first (least used first), then ask the AI for the
 * shortfall. `exclude` holds ids this person has already seen, so a retest never repeats a question.
 */
async function pickQuestions(
  companyId: string,
  bp: SkillBlueprint,
  exclude: Set<string>,
  context: { company?: string; role?: string }
): Promise<BankQuestion[]> {
  const key = skillKey(bp.skill);
  const bank = await bankFor(companyId, key);
  const usable = bank.filter((q) => q.status === 'ACTIVE' && !exclude.has(q.id));
  const picked: BankQuestion[] = [];

  const need: Record<Difficulty, number> = { easy: bp.easy, medium: bp.medium, hard: bp.hard };
  const missing: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const d of DIFFICULTIES) {
    const pool = shuffle(usable.filter((q) => q.difficulty === d)).sort((a, b) => (a.timesUsed || 0) - (b.timesUsed || 0));
    const take = pool.slice(0, need[d]);
    picked.push(...take);
    missing[d] = need[d] - take.length;
  }

  if (DIFFICULTIES.some((d) => missing[d] > 0)) {
    if (!openAiKey()) {
      throw new HttpError(
        422,
        `There are not enough saved questions for "${bp.skill}" and AI question writing is off. Set OPENAI_API_KEY on the server so questions can be generated.`
      );
    }
    const knownTexts = bank.map((q) => q.text);
    const seen = new Set(bank.map((q) => normalizeText(q.text)));
    const chunks: { difficulty: Difficulty; n: number }[] = [];
    for (const d of DIFFICULTIES) {
      let left = missing[d];
      while (left > 0) {
        const n = Math.min(10, left);
        chunks.push({ difficulty: d, n });
        left -= n;
      }
    }
    // One retry round if the model returned fewer valid questions than asked.
    const collected: Record<Difficulty, GeneratedQuestion[]> = { easy: [], medium: [], hard: [] };
    for (let round = 0; round < 2; round++) {
      const todo = round === 0 ? chunks : DIFFICULTIES.map((d) => ({ difficulty: d, n: missing[d] - collected[d].length })).filter((c) => c.n > 0);
      if (!todo.length) break;
      const results = await Promise.all(todo.map((c) => callOpenAi(bp.skill, c.difficulty, c.n, context, knownTexts).catch((e) => {
        if (round === 1) return [] as GeneratedQuestion[];
        throw e;
      })));
      results.forEach((list, i) => {
        for (const g of list) {
          const norm = normalizeText(g.text);
          if (seen.has(norm) || collected[todo[i].difficulty].length >= missing[todo[i].difficulty]) continue;
          seen.add(norm);
          collected[todo[i].difficulty].push(g);
        }
      });
    }
    for (const d of DIFFICULTIES) {
      if (collected[d].length < missing[d]) {
        throw new HttpError(502, `The AI could only write ${collected[d].length} of ${missing[d]} needed ${d} questions for "${bp.skill}". Please try again.`);
      }
    }
    const saved = await saveGenerated(companyId, cleanSkillName(bp.skill), [...collected.easy, ...collected.medium, ...collected.hard]);
    picked.push(...saved);
  }
  return picked;
}

function freeze(q: BankQuestion): FrozenQuestion {
  const order = shuffle([0, 1, 2, 3]);
  return {
    id: q.id,
    skill: q.skill,
    difficulty: q.difficulty,
    topic: q.topic,
    text: q.text,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
    explanation: q.explanation,
  };
}

// ------------------------------------------------------------------ assessment documents

function parseBlueprints(input: unknown): SkillBlueprint[] {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, 'Add at least one skill to test.');
  if (input.length > MAX_SKILLS_PER_TEST) throw new HttpError(400, `A test can cover at most ${MAX_SKILLS_PER_TEST} skills.`);
  const seen = new Set<string>();
  return input.map((raw: any) => {
    const skill = cleanSkillName(raw?.skill);
    if (!skill) throw new HttpError(400, 'Every skill needs a name.');
    const key = skillKey(skill);
    if (seen.has(key)) throw new HttpError(400, `"${skill}" is listed twice.`);
    seen.add(key);
    let bp: SkillBlueprint;
    if (raw && ['easy', 'medium', 'hard'].every((d) => Number.isInteger(raw[d]) && raw[d] >= 0)) {
      bp = { skill, easy: raw.easy, medium: raw.medium, hard: raw.hard };
    } else {
      const count = Number(raw?.count ?? 10);
      if (!Number.isFinite(count) || count < 1) throw new HttpError(400, `Choose how many questions to ask for "${skill}".`);
      const preset: DifficultyPreset = ['easy', 'balanced', 'hard'].includes(raw?.preset) ? raw.preset : 'balanced';
      bp = { skill, ...splitCount(count, preset) };
    }
    if (blueprintTotal(bp) < 1) throw new HttpError(400, `"${skill}" needs at least one question.`);
    if (blueprintTotal(bp) > MAX_QUESTIONS_PER_SKILL) throw new HttpError(400, `"${skill}" can have at most ${MAX_QUESTIONS_PER_SKILL} questions.`);
    return bp;
  });
}

async function companyName(companyId: string): Promise<string> {
  const snap = await db().collection('companies').doc(companyId).get();
  return String(snap.data()?.name || 'your company');
}

/** Question ids this person has already been shown (any earlier assessment for the same email). */
async function seenQuestionIds(companyId: string, emailLower: string): Promise<Set<string>> {
  const snap = await db().collection('assessments').where('companyId', '==', companyId).where('subject.emailLower', '==', emailLower).get();
  const ids = new Set<string>();
  for (const d of snap.docs) {
    const a = d.data() as any;
    // A test that was never opened shows nothing, so its questions may be reused.
    if (a.status === 'SENT' || a.status === 'CANCELLED') continue;
    for (const id of a.questionIds || []) ids.add(id);
  }
  return ids;
}

interface CreateInput {
  ctx: AuthContext;
  kind: AssessmentKind;
  subject: { type: 'CANDIDATE' | 'EMPLOYEE'; name: string; email: string; onboardingId?: string; employeeUid?: string; role?: string };
  blueprint: SkillBlueprint[];
  durationMinutes: number;
  expiresInDays: number;
  showResultToTaker: boolean;
  baselineId?: string;
  origin?: string;
  sendEmail: boolean;
}

async function createAssessment(input: CreateInput): Promise<{ id: string; emailSent: boolean; link: string }> {
  const { ctx } = input;
  const companyId = ctx.companyId!;
  const emailLower = input.subject.email.toLowerCase();
  const cname = await companyName(companyId);

  const exclude = await seenQuestionIds(companyId, emailLower);
  const picks = await Promise.all(input.blueprint.map((bp) => pickQuestions(companyId, bp, exclude, { company: cname, role: input.subject.role })));
  const bankQuestions = picks.flat();
  const frozen = shuffle(bankQuestions.map(freeze));

  const ref = db().collection('assessments').doc();
  const token = newToken();
  const created = nowIso();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const doc = clean({
    id: ref.id,
    companyId,
    kind: input.kind,
    status: 'SENT' as AssessmentStatus,
    subject: { ...input.subject, emailLower },
    blueprint: input.blueprint,
    questions: frozen,
    questionIds: frozen.map((q) => q.id),
    durationMinutes: input.durationMinutes,
    showResultToTaker: input.showResultToTaker,
    baselineId: input.baselineId || null,
    tokenHash: sha256(token),
    expiresAt,
    createdAt: created,
    createdBy: { uid: ctx.uid, email: ctx.email },
    events: [{ at: created, text: `Created by ${ctx.email}.` }],
  });
  await ref.set(doc);

  // Count the usage so the bank rotates questions between people.
  const usage = db().batch();
  for (const q of bankQuestions) usage.update(db().collection('assessmentQuestions').doc(q.id), { timesUsed: (q.timesUsed || 0) + 1 });
  await usage.commit().catch((e) => console.warn('[Assessments] could not update question usage:', e?.message || e));

  const link = `${appBase(input.origin)}/assessment?token=${token}`;
  let emailSent = false;
  if (input.sendEmail) {
    emailSent = await sendInvite(doc as any, link, cname);
    await ref.update({ events: [...(doc as any).events, { at: nowIso(), text: emailSent ? 'Invitation emailed.' : 'Invitation email could not be sent (check SMTP settings).' }] });
  }
  return { id: ref.id, emailSent, link };
}

async function sendInvite(a: any, link: string, cname: string): Promise<boolean> {
  const skills = (a.blueprint as SkillBlueprint[]).map((b) => b.skill).join(', ');
  const total = (a.questions as FrozenQuestion[]).length;
  const intro =
    a.kind === 'PRE_HIRE'
      ? `As part of your onboarding at ${cname}, we would like you to take a short skill assessment.`
      : `${cname} has asked you to take a short skill assessment so we can see how your skills have grown.`;
  const body = [
    `Dear ${a.subject.name},`,
    '',
    intro,
    '',
    'ASSESSMENT DETAILS',
    `Skills covered: ${skills}`,
    `Questions: ${total} multiple-choice questions`,
    `Time limit: ${a.durationMinutes} minutes (the timer starts when you click Start)`,
    `Open until: ${new Date(a.expiresAt).toDateString()}`,
    '',
    'BEFORE YOU START',
    '1. Use a computer with a stable internet connection and stay on the test page.',
    '2. You can answer each question once and move forward; you can go back before you submit.',
    '3. Switching to other tabs or windows is recorded.',
    '',
    `Start your assessment: ${link}`,
    '',
    'Please keep this link private. It was created only for you.',
  ].join('\n');
  try {
    const r = await dispatchLiveEmail({ to: a.subject.email, recipientName: a.subject.name, subject: `Your skill assessment (${skills})`, body });
    if (!r.success) console.warn('[Assessments] email not sent:', r.error || r.note);
    return !!r.success;
  } catch (err: any) {
    console.warn('[Assessments] email failed:', err?.message || err);
    return false;
  }
}

// ------------------------------------------------------------------ views

function expireIfNeeded(a: any): any {
  const now = Date.now();
  if (a.status === 'SENT' && now > Date.parse(a.expiresAt)) return { ...a, status: 'EXPIRED' };
  if (a.status === 'IN_PROGRESS' && now > Date.parse(a.deadline) + GRACE_SECONDS * 1000) return { ...a, status: 'EXPIRED' };
  return a;
}

function summary(a: any) {
  a = expireIfNeeded(a);
  return {
    id: a.id,
    kind: a.kind,
    status: a.status as AssessmentStatus,
    subject: {
      type: a.subject.type,
      name: a.subject.name,
      email: a.subject.email,
      onboardingId: a.subject.onboardingId || null,
      employeeUid: a.subject.employeeUid || null,
    },
    skills: (a.blueprint as SkillBlueprint[]).map((b) => b.skill),
    blueprint: a.blueprint as SkillBlueprint[],
    questionCount: (a.questions as FrozenQuestion[]).length,
    durationMinutes: a.durationMinutes,
    showResultToTaker: !!a.showResultToTaker,
    baselineId: a.baselineId || null,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
    startedAt: a.startedAt || null,
    completedAt: a.completedAt || null,
    result: (a.result as AssessmentResult | undefined) || null,
  };
}

async function loadCompleted(companyId: string, emailLower: string): Promise<any[]> {
  const snap = await db().collection('assessments').where('companyId', '==', companyId).where('subject.emailLower', '==', emailLower).get();
  return snap.docs
    .map((d) => d.data() as any)
    .filter((a) => a.status === 'COMPLETED' && a.result)
    .sort((x, y) => Date.parse(x.completedAt) - Date.parse(y.completedAt));
}

function compareTo(base: any, later: any): Comparison {
  return compareResults({ result: base.result, blueprint: base.blueprint }, { result: later.result, blueprint: later.blueprint });
}

/** Baseline for a person: the explicitly linked assessment, otherwise their earliest completed one. */
async function baselineFor(a: any): Promise<any | null> {
  const completed = await loadCompleted(a.companyId, a.subject.emailLower);
  if (a.baselineId) {
    const linked = completed.find((c) => c.id === a.baselineId);
    if (linked) return linked;
  }
  return completed.find((c) => c.id !== a.id) || null;
}

// ------------------------------------------------------------------ taking the test (candidate by token, employee signed in)

async function findByToken(token: string): Promise<any | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const snap = await db().collection('assessments').where('tokenHash', '==', sha256(token)).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as any);
}

interface Taker {
  assessment: any;
}

async function resolveTaker(r: AssessmentRequest, tokenInput: string, idInput: string): Promise<Taker> {
  if (tokenInput) {
    const a = await findByToken(tokenInput);
    if (!a) throw new HttpError(404, 'This assessment link is not valid.');
    return { assessment: a };
  }
  const ctx = await requireActiveTenant(r.headers);
  if (!ctx.companyId) throw new HttpError(403, 'Open this as a company user.');
  const snap = await db().collection('assessments').doc(idInput || '_').get();
  const a = snap.exists ? (snap.data() as any) : null;
  if (!a || a.companyId !== ctx.companyId) throw new HttpError(404, 'Assessment not found.');
  const mine = a.subject.employeeUid === ctx.uid || a.subject.emailLower === ctx.email;
  if (!mine) throw new HttpError(404, 'Assessment not found.');
  return { assessment: a };
}

function takerView(a: any, includeQuestions: boolean) {
  a = expireIfNeeded(a);
  const base: Record<string, any> = {
    id: a.id,
    status: a.status,
    kind: a.kind,
    name: a.subject.name,
    skills: (a.blueprint as SkillBlueprint[]).map((b) => b.skill),
    questionCount: (a.questions as FrozenQuestion[]).length,
    durationMinutes: a.durationMinutes,
    expiresAt: a.expiresAt,
    startedAt: a.startedAt || null,
    deadline: a.deadline || null,
    secondsLeft: a.deadline ? Math.max(0, Math.round((Date.parse(a.deadline) - Date.now()) / 1000)) : null,
    result: a.status === 'COMPLETED' && a.showResultToTaker ? a.result : null,
    resultHidden: a.status === 'COMPLETED' && !a.showResultToTaker,
  };
  if (includeQuestions) {
    // The correct answer and explanation never leave the server while the test is open.
    base.questions = (a.questions as FrozenQuestion[]).map((q) => ({ id: q.id, skill: q.skill, text: q.text, options: q.options }));
  }
  return base;
}

async function publicInfo(r: AssessmentRequest, token: string, id: string): Promise<Result> {
  const { assessment } = await resolveTaker(r, token, id);
  const view = takerView(assessment, false);
  view.companyName = await companyName(assessment.companyId);
  return ok({ assessment: view });
}

async function startTest(r: AssessmentRequest, token: string, id: string): Promise<Result> {
  const { assessment } = await resolveTaker(r, token, id);
  const a = expireIfNeeded(assessment);
  if (a.status === 'COMPLETED') return ok({ assessment: takerView(a, false) });
  if (a.status === 'CANCELLED') throw new HttpError(410, 'This assessment was cancelled. Please contact HR.');
  if (a.status === 'EXPIRED') throw new HttpError(410, 'This assessment has expired. Please contact HR for a new link.');

  const ref = db().collection('assessments').doc(a.id);
  if (a.status === 'SENT') {
    const started = nowIso();
    const deadline = new Date(Date.now() + a.durationMinutes * 60_000).toISOString();
    await ref.update({
      status: 'IN_PROGRESS',
      startedAt: started,
      deadline,
      events: [...(a.events || []), { at: started, text: 'Test started.' }].slice(-30),
    });
    a.status = 'IN_PROGRESS';
    a.startedAt = started;
    a.deadline = deadline;
  }
  return ok({ assessment: takerView(a, true) });
}

async function submitTest(r: AssessmentRequest, token: string, id: string, body: any): Promise<Result> {
  const { assessment } = await resolveTaker(r, token, id);
  const a = assessment;
  if (a.status === 'COMPLETED') return ok({ assessment: takerView(a, false) });
  if (a.status !== 'IN_PROGRESS') throw new HttpError(409, 'This assessment is not open for answers.');

  const questions = a.questions as FrozenQuestion[];
  const raw = body?.answers && typeof body.answers === 'object' ? body.answers : {};
  const answers: Record<string, number> = {};
  for (const q of questions) {
    const v = raw[q.id];
    if (Number.isInteger(v) && v >= 0 && v < q.options.length) answers[q.id] = v;
  }
  const result = scoreAssessment(questions.map((q) => ({ id: q.id, skill: q.skill, difficulty: q.difficulty, correctIndex: q.correctIndex })), answers);

  const completedAt = nowIso();
  const lateBySeconds = Math.round((Date.parse(completedAt) - Date.parse(a.deadline)) / 1000);
  const tabSwitches = Math.max(0, Math.min(999, Math.floor(Number(body?.tabSwitches) || 0)));
  const update = clean({
    status: 'COMPLETED' as AssessmentStatus,
    answers,
    result,
    completedAt,
    tabSwitches,
    lateBySeconds: lateBySeconds > GRACE_SECONDS ? lateBySeconds : 0,
    events: [...(a.events || []), { at: completedAt, text: 'Test submitted.' }].slice(-30),
  });
  await db().collection('assessments').doc(a.id).update(update);
  return ok({ assessment: takerView({ ...a, ...update }, false) });
}

async function mine(ctx: AuthContext): Promise<Result> {
  if (!ctx.companyId) return ok({ items: [] });
  const col = db().collection('assessments');
  const [byUid, byEmail] = await Promise.all([
    col.where('companyId', '==', ctx.companyId).where('subject.employeeUid', '==', ctx.uid).get(),
    ctx.email ? col.where('companyId', '==', ctx.companyId).where('subject.emailLower', '==', ctx.email).get() : Promise.resolve(null),
  ]);
  const map = new Map<string, any>();
  for (const d of [...byUid.docs, ...(byEmail ? byEmail.docs : [])]) map.set(d.id, d.data());
  const all = Array.from(map.values()).filter((a) => a.status !== 'CANCELLED').sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));

  const completed = all.filter((a) => a.status === 'COMPLETED' && a.result).sort((x, y) => Date.parse(x.completedAt) - Date.parse(y.completedAt));
  const items = all.map((a0) => {
    const a = expireIfNeeded(a0);
    const visible = a.status === 'COMPLETED' && a.showResultToTaker;
    const base = completed.find((c) => c.id === (a.baselineId || '') ) || completed.find((c) => c.id !== a.id && Date.parse(c.completedAt) < Date.parse(a.completedAt || '9999'));
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      skills: (a.blueprint as SkillBlueprint[]).map((b: SkillBlueprint) => b.skill),
      questionCount: a.questions.length,
      durationMinutes: a.durationMinutes,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
      completedAt: a.completedAt || null,
      result: visible ? a.result : null,
      resultHidden: a.status === 'COMPLETED' && !a.showResultToTaker,
      comparison: visible && base && base.showResultToTaker !== false && a.kind === 'RETEST' ? compareTo(base, a) : null,
    };
  });
  return ok({ items });
}

// ------------------------------------------------------------------ HR actions

function requireCompany(ctx: AuthContext): string {
  if (!ctx.companyId) throw new HttpError(403, 'Open this as a company user. Platform administrators have no company.');
  return ctx.companyId;
}

async function listAssessments(ctx: AuthContext, query: Record<string, any>): Promise<Result> {
  const companyId = requireCompany(ctx);
  const snap = await db().collection('assessments').where('companyId', '==', companyId).get();
  let items = snap.docs.map((d) => d.data() as any);
  const onboardingId = s(query.onboardingId);
  const email = s(query.email).toLowerCase();
  if (onboardingId) items = items.filter((a) => a.subject.onboardingId === onboardingId);
  if (email) items = items.filter((a) => a.subject.emailLower === email);
  items.sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
  return ok({ items: items.slice(0, 300).map(summary) });
}

async function getAssessment(ctx: AuthContext, id: string): Promise<Result> {
  const companyId = requireCompany(ctx);
  const snap = await db().collection('assessments').doc(id || '_').get();
  const a = snap.exists ? (snap.data() as any) : null;
  if (!a || a.companyId !== companyId) return fail(404, 'Assessment not found.');
  const view = summary(a);
  const review =
    a.status === 'COMPLETED'
      ? (a.questions as FrozenQuestion[]).map((q) => {
          const chosen = Number.isInteger(a.answers?.[q.id]) ? a.answers[q.id] : null;
          return { skill: q.skill, difficulty: q.difficulty, topic: q.topic, text: q.text, options: q.options, chosenIndex: chosen, correctIndex: q.correctIndex, correct: chosen === q.correctIndex, explanation: q.explanation };
        })
      : [];
  const base = a.status === 'COMPLETED' && a.kind === 'RETEST' ? await baselineFor(a) : null;
  return ok({
    item: {
      ...view,
      tabSwitches: a.tabSwitches || 0,
      lateBySeconds: a.lateBySeconds || 0,
      events: a.events || [],
      review,
      comparison: base ? compareTo(base, a) : null,
      baseline: base ? { id: base.id, completedAt: base.completedAt, kind: base.kind } : null,
    },
  });
}

function asDuration(v: unknown): number {
  const n = Math.floor(Number(v ?? DEFAULT_DURATION_MIN));
  if (!Number.isFinite(n) || n < 5) return DEFAULT_DURATION_MIN;
  return Math.min(MAX_DURATION_MIN, n);
}

function asExpiry(v: unknown): number {
  const n = Math.floor(Number(v ?? DEFAULT_EXPIRY_DAYS));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_EXPIRY_DAYS;
  return Math.min(MAX_EXPIRY_DAYS, n);
}

async function employeeSubject(companyId: string, uid: string) {
  const snap = await db().collection('employees').doc(uid || '_').get();
  const e = snap.exists ? (snap.data() as any) : null;
  if (!e || e.companyId !== companyId) throw new HttpError(404, 'Employee not found in your company.');
  if (!e.email) throw new HttpError(400, 'This employee has no email address.');
  return { type: 'EMPLOYEE' as const, name: String(e.name || e.email), email: String(e.email), employeeUid: uid, role: String(e.title || '') };
}

async function createAction(ctx: AuthContext, body: any, origin?: string): Promise<Result> {
  const companyId = requireCompany(ctx);
  const blueprint = parseBlueprints(body.skills);
  const kind: AssessmentKind = body.kind === 'RETEST' ? 'RETEST' : body.kind === 'GENERAL' ? 'GENERAL' : 'PRE_HIRE';

  let subject: CreateInput['subject'];
  if (s(body.employeeUid)) {
    subject = await employeeSubject(companyId, s(body.employeeUid));
  } else {
    const name = s(body.name);
    const email = s(body.email);
    if (!name) throw new HttpError(400, 'The candidate name is required.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'A valid candidate email is required.');
    subject = { type: 'CANDIDATE', name, email, onboardingId: s(body.onboardingId) || undefined, role: s(body.role) || undefined };
  }
  const out = await createAssessment({
    ctx,
    kind: subject.type === 'EMPLOYEE' && kind === 'PRE_HIRE' ? 'GENERAL' : kind,
    subject,
    blueprint,
    durationMinutes: asDuration(body.durationMinutes),
    expiresInDays: asExpiry(body.expiresInDays),
    showResultToTaker: body.showResultToTaker === undefined ? subject.type === 'EMPLOYEE' : !!body.showResultToTaker,
    origin,
    sendEmail: body.sendEmail !== false,
  });
  return ok(out);
}

async function retestAction(ctx: AuthContext, body: any, origin?: string): Promise<Result> {
  const companyId = requireCompany(ctx);
  const subject = await employeeSubject(companyId, s(body.employeeUid));
  const completed = await loadCompleted(companyId, subject.email.toLowerCase());
  if (completed.length === 0) {
    throw new HttpError(409, `${subject.name} has no completed assessment yet, so there is nothing to compare a retest with. Use "New test" for a first assessment.`);
  }
  const baseline = s(body.baselineId) ? completed.find((c) => c.id === s(body.baselineId)) : completed[0];
  if (!baseline) throw new HttpError(404, 'That baseline assessment was not found for this person.');

  // Same shape as the baseline unless HR chose to cover fewer skills.
  const wanted = Array.isArray(body.skills) && body.skills.length ? new Set((body.skills as unknown[]).map((k) => skillKey(s(k)))) : null;
  const blueprint = (baseline.blueprint as SkillBlueprint[]).filter((b) => !wanted || wanted.has(skillKey(b.skill)));
  if (blueprint.length === 0) throw new HttpError(400, 'Pick at least one skill from the first test.');

  const out = await createAssessment({
    ctx,
    kind: 'RETEST',
    subject,
    blueprint,
    durationMinutes: body.durationMinutes ? asDuration(body.durationMinutes) : baseline.durationMinutes,
    expiresInDays: asExpiry(body.expiresInDays),
    showResultToTaker: body.showResultToTaker === undefined ? true : !!body.showResultToTaker,
    baselineId: baseline.id,
    origin,
    sendEmail: body.sendEmail !== false,
  });
  return ok({ ...out, baselineId: baseline.id });
}

async function resendAction(ctx: AuthContext, body: any, origin?: string): Promise<Result> {
  const companyId = requireCompany(ctx);
  const snap = await db().collection('assessments').doc(s(body.id) || '_').get();
  const a = snap.exists ? (snap.data() as any) : null;
  if (!a || a.companyId !== companyId) return fail(404, 'Assessment not found.');
  const cur = expireIfNeeded(a);
  const neverStarted = !a.startedAt;
  if (cur.status === 'COMPLETED' || cur.status === 'CANCELLED') return fail(409, `This assessment is ${cur.status.toLowerCase()}; create a new one instead.`);
  if (!neverStarted) return fail(409, 'The person has already opened this test, so the same questions cannot be sent again. Create a new assessment instead.');

  const token = newToken();
  const expiresAt = new Date(Date.now() + asExpiry(body.expiresInDays) * 86_400_000).toISOString();
  const link = `${appBase(origin)}/assessment?token=${token}`;
  const next = { ...a, expiresAt, status: 'SENT' };
  const sent = await sendInvite(next, link, await companyName(companyId));
  await snap.ref.update({
    tokenHash: sha256(token),
    expiresAt,
    status: 'SENT',
    events: [...(a.events || []), { at: nowIso(), text: sent ? `New link emailed by ${ctx.email}.` : `New link created by ${ctx.email}; email could not be sent.` }].slice(-30),
  });
  return ok({ emailSent: sent, link });
}

async function cancelAction(ctx: AuthContext, body: any): Promise<Result> {
  const companyId = requireCompany(ctx);
  const snap = await db().collection('assessments').doc(s(body.id) || '_').get();
  const a = snap.exists ? (snap.data() as any) : null;
  if (!a || a.companyId !== companyId) return fail(404, 'Assessment not found.');
  if (a.status === 'COMPLETED') return fail(409, 'A completed assessment cannot be cancelled.');
  await snap.ref.update({
    status: 'CANCELLED',
    tokenHash: null,
    events: [...(a.events || []), { at: nowIso(), text: `Cancelled by ${ctx.email}.` }].slice(-30),
  });
  return ok();
}

async function historyAction(ctx: AuthContext, query: Record<string, any>): Promise<Result> {
  const companyId = requireCompany(ctx);
  let email = s(query.email).toLowerCase();
  if (s(query.employeeUid)) email = (await employeeSubject(companyId, s(query.employeeUid))).email.toLowerCase();
  if (!email) return fail(400, 'email or employeeUid is required.');
  const completed = await loadCompleted(companyId, email);
  const first = completed[0];
  return ok({
    items: completed.map((a) => ({
      ...summary(a),
      comparisonToFirst: first && a.id !== first.id ? compareTo(first, a) : null,
    })),
  });
}

async function bankAction(ctx: AuthContext, query: Record<string, any>): Promise<Result> {
  const companyId = requireCompany(ctx);
  const key = skillKey(s(query.skill));
  const snap = key
    ? await db().collection('assessmentQuestions').where('companyId', '==', companyId).where('skillKey', '==', key).get()
    : await db().collection('assessmentQuestions').where('companyId', '==', companyId).get();
  const items = snap.docs.map((d) => d.data() as BankQuestion).sort((a, b) => a.skill.localeCompare(b.skill) || a.difficulty.localeCompare(b.difficulty));
  const skills = new Map<string, { skill: string; total: number; active: number }>();
  for (const q of items) {
    const e = skills.get(q.skillKey) || { skill: q.skill, total: 0, active: 0 };
    e.total += 1;
    if (q.status === 'ACTIVE') e.active += 1;
    skills.set(q.skillKey, e);
  }
  return ok({ skills: Array.from(skills.values()), items: items.slice(0, 400) });
}

async function bankToggle(ctx: AuthContext, body: any): Promise<Result> {
  const companyId = requireCompany(ctx);
  const snap = await db().collection('assessmentQuestions').doc(s(body.id) || '_').get();
  const q = snap.exists ? (snap.data() as BankQuestion) : null;
  if (!q || q.companyId !== companyId) return fail(404, 'Question not found.');
  await snap.ref.update({ status: body.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE' });
  return ok();
}

// ------------------------------------------------------------------ router

export async function routeAssess(r: AssessmentRequest): Promise<Result> {
  try {
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    const action = r.action;

    // ---- taking a test: candidate by private link, or an employee signed in
    if (action === 'public-info' && r.method === 'GET') return await publicInfo(r, s(r.query.token), s(r.query.id));
    if (action === 'start' && r.method === 'POST') return await startTest(r, s(body.token), s(body.id));
    if (action === 'submit' && r.method === 'POST') return await submitTest(r, s(body.token), s(body.id), body);
    if (action === 'mine' && r.method === 'GET') return await mine(await requireActiveTenant(r.headers));

    // ---- HR
    const viewing = ['list', 'get', 'history', 'bank'].includes(action);
    const ctx = viewing ? await requirePermission(r.headers, 'assess.view', 'assess.manage') : await requirePermission(r.headers, 'assess.manage');

    if (action === 'list' && r.method === 'GET') return await listAssessments(ctx, r.query);
    if (action === 'get' && r.method === 'GET') return await getAssessment(ctx, s(r.query.id));
    if (action === 'history' && r.method === 'GET') return await historyAction(ctx, r.query);
    if (action === 'bank' && r.method === 'GET') return await bankAction(ctx, r.query);
    if (r.method !== 'POST') return fail(405, 'Method not allowed.');

    switch (action) {
      case 'create': return await createAction(ctx, body, r.origin);
      case 'retest': return await retestAction(ctx, body, r.origin);
      case 'resend': return await resendAction(ctx, body, r.origin);
      case 'cancel': return await cancelAction(ctx, body);
      case 'bank-toggle': return await bankToggle(ctx, body);
      default: return fail(404, `Unknown assessment action '${action}'.`);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    if (err instanceof HttpError) return fail(err.status, err.message);
    console.error('[Assessments] error:', err);
    return fail(500, err?.message || 'Assessment request failed.');
  }
}

export { AuthError };
