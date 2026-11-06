/**
 * Performance Autopilot: takes the routine work out of Performance Management.
 *
 * What it does (all of it is safe to run twice, and every step is written to the audit trail):
 *  - opens review cycles on the date HR chose, publishes approved reviews after a short delay, and locks a cycle once everyone has answered
 *  - makes evidence on its own: attendance facts from this app, and "evidence feeds" (a link to a CSV, for example a published Google Sheet)
 *  - sends the manager a review pack as soon as the employee has submitted, and shows it on the review screen
 *  - fills a self-assessment draft from the employee's own recorded work
 *
 * Rules kept from the specification (HR-PM-005, HR-PM-008):
 *  - Nothing here rates anybody. Evidence and packs only inform; the manager rates, HR checks, an approver approves.
 *  - Evidence that cannot be matched to a KPI waits in the manager's queue. It is never guessed into a KPI.
 *  - The AI draft is optional, advisory, never sees names, and anything inferring personality, motive or health is thrown away and logged.
 *  - Every switch is off until HR turns it on (except the pack email), so nothing starts by surprise.
 */
import { createHash } from 'node:crypto';
import { addDays, canMove, daysBetween, isDate, monthOf, unsupportedInference } from '../../shared/pmEngine.js';
import { companyRequests, effectiveProfile, loadProfiles, loadSettings } from './leaveCore.js';
import { buildMonth, monthRange } from './leaveApi.js';
import { aiEnabled, aiJson } from './openaiHelper.js';
import { fetchPublic } from './safeFetch.js';
import { importCsvText, systemEvidence } from './pmEvidence.js';
import { computeReview, openCycleNow } from './pmReviews.js';
import {
  audit, clean, db, fail, getK, isMyReport, lc, listK, newId, nowIso, ok, putK, raise, settingsOf, str, tell, today, ymd,
  type C, type Item, type Result, type Route,
} from './pmCore.js';

// ------------------------------------------------------------------ settings

export interface AutoSettings extends Item {
  autoOpen: boolean; autoPublish: boolean; publishDelayDays: number; autoLock: boolean; sendPacks: boolean;
  attendanceEvidence: boolean; attendanceKpiName: string;
  lastRun: { at: string; by: string; steps: Record<string, any> } | null;
}
const settingsId = (cid: string) => `pmauto_${cid}`;
const DEFAULTS = { autoOpen: false, autoPublish: false, publishDelayDays: 2, autoLock: false, sendPacks: true, attendanceEvidence: false, attendanceKpiName: '', lastRun: null };

export async function autoSettings(cid: string): Promise<AutoSettings> {
  const s = await db().collection('pmItems').doc(settingsId(cid)).get();
  const d = s.exists ? (s.data() as AutoSettings) : null;
  return { ...DEFAULTS, ...(d && d.companyId === cid ? d : {}), id: settingsId(cid), companyId: cid, kind: 'autopilot' } as AutoSettings;
}
const saveAuto = (s: AutoSettings) => putK(s);

async function autoGet(c: C): Promise<Result> {
  const [st, feeds, cycles] = await Promise.all([autoSettings(c.cid), listK(c.cid, 'evFeed'), listK(c.cid, 'cycle')]);
  const waiting = cycles.filter((x) => x.autoOpenOn && !x.openedAt && x.lockStatus !== 'LOCKED').map((x) => ({ id: x.id, name: x.name, autoOpenOn: x.autoOpenOn }));
  return ok({ settings: st, feeds: feeds.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))), waitingCycles: waiting, aiAvailable: aiEnabled(), aiOn: !!(await settingsOf(c.cid))?.aiAcknowledged });
}

