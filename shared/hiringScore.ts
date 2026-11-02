/**
 * Weighted candidate score out of 100.
 *
 * Six parts with weights a company can change (they always add up to 100 when used). A part that has not been judged yet
 * is "pending": it is left out of the total and shown as pending, never counted as zero, so a candidate is not
 * marked down for something nobody has looked at.
 */
export const SCORE_PARTS = ['skills', 'experience', 'portfolio', 'communication', 'stability', 'salaryFit'] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];

export const SCORE_LABEL: Record<ScorePart, string> = {
  skills: 'Skills',
  experience: 'Experience',
  portfolio: 'Portfolio',
  communication: 'Communication',
  stability: 'Stability',
  salaryFit: 'Salary fit',
};

export type ScoreWeights = Record<ScorePart, number>;

export const DEFAULT_WEIGHTS: ScoreWeights = { skills: 30, experience: 25, portfolio: 15, communication: 10, stability: 10, salaryFit: 10 };

/** Each input is a 0-100 rating for the part, or null/undefined when it is not known yet. */
export type PartRatings = Partial<Record<ScorePart, number | null | undefined>>;

export interface ScoreLine { part: ScorePart; label: string; weight: number; rating: number | null; points: number | null; pending: boolean }
export interface WeightedScore {
  lines: ScoreLine[];
  /** Points earned from the parts judged so far. */
  earned: number;
  /** Total weight of the parts judged so far. */
  judgedWeight: number;
  /** earned out of 100 if everything pending were scored zero: the safe floor. */
  outOf100: number;
  /** earned scaled to the judged weight, so a half-judged candidate can be compared fairly. Null when nothing is judged. */
  normalised: number | null;
  complete: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Fixes a weights object: unknown or bad values fall back to the default, then everything is scaled to add up to 100. */
export function cleanWeights(input: unknown): ScoreWeights {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const raw = {} as ScoreWeights;
  let total = 0;
  for (const p of SCORE_PARTS) {
    const n = Number(src[p]);
    raw[p] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEIGHTS[p];
    total += raw[p];
  }
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as ScoreWeights;
  let used = 0;
  SCORE_PARTS.forEach((p, i) => {
    out[p] = i === SCORE_PARTS.length - 1 ? Math.round((100 - used) * 100) / 100 : Math.round((raw[p] / total) * 10000) / 100;
    used += out[p];
  });
  return out;
}

export function weightsError(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Weights are required.';
  let total = 0;
  for (const p of SCORE_PARTS) {
    const n = Number((input as Record<string, unknown>)[p]);
    if (!Number.isFinite(n) || n < 0 || n > 100) return `${SCORE_LABEL[p]} must be between 0 and 100.`;
    total += n;
  }
  if (Math.abs(total - 100) > 0.01) return `The weights must add up to 100 (they add up to ${Math.round(total * 100) / 100}).`;
  return null;
}

export function weightedScore(ratings: PartRatings, weightsIn: ScoreWeights = DEFAULT_WEIGHTS): WeightedScore {
  const weights = cleanWeights(weightsIn);
  let earned = 0;
  let judgedWeight = 0;
  const lines: ScoreLine[] = SCORE_PARTS.map((part) => {
    const v = ratings[part];
    const known = typeof v === 'number' && Number.isFinite(v);
    const rating = known ? clamp(v as number, 0, 100) : null;
    const points = rating === null ? null : Math.round(((rating * weights[part]) / 100) * 100) / 100;
    if (points !== null) {
      earned += points;
      judgedWeight += weights[part];
    }
    return { part, label: SCORE_LABEL[part], weight: weights[part], rating, points, pending: rating === null };
  });
  earned = Math.round(earned * 100) / 100;
  return {
    lines,
    earned,
    judgedWeight: Math.round(judgedWeight * 100) / 100,
    outOf100: earned,
    normalised: judgedWeight > 0 ? Math.round((earned / judgedWeight) * 10000) / 100 : null,
    complete: lines.every((l) => !l.pending),
  };
}

// ---- turning facts into the 0-100 ratings the parts need

/** Experience against the range the requisition asks for. In range = 100, each missing year costs 20, above the range is not penalised. */
export function experienceRating(years: number | null | undefined, minYears: number, maxYears: number): number | null {
  if (years === null || years === undefined || !Number.isFinite(years)) return null;
  if (years >= minYears) return 100;
  return clamp(Math.round(100 - (minYears - years) * 20), 0, 100);
}

/** Share of the required skills found in the resume text. Null when the requisition lists no skills or there is no resume text. */
export function skillsRating(requiredSkills: string[], resumeText: string): number | null {
  const skills = requiredSkills.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const text = (resumeText || '').toLowerCase();
  if (!skills.length || !text.trim()) return null;
  const hit = skills.filter((s) => text.includes(s)).length;
  return Math.round((hit / skills.length) * 100);
}

/**
 * Job stability from the average stay per employer. Needs total years and number of employers.
 * 3+ years per employer = 100, under 1 year = 40, in between scales. Null when unknown.
 */
export function stabilityRating(totalYears: number | null | undefined, employers: number | null | undefined): number | null {
  if (!totalYears || !employers || totalYears <= 0 || employers <= 0) return null;
  const avg = totalYears / employers;
  if (avg >= 3) return 100;
  if (avg < 1) return 40;
  return Math.round(40 + ((avg - 1) / 2) * 60);
}

/**
 * Salary fit: expected CTC against the top of the band. At or under the band = 100; each 10% above costs 25 points.
 * Null when either side is unknown.
 */
export function salaryFitRating(expectedLpa: number | null | undefined, bandMaxLpa: number | null | undefined): number | null {
  if (!expectedLpa || !bandMaxLpa || expectedLpa <= 0 || bandMaxLpa <= 0) return null;
  if (expectedLpa <= bandMaxLpa) return 100;
  const overPct = ((expectedLpa - bandMaxLpa) / bandMaxLpa) * 100;
  return clamp(Math.round(100 - (overPct / 10) * 25), 0, 100);
}

/** Portfolio: 0 when a link was asked for but nothing is given is NOT assumed; a link present = 60 until a person rates it. */
export function portfolioRating(link: string | null | undefined, humanRating?: number | null): number | null {
  if (typeof humanRating === 'number' && Number.isFinite(humanRating)) return clamp(humanRating, 0, 100);
  return link && link.trim() ? 60 : null;
}
