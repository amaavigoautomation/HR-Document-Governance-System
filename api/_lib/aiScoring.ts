/**
 * AI-assisted candidate scoring (resume evidence).
 *
 * Token-cost design:
 *  - The resume is read with plain code (PDF / DOCX text extraction): no tokens.
 *  - ONE small OpenAI call per candidate returns structured evidence only (met / partial /
 *    not evidenced + a quote per JD requirement). The score itself is computed by our code with
 *    fixed weights, so it is consistent and explainable.
 *  - Results are cached (Firestore + in-memory) by resume URL + JD + model, so a candidate is
 *    only ever sent to the model again if the resume or the JD changes.
 *  - Nothing runs unless HR clicks "Evaluate with AI" (evaluate=true), and each request processes at
 *    most AI_SCORING_BATCH new candidates (default 4) so serverless time limits are never hit.
 *  - Emails and phone numbers are removed from the resume text before it is sent.
 *
 * Env: OPENAI_API_KEY, OPENAI_SCORING_MODEL (or OPENAI_MODEL, default gpt-4o-mini), OPENAI_BASE_URL,
 *      AI_SCORING_BATCH, AI_SCORING_MAX_CANDIDATES (default 30), AI_SCORING_RESUME_CHARS (default 6000),
 *      RESUME_ALLOWED_HOSTS (comma list, default "amaavigo.com").
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { adminDb } from './firebaseAdmin.js';
import { fetchPublic } from './safeFetch.js';

type Status = 'MET' | 'PARTIAL' | 'NOT_EVIDENCED';

export interface ScorableCandidate {
  id: string;
  resumeUrl: string | null;
  experienceNumeric: number | null;
  experienceVsJD: { status: 'EXCEEDS' | 'MEETS' | 'BELOW' | 'NOT_EVIDENCED'; label: string };
  skillsAlignment: { skill: string; status: Status; evidence: string }[];
  responsibilitiesAlignment: { responsibility: string; status: Status; evidence: string }[];
  strengths: string[];
  gaps: string[];
  missingOrNotEvidenced: string[];
  alignmentScore: number;
  scored?: boolean;
  overallAlignment: 'Strong Evidence' | 'Moderate Evidence' | 'Limited Evidence' | 'Not Evidenced';
  keyTakeaway: string;
  interviewChecklist: string[];
  noticePeriod: string;
  scoringMode?: 'AI' | 'KEYWORDS' | 'RULES';
  aiNote?: string;
}

import type { AiScoringSummary } from '../../shared/evaluationTypes.js';
export type { AiScoringSummary };

export interface Evidence {
  skills: { status: Status; evidence: string }[];
  responsibilities: { status: Status; evidence: string }[];
  strengths: string[];
  gaps: string[];
  hasMetrics: boolean;
  hasPortfolio: boolean;
}

interface CacheEntry {
  ok: boolean;
  error?: string;
  evidence?: Evidence;
  createdAt: string;
}

const NEGATIVE_TTL_MS = 6 * 3600 * 1000;
const memoryCache = new Map<string, CacheEntry>();

const num = (name: string, fallback: number) => {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

function apiKey(): string {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return !k || k === 'MY_OPENAI_API_KEY' ? '' : k;
}

const modelName = () => (process.env.OPENAI_SCORING_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

export function isAiScoringEnabled(): boolean {
  return !!apiKey();
}

// ------------------------------------------------------------------ resume reading (no tokens)

function allowedHosts(): string[] {
  return (process.env.RESUME_ALLOWED_HOSTS || 'amaavigo.com')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  return (u.protocol === 'https:' || u.protocol === 'http:') && allowedHosts().some((a) => h === a || h.endsWith(`.${a}`));
}

async function pdfText(buf: Buffer): Promise<string> {
  // @ts-ignore - legacy build has no bundled types
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages = Math.min(pdf.numPages, 6);
  const out: string[] = [];
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(' '));
  }
  try {
    await task.destroy();
  } catch {
    /* ignore */
  }
  return out.join('\n');
}