async function autoSave(c: C, b: any): Promise<Result> {
  const prev = await autoSettings(c.cid);
  const bool = (k: keyof AutoSettings) => (b[k] === undefined ? prev[k] : b[k] === true);
  const delay = b.publishDelayDays === undefined ? prev.publishDelayDays : Math.round(Number(b.publishDelayDays));
  if (!Number.isFinite(delay) || delay < 0 || delay > 14) return fail(400, 'Wait between 0 and 14 days before publishing an approved review.');
  const next: AutoSettings = {
    ...prev, autoOpen: bool('autoOpen') as boolean, autoPublish: bool('autoPublish') as boolean, publishDelayDays: delay, autoLock: bool('autoLock') as boolean,
    sendPacks: bool('sendPacks') as boolean, attendanceEvidence: bool('attendanceEvidence') as boolean,
    attendanceKpiName: b.attendanceKpiName === undefined ? prev.attendanceKpiName : str(b.attendanceKpiName, 120),
  };
  if (next.attendanceEvidence && !next.attendanceKpiName) return fail(400, 'Type the name of the KPI that attendance should count as evidence for (it must match a KPI in the role templates).');
  await saveAuto(next);
  await audit(c, 'setting', next.id, 'AUTOPILOT_SETTINGS', pickSwitches(prev), pickSwitches(next));
  return ok({ settings: next });
}
const pickSwitches = (s: AutoSettings) => ({ autoOpen: s.autoOpen, autoPublish: s.autoPublish, publishDelayDays: s.publishDelayDays, autoLock: s.autoLock, sendPacks: s.sendPacks, attendanceEvidence: s.attendanceEvidence, attendanceKpiName: s.attendanceKpiName });

// ------------------------------------------------------------------ evidence feeds (a link to a CSV, read every day)

/** A normal Google Sheets address becomes its CSV export address (the sheet must be shared "anyone with the link" or published). */
export function feedUrl(raw: string): string {
  const u = raw.trim();
  const m = u.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) return u;
  const gid = u.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

async function feedSave(c: C, b: any): Promise<Result> {
  const name = str(b.name, 100); const url = feedUrl(str(b.url, 600));
  if (!name) return fail(400, 'Give the feed a name, like "Sales sheet".');
  if (!/^https:\/\/\S+$/i.test(url)) return fail(400, 'The link must start with https://. For a Google Sheet, share it as "anyone with the link can view" and paste its address.');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'evFeed') : null;
  if (b.id && !prev) return fail(404, 'That feed was not found.');
  const id = prev?.id || newId();
  const item: Item = { ...(prev || {}), id, companyId: c.cid, kind: 'evFeed', name, url, enabled: b.enabled !== false, lastRunAt: prev?.lastRunAt || '', lastResult: prev?.lastResult || '' };
  await putK(item);
  await audit(c, 'setting', id, prev ? 'FEED_UPDATED' : 'FEED_ADDED', prev ? { url: prev.url } : null, { name, url });
  return ok({ item });
}

async function feedDelete(c: C, b: any): Promise<Result> {
  const f = await getK(c.cid, str(b.id, 80), 'evFeed');
  if (!f) return fail(404, 'That feed was not found.');
  await db().collection('pmItems').doc(f.id).delete();
  await audit(c, 'setting', f.id, 'FEED_REMOVED', { name: f.name }, null);
  return ok({});
}

