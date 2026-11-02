/**
 * Recruitment AI (reached through hiringRouter.ts as /api/recruitment/<action>). The model reads and writes language; scores,
 * dates, duplicate matches and verdicts are calculated in shared/resumeAi.ts. With no OPENAI_API_KEY every action still answers
 * from rules and says so.
 *
 *   ai-status                    is AI on, and this month's use against the limit
 *   ai-resume                    read a resume (text, or a scanned PDF / photo) into skills, history, gaps, certifications, projects
 *   dup-scan / dup-merge         find the same person applying twice, and merge the records
 *   ai-compare                   2 to 4 candidates side by side with a written comparison
 *   ai-recommend                 a hiring recommendation with the reasons listed
 *   ai-followup / ai-followup-send   a draft email for the next step (HR edits, then sends)
 *   ai-insights                  plain-language reading of the founder dashboard
 *
 * Fairness: prompts use "Candidate A, B" and never include names, contact details, age, gender, address or photos. Interview
 * scorecards only count once every panel member has submitted (the blind-feedback rule), and raw scorecards are never sent anywhere.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getApplication, getCompanyName, listApplications, type ApplicationDoc } from './recruitmentData.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { fetchResumeFile, readResume } from './aiScoring.js';
import { aiJson, aiUsage, type Part } from './openaiHelper.js';
import { loadDashboard } from './analyticsApi.js';
import { MANAGE_PERMS, extractResumeFacts, getItem, getRequisition, listItems, newId, putItem, requisitionForApplication, scoreFor, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import { summarise, type Scorecard } from '../../shared/interviewEngine.js';
import { requisitionMaxCtcLpa } from '../../shared/hiringBudget.js';
import { VERDICT_LABEL, analyseHistory, buildInsights, cleanExtraction, findDuplicates, recommend, type Extraction } from '../../shared/resumeAi.js';

type Result = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isHr = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
const canSeeDash = (ctx: AuthContext) => ctx.isCompanyAdmin || ['req.founder_decide', 'hrbp.view', 'hrbp.manage'].some((p) => ctx.perms.includes(p));
const todayYm = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const skillList = (s: unknown) => String(s || '').split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);

// ------------------------------------------------------------------ status

async function status(cid: string): Promise<Result> {
  return ok({ usage: await aiUsage(cid) });
}

// ------------------------------------------------------------------ resume reading

const EXTRACT_SYSTEM = [
  'You read resumes for an HR team. Use ONLY what the resume says. Never guess or fill gaps.',
  'Ignore and do not output name, contact details, age, gender, nationality, marital status, address or photo.',
  'Return JSON only in exactly this shape:',
  '{"skills":["..."],"yearsExperience":0,"education":[{"degree":"","institute":"","year":""}],"certifications":["..."],"history":[{"company":"","role":"","from":"YYYY-MM","to":"YYYY-MM or present"}],"projects":["one line each, relevant ones only"],"summary":"two sentences about the work experience"}',
  'history: every job with start and end month. If a month is unknown, use your best reading of the year as YYYY-01 for a start and YYYY-12 for an end, and skip the job if there is no year at all.',
  'yearsExperience: total professional experience in years, a number, or null if it cannot be worked out.',
].join('\n');

async function aiResume(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  if (!a.resumeUrl) return fail(400, 'This candidate has no resume link.');
  const req = await requisitionForApplication(cid, a);
  const required = skillList(req?.keySkills);
  const read = await readResume(a.resumeUrl);
  const resumes = await listItems(cid, 'resume');
  const priorResume = resumes.find((r) => r.applicationId === a.id);

  let parts: string | Part[];
  let source: 'text' | 'vision' = 'text';
  let cacheKey = '';
  if (read.text) {
    parts = `Required skills for the role (for your reference only): ${required.join(', ') || 'none listed'}\n\nRESUME:\n${read.text}`;
    cacheKey = `t|${read.text.slice(0, 6000)}`;
  } else {
    // No text: a scanned PDF or a photo. Let the vision model read it.
    const file = await fetchResumeFile(a.resumeUrl);
    if (!file.buf) return fail(422, read.error || file.error || 'The resume could not be read.');
    source = 'vision';
    const b64 = file.buf.toString('base64');
    const lead: Part = { type: 'text', text: `Read this resume.\nRequired skills for the role (for your reference only): ${required.join(', ') || 'none listed'}` };
    parts = file.mime === 'application/pdf'
      ? [lead, { type: 'file', file: { filename: 'resume.pdf', file_data: `data:application/pdf;base64,${b64}` } }]
      : [lead, { type: 'image_url', image_url: { url: `data:${file.mime};base64,${b64}` } }];
    cacheKey = `v|${file.buf.length}|${b64.slice(0, 200)}|${b64.slice(-200)}`;
  }

  const res = await aiJson({ cid, feature: 'resume', system: EXTRACT_SYSTEM, user: parts, cacheKey: b.force ? undefined : cacheKey, maxTokens: 1400 });
  if (res.off) {
    if (!read.text) return fail(422, 'This resume has no readable text (it looks scanned). Reading it needs AI: ask an admin to set OPENAI_API_KEY.');
    return ok({ aiOff: true, note: 'AI is off, so only the rule-based facts were read. Set OPENAI_API_KEY to read employment history, gaps and certifications.', facts: extractResumeFacts(read.text, required) });
  }
  if (!res.data) return fail(502, res.error || 'The AI could not read this resume.');

  const extraction = cleanExtraction(res.data);
  const analysis = analyseHistory(extraction.history, todayYm());
  const savedAt = nowIso();
  const prior = (await listItems(cid, 'aiResume')).find((r) => r.applicationId === a.id);
  await putItem({ id: prior?.id || newId(), companyId: cid, kind: 'aiResume', applicationId: a.id, extraction, analysis, source, at: savedAt, by: await whoIs(ctx) });

  // Feed the weighted score: a scanned resume has no text, so give scoring the text the AI read.
  const text = read.text || [extraction.summary, `Skills: ${extraction.skills.join(', ')}`, ...extraction.history.map((j) => `${j.role} at ${j.company} ${j.from} to ${j.to}`), ...extraction.projects, ...extraction.certifications].join('\n');
  await putItem({ id: priorResume?.id || newId(), companyId: cid, kind: 'resume', applicationId: a.id, text: text.slice(0, 20000), facts: extractResumeFacts(text, required), extractedAt: savedAt, via: source });
  const upd: Record<string, any> = {};
  if (a.totalExperienceYears === undefined && extraction.yearsExperience !== null) upd.totalExperienceYears = extraction.yearsExperience;
  if (a.employersCount === undefined && analysis.jobs > 0) upd.employersCount = analysis.jobs;
  if (Object.keys(upd).length) await db().collection('applications').doc(a.id).update({ ...upd, updatedAt: savedAt });
  return ok({ extraction, analysis, source, cached: !!res.cached, appliedToScore: Object.keys(upd) });
}

// ------------------------------------------------------------------ duplicates

const dupCard = (a: ApplicationDoc) => ({ id: a.id, name: a.name, email: a.email, mobile: a.mobile, designation: a.designation, status: a.status, source: a.source, createdAt: a.createdAt });

async function dupScan(cid: string): Promise<Result> {
  const apps = await listApplications(cid);
  const groups = findDuplicates(apps.map((a) => ({ id: a.id, name: a.name, email: a.email, mobile: a.mobile, resumeUrl: a.resumeUrl, designation: a.designation, createdAt: a.createdAt })));
  const by = new Map(apps.map((a) => [a.id, a]));
  return ok({ groups: groups.map((g) => ({ ...g, candidates: g.ids.map((id) => dupCard(by.get(id)!)).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt))) })), scanned: apps.length });
}

/** Keeps one record, moves everything attached to the others onto it, then removes the others (a copy is kept in the merge log). */
async function dupMerge(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  if (b.confirm !== true) return fail(400, 'Confirm the merge. The other records are removed (a copy is kept in the merge log).');
  const keep = await getApplication(cid, str(b.keepId, 100));
  if (!keep) return fail(404, 'The record to keep was not found.');
  const ids = (Array.isArray(b.mergeIds) ? b.mergeIds : []).map((x: unknown) => str(x, 100)).filter((x: string) => x && x !== keep.id);
  if (!ids.length) return fail(400, 'Choose the duplicate records to merge into it.');
  const dups: ApplicationDoc[] = [];
  for (const id of ids) {
    const d = await getApplication(cid, id);
    if (!d) return fail(404, 'One of the duplicate records was not found.');
    dups.push(d);
  }
  // Fill what the kept record is missing from the duplicates (oldest first), never overwrite what it has.
  const fill: Record<string, any> = {};
  for (const d of dups.sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)))) {
    for (const k of ['mobile', 'city', 'resumeUrl', 'portfolioUrl', 'qualification', 'currentCtcLpa', 'expectedCtcLpa', 'totalExperienceYears', 'employersCount', 'noticePeriod', 'experience'] as const) {
      const have = (keep as any)[k];
      const there = (d as any)[k];
      if ((have === undefined || have === '' || have === null) && there !== undefined && there !== '' && there !== null && fill[k] === undefined) fill[k] = there;
    }
  }
  let moved = 0;
  for (const kind of ['screening', 'assessment', 'interview', 'offer', 'resume', 'aiResume', 'rating', 'referral']) {
    for (const it of (await listItems(cid, kind)).filter((x) => ids.includes(x.applicationId))) {
      // One screening / resume / rating per candidate: keep the kept record's own if it has one.
      const clash = ['screening', 'resume', 'aiResume', 'rating', 'referral'].includes(kind) && (await listItems(cid, kind)).some((x) => x.applicationId === keep.id);
      if (clash) await db().collection('hiringItems').doc(it.id).delete();
      else { await putItem({ ...it, applicationId: keep.id, movedFrom: it.applicationId }); moved++; }
    }
  }
  if (Object.keys(fill).length) await db().collection('applications').doc(keep.id).update({ ...fill, updatedAt: nowIso() });
  await putItem({ id: newId(), companyId: cid, kind: 'dupMerge', keptId: keep.id, removed: dups.map((d) => ({ ...d })), movedItems: moved, by: await whoIs(ctx), at: nowIso() });
  for (const d of dups) await db().collection('applications').doc(d.id).delete();
  return ok({ kept: keep.id, removed: ids.length, movedItems: moved, filled: Object.keys(fill) });
}

