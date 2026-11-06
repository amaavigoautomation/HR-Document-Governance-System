/**
 * Day-to-day: work evidence (linked to a KPI, verified by the manager) and the monthly check-in.
 * Evidence is information for the review; counts never turn into a rating by themselves.
 */
import { createHash } from 'node:crypto';
import { addDays, isDate } from '../../shared/pmEngine.js';
import { fetchPublic } from './safeFetch.js';
import { OPEN_PLAN, openPlanOf } from './pmPlans.js';
import {
  active, audit, bad, canSee, clear, del, denied, get, hrUids, isManagerOf, list, lc, managerOf, nameOf, notFound, ok, put, raise,
  remindNow, settingsOf, str, tell, today,
  type C, type Doc, type Result, type Route,
} from './pmCore.js';

// ------------------------------------------------------------------ evidence

const evKey = (uid: string, date: string, title: string) => createHash('sha1').update(`${uid}|${date}|${lc(title)}`).digest('hex').slice(0, 24);

async function evAdd(c: C, b: any): Promise<Result> {
  const uid = str(b.uid, 120) || c.ctx.uid;
  const forSelf = uid === c.ctx.uid;
  if (!forSelf && !isManagerOf(c, uid) && !c.isHr) return denied('You can add work only for yourself or the people who report to you.');
  const plan = openPlanOf(await list(c.cid, 'plans', { uid }), uid);
  if (!plan || plan.status !== 'ACTIVE') return bad('Work can be added once the targets are approved.');
  const kpi = plan.kpis.find((k: any) => k.id === str(b.kpiId, 40));
  if (!kpi) return bad('Pick which KPI this work belongs to.');
  const date = str(b.date, 10); const title = str(b.title, 200); const link = str(b.link, 500);
  if (!isDate(date)) return bad('Pick the date the work was done.');
  if (date > today()) return bad('The date cannot be in the future.');
  if (date < addDays(today(), -400)) return bad('That date is more than a year ago.');
  if (title.length < 4) return bad('Describe the work in a few words (for example "Diwali campaign launched").');
  if (link && !/^https?:\/\//i.test(link)) return bad('The link must start with http:// or https://');
  const id = `${c.cid}_${evKey(uid, date, title)}`;
  if (await get(c.cid, 'evidence', id)) return bad('This work is already recorded for that date.');
  // Added by the manager = vouched for. Added by the employee (or HR) = the manager verifies it.
  const byManager = !forSelf && isManagerOf(c, uid);
  const ev = await put('evidence', {
    id, companyId: c.cid, uid, name: nameOf(c, uid), planId: plan.id, kpiId: kpi.id, kpiName: kpi.kpi, date, title, link,
    source: 'MANUAL', status: byManager ? 'VERIFIED' : 'PENDING', addedBy: c.who, addedByUid: c.ctx.uid, verifiedBy: byManager ? c.who : '', verifiedAt: byManager ? new Date().toISOString() : '',
  });
  await audit(c, id, 'EVIDENCE_ADDED', `${title} → ${kpi.kpi}`, uid);
  return ok({ item: ev, message: byManager ? 'Added and verified.' : 'Added. Your manager will verify it.' });
}

async function evVerify(c: C, b: any): Promise<Result> {
  const ev = await get(c.cid, 'evidence', str(b.id, 120));
  if (!ev) return notFound('That work item');
  if (ev.uid === c.ctx.uid) return denied('You cannot verify your own work.');
  if (!isManagerOf(c, ev.uid) && !c.isHr) return denied('Only this person\'s manager can verify their work.');
  if (ev.status !== 'PENDING') return bad('This item was already checked.');
  const good = b.ok === true; const note = str(b.note, 300);
  if (!good && note.length < 3) return bad('Say briefly why this does not count, so the employee knows.');
  const next = await put('evidence', { ...ev, status: good ? 'VERIFIED' : 'REJECTED', verifiedBy: c.who, verifiedAt: new Date().toISOString(), note });
  await audit(c, ev.id, good ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_REJECTED', note, ev.uid);
  return ok({ item: next, message: good ? 'Verified.' : 'Marked as not counting.' });
}

async function evDelete(c: C, b: any): Promise<Result> {
  const ev = await get(c.cid, 'evidence', str(b.id, 120));
  if (!ev || ev.addedByUid !== c.ctx.uid) return notFound('That work item');
  if (ev.status !== 'PENDING') return bad('Checked work cannot be deleted. Ask your manager if it is wrong.');
  await del('evidence', ev.id);
  await audit(c, ev.id, 'EVIDENCE_DELETED', ev.title, ev.uid);
  return ok({ message: 'Deleted.' });
}

// ------------------------------------------------------------------ import (CSV upload, or a Google Sheet read every day)

/** Small CSV reader: quoted fields, commas and new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export const IMPORT_COLUMNS = ['email', 'date', 'kpi', 'title', 'link'];

/**
 * Rows: email, date (YYYY-MM-DD), kpi (the KPI wording or its responsibility area), title, link (optional).
 * Imported work waits for the manager to verify it. Rows that match nobody are reported, never guessed.
 */
export async function importCsv(c: C, text: string, by: string, onlyUids?: Set<string>): Promise<{ added: number; skipped: number; problems: string[] }> {
  const rows = parseCsv(text);
  if (!rows.length) return { added: 0, skipped: 0, problems: ['The file is empty.'] };
  const head = rows[0].map((h) => lc(h));
  const col = (n: string) => head.indexOf(n);
  if (col('email') < 0 || col('date') < 0 || col('kpi') < 0 || col('title') < 0) return { added: 0, skipped: 0, problems: [`The first row must name the columns: ${IMPORT_COLUMNS.join(', ')}.`] };
  const plans = (await list(c.cid, 'plans')).filter((p) => p.status === 'ACTIVE');
  const byEmail = new Map(active(c).map((p) => [p.email, p]));
  let added = 0; let skipped = 0; const problems: string[] = [];
  for (const [i, r] of rows.slice(1, 2001).entries()) {
    const line = i + 2; const at = (n: string) => str(r[col(n)] ?? '', 300);
    const p = byEmail.get(lc(at('email')));
    if (!p) { problems.push(`Row ${line}: nobody active has the email "${at('email')}".`); continue; }
    if (onlyUids && !onlyUids.has(p.uid)) { problems.push(`Row ${line}: ${p.name} does not report to you.`); continue; }
    const plan = plans.find((x) => x.uid === p.uid);
    if (!plan) { problems.push(`Row ${line}: ${p.name} has no approved targets yet.`); continue; }
    const k = lc(at('kpi'));
    const kpi = plan.kpis.find((x: any) => lc(x.kpi) === k || lc(x.kra) === k || x.id === at('kpi'));
    if (!kpi) { problems.push(`Row ${line}: "${at('kpi')}" is not one of ${p.name}'s KPIs.`); continue; }
    const date = at('date'); const title = at('title').slice(0, 200); const link = at('link');
    if (!isDate(date) || date > today()) { problems.push(`Row ${line}: the date "${date}" is not a valid past date (use YYYY-MM-DD).`); continue; }
    if (title.length < 3) { problems.push(`Row ${line}: the title is empty.`); continue; }
    const id = `${c.cid}_${evKey(p.uid, date, title)}`;
    if (await get(c.cid, 'evidence', id)) { skipped++; continue; }
    await put('evidence', {
      id, companyId: c.cid, uid: p.uid, name: p.name, planId: plan.id, kpiId: kpi.id, kpiName: kpi.kpi, date, title, link: /^https?:\/\//i.test(link) ? link : '',
      source: 'IMPORT', status: 'PENDING', addedBy: by, addedByUid: c.ctx.uid, verifiedBy: '', verifiedAt: '',
    });
    added++;
  }
  return { added, skipped, problems };
}

async function evImport(c: C, b: any): Promise<Result> {
  const mine = new Set(active(c).filter((p) => managerOf(c, p.uid) === c.ctx.uid).map((p) => p.uid));
  if (!c.isHr && !mine.size) return denied('Only HR or a manager can import work.');
  const text = typeof b.csv === 'string' ? b.csv : '';
  if (!text.trim()) return bad('Choose a CSV file first.');
  if (text.length > 1_500_000) return bad('The file is larger than 1.5 MB. Split it.');
  const r = await importCsv(c, text, `Import by ${c.who}`, c.isHr ? undefined : mine);
  await audit(c, `import_${today()}`, 'EVIDENCE_IMPORTED', `${r.added} added, ${r.skipped} already there, ${r.problems.length} problems`);
  return ok({ ...r, message: `${r.added} work item(s) added for managers to verify. ${r.skipped ? `${r.skipped} were already there. ` : ''}${r.problems.length ? `${r.problems.length} row(s) need fixing.` : ''}` });
}

/** A normal Google Sheets link becomes its CSV export link (the sheet must be shared "anyone with the link"). */
export function feedCsvUrl(raw: string): string {
  const m = raw.trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) return raw.trim();
  const gid = raw.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

export async function runFeed(c: C): Promise<string> {
  const s = await settingsOf(c.cid);
  if (!s.feedUrl) return 'no feed';
  let result = '';
  try {
    const res = await fetchPublic(feedCsvUrl(s.feedUrl), { headers: { Accept: 'text/csv,text/plain,*/*' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`The link answered with HTTP ${res.status}. Share the sheet so anyone with the link can view it.`);
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('The link opens a web page, not a CSV. Share the sheet so anyone with the link can view it.');
    if (text.length > 1_500_000) throw new Error('The sheet is larger than 1.5 MB. Keep only recent rows.');
    const r = await importCsv(c, text, 'Daily evidence feed');
    result = `${r.added} added, ${r.skipped} already there, ${r.problems.length} problem rows`;
    if (r.problems.length) await raise(c, 'IMPORT_UNMATCHED', `feed_${today()}`, { text: `The evidence feed had ${r.problems.length} row(s) it could not match: ${r.problems.slice(0, 8).join(' ')}` });
    await clear(c, 'FEED_FAILED', 'feed', 'The feed was read successfully.');
  } catch (e: any) {
    result = `Problem: ${String(e?.message || 'could not be read').slice(0, 300)}`;
    await raise(c, 'FEED_FAILED', 'feed', { text: `The evidence feed could not be read. ${result}`, notify: await hrUids(c) });
  }
  await put('settings', { ...s, feedLast: `${today()}: ${result}` });
  return result;
}

// ------------------------------------------------------------------ monthly check-ins

const checkinId = (cid: string, uid: string, month: string) => `${cid}_${uid}_${month}`;

/** On or after the 1st, every person with approved targets and a manager gets this month's check-in (once). */
export async function generateCheckins(c: C): Promise<{ created: number }> {
  const month = today().slice(0, 7);
  const plans = (await list(c.cid, 'plans')).filter((p) => p.status === 'ACTIVE' && p.managerUid);
  let created = 0;
  for (const p of plans) {
    const id = checkinId(c.cid, p.uid, month);
    if (await get(c.cid, 'checkins', id)) continue;
    await put('checkins', { id, companyId: c.cid, uid: p.uid, name: p.name, managerUid: p.managerUid, managerName: p.managerName, month, status: 'DUE', wentWell: '', blockers: '', nextFocus: '', managerComment: '', doneAt: '' });
    created++;
  }
  return { created };
}

async function checkinSave(c: C, b: any): Promise<Result> {
  const ci = await get(c.cid, 'checkins', str(b.id, 200));
  if (!ci) return notFound('The check-in');
  const isEmp = ci.uid === c.ctx.uid; const isMgr = ci.managerUid === c.ctx.uid || isManagerOf(c, ci.uid);
  if (!isEmp && !isMgr) return denied();
  if (ci.status === 'DONE') return bad('This check-in is already done.');
  const next: Doc = { ...ci };
  if (isEmp) { next.wentWell = str(b.wentWell, 1000); next.blockers = str(b.blockers, 1000); next.nextFocus = str(b.nextFocus, 1000); }
  if (isMgr) {
    next.managerComment = str(b.managerComment, 1500);
    if (b.done === true) {
      if (next.managerComment.length < 5) return bad('Write a short comment about the conversation before marking it done.');
      next.status = 'DONE'; next.doneAt = new Date().toISOString(); next.managerUid = c.ctx.uid; next.managerName = c.who;
    }
  }
  await put('checkins', next);
  if (next.status === 'DONE') { await audit(c, ci.id, 'CHECKIN_DONE', '', ci.uid); await clear(c, 'CHECKIN_LATE', ci.id, 'Done.'); }
  return ok({ item: next, message: next.status === 'DONE' ? 'Check-in done.' : 'Saved.' });
}

export async function checkinReminders(c: C): Promise<{ reminded: number }> {
  const s = await settingsOf(c.cid);
  const t = today(); const month = t.slice(0, 7); const day = Number(t.slice(8, 10));
  const due = (await list(c.cid, 'checkins')).filter((x) => x.status === 'DUE');
  let reminded = 0;
  for (const ci of due) {
    const old = ci.month < month;
    if (!old && day < 15) continue;
    if (!remindNow(ci, 'mgr', s.timing.remindEvery * 2)) continue;
    reminded++;
    await put('checkins', ci);
    await tell(c, [ci.managerUid], `Check-in with ${ci.name}`, `The ${ci.month} check-in with ${ci.name} is not done yet. It takes 2 minutes: open My team → Check-ins.`);
    if (old) await raise(c, 'CHECKIN_LATE', ci.id, { subjectUid: ci.uid, text: `The ${ci.month} check-in between ${ci.managerName} and ${ci.name} was missed.` });
  }
  return { reminded };
}

async function checkinList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const uid = str(q.uid, 120) || c.ctx.uid;
  if (!canSee(c, uid)) return denied();
  const items = (await list(c.cid, 'checkins', { uid })).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12);
  return ok({ items });
}

export const WORK_ROUTES: Record<string, Route> = {
  'ev-add': { method: 'POST', who: 'any', run: (c, b) => evAdd(c, b) },
  'ev-verify': { method: 'POST', who: 'any', run: (c, b) => evVerify(c, b) },
  'ev-delete': { method: 'POST', who: 'any', run: (c, b) => evDelete(c, b) },
  'ev-import': { method: 'POST', who: 'any', run: (c, b) => evImport(c, b) },
  'checkin-save': { method: 'POST', who: 'any', run: (c, b) => checkinSave(c, b) },
  checkins: { method: 'GET', who: 'any', run: (c, b, q) => checkinList(c, b, q) },
};