async function runFeed(c: C, f: Item): Promise<{ ok: boolean; message: string }> {
  let message = ''; let good = true;
  try {
    const res = await fetchPublic(f.url, { headers: { Accept: 'text/csv,text/plain,*/*' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`The link answered with HTTP ${res.status}. Check that it is shared so anyone with the link can view it.`);
    const text = await res.text();
    if (text.length > 1_500_000) throw new Error('The file is larger than 1.5 MB. Keep only recent rows.');
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('The link opens a web page, not a CSV file. Share the sheet so anyone with the link can view it.');
    const r = await importCsvText(c, text, { uid: 'system', name: `Feed: ${f.name}`, system: true });
    good = r.status === 200;
    message = good ? String(r.json.message || 'Done.') : String(r.json.error || 'Failed.');
  } catch (e: any) { good = false; message = String(e?.message || 'The feed could not be read.').slice(0, 300); }
  await putK({ ...f, lastRunAt: nowIso(), lastResult: `${good ? 'OK' : 'Problem'}: ${message}` });
  if (!good) await raise(c, 'TASK_EVENT_PROBLEM', { refId: `feed_${f.id}_${today()}`, refLabel: `Feed: ${f.name}`, detail: `The evidence feed "${f.name}" could not be read today. ${message}` });
  return { ok: good, message };
}

async function feedRun(c: C, b: any): Promise<Result> {
  const f = await getK(c.cid, str(b.id, 80), 'evFeed');
  if (!f) return fail(404, 'That feed was not found.');
  const r = await runFeed(c, f);
  return r.ok ? ok({ message: r.message }) : fail(400, r.message);
}

async function runFeeds(c: C): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const f of (await listK(c.cid, 'evFeed')).filter((x) => x.enabled !== false)) out[f.name] = (await runFeed(c, f)).message;
  return out;
}

// ------------------------------------------------------------------ attendance as evidence

/**
 * For people whose plan has a KPI with the name HR chose, last month's and this month's attendance becomes one piece of evidence
 * ("Attendance 2026-10: 21 days present, 2 late, 0 absent, 1 on leave"). People with no such KPI get nothing, so nothing piles up unmapped.
 */
export async function attendanceEvidence(c: C, st: AutoSettings): Promise<Record<string, any>> {
  if (!st.attendanceEvidence || !st.attendanceKpiName) return { skipped: 'Off' };
  const [{ settings: ls, configured }, profiles, requests, plans, targets] = await Promise.all([loadSettings(c.cid), loadProfiles(c.cid), companyRequests(c.cid), listK(c.cid, 'plan'), listK(c.cid, 'kpiTarget')]);
  if (!configured || ls.locations.length === 0) return { skipped: 'Leave & attendance is not set up yet.' };
  const live = new Map(plans.filter((p) => p.status !== 'SUPERSEDED' && p.status !== 'CONFIGURATION_PENDING').map((p) => [p.id, p.uid as string]));
  const want = lc(st.attendanceKpiName);
  const people = new Set<string>();
  for (const k of targets) if (live.has(k.planId) && lc(k.kpiName) === want) people.add(live.get(k.planId)!);
  if (people.size === 0) return { skipped: `No active plan has a KPI called "${st.attendanceKpiName}".` };
  const t = today(); const cur = monthOf(t); const prev = monthOf(addDays(`${cur}-01`, -1));
  let stored = 0; let unchanged = 0;
  for (const month of [prev, cur]) {
    const { to } = monthRange(month);
    const snap = await db().collection('leaveAttendance').where('companyId', '==', c.cid).where('month', '==', month).get();
    const recs = new Map<string, Map<string, any>>();
    snap.docs.forEach((d: any) => { const x = d.data() as any; if (!recs.has(x.uid)) recs.set(x.uid, new Map()); recs.get(x.uid)!.set(x.date, x); });
    for (const p of c.people.filter((x) => x.active && people.has(x.uid))) {
      const prof = effectiveProfile(ls, p, profiles.get(p.uid));
      const s = buildMonth(ls, prof.locationId, prof.joinDate, month, recs.get(p.uid) || new Map(), requests.filter((r) => r.uid === p.uid)).summary;
      if (s.present + s.leave + s.absent + s.halfDay === 0) continue;
      const title = `Attendance ${month}: ${s.present} day(s) present, ${s.late} late, ${s.absent} absent, ${s.leave} on leave${month === cur ? ' (so far)' : ''}`;
      const r = await systemEvidence(c, { uid: p.uid, taskId: `attendance_${month}`, title, kpiRef: st.attendanceKpiName, completedOn: month < cur ? to : t, notes: 'Made automatically from Leave & Attendance records. Information only: it is never a rating.' }, 'Autopilot (attendance records)');
      if (r.outcome === 'STORED' || r.outcome === 'UPDATED') stored++; else unchanged++;
    }
  }
  return { people: people.size, stored, unchanged };
}