// ------------------------------------------------------------------ facts about a candidate (shared by compare / recommend)

async function factsFor(cid: string, a: ApplicationDoc) {
  const [sc, screenings, assessments, interviews, aiRes] = await Promise.all([scoreFor(cid, a), listItems(cid, 'screening'), listItems(cid, 'assessment'), listItems(cid, 'interview'), listItems(cid, 'aiResume')]);
  const req = sc.requisition ? await getRequisition(cid, sc.requisition.id) : null;
  // Only interviews where every panel member has submitted count, so nobody is influenced by partial feedback.
  const cards: Scorecard[] = [];
  let pending = 0;
  for (const i of interviews.filter((x) => x.applicationId === a.id && ['SCHEDULED', 'COMPLETED'].includes(x.status))) {
    const c: Scorecard[] = i.scorecards || [];
    const panel: any[] = i.panel || [];
    if (panel.length && panel.every((p) => c.some((s) => s.interviewerId === p.uid))) cards.push(...c);
    else pending++;
  }
  const interview = cards.length ? summarise(cards) : null;
  const ai = aiRes.find((r) => r.applicationId === a.id);
  return {
    app: a, score: sc.score.normalised as number | null, years: sc.years as number | null, screening: String(screenings.find((s) => s.applicationId === a.id)?.outcome || ''),
    assessments: assessments.filter((x) => x.applicationId === a.id).map((x) => ({ result: x.result as string | undefined })), interview, interviewsPending: pending,
    expectedCtcLpa: a.expectedCtcLpa ?? null, bandMaxLpa: req ? requisitionMaxCtcLpa({ ctcMaxLpa: req.ctcMaxLpa, budgetRange: req.budgetRange }) : null,
    stability: ai?.analysis?.stabilityScore ?? null, gaps: (ai?.analysis?.gaps || []).length as number, certifications: (ai?.extraction?.certifications || []).length as number,
  };
}
type Facts = Awaited<ReturnType<typeof factsFor>>;
const rec = (f: Facts) => recommend({ score: f.score, interview: f.interview ? { average: f.interview.average, recommendation: f.interview.recommendation } : null, screening: f.screening, assessments: f.assessments, expectedCtcLpa: f.expectedCtcLpa, bandMaxLpa: f.bandMaxLpa });

