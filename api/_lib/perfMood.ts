/**
 * Moodometer: a voluntary daily mood check-in, with group results for HR and managers.
 * Uses the same `moodCheckins` records as the Home page card, so one answer a day serves both.
 * Individual answers are never shown to managers or HR: only groups of at least 3 different people.
 */
import { istToday, addDays } from '../../shared/leaveEngine.js';
import { isMood } from '../../shared/home.js';
import { LOW_MOOD_DAYS, buildMoodReport, lowMoodDepartments, type MoodRow } from '../../shared/mood.js';
import { PerfError, db, loadDirectory, nowIso, ok, raise, tell, type Directory, type Result } from './perfCore.js';
import type { Who } from './perfSetup.js';

const COLL = 'moodCheckins';
const moodId = (cid: string, uid: string, date: string) => `${cid}__${uid}__${date}`;

async function rowsOf(cid: string, from: string): Promise<MoodRow[]> {
  const snap = await db().collection(COLL).where('companyId', '==', cid).get();
  return snap.docs.map((d: any) => d.data()).filter((x: any) => x.date >= from).map((x: any) => ({ uid: String(x.uid), date: String(x.date), mood: String(x.mood) }));
}

export async function myMood(w: Who): Promise<Result> {
  const today = istToday();
  const from = addDays(today, -29);
  const rows = (await rowsOf(w.cid, from)).filter((r) => r.uid === w.uid);
  return ok({ today: rows.find((r) => r.date === today)?.mood || null, history: rows.sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, mood: r.mood })) });
}

export async function saveMood(w: Who, body: any): Promise<Result> {
  if (!isMood(body?.mood)) throw new PerfError(400, 'Choose how you feel.');
  const date = istToday();
  await db().collection(COLL).doc(moodId(w.cid, w.uid, date)).set({ companyId: w.cid, uid: w.uid, date, mood: body.mood, at: nowIso() });
  return ok({ today: body.mood });
}

export async function moodReport(w: Who, q: any): Promise<Result> {
  const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const today = istToday();
  const from = addDays(today, -(days - 1));
  const dir = await loadDirectory(w.cid);
  const all = await rowsOf(w.cid, from);
  const deptOf = (uid: string) => dir.byUid.get(uid)?.department || '';
  if (q.scope === 'team') {
    const reports = new Set(dir.reportsOf(w.uid));
    if (reports.size === 0) throw new PerfError(403, 'You have no team.');
    const rep = buildMoodReport(all.filter((r) => reports.has(r.uid)), deptOf, reports.size, from, today);
    return ok({ days, scope: 'team', report: { ...rep, departments: [] } });
  }
  if (!w.canManage && !w.canApprove && !w.canView) throw new PerfError(403, 'You cannot see company-wide mood.');
  return ok({ days, scope: 'company', report: buildMoodReport(all, deptOf, dir.active.length, from, today) });
}

/** Called by the daily job. Flags departments (never people) whose mood stayed low for several days. */
export async function checkLowMood(cid: string, dir: Directory, hr: () => Promise<string[]>): Promise<number> {
  const today = istToday();
  const rows = await rowsOf(cid, addDays(today, -(LOW_MOOD_DAYS - 1)));
  const low = lowMoodDepartments(rows, (uid) => dir.byUid.get(uid)?.department || '', today);
  for (const d of low) {
    await raise(cid, { category: 'MOOD_LOW', severity: 'MEDIUM', owner: 'HR', message: `Mood in ${d.department} has stayed low for ${LOW_MOOD_DAYS} days (average ${d.average} out of 5, ${d.people} people). This is a group result only.`, key: `${d.department}__${today}` });
    await tell(cid, await hr(), `Low team mood: ${d.department}`, `Average ${d.average} out of 5 over ${LOW_MOOD_DAYS} days. Consider a team conversation. This is a group result only.`, 'performance:mood', `moodlow__${d.department}__${today}`, dir);
  }
  return low.length;
}
