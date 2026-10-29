/**
 * Moodometer: pure helpers for group results from daily mood check-ins. No browser or Node imports.
 * Mood is voluntary and self-reported. It is never used in ratings, scores or AI drafts.
 * Group results are only shown for groups of at least MOOD_MIN_GROUP different people, so nobody can be picked out.
 */
export const MOOD_ORDER = ['UNHAPPY', 'SAD', 'OK', 'SATISFIED', 'EXCITED'] as const;
export type MoodKey = (typeof MOOD_ORDER)[number];

/** 1 (unhappy) to 5 (excited). */
export const MOOD_SCORE: Record<MoodKey, number> = { UNHAPPY: 1, SAD: 2, OK: 3, SATISFIED: 4, EXCITED: 5 };
export const MOOD_MIN_GROUP = 3;
/** A department is flagged when its average stays at or below this for the whole look-back window. */
export const LOW_MOOD_AVERAGE = 2.5;
export const LOW_MOOD_DAYS = 3;

export interface MoodRow {
  uid: string;
  date: string;
  mood: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const valid = (m: string): m is MoodKey => (MOOD_ORDER as readonly string[]).includes(m);
const blank = (): Record<MoodKey, number> => ({ UNHAPPY: 0, SAD: 0, OK: 0, SATISFIED: 0, EXCITED: 0 });

export interface MoodGroup {
  /** Different people in the group who answered. */
  people: number;
  responses: number;
  hidden: boolean;
  average: number | null;
  counts: Record<MoodKey, number> | null;
}

/** Counts and average for a set of check-ins, or hidden when too few different people answered. */
export function moodGroup(rows: MoodRow[], min = MOOD_MIN_GROUP): MoodGroup {
  const ok = rows.filter((r) => valid(r.mood));
  const people = new Set(ok.map((r) => r.uid)).size;
  if (people < min) return { people, responses: ok.length, hidden: true, average: null, counts: null };
  const counts = blank();
  let sum = 0;
  for (const r of ok) { counts[r.mood as MoodKey]++; sum += MOOD_SCORE[r.mood as MoodKey]; }
  return { people, responses: ok.length, hidden: false, average: ok.length ? r2(sum / ok.length) : null, counts };
}

export interface MoodReport {
  from: string;
  to: string;
  overall: MoodGroup;
  /** Active people who answered at least once in the period, out of everyone active. */
  participation: { responders: number; active: number; percent: number };
  series: { date: string; responses: number; hidden: boolean; average: number | null; counts: Record<MoodKey, number> | null }[];
  departments: (MoodGroup & { department: string })[];
}

const datesBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

export function buildMoodReport(rows: MoodRow[], deptOf: (uid: string) => string, activeCount: number, from: string, to: string, min = MOOD_MIN_GROUP): MoodReport {
  const inRange = rows.filter((r) => r.date >= from && r.date <= to && valid(r.mood));
  const responders = new Set(inRange.map((r) => r.uid)).size;
  const series = datesBetween(from, to).map((date) => {
    const day = inRange.filter((r) => r.date === date);
    const g = moodGroup(day, min);
    return { date, responses: day.length, hidden: g.hidden, average: g.average, counts: g.counts };
  });
  const depts = [...new Set(inRange.map((r) => deptOf(r.uid) || 'No department'))].sort();
  return {
    from, to, overall: moodGroup(inRange, min),
    participation: { responders, active: activeCount, percent: activeCount ? Math.round((responders / activeCount) * 100) : 0 },
    series,
    departments: depts.map((d) => ({ department: d, ...moodGroup(inRange.filter((r) => (deptOf(r.uid) || 'No department') === d), min) })),
  };
}

/** Departments whose average was low on every one of the last `days` days (each day with enough people). Group level only. */
export function lowMoodDepartments(rows: MoodRow[], deptOf: (uid: string) => string, today: string, days = LOW_MOOD_DAYS, threshold = LOW_MOOD_AVERAGE, min = MOOD_MIN_GROUP): { department: string; average: number; people: number }[] {
  const dates = datesBetween(new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10), today);
  const depts = [...new Set(rows.map((r) => deptOf(r.uid) || 'No department'))];
  const out: { department: string; average: number; people: number }[] = [];
  for (const d of depts) {
    const mine = rows.filter((r) => (deptOf(r.uid) || 'No department') === d);
    const perDay = dates.map((date) => moodGroup(mine.filter((r) => r.date === date), min));
    if (perDay.every((g) => !g.hidden && g.average !== null && g.average <= threshold)) {
      const all = moodGroup(mine.filter((r) => dates.includes(r.date)), min);
      out.push({ department: d, average: all.average as number, people: all.people });
    }
  }
  return out;
}