const anon = (f: Facts, label: string) => ({
  candidate: label, weightedScore: f.score, yearsExperience: f.years, hrScreening: f.screening || 'not done', assessments: f.assessments.map((x) => x.result || 'pending'),
  interview: f.interview ? { average: f.interview.average, panelRecommendation: f.interview.recommendation } : 'not complete', employmentStability: f.stability, employmentGaps: f.gaps, certifications: f.certifications,
  expectedCtcVsBudget: f.expectedCtcLpa !== null && f.bandMaxLpa !== null ? (f.expectedCtcLpa > f.bandMaxLpa ? 'above budget' : 'within budget') : 'unknown',
});

const FAIR_RULES = 'Use only the facts given. Do not infer or mention name, gender, age, nationality, religion, family, health or appearance. Do not invent facts. If information is missing, say so. Return JSON only.';

// ------------------------------------------------------------------ compare

async function aiCompare(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const ids: string[] = [...new Set<string>((Array.isArray(b.applicationIds) ? b.applicationIds : []).map((x: unknown) => str(x, 100)).filter(Boolean))];
  if (ids.length < 2 || ids.length > 4) return fail(400, 'Choose 2 to 4 candidates to compare.');
  const apps: ApplicationDoc[] = [];
  for (const id of ids) { const a = await getApplication(cid, id); if (!a) return fail(404, 'A candidate was not found.'); apps.push(a); }
  const facts = await Promise.all(apps.map((a) => factsFor(cid, a)));
  const rows = facts.map((f) => ({ applicationId: f.app.id, name: f.app.name, designation: f.app.designation, status: f.app.status, ...anon(f, ''), candidate: undefined, recommendation: rec(f), interviewsPending: f.interviewsPending }))
    .sort((x, y) => y.recommendation.points - x.recommendation.points || (y.weightedScore ?? -1) - (x.weightedScore ?? -1));
  const labels = new Map(rows.map((r, i) => [r.applicationId, `Candidate ${String.fromCharCode(65 + i)}`]));
  let narrative = `${rows[0].name} ranks first on the facts available (${VERDICT_LABEL[rows[0].recommendation.verdict].toLowerCase()}, ${rows[0].recommendation.points} points).`;
  let generatedBy: 'AI' | 'RULES' = 'RULES';
  let note = '';
  const ai = await aiJson({
    cid, feature: 'compare', maxTokens: 700, cacheKey: JSON.stringify(rows.map((r) => [r.applicationId, r.weightedScore, r.recommendation.points, r.interview])),
    system: `You help HR compare candidates for one role. Write 3 to 5 plain sentences: who looks strongest and why, where the others are stronger, and what is still unknown. ${FAIR_RULES} Shape: {"narrative":"..."}`,
    user: JSON.stringify(rows.map((r) => ({ ...anon(facts.find((f) => f.app.id === r.applicationId)!, labels.get(r.applicationId)!), points: r.recommendation.points, reasons: r.recommendation.reasons }))),
  });
  if (ai.data?.narrative) {
    narrative = String(ai.data.narrative).slice(0, 1500);
    generatedBy = 'AI';
    // The model sees "Candidate A..D"; put the names back for HR.
    for (const [id, label] of labels) narrative = narrative.split(label).join(rows.find((r) => r.applicationId === id)!.name);
  } else if (ai.error) note = ai.error;
  else if (ai.off) note = 'AI is off, so this comparison is rule-based.';
  return ok({ rows, narrative, generatedBy, note });
}