async function docxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('Not a Word document');
  const xml = await file.async('string');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/(\+?\d[\d\s\-().]{8,}\d)/g, '[phone]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type ResumeRead = { text?: string; error?: string };
const RESUME_TEXT_TTL_MS = 30 * 60 * 1000;
const RESUME_ERROR_TTL_MS = 10 * 60 * 1000;
const RESUME_CACHE_MAX = 300;
const resumeTextCache = new Map<string, { at: number; value: ResumeRead }>();

/** Reads a resume's text once per instance for a while, so the keyword pass and the AI pass never download it twice. */
export async function readResume(url: string): Promise<ResumeRead> {
  const hit = resumeTextCache.get(url);
  if (hit && Date.now() - hit.at < (hit.value.text ? RESUME_TEXT_TTL_MS : RESUME_ERROR_TTL_MS)) return hit.value;
  const value = await readResumeUncached(url);
  if (resumeTextCache.size >= RESUME_CACHE_MAX) {
    const oldest = resumeTextCache.keys().next().value;
    if (oldest !== undefined) resumeTextCache.delete(oldest);
  }
  resumeTextCache.set(url, { at: Date.now(), value });
  return value;
}

async function readResumeUncached(url: string): Promise<ResumeRead> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { error: 'Resume link is not a valid URL.' };
  }
  // Hosts in RESUME_ALLOWED_HOSTS are trusted (the Amaavigo website). Any other link, such as one sent by a
  // company's own site through the application webhook, is fetched only if it is a public https address.
  const trusted = hostAllowed(u);
  if (!trusted && u.protocol !== 'https:') return { error: 'Resume links must use https.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = trusted
      ? await fetch(u, { signal: controller.signal, headers: { Accept: '*/*' } })
      : await fetchPublic(u.toString(), { signal: controller.signal, headers: { Accept: '*/*' } });
    if (!res.ok) return { error: `Resume download failed (HTTP ${res.status}).` };
    if (trusted && !hostAllowed(new URL(res.url || u.toString()))) return { error: 'Resume redirected to a disallowed host.' };
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > 6 * 1024 * 1024) return { error: 'Resume file is larger than 6 MB.' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return { error: 'Resume file is larger than 6 MB.' };

    let text = '';
    if (buf.slice(0, 4).toString('latin1') === '%PDF') text = await pdfText(buf);
    else if (buf[0] === 0x50 && buf[1] === 0x4b) text = await docxText(buf);
    else return { error: 'Resume is not a PDF or Word file (images are not read).' };

    text = scrub(text);
    if (text.length < 80) return { error: 'No readable text in the resume (it may be a scanned image).' };
    return { text: text.slice(0, num('AI_SCORING_RESUME_CHARS', 6000)) };
  } catch (err: any) {
    return { error: err?.name === 'AbortError' ? 'Resume download timed out.' : `Could not read resume: ${err?.message || err}` };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ OpenAI evidence call

const SYSTEM_PROMPT = [
  'You are a careful resume screening assistant.',
  'Use ONLY the resume text provided. Never guess or assume.',
  'For each numbered requirement, decide: MET (clear hands-on evidence in the resume), PARTIAL (related or indirect evidence) or NOT_EVIDENCED.',
  '"evidence" must be a short exact quote (max 140 characters) copied from the resume; use "" for NOT_EVIDENCED.',
  'Ignore name, gender, age, nationality, address, photo, marital status and the prestige of institutions.',
  'Return JSON only, exactly in this shape:',
  '{"skills":[{"i":0,"status":"MET","evidence":"..."}],"responsibilities":[{"i":0,"status":"PARTIAL","evidence":"..."}],"strengths":["..."],"gaps":["..."],"hasMetrics":false,"hasPortfolio":false}',
  'strengths and gaps: at most 4 short items each, based only on the requirements. hasMetrics: true if the resume shows measurable results (numbers, ROAS, rates). hasPortfolio: true if it links a portfolio, case studies or work samples.',
].join('\n');

function numbered(items: string[]): string {
  return items.length ? items.map((s, i) => `${i}. ${s}`).join('\n') : '(none listed)';
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cleanStatus(v: unknown): Status {
  return v === 'MET' || v === 'PARTIAL' ? v : 'NOT_EVIDENCED';
}

async function callOpenAi(
  jd: { requiredSkills: string[]; coreResponsibilities: string[] },
  resume: string
): Promise<{ evidence?: Evidence; error?: string; usage?: { input: number; output: number } }> {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model: modelName(),
        temperature: 0,
        max_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `REQUIRED SKILLS:\n${numbered(jd.requiredSkills)}\n\nRESPONSIBILITIES:\n${numbered(jd.coreResponsibilities)}\n\nRESUME:\n${resume}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(raw);
    } catch {
      /* handled below */
    }
    if (!res.ok) return { error: `OpenAI error (HTTP ${res.status}): ${data?.error?.message || raw.slice(0, 150)}` };

    let parsed: any;
    try {
      parsed = JSON.parse(String(data?.choices?.[0]?.message?.content || ''));
    } catch {
      return { error: 'The model returned invalid JSON.' };
    }

    const resumeNorm = norm(resume);
    const fix = (arr: any, count: number) => {
      const out: { status: Status; evidence: string }[] = Array.from({ length: count }, () => ({
        status: 'NOT_EVIDENCED' as Status,
        evidence: '',
      }));
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const i = Number(it?.i);
          if (!Number.isInteger(i) || i < 0 || i >= count) continue;
          let status = cleanStatus(it?.status);
          const evidence = String(it?.evidence || '').slice(0, 160);
          // Anti-hallucination: a MET claim must quote text that really is in the resume.
          if (status === 'MET') {
            const q = norm(evidence).slice(0, 30);
            if (!q || !resumeNorm.includes(q)) status = 'PARTIAL';
          }
          out[i] = { status, evidence: status === 'NOT_EVIDENCED' ? '' : evidence };
        }
      }
      return out;
    };
    const list = (v: any) =>
      Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, 4) : [];

    return {
      evidence: {
        skills: fix(parsed.skills, jd.requiredSkills.length),
        responsibilities: fix(parsed.responsibilities, jd.coreResponsibilities.length),
        strengths: list(parsed.strengths),
        gaps: list(parsed.gaps),
        hasMetrics: parsed.hasMetrics === true,
        hasPortfolio: parsed.hasPortfolio === true,
      },
      usage: { input: Number(data?.usage?.prompt_tokens) || 0, output: Number(data?.usage?.completion_tokens) || 0 },
    };
  } catch (err: any) {
    return { error: err?.name === 'AbortError' ? 'OpenAI request timed out.' : `OpenAI request failed: ${err?.message || err}` };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ cache

function cacheKey(companyId: string, candidateId: string, resumeUrl: string, jd: { requiredSkills: string[]; coreResponsibilities: string[] }) {
  const h = createHash('sha256')
    .update(JSON.stringify([resumeUrl, jd.requiredSkills, jd.coreResponsibilities, modelName()]))
    .digest('hex')
    .slice(0, 24);
  return `${companyId}_${candidateId}_${h}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function cacheGet(key: string): Promise<CacheEntry | null> {
  const mem = memoryCache.get(key);
  if (mem) return mem;
  try {
    const snap = await adminDb().collection('candidateEvaluations').doc(key).get();
    if (snap.exists) {
      const entry = snap.data() as CacheEntry;
      memoryCache.set(key, entry);
      return entry;
    }
  } catch (err: any) {
    console.warn('[AI scoring] cache read failed:', err?.message || err);
  }
  return null;
}

async function cacheSet(key: string, entry: CacheEntry, extra: Record<string, unknown> = {}) {
  memoryCache.set(key, entry);
  try {
    await adminDb().collection('candidateEvaluations').doc(key).set({ ...entry, ...extra });
  } catch (err: any) {
    console.warn('[AI scoring] cache write failed (is the rules block published?):', err?.message || err);
  }
}

function usable(e: CacheEntry | null): boolean {
  if (!e) return false;
  if (e.ok) return true;
  return Date.now() - Date.parse(e.createdAt) < NEGATIVE_TTL_MS; // remembered resume problems, no tokens spent
}

// ------------------------------------------------------------------ scoring (our code, fixed weights)

export function applyEvidence<C extends ScorableCandidate>(
  base: C,
  jd: { requiredSkills: string[]; coreResponsibilities: string[] },
  ev: Evidence,
  mode: 'AI' | 'KEYWORDS' = 'AI'
): C {
  const skillsAlignment = jd.requiredSkills.map((skill, i) => ({
    skill,
    status: ev.skills[i].status,
    evidence: ev.skills[i].evidence || 'Not provided / Not evidenced',
  }));
  const responsibilitiesAlignment = jd.coreResponsibilities.map((responsibility, i) => ({
    responsibility,
    status: ev.responsibilities[i].status,
    evidence: ev.responsibilities[i].evidence || 'Not provided / Not evidenced',
  }));

  let score = 0;
  const es = base.experienceVsJD.status;
  if (es === 'EXCEEDS') score += 25;
  else if (es === 'MEETS') score += 22;
  else if (es === 'BELOW' && base.experienceNumeric && base.experienceNumeric > 0) score += 12;

  const met = skillsAlignment.filter((s) => s.status === 'MET').length;
  const partial = skillsAlignment.filter((s) => s.status === 'PARTIAL').length;
  score += Math.round(((met + partial * 0.4) / Math.max(1, skillsAlignment.length)) * 45);

  const metResp = responsibilitiesAlignment.filter((r) => r.status === 'MET').length;
  const partResp = responsibilitiesAlignment.filter((r) => r.status === 'PARTIAL').length;
  score += Math.round(((metResp + partResp * 0.4) / Math.max(1, responsibilitiesAlignment.length)) * 20);

  if (base.resumeUrl) score += 5;
  if (ev.hasMetrics || ev.hasPortfolio) score += 5;
  score = Math.min(98, Math.max(15, score));

  const overallAlignment: C['overallAlignment'] =
    score >= 75 ? 'Strong Evidence' : score >= 55 ? 'Moderate Evidence' : score >= 35 ? 'Limited Evidence' : 'Not Evidenced';

  const strengths = [...ev.strengths];
  if (es === 'EXCEEDS' || es === 'MEETS') strengths.unshift(base.experienceVsJD.label);

  const missing = skillsAlignment.filter((s) => s.status === 'NOT_EVIDENCED').map((s) => `${s.skill}: Not provided / Not evidenced`);
  const partialSkills = skillsAlignment.filter((s) => s.status === 'PARTIAL').map((s) => s.skill);

  const checklist: string[] = [];
  missing.slice(0, 2).forEach((m) => checklist.push(`Verify proof and hands-on depth for: ${m.replace(/: Not provided.*/, '')}`));
  partialSkills.slice(0, 1).forEach((p) => checklist.push(`Probe depth of experience in: ${p}`));
  if (base.noticePeriod && base.noticePeriod !== 'Not provided / Not evidenced') {
    checklist.push(`Confirm availability and notice period commitment (${base.noticePeriod})`);
  }

  return {
    ...base,
    skillsAlignment,
    responsibilitiesAlignment,
    strengths,
    gaps: ev.gaps,
    missingOrNotEvidenced: missing.slice(0, 5),
    alignmentScore: score,
    overallAlignment,
    keyTakeaway: `${met} of ${skillsAlignment.length} required skills ${mode === 'AI' ? 'clearly evidenced' : 'matched'} in the resume, ${partial} partially (${metResp} of ${responsibilitiesAlignment.length} responsibilities ${mode === 'AI' ? 'evidenced' : 'matched'}).${mode === 'KEYWORDS' ? ' Keyword match only; run Evaluate with AI for a deeper reading.' : ''}`,
    interviewChecklist: checklist.slice(0, 4),
    scored: true,
    scoringMode: mode,
  };
}

// ------------------------------------------------------------------ entry point

export async function applyAiScoring<C extends ScorableCandidate>(args: {
  companyId: string;
  jd: { requiredSkills: string[]; coreResponsibilities: string[] };
  results: C[];
  evaluate: boolean;
}): Promise<{ results: C[]; summary: AiScoringSummary }> {
  const { jd, evaluate } = args;
  const summary: AiScoringSummary = {
    enabled: isAiScoringEnabled(),
    model: modelName(),
    totalCandidates: args.results.length,
    aiScored: 0,
    fromCache: 0,
    pending: 0,
    failed: 0,
  };
  const results = args.results.map((r) => ({ ...r, scoringMode: r.scoringMode ?? ('RULES' as const) })) as C[];

  if (!summary.enabled) {
    summary.note = 'AI scoring is off: set OPENAI_API_KEY to enable it. Showing rule-based scores.';
    return { results, summary };
  }

  const maxCandidates = num('AI_SCORING_MAX_CANDIDATES', 30);
  const batch = num('AI_SCORING_BATCH', 4);
  let newThisCall = 0;
  const tokens = { input: 0, output: 0 };
  const failures: string[] = [];
  let stop = false;

  for (let idx = 0; idx < results.length; idx++) {
    const cand = results[idx];
    if (idx >= maxCandidates) {
      cand.aiNote = `Not scored: only the first ${maxCandidates} candidates are scored per position.`;
      continue;
    }
    if (!cand.resumeUrl) {
      cand.aiNote = 'No resume link: rule-based score only.';
      continue;
    }

    const key = cacheKey(args.companyId, cand.id, cand.resumeUrl, jd);
    const cached = await cacheGet(key);

    if (usable(cached)) {
      if (cached!.ok && cached!.evidence) {
        results[idx] = applyEvidence(cand, jd, cached!.evidence);
        summary.aiScored++;
        summary.fromCache++;
      } else {
        cand.aiNote = cached!.error || 'Resume could not be read.';
        summary.failed++;
      }
      continue;
    }

    if (!evaluate || stop || newThisCall >= batch) {
      summary.pending++;
      continue;
    }
    newThisCall++;

    const resume = await readResume(cand.resumeUrl);
    if (!resume.text) {
      const entry: CacheEntry = { ok: false, error: resume.error, createdAt: new Date().toISOString() };
      await cacheSet(key, entry, { candidateId: cand.id, companyId: args.companyId });
      cand.aiNote = resume.error;
      summary.failed++;
      continue;
    }

    const out = await callOpenAi(jd, resume.text);
    if (!out.evidence) {
      // Transient (model/network) problem: not cached, so it can be retried; no further calls this request.
      failures.push(out.error || 'AI call failed.');
      cand.aiNote = out.error;
      summary.pending++;
      stop = true;
      continue;
    }
    tokens.input += out.usage?.input || 0;
    tokens.output += out.usage?.output || 0;
    const entry: CacheEntry = { ok: true, evidence: out.evidence, createdAt: new Date().toISOString() };
    await cacheSet(key, entry, { candidateId: cand.id, companyId: args.companyId, model: modelName(), tokens: out.usage || null });
    results[idx] = applyEvidence(cand, jd, out.evidence);
    summary.aiScored++;
  }

  if (failures.length) summary.note = failures[0];
  if (evaluate) summary.tokens = tokens;
  return { results, summary };
}
