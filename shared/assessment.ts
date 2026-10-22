/**
 * Skill assessment maths (pure TypeScript, shared by the API, the browser and the tests).
 *
 * - Every question belongs to one skill and has a difficulty. Harder questions are worth more.
 * - A skill score is a percentage of the marks available for that skill.
 * - A retest is only comparable with an earlier test when both have the same "shape"
 *   (same number of questions per skill at each difficulty).
 */

export type Difficulty = 'easy' | 'medium' | 'hard';
export type SkillLevel = 'Beginner' | 'Intermediate' | 'Advanced';
export type DifficultyPreset = 'easy' | 'balanced' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const DIFFICULTY_WEIGHT: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };

/** Fewer questions than this per skill gives a noisy percentage; the UI warns about it. */
export const MIN_RELIABLE_QUESTIONS = 10;
export const MAX_QUESTIONS_PER_SKILL = 40;
export const MAX_SKILLS_PER_TEST = 6;

export interface SkillBlueprint {
  skill: string;
  easy: number;
  medium: number;
  hard: number;
}

export interface ScorableQuestion {
  id: string;
  skill: string;
  difficulty: Difficulty;
  correctIndex: number;
}

export interface SkillScore {
  skill: string;
  skillKey: string;
  percent: number; // 0-100, one decimal
  earned: number;
  possible: number;
  correct: number;
  total: number;
  level: SkillLevel;
}

export interface AssessmentResult {
  overall: SkillScore; // skill = 'Overall'
  skills: SkillScore[];
  answered: number;
  total: number;
}

/** Stable identity for a skill name: "Node.js", " node.JS " and "NODE.JS" are the same skill. */
export function skillKey(skill: string): string {
  return String(skill || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 .+#/&-]/g, '')
    .slice(0, 60);
}

export function cleanSkillName(skill: string): string {
  return String(skill || '')
    .replace(/\s+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 60);
}

export function levelFor(percent: number): SkillLevel {
  if (percent >= 75) return 'Advanced';
  if (percent >= 40) return 'Intermediate';
  return 'Beginner';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Splits a question count across difficulties. 'balanced' is roughly 40% easy, 40% medium, 20% hard. */
export function splitCount(count: number, preset: DifficultyPreset = 'balanced'): Pick<SkillBlueprint, 'easy' | 'medium' | 'hard'> {
  const n = Math.max(1, Math.min(MAX_QUESTIONS_PER_SKILL, Math.floor(count)));
  const shares: Record<DifficultyPreset, [number, number, number]> = {
    easy: [0.6, 0.3, 0.1],
    balanced: [0.4, 0.4, 0.2],
    hard: [0.2, 0.4, 0.4],
  };
  const [e, m] = shares[preset];
  const easy = Math.round(n * e);
  const medium = Math.min(n - easy, Math.round(n * m));
  return { easy, medium, hard: n - easy - medium };
}

export function blueprintTotal(b: Pick<SkillBlueprint, 'easy' | 'medium' | 'hard'>): number {
  return b.easy + b.medium + b.hard;
}

export function scoreSkill(skill: string, questions: ScorableQuestion[], answers: Record<string, number | null | undefined>): SkillScore {
  let earned = 0;
  let possible = 0;
  let correct = 0;
  for (const q of questions) {
    const w = DIFFICULTY_WEIGHT[q.difficulty] ?? 1;
    possible += w;
    if (answers[q.id] === q.correctIndex) {
      earned += w;
      correct += 1;
    }
  }
  const percent = possible > 0 ? round1((earned / possible) * 100) : 0;
  return { skill, skillKey: skillKey(skill), percent, earned, possible, correct, total: questions.length, level: levelFor(percent) };
}

/** Unanswered questions count as wrong. Skills keep the order in which they first appear. */
export function scoreAssessment(questions: ScorableQuestion[], answers: Record<string, number | null | undefined>): AssessmentResult {
  const order: string[] = [];
  const bySkill = new Map<string, { name: string; qs: ScorableQuestion[] }>();
  for (const q of questions) {
    const key = skillKey(q.skill);
    if (!bySkill.has(key)) {
      bySkill.set(key, { name: q.skill, qs: [] });
      order.push(key);
    }
    bySkill.get(key)!.qs.push(q);
  }
  const skills = order.map((k) => scoreSkill(bySkill.get(k)!.name, bySkill.get(k)!.qs, answers));
  const overall = scoreSkill('Overall', questions, answers);
  const answered = questions.filter((q) => typeof answers[q.id] === 'number').length;
  return { overall, skills, answered, total: questions.length };
}

export interface SkillComparison {
  skill: string;
  skillKey: string;
  before: number | null;
  after: number | null;
  /** after - before, in percentage points. */
  deltaPoints: number | null;
  /** (after - before) / before, as a percentage. Null when before is 0 or a side is missing. */
  relativePercent: number | null;
  /** True when both tests had the same number of questions at each difficulty for this skill. */
  comparable: boolean;
  note?: string;
}

export interface Comparison {
  skills: SkillComparison[];
  overall: SkillComparison;
}

function sameShape(a?: SkillBlueprint, b?: SkillBlueprint): boolean {
  if (!a || !b) return false;
  return a.easy === b.easy && a.medium === b.medium && a.hard === b.hard;
}

/** Compares a baseline test with a later one, skill by skill. Skills that only appear in one test are listed with a gap. */
export function compareResults(
  before: { result: AssessmentResult; blueprint: SkillBlueprint[] },
  after: { result: AssessmentResult; blueprint: SkillBlueprint[] }
): Comparison {
  const keys: string[] = [];
  const names = new Map<string, string>();
  for (const s of [...before.result.skills, ...after.result.skills]) {
    if (!names.has(s.skillKey)) {
      names.set(s.skillKey, s.skill);
      keys.push(s.skillKey);
    }
  }
  const bp = (list: SkillBlueprint[], k: string) => list.find((b) => skillKey(b.skill) === k);

  const one = (skill: string, key: string, b: number | null, a: number | null, comparable: boolean, note?: string): SkillComparison => {
    const deltaPoints = b !== null && a !== null ? round1(a - b) : null;
    const relativePercent = b !== null && a !== null && b > 0 ? round1(((a - b) / b) * 100) : null;
    return { skill, skillKey: key, before: b, after: a, deltaPoints, relativePercent, comparable, note };
  };

  const skills = keys.map((k) => {
    const b = before.result.skills.find((s) => s.skillKey === k);
    const a = after.result.skills.find((s) => s.skillKey === k);
    const comparable = !!b && !!a && sameShape(bp(before.blueprint, k), bp(after.blueprint, k));
    let note: string | undefined;
    if (!b) note = 'Not tested the first time.';
    else if (!a) note = 'Not tested in the retest.';
    else if (!comparable) note = 'The two tests had a different number of questions or difficulty mix, so treat this change with care.';
    return one(names.get(k)!, k, b ? b.percent : null, a ? a.percent : null, comparable, note);
  });

  const bothSkills = skills.filter((s) => s.before !== null && s.after !== null);
  const overallComparable = bothSkills.length > 0 && bothSkills.every((s) => s.comparable) && skills.length === bothSkills.length;
  const overall = one(
    'Overall',
    'overall',
    before.result.overall.percent,
    after.result.overall.percent,
    overallComparable,
    overallComparable ? undefined : 'The tests did not cover the same skills in the same shape.'
  );
  return { skills, overall };
}