// ------------------------------------------------------------------ recommend

async function aiRecommend(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const f = await factsFor(cid, a);
  const r = rec(f);
  let narrative = `${VERDICT_LABEL[r.verdict]}. ${r.reasons.join(' ')}${r.missing.length ? ` Still missing: ${r.missing.join('; ')}.` : ''}`;
  let generatedBy: 'AI' | 'RULES' = 'RULES';
  const ai = await aiJson({
    cid, feature: 'recommend', maxTokens: 500, cacheKey: JSON.stringify([a.id, r.points, r.reasons, r.missing]),
    system: `You write a short hiring recommendation note for HR (3 to 4 sentences) from the verdict and reasons given. Do not change the verdict. ${FAIR_RULES} Shape: {"narrative":"..."}`,
    user: JSON.stringify({ verdict: VERDICT_LABEL[r.verdict], reasons: r.reasons, stillMissing: r.missing, facts: anon(f, 'The candidate') }),
  });
  if (ai.data?.narrative) { narrative = String(ai.data.narrative).slice(0, 1200); generatedBy = 'AI'; }
  return ok({ verdict: r.verdict, verdictLabel: VERDICT_LABEL[r.verdict], points: r.points, reasons: r.reasons, missing: r.missing, narrative, generatedBy, note: ai.off ? 'AI is off, so this note is rule-based.' : ai.error || '' });
}

