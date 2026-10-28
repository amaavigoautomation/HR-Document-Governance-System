/**
 * Free resume scoring: matches each requirement of the job description against the resume's text.
 *
 * No AI call and no tokens. A requirement counts as MET when most of its meaningful words appear in the resume,
 * PARTIAL when some do, and NOT_EVIDENCED otherwise. The score itself is computed by applyEvidence() in
 * aiScoring.ts with the same fixed weights the AI mode uses, so the two modes are comparable.
 *
 * This is a keyword match, not an understanding of the resume: the UI labels it "Resume match" and offers
 * "Evaluate with AI" for a deeper reading.
 */
import { applyEvidence, cleanJd, readResume, type Evidence, type ScorableCandidate } from './aiScoring.js';

type Status = 'MET' | 'PARTIAL' | 'NOT_EVIDENCED';

const STOP = new Set(
  (
    'a an and the or of to in on for with by at from as is are be been being this that these those it its into over under ' +
    'their our your you we they will can may must should would could able ability abilities strong good great excellent ' +
    'knowledge experience experienced understanding proficiency proficient skills skill work working team teams years year ' +
    'plus required preferred relevant responsible responsibility responsibilities including such using use used etc well ' +
    'across within also have has had not any all more most other own new high higher level basic advanced'
  ).split(/\s+/)
);

const SHORT_OK = new Set(['ai', 'ml', 'hr', 'qa', 'ui', 'ux', 'bi', 'it', 'pr']);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && (w.length >= 3 || SHORT_OK.has(w)))
    .map(stem);
}

function normalized(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()} `;
}

function snippet(resume: string, matched: string[]): string {
  const parts = resume.split(/[\n.;•]+/).map((p) => p.trim()).filter(Boolean);
  const hit = parts.find((p) => {
    const t = new Set(tokens(p));
    return matched.some((m) => t.has(m));
  });
  return (hit || '').replace(/\s+/g, ' ').slice(0, 140);
}

function judge(requirement: string, resume: string, resumeTokens: Set<string>, resumeNorm: string): { status: Status; evidence: string } {
  const req = Array.from(new Set(tokens(requirement))).slice(0, 8);
  if (req.length === 0) return { status: 'NOT_EVIDENCED', evidence: '' };

  const phrase = normalized(requirement).trim();
  const matched = req.filter((t) => resumeTokens.has(t));
  const ratio = matched.length / req.length;

  if ((phrase.length >= 6 && resumeNorm.includes(` ${phrase} `)) || (matched.length > 0 && ratio >= 0.6)) {
    return { status: 'MET', evidence: snippet(resume, matched) };
  }
  if (matched.length > 0 && ratio >= 0.2) {
    return { status: 'PARTIAL', evidence: snippet(resume, matched) };
  }
  return { status: 'NOT_EVIDENCED', evidence: '' };
}

const METRICS = /(\d+(\.\d+)?\s?%|\b\d+x\b|₹\s?\d|\$\s?\d|\b(roas|cpl|ctr|roi|kpi|revenue|conversion rate|quota|target achieved)\b)/i;
const PORTFOLIO = /(portfolio|case stud|behance|dribbble|github\.com|showreel)/i;

export function keywordEvidence(jd: { requiredSkills: string[]; coreResponsibilities: string[] }, resume: string): Evidence {
  const resumeTokens = new Set(tokens(resume));
  const resumeNorm = normalized(resume);

  const skills = jd.requiredSkills.map((s) => judge(s, resume, resumeTokens, resumeNorm));
  const responsibilities = jd.coreResponsibilities.map((r) => judge(r, resume, resumeTokens, resumeNorm));

  const strengths = jd.requiredSkills
    .filter((_, i) => skills[i].status === 'MET')
    .slice(0, 4)
    .map((s) => `Resume mentions: ${s}`);
  const gaps = jd.requiredSkills
    .filter((_, i) => skills[i].status === 'NOT_EVIDENCED')
    .slice(0, 4)
    .map((s) => `No mention of: ${s}`);

  return {
    skills,
    responsibilities,
    strengths,
    gaps,
    hasMetrics: METRICS.test(resume),
    hasPortfolio: PORTFOLIO.test(resume),
  };
}

const num = (name: string, fallback: number) => {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export interface KeywordPassSummary {
  scored: number;
  pending: number;
  /** Resumes that could not be read, and why (the most common reason first). */
  failed: number;
  failureNote?: string;
}

/**
 * Scores every candidate that has no score yet by reading their resume. Reads a few resumes at a time and stops
 * starting new ones when the time budget is used, so a slow resume host can never time the request out; the rest
 * are picked up on the next refresh (resume text is kept in memory, so earlier ones are not downloaded again).
 */
export async function applyKeywordScoring<C extends ScorableCandidate>(args: {
  jd: { requiredSkills: string[]; coreResponsibilities: string[] };
  results: C[];
  budgetMs?: number;
}): Promise<{ results: C[]; summary: KeywordPassSummary }> {
  const jd = cleanJd(args.jd);
  const results = [...args.results];
  const summary: KeywordPassSummary = { scored: 0, pending: 0, failed: 0 };
  const reasons = new Map<string, number>();
  if (jd.requiredSkills.length === 0 && jd.coreResponsibilities.length === 0) return { results, summary };

  const maxCandidates = num('AI_SCORING_MAX_CANDIDATES', 30);
  const deadline = Date.now() + (args.budgetMs ?? num('KEYWORD_PASS_BUDGET_MS', 7000));
  const queue: number[] = [];

  results.forEach((cand, idx) => {
    if (cand.scored === true) return;
    if (!cand.resumeUrl) {
      cand.aiNote = 'No resume link, so there is nothing to score from.';
      return;
    }
    if (idx >= maxCandidates) {
      cand.aiNote = `Not scored: only the first ${maxCandidates} candidates are read per position.`;
      return;
    }
    queue.push(idx);
  });

  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const idx = queue[next++];
      const cand = results[idx];
      if (Date.now() > deadline) {
        cand.aiNote = 'Resume not read yet. Refresh to continue.';
        summary.pending++;
        continue;
      }
      const resume = await readResume(cand.resumeUrl as string);
      if (!resume.text) {
        const why = resume.error || 'Resume could not be read.';
        cand.aiNote = why;
        cand.keyTakeaway = `Not scored: ${why}`;
        summary.failed++;
        reasons.set(why, (reasons.get(why) || 0) + 1);
        continue;
      }
      results[idx] = applyEvidence(cand, jd, keywordEvidence(jd, resume.text), 'KEYWORDS');
      summary.scored++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) summary.failureNote = top[0];
  return { results, summary };
}