// ------------------------------------------------------------------ review pack (for the person who evaluates)

const sentence = (s: string, n = 220) => str(s, n).replace(/\s+/g, ' ');
const list = (xs: string[], n: number) => xs.slice(0, n).join('; ');

export async function buildPack(c: C, rv: Item) {
  const v = await computeReview(c, rv);
  const from = monthOf(rv.periodStart); const to = monthOf(rv.periodEnd);
  const checkins = (await listK(c.cid, 'checkin')).filter((x) => x.uid === rv.uid && x.month >= from && x.month <= to).sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const evidence = (v.evidence as Item[]).filter((e) => e.status !== 'REJECTED');
  const kpis = (rv.kpis || []).map((k: any) => {
    const mine = (v.evidence as Item[]).filter((e) => e.kpiTargetId === k.targetId);
    const verified = mine.filter((e) => e.status === 'VERIFIED');
    return {
      targetId: k.targetId, kpiName: k.kpiName, kraName: k.kraName, target: k.target || '',
      counts: { verified: verified.length, pending: mine.filter((e) => e.status === 'PENDING_VERIFICATION').length, rejected: mine.filter((e) => e.status === 'REJECTED').length, rework: verified.reduce((s, e) => s + (Number(e.reworkCount) || 0), 0) },
      items: mine.slice(0, 12).map((e) => ({ id: e.id, title: e.title, link: e.link || '', status: e.status, quality: e.quality, completedOn: e.completedOn || '', source: e.source })),
      suggestedEvidenceIds: verified.slice(0, 12).map((e) => e.id), gap: verified.length === 0,
    };
  });
  const unmapped = evidence.filter((e) => e.status === 'UNMAPPED').slice(0, 20).map((e) => ({ id: e.id, title: e.title, completedOn: e.completedOn || '' }));
  const done = checkins.filter((x) => x.status === 'DONE');
  const points: string[] = [];
  for (const k of kpis) {
    const titles = k.items.filter((i: any) => i.status === 'VERIFIED').map((i: any) => i.title);
    points.push(k.gap ? `${k.kraName}: ${k.kpiName} has no verified evidence yet. Verify evidence first, or mark "not enough evidence" when you rate it.`
      : `${k.kraName}: ${k.kpiName} (target ${k.target || 'not set'}): ${k.counts.verified} verified item(s)${k.counts.rework ? `, ${k.counts.rework} rework` : ''}. ${list(titles, 3)}.`);
  }
  for (const x of done) points.push(`Check-in ${x.month}: ${[x.wins && `wins - ${sentence(x.wins, 160)}`, x.concerns && `concerns - ${sentence(x.concerns, 160)}`].filter(Boolean).join('; ') || 'recorded'}.`);
  if (rv.self?.achievements) points.push(`In their own words, the employee wrote: "${sentence(rv.self.achievements, 260)}"`);
  if (unmapped.length) points.push(`${unmapped.length} evidence item(s) are not linked to a KPI yet. Link or reject them in Work evidence before rating.`);
  if (v.context?.leaveDays) points.push(`The employee was on approved leave for ${v.context.leaveDays} day(s) in this period (context only, never a rating).`);

  let draft = { source: 'RULES' as 'RULES' | 'AI', points, note: 'Simple summary of the recorded facts.' };
  const set = await settingsOf(c.cid);
  if (aiEnabled() && set?.aiAcknowledged) {
    // Names never leave the app: the model sees "the employee" and the facts only.
    const facts = JSON.stringify({
      kpis: kpis.map((k: any) => ({ kra: k.kraName, kpi: k.kpiName, target: k.target, verified: k.counts.verified, rework: k.counts.rework, titles: k.items.filter((i: any) => i.status === 'VERIFIED').slice(0, 6).map((i: any) => i.title) })),
      checkins: done.map((x) => ({ month: x.month, wins: sentence(x.wins, 300), concerns: sentence(x.concerns, 300), support: sentence(x.support, 200) })),
      employeeSelfSummary: sentence(rv.self?.achievements || '', 600), unlinkedEvidence: unmapped.length, leaveDays: v.context?.leaveDays || 0,
    });
    const r = await aiJson({
      cid: c.cid, feature: 'pm-pack', cacheKey: createHash('sha256').update(facts).digest('hex'), maxTokens: 700,
      system: 'You prepare discussion notes for a manager who will review an employee\'s work. Use ONLY the facts given. Write 4 to 7 short, specific, behaviour- and result-based talking points (what was delivered, what is missing, what to ask). Never infer personality, motivation, loyalty, health, age, gender, religion or any protected trait. Never suggest a rating, a score, pay, promotion or disciplinary action. Reply as JSON: {"points": ["..."]}.',
      user: facts,
    });
    if (r.data && Array.isArray(r.data.points)) {
      const pts: string[] = r.data.points.map((x: any) => str(x, 400)).filter(Boolean).slice(0, 8);
      const bad = pts.find((p) => unsupportedInference(p));
      if (bad) { await raise(c, 'AI_UNSUPPORTED', { refId: `${rv.id}_pack_${Date.now().toString(36)}`, subjectUid: rv.uid, refLabel: rv.employeeName, detail: `An AI draft was discarded because it went beyond the facts ("${unsupportedInference(bad)}"). The plain summary is shown instead.`, ownerUid: c.ctx.uid }); draft.note = 'The AI draft was discarded because it went beyond the facts. A plain summary is shown.'; }
      else if (pts.length) draft = { source: 'AI', points: pts, note: 'AI draft from the recorded facts. Edit freely. It never sees names and it never suggests a rating.' };
    } else if (r.error) draft.note = 'AI is not available right now. A plain summary is shown.';
  }
  return { kpis, unmapped, checkins: checkins.map((x) => ({ month: x.month, status: x.status, wins: x.wins || '', focus: x.focus || '', concerns: x.concerns || '', support: x.support || '', employeeComment: x.employeeComment || '' })), context: v.context, flags: v.flags, draft };
}