// ------------------------------------------------------------------ follow-up emails

export const FOLLOWUP_PURPOSES = ['next_round', 'reject', 'hold', 'reference', 'offer_call'] as const;
type Purpose = (typeof FOLLOWUP_PURPOSES)[number];

export function followupTemplate(p: Purpose, first: string, role: string, company: string): { subject: string; body: string } {
  const hi = `Hello ${first},\n\n`;
  const bye = `\n\nBest regards\nHR Team, ${company}`;
  switch (p) {
    case 'next_round': return { subject: `Next steps for your ${role} application`, body: `${hi}Thank you for your time so far. We would like to move you to the next stage for the ${role} role. We will share the date and joining details shortly. Please reply with your availability for the coming week.${bye}` };
    case 'reject': return { subject: `Your ${role} application at ${company}`, body: `${hi}Thank you for the time you invested in speaking with us about the ${role} role. After careful consideration we have decided not to move forward with your application at this time. We appreciate your interest and wish you every success.${bye}` };
    case 'hold': return { subject: `Update on your ${role} application`, body: `${hi}Thank you for your patience. We are still completing our review for the ${role} role and do not have a final decision yet. We will get back to you as soon as we do.${bye}` };
    case 'reference': return { subject: `References for your ${role} application`, body: `${hi}We are pleased with how your application is progressing. Please share the names and contact details of two professional references who can speak about your recent work.${bye}` };
    default: return { subject: `Let us talk about your ${role} offer`, body: `${hi}We would like to discuss the offer for the ${role} role with you. Please let us know a time in the next two days that suits you for a short call.${bye}` };
  }
}

async function aiFollowup(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const purpose = str(b.purpose, 20) as Purpose;
  if (!FOLLOWUP_PURPOSES.includes(purpose)) return fail(400, 'Choose what the email is for.');
  const company = await getCompanyName(cid);
  const first = (a.name || 'there').split(/\s+/)[0];
  const base = followupTemplate(purpose, first, a.designation, company);
  const ai = await aiJson({
    cid, feature: 'followup', maxTokens: 500, cacheKey: JSON.stringify([purpose, first, a.designation, company, str(b.note, 300)]),
    system: `You polish short, warm, professional emails from an HR team to a job candidate. Keep the same meaning and every commitment of the draft, under 130 words, plain text, no placeholders. Never state reasons for a rejection beyond what the draft says. Return JSON only: {"subject":"...","body":"..."}`,
    user: JSON.stringify({ draft: base, extraNoteFromHr: str(b.note, 300) }),
  });
  const ok2 = ai.data?.subject && ai.data?.body;
  return ok({ subject: ok2 ? str(ai.data.subject, 150) : base.subject, body: ok2 ? String(ai.data.body).slice(0, 2500) : base.body, generatedBy: ok2 ? 'AI' : 'TEMPLATE', to: a.email, note: ai.off ? 'AI is off, so this is the standard wording.' : ai.error || '' });
}