async function packGet(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const rv = await getK(c.cid, str(q.reviewId, 160), 'review');
  if (!rv) return fail(404, 'That review was not found.');
  if (rv.uid === c.ctx.uid) return fail(403, 'The review pack is for the people who evaluate a review.');
  if (!(isMyReport(c, rv.uid) || rv.managerUid === c.ctx.uid || c.isHr || c.isApprover)) return fail(403, 'You do not have access to this review.');
  const pack = await buildPack(c, rv);
  await audit(c, 'review', rv.id, 'PACK_VIEWED', null, { source: pack.draft.source }, rv.uid);
  return ok({ pack, disclaimer: 'Information only. A person rates, HR checks and an approver approves.' });
}

/** Daily: the manager gets a short pack note once the employee has submitted (one note per review, ever). */
export async function sendPacks(c: C, st: AutoSettings): Promise<Record<string, any>> {
  if (!st.sendPacks) return { skipped: 'Off' };
  let sent = 0;
  for (const rv of (await listK(c.cid, 'review')).filter((r) => ['SELF_ASSESSED', 'MANAGER_EVALUATED'].includes(r.status) && r.managerUid)) {
    const id = `pmpack_${rv.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
    if (await getK(c.cid, id, 'packSent')) continue;
    const pack = await buildPack(c, { ...rv });
    const gaps = pack.kpis.filter((k: any) => k.gap).length; const verified = pack.kpis.reduce((s: number, k: any) => s + k.counts.verified, 0);
    await putK({ id, companyId: c.cid, kind: 'packSent', reviewId: rv.id, sentAt: nowIso() });
    await tell(c, [rv.managerUid], `Review pack ready: ${rv.employeeName}`, `${rv.employeeName} has submitted their self-assessment for ${rv.cycleName}.\n\nRecorded work: ${verified} verified evidence item(s) across ${pack.kpis.length} KPI(s); ${gaps} KPI(s) have no verified evidence; ${pack.unmapped.length} item(s) are not linked to a KPI; ${pack.checkins.filter((x: any) => x.status === 'DONE').length} monthly check-in(s) recorded.\n\nOpen Performance > My team: reviews > ${rv.employeeName} to see the full pack and a draft of talking points. You still give every rating.`);
    sent++;
  }
  return { sent };
}

// ------------------------------------------------------------------ self-assessment draft (the employee's own recorded work)

async function selfPrefill(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const rv = await getK(c.cid, str(q.reviewId, 160), 'review');
  if (!rv || rv.uid !== c.ctx.uid) return fail(404, 'That review was not found.');
  if (rv.status !== 'OPEN') return fail(409, 'The self-assessment is not open for writing.');
  const v = await computeReview(c, rv);
  const mine = (v.evidence as Item[]).filter((e) => ['VERIFIED', 'PENDING_VERIFICATION'].includes(e.status));
  const work = mine.filter((e) => !String(e.taskId || '').startsWith('attendance_'));
  const lines = work.slice(0, 15).map((e) => `- ${sentence(e.title, 140)}${e.kpiName ? ` (${e.kpiName})` : ''}${e.completedOn ? `, ${e.completedOn}` : ''}`);
  const from = monthOf(rv.periodStart); const to = monthOf(rv.periodEnd);
  const wins = (await listK(c.cid, 'checkin')).filter((x) => x.uid === rv.uid && x.status === 'DONE' && x.month >= from && x.month <= to && x.wins).map((x) => `- ${x.month}: ${sentence(x.wins, 200)}`);
  const achievements = [...lines, ...wins.length ? ['', 'Wins noted in my monthly check-ins:', ...wins.slice(0, 6)] : []].join('\n').trim();
  const kpis = (rv.kpis || []).map((k: any) => {
    const own = mine.filter((e) => e.kpiTargetId === k.targetId);
    const titles = own.filter((e) => !String(e.taskId || '').startsWith('attendance_')).map((e) => sentence(e.title, 80));
    return { targetId: k.targetId, employeeNote: own.length ? `${own.length} recorded item(s)${titles.length ? `: ${list(titles, 3)}` : ''}.` : '', evidenceIds: own.slice(0, 30).map((e) => e.id) };
  });
  return ok({ achievements, kpis, found: mine.length, note: mine.length || wins.length ? 'Filled from the work recorded for you. Check it, correct it, add what is missing, and make it your own.' : 'Nothing has been recorded for you in this period yet, so there is nothing to fill in. Write it yourself.' });
}

// ------------------------------------------------------------------ the daily steps that change reviews and cycles

async function openDueCycles(c: C, st: AutoSettings): Promise<Record<string, any>> {
  if (!st.autoOpen) return { skipped: 'Off' };
  const t = today(); const out: Record<string, any> = {};
  for (const cy of (await listK(c.cid, 'cycle')).filter((x) => x.autoOpenOn && x.autoOpenOn <= t && !x.openedAt && x.lockStatus !== 'LOCKED')) {
    const r = await openCycleNow(c, { id: cy.id });
    out[cy.name] = r.status === 200 ? r.json.message : `Not opened: ${r.json.error}`;
    if (r.status !== 200) await raise(c, 'TASK_EVENT_PROBLEM', { refId: `autoopen_${cy.id}`, refLabel: cy.name, detail: `The cycle "${cy.name}" was due to open automatically today but could not: ${r.json.error}` });
  }
  return out;
}

async function publishApproved(c: C, st: AutoSettings): Promise<Record<string, any>> {
  if (!st.autoPublish) return { skipped: 'Off' };
  const t = today(); let published = 0;
  for (const rv of (await listK(c.cid, 'review')).filter((r) => r.status === 'APPROVED')) {
    const approved = ymd(String(rv.final?.approvedAt || rv.updatedAt || ''));
    if (!isDate(approved) || daysBetween(approved, t) < st.publishDelayDays || !canMove('APPROVED', 'PUBLISHED')) continue;
    const next = { ...rv, status: 'PUBLISHED', publishedAt: nowIso(), publishedBy: 'Autopilot', history: [...(rv.history || []), { at: nowIso(), by: 'Autopilot', action: 'PUBLISHED', note: `Published automatically ${st.publishDelayDays} day(s) after approval.` }] };
    await putK(next);
    await audit(c, 'review', rv.id, 'PUBLISHED', { status: 'APPROVED' }, { status: 'PUBLISHED', automatic: true }, rv.uid);
    await tell(c, [rv.uid], `Your ${rv.cycleName} review is ready`, 'Open Performance > My performance to read it. You can acknowledge it, or record that you disagree and why.');
    published++;
  }
  return { published };
}

async function lockFinished(c: C, st: AutoSettings): Promise<Record<string, any>> {
  if (!st.autoLock) return { skipped: 'Off' };
  const reviews = await listK(c.cid, 'review'); let locked = 0;
  for (const cy of (await listK(c.cid, 'cycle')).filter((x) => x.openedAt && x.lockStatus !== 'LOCKED')) {
    const rs = reviews.filter((r) => r.cycleId === cy.id);
    if (rs.length === 0 || !rs.every((r) => r.status === 'ACKNOWLEDGED')) continue;   // a deferred, disputed or unanswered review always needs a person first
    await putK({ ...cy, lockStatus: 'LOCKED' });
    await audit(c, 'cycle', cy.id, 'LOCKED', { lock: cy.lockStatus }, { lock: 'LOCKED', automatic: true });
    locked++;
  }
  return { locked };
}

// ------------------------------------------------------------------ the autopilot run

/** Runs every step. One step failing never stops the others. Called by the daily job and by HR's "Run now". */
export async function runAutopilot(c: C): Promise<Record<string, any>> {
  const st = await autoSettings(c.cid);
  const steps: Record<string, any> = {};
  const todo: [string, () => Promise<any>][] = [
    ['feeds', () => runFeeds(c)], ['attendance', () => attendanceEvidence(c, st)], ['openCycles', () => openDueCycles(c, st)],
    ['packs', () => sendPacks(c, st)], ['publish', () => publishApproved(c, st)], ['lock', () => lockFinished(c, st)],
  ];
  for (const [name, fn] of todo) { try { steps[name] = await fn(); } catch (e: any) { steps[name] = { error: String(e?.message || 'failed').slice(0, 200) }; } }
  await saveAuto(clean({ ...st, lastRun: { at: nowIso(), by: c.who, steps } }));
  return steps;
}

async function autoRun(c: C): Promise<Result> { return ok({ steps: await runAutopilot(c) }); }

export const AUTO_ROUTES: Record<string, Route> = {
  'auto-get': { method: 'GET', who: 'hr', run: (c) => autoGet(c) },
  'auto-save': { method: 'POST', who: 'hr', run: (c, b) => autoSave(c, b) },
  'auto-run': { method: 'POST', who: 'hr', run: (c) => autoRun(c) },
  'feed-save': { method: 'POST', who: 'hr', run: (c, b) => feedSave(c, b) },
  'feed-delete': { method: 'POST', who: 'hr', run: (c, b) => feedDelete(c, b) },
  'feed-run': { method: 'POST', who: 'hr', run: (c, b) => feedRun(c, b) },
  'pack-get': { method: 'GET', who: 'any', run: (c, b, q) => packGet(c, b, q) },
  'self-prefill': { method: 'GET', who: 'any', run: (c, b, q) => selfPrefill(c, b, q) },
};