async function aiFollowupSend(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  if (!EMAIL_RE.test(a.email || '')) return fail(400, 'This candidate has no valid email address.');
  const subject = str(b.subject, 150);
  const body = typeof b.body === 'string' ? b.body.trim().slice(0, 4000) : '';
  if (!subject || body.length < 20) return fail(400, 'Write a subject and a message.');
  const company = await getCompanyName(cid);
  let sent = false;
  try { sent = !!(await dispatchLiveEmail({ to: a.email, recipientName: a.name, subject, body, fromName: company })).success; } catch { sent = false; }
  await putItem({ id: newId(), companyId: cid, kind: 'followup', applicationId: a.id, subject, sent, by: await whoIs(ctx), at: nowIso() });
  return sent ? ok({ sent: true }) : fail(502, 'The email could not be sent. Check the email settings.');
}

// ------------------------------------------------------------------ dashboard insights

async function aiInsights(cid: string): Promise<Result> {
  const d = await loadDashboard(cid);
  const insights = buildInsights(d);
  let narrative = '';
  const ai = await aiJson({
    cid, feature: 'insights', maxTokens: 500, cacheKey: JSON.stringify(d),
    system: 'You write a 3 to 4 sentence plain-language summary of hiring numbers for a founder: what is going well, what needs attention, and one suggested action. Use only the numbers given and do not invent any. Return JSON only: {"narrative":"..."}',
    user: JSON.stringify({ numbers: d, ruleInsights: insights.map((i) => i.text) }),
  });
  if (ai.data?.narrative) narrative = String(ai.data.narrative).slice(0, 1200);
  return ok({ insights, narrative, generatedBy: narrative ? 'AI' : 'RULES', note: ai.off ? 'AI is off, so only the rule-based insights are shown.' : ai.error || '' });
}

// ------------------------------------------------------------------ routing

const ACTIONS: Record<string, { method: 'GET' | 'POST'; who: 'hr' | 'dash' }> = {
  'ai-status': { method: 'GET', who: 'hr' }, 'ai-resume': { method: 'POST', who: 'hr' }, 'dup-scan': { method: 'GET', who: 'hr' }, 'dup-merge': { method: 'POST', who: 'hr' },
  'ai-compare': { method: 'POST', who: 'hr' }, 'ai-recommend': { method: 'POST', who: 'hr' }, 'ai-followup': { method: 'POST', who: 'hr' }, 'ai-followup-send': { method: 'POST', who: 'hr' },
  'ai-insights': { method: 'GET', who: 'dash' },
};

export async function routeAiHiring(r: PipeRequest): Promise<Result | null> {
  const spec = ACTIONS[r.action];
  if (!spec) return null;
  try {
    if (r.method !== spec.method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (spec.who === 'hr' && !isHr(ctx)) return fail(403, 'You do not have permission to do this.');
    if (spec.who === 'dash' && !canSeeDash(ctx)) return fail(403, 'You do not have permission to do this.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'ai-status': return await status(ctx.companyId);
      case 'ai-resume': return await aiResume(ctx, b);
      case 'dup-scan': return await dupScan(ctx.companyId);
      case 'dup-merge': return await dupMerge(ctx, b);
      case 'ai-compare': return await aiCompare(ctx, b);
      case 'ai-recommend': return await aiRecommend(ctx, b);
      case 'ai-followup': return await aiFollowup(ctx, b);
      case 'ai-followup-send': return await aiFollowupSend(ctx, b);
      default: return await aiInsights(ctx.companyId);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[AiHiring] error:', err);
    return fail(500, err?.message || 'AI request failed.');
  }
}

export type { Extraction };
export { getItem };
