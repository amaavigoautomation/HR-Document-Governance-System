/**
 * HR-PM-005 Task Management & Delivery Integration (workflow PM-005 "Task Evidence Sync").
 *
 * Evidence reaches a person's KPIs three ways: someone adds it by hand, a manager imports a CSV from their task tool,
 * or the task tool posts events to the company's webhook. All three go through the same checks:
 * Task event -> Employee lookup -> Project lookup -> KPI mapping -> SOP mapping -> Evidence validation -> Store -> Manager review queue.
 *
 * Design rule from the specification: task counts, login hours and activity levels never become ratings on their own.
 * Evidence only informs a person; the manager rates. Unassigned, duplicate, deleted or disputed events are logged, never silently scored.
 */
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { parseCsv } from '../../shared/csv.js';
import { EVIDENCE_SOURCES, addDays, isDate, overlapDays } from '../../shared/pmEngine.js';
import {
  audit, db, fail, getK, isMyReport, lc, listK, loadSystem, newId, nowIso, ok, oneOf, person, putK, raise, saveSettings, settingsOf, str, today, clean,
  type C, type Item, type Route, type Result, type PmSettings,
} from './pmCore.js';

const SRC = EVIDENCE_SOURCES;
const QUALITY = ['APPROVED', 'REWORK', 'PENDING', 'NOT_APPLICABLE'] as const;

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const evId = (cid: string, uid: string, source: string, taskId: string) => `ev_${hash(`${cid}|${uid}|${source}|${taskId}`)}`;
const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s);

/** The plan targets a person's evidence can attach to (their current, non-superseded plan). */
async function targetsOf(c: C, uid: string): Promise<Item[]> {
  const plans = (await listK(c.cid, 'plan')).filter((p) => p.uid === uid && p.status !== 'SUPERSEDED' && p.status !== 'CONFIGURATION_PENDING');
  const ids = new Set(plans.map((p) => p.id));
  return (await listK(c.cid, 'kpiTarget')).filter((k) => ids.has(k.planId));
}

interface Incoming {
  uid: string; source: string; taskId: string; title: string; link: string; completedOn: string; dueOn: string; quality: string; reworkCount: number; project: string; notes: string;
  kpiRef: string; sopRef: string; addedVia: 'MANUAL' | 'IMPORT' | 'WEBHOOK'; event?: string;
}

/** Validation: a piece of evidence needs a title and something a manager can open or look up (a link or a task id). */
function validateIncoming(i: Incoming): string {
  if (!i.title) return 'Give the evidence a short title.';
  if (!i.link && !i.taskId) return 'Add a link to the deliverable, or the task id, so a manager can check it.';
  if (i.link && !isLink(i.link)) return 'The link must start with http:// or https://.';
  if (i.completedOn && !isDate(i.completedOn)) return 'The completion date must look like 2026-11-03.';
  if (i.dueOn && !isDate(i.dueOn)) return 'The due date must look like 2026-11-03.';
  return '';
}

/** Stores one piece of evidence. Returns what happened so callers can tell the person in plain words. */
async function store(c: C, i: Incoming, by: { uid: string; name: string; verified: boolean }): Promise<{ outcome: 'STORED' | 'DUPLICATE' | 'UPDATED' | 'REJECTED'; item?: Item; message?: string }> {
  const p = person(c, i.uid);
  if (!p) return { outcome: 'REJECTED', message: 'That person is not an active employee of this company.' };
  const problem = validateIncoming(i);
  if (problem) return { outcome: 'REJECTED', message: problem };
  const targets = await targetsOf(c, p.uid);
  // KPI mapping: by id or by name. Unmapped evidence waits in the manager's queue; it is never guessed into a KPI.
  const ref = lc(i.kpiRef);
  const target = ref ? targets.find((t) => t.id === i.kpiRef || lc(t.kpiName) === ref) : undefined;
  const id = i.taskId ? evId(c.cid, p.uid, i.source, i.taskId) : newId();
  const prev = i.taskId ? await getK(c.cid, id, 'evidence') : null;
  if (prev && prev.status !== 'DELETED' && prev.title === i.title && prev.reference === (i.link || i.taskId) && prev.completedOn === i.completedOn && prev.quality === i.quality && prev.reworkCount === i.reworkCount) {
    return { outcome: 'DUPLICATE', item: prev, message: 'This task event was already recorded.' };
  }
  const mapped = target || (prev?.kpiTargetId ? targets.find((t) => t.id === prev.kpiTargetId) : undefined);
  const status = prev?.status === 'VERIFIED' && prev.verifiedBy ? 'PENDING_VERIFICATION' : !mapped ? 'UNMAPPED' : by.verified ? 'VERIFIED' : 'PENDING_VERIFICATION';
  const item: Item = {
    ...(prev || {}), id, companyId: c.cid, kind: 'evidence', uid: p.uid, employeeName: p.name, kpiTargetId: mapped?.id || '', kpiName: mapped?.kpiName || '', planId: mapped?.planId || '', sopId: i.sopRef || prev?.sopId || '',
    source: i.source, taskId: i.taskId, title: i.title, reference: i.link || i.taskId, link: i.link, completedOn: i.completedOn, dueOn: i.dueOn, quality: i.quality, reworkCount: i.reworkCount, project: i.project || prev?.project || '',
    notes: i.notes, addedVia: i.addedVia, addedBy: by.name, status, verifiedBy: status === 'VERIFIED' ? by.name : '', verifiedAt: status === 'VERIFIED' ? nowIso() : '',
  };
  await putK(item);
  await audit(c, 'evidence', id, prev ? 'UPDATED' : 'ADDED', prev ? { status: prev.status } : null, { status, via: i.addedVia }, p.uid);
  if (!mapped) await raise(c, 'EVIDENCE_UNAVAILABLE', { refId: `unmapped_${id}`, subjectUid: p.uid, refLabel: i.title, ownerUid: c.manager.get(p.uid) || '', detail: `"${i.title}" for ${p.name} is not linked to a KPI yet. It waits in the manager's queue and does not count until it is.` });
  return { outcome: prev ? 'UPDATED' : 'STORED', item };
}

const incoming = (b: any, uid: string, via: Incoming['addedVia']): Incoming => ({
  uid, source: oneOf(b.source, SRC, 'TASK_SYSTEM'), taskId: str(b.taskId, 80), title: str(b.title, 200), link: str(b.link, 500), completedOn: str(b.completedOn, 10), dueOn: str(b.dueOn, 10),
  quality: oneOf(b.quality, QUALITY, 'PENDING'), reworkCount: Math.max(0, Math.min(99, Number(b.reworkCount) || 0)), project: str(b.project, 120), notes: str(b.notes, 500), kpiRef: str(b.kpiTargetId || b.kpi, 160), sopRef: str(b.sopId, 80), addedVia: via, event: str(b.event, 30),
});

// ------------------------------------------------------------------ screens

async function evList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10) || 'mine';
  let items = await listK(c.cid, 'evidence');
  if (scope === 'mine') items = items.filter((e) => e.uid === c.ctx.uid);
  else if (scope === 'team') items = items.filter((e) => isMyReport(c, e.uid));
  else if (!c.isHr && !c.isApprover) return fail(403, 'You do not have permission to see everyone\'s evidence.');
  if (q.employeeUid) items = items.filter((e) => e.uid === str(q.employeeUid, 120));
  if (q.status) items = items.filter((e) => e.status === str(q.status, 30));
  if (q.queue === '1') items = items.filter((e) => ['PENDING_VERIFICATION', 'UNMAPPED'].includes(e.status));
  items = items.filter((e) => e.status !== 'DELETED' || q.deleted === '1').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 400);
  return ok({ items });
}

async function evAdd(c: C, b: any): Promise<Result> {
  const uid = str(b.employeeUid, 120) || c.ctx.uid;
  const p = person(c, uid);
  if (!p) return fail(400, 'Choose an active employee of this company.');
  const own = p.uid === c.ctx.uid;
  if (!own && !isMyReport(c, p.uid) && !c.isHr) return fail(403, 'You can add evidence for yourself or for the people who report to you.');
  const r = await store(c, incoming(b, p.uid, 'MANUAL'), { uid: c.ctx.uid, name: c.who, verified: !own && isMyReport(c, p.uid) });
  if (r.outcome === 'REJECTED') return fail(400, r.message!);
  return ok({ item: r.item, outcome: r.outcome, message: r.outcome === 'DUPLICATE' ? 'That was already recorded, so nothing was added twice.' : r.item?.status === 'VERIFIED' ? 'Added and verified.' : r.item?.status === 'UNMAPPED' ? 'Added. Choose which KPI it belongs to so it counts.' : 'Added. Your manager will check it.' });
}

/** Manager review queue: verify, reject (with a reason) or map to a KPI. */
async function evVerify(c: C, b: any): Promise<Result> {
  const e = await getK(c.cid, str(b.id, 120), 'evidence');
  if (!e) return fail(404, 'That evidence was not found.');
  if (!isMyReport(c, e.uid) && !c.isHr) return fail(403, 'Only the reporting manager (or HR) can verify evidence.');
  if (e.uid === c.ctx.uid) return fail(403, 'You cannot verify your own evidence.');
  const decision = str(b.decision, 10).toUpperCase();
  const note = str(b.note, 400);
  let next = { ...e };
  if (b.kpiTargetId) {
    const t = (await targetsOf(c, e.uid)).find((x) => x.id === str(b.kpiTargetId, 120));
    if (!t) return fail(400, 'That KPI does not belong to this person.');
    next = { ...next, kpiTargetId: t.id, kpiName: t.kpiName, planId: t.planId };
  }
  if (decision === 'REJECT') {
    if (!note) return fail(400, 'Say why this evidence is rejected.');
    next = { ...next, status: 'REJECTED', verifiedBy: c.who, verifiedAt: nowIso(), rejectionNote: note };
  } else if (decision === 'VERIFY') {
    if (!next.kpiTargetId) return fail(400, 'Choose which KPI this evidence belongs to first.');
    next = { ...next, status: 'VERIFIED', verifiedBy: c.who, verifiedAt: nowIso(), managerNote: note };
  } else if (!b.kpiTargetId) return fail(400, 'Choose Verify or Reject, or pick a KPI to map it to.');
  else next = { ...next, status: next.status === 'UNMAPPED' ? 'PENDING_VERIFICATION' : next.status };
  await putK(next);
  await audit(c, 'evidence', e.id, decision || 'MAPPED', { status: e.status }, { status: next.status, note }, e.uid);
  return ok({ item: next });
}

async function evDelete(c: C, b: any): Promise<Result> {
  const e = await getK(c.cid, str(b.id, 120), 'evidence');
  if (!e || (e.uid !== c.ctx.uid && !isMyReport(c, e.uid) && !c.isHr)) return fail(404, 'That evidence was not found.');
  if (e.status === 'VERIFIED' && e.uid === c.ctx.uid && !c.isHr) return fail(409, 'A manager has already verified this. Ask them to reject it if it is wrong.');
  // Never removed from the record: marked, so reviews that used it stay explainable.
  await putK({ ...e, status: 'DELETED', deletedBy: c.who, deletedAt: nowIso() });
  await audit(c, 'evidence', e.id, 'DELETED', { status: e.status }, { status: 'DELETED' }, e.uid);
  return ok({});
}

// ------------------------------------------------------------------ CSV import

const HEAD: Record<string, string> = {
  employee_email: 'email', email: 'email', employee: 'email', task_id: 'taskId', task: 'taskId', id: 'taskId', title: 'title', name: 'title', link: 'link', url: 'link', deliverable: 'link', completed_on: 'completedOn', completed: 'completedOn',
  due_on: 'dueOn', due: 'dueOn', kpi: 'kpi', quality: 'quality', rework: 'reworkCount', rework_count: 'reworkCount', project: 'project', source: 'source', notes: 'notes', sop: 'sopId',
};

async function evImport(c: C, b: any): Promise<Result> {
  const text = typeof b.csv === 'string' ? b.csv : '';
  const rows = parseCsv(text);
  if (rows.length < 2) return fail(400, 'The file needs a header row and at least one task. Download the template to see the columns.');
  if (rows.length > 501) return fail(400, 'Import at most 500 rows at a time.');
  const heads = rows[0].map((h) => HEAD[h.trim().toLowerCase().replace(/[^a-z]+/g, '_')] || '');
  if (!heads.includes('email') || !heads.includes('title')) return fail(400, 'The file needs at least the columns employee_email and title.');
  const result = { stored: 0, updated: 0, duplicates: 0, rejected: [] as { row: number; reason: string }[], unassigned: 0 };
  const people = new Map(c.people.filter((p) => p.active).map((p) => [p.email.toLowerCase(), p]));
  for (let r = 1; r < rows.length; r++) {
    const o: Record<string, string> = {};
    rows[r].forEach((v, i) => { if (heads[i]) o[heads[i]] = v.trim(); });
    const p = people.get((o.email || '').toLowerCase());
    if (!p) { result.unassigned++; await raise(c, 'TASK_EVENT_PROBLEM', { refId: `imp_${hash(`${o.email}|${o.taskId}`)}`, refLabel: o.title || o.taskId || 'task', detail: `Row ${r + 1}: no employee with the email "${o.email || '(empty)'}". The task was not scored for anyone.` }); continue; }
    if (!c.isHr && !isMyReport(c, p.uid) && p.uid !== c.ctx.uid) { result.rejected.push({ row: r + 1, reason: `${p.name} does not report to you.` }); continue; }
    const res = await store(c, incoming(o, p.uid, 'IMPORT'), { uid: c.ctx.uid, name: c.who, verified: false });
    if (res.outcome === 'REJECTED') result.rejected.push({ row: r + 1, reason: res.message || 'Could not be stored.' });
    else if (res.outcome === 'DUPLICATE') { result.duplicates++; }
    else if (res.outcome === 'UPDATED') result.updated++; else result.stored++;
  }
  if (result.duplicates) await raise(c, 'DUPLICATE_EVENT', { refId: `import_${today()}`, refLabel: 'CSV import', detail: `${result.duplicates} row${result.duplicates > 1 ? 's were' : ' was'} already recorded and skipped, so nothing was counted twice.` });
  return ok({ ...result, message: `${result.stored} new, ${result.updated} updated, ${result.duplicates} already there, ${result.unassigned} with no matching employee, ${result.rejected.length} rejected.` });
}

// ------------------------------------------------------------------ webhook (public, signed by a company key)

async function hookKey(c: C): Promise<Result> {
  const prev = await settingsOf(c.cid);
  const item: PmSettings = { ...(prev || {}), id: `pmset_${c.cid}`, companyId: c.cid, kind: 'setting', webhookKey: randomBytes(24).toString('hex'), aiAcknowledged: prev?.aiAcknowledged === true };
  await saveSettings(item);
  await audit(c, 'setting', item.id, prev?.webhookKey ? 'WEBHOOK_KEY_ROTATED' : 'WEBHOOK_KEY_CREATED', null, null);
  return ok({ webhookKey: item.webhookKey, companyId: c.cid });
}
async function hookInfo(c: C): Promise<Result> {
  const s = await settingsOf(c.cid);
  return ok({ webhookKey: s?.webhookKey || '', companyId: c.cid, events: ['created', 'updated', 'completed', 'deleted', 'reassigned', 'scope_changed', 'disputed'] });
}

const safeEq = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** POST /api/pm/ev-hook?c=<company id>&key=<company key> with one event or { events: [...] }. No login: the key is the credential. */
export async function evHook(r: { method: string; query: Record<string, any>; body: any }): Promise<Result> {
  if (r.method !== 'POST') return fail(405, 'Method not allowed.');
  const cid = str(r.query.c, 120); const key = str(r.query.key, 100);
  if (!cid || !key) return fail(401, 'Missing company or key.');
  const settings = await settingsOf(cid);
  if (!settings?.webhookKey || !safeEq(settings.webhookKey, key)) return fail(401, 'The key is not valid.');
  const company = await db().collection('companies').doc(cid).get();
  if (!company.exists || (company.data() as any)?.status !== 'ACTIVE') return fail(403, 'This company is not active.');
  const c = await loadSystem(cid, 'Task webhook');
  const events: any[] = Array.isArray(r.body?.events) ? r.body.events.slice(0, 200) : r.body && typeof r.body === 'object' ? [r.body] : [];
  if (events.length === 0) return fail(400, 'Send an event, or { "events": [ ... ] }.');
  const people = new Map(c.people.filter((p) => p.active).map((p) => [p.email.toLowerCase(), p]));
  const tally = { stored: 0, duplicates: 0, logged: 0 };
  for (const ev of events) {
    const event = str(ev?.event, 30).toLowerCase() || 'completed';
    const taskId = str(ev?.taskId, 80);
    const p = people.get(str(ev?.employeeEmail, 160).toLowerCase());
    if (!p) { await raise(c, 'TASK_EVENT_PROBLEM', { refId: `hook_${hash(`${taskId}|${ev?.employeeEmail}`)}`, refLabel: str(ev?.title, 120) || taskId || 'task', detail: `Task event "${event}" for ${taskId || 'a task'} had no matching employee (${str(ev?.employeeEmail, 120) || 'no email'}). It was logged, not scored.` }); tally.logged++; continue; }
    const id = taskId ? evId(cid, p.uid, oneOf(ev?.source, SRC, 'TASK_SYSTEM'), taskId) : '';
    const existing = id ? await getK(cid, id, 'evidence') : null;
    if (event === 'deleted') {
      if (existing) await putK({ ...existing, status: 'DELETED', deletedBy: 'Task webhook', deletedAt: nowIso() });
      await raise(c, 'TASK_EVENT_PROBLEM', { refId: `del_${id || hash(taskId)}`, subjectUid: p.uid, refLabel: taskId, ownerUid: c.manager.get(p.uid) || '', detail: `Task ${taskId} was deleted in the task system. Any evidence from it no longer counts; the manager is told rather than a score changing silently.` });
      tally.logged++; continue;
    }
    if (['reassigned', 'scope_changed', 'disputed'].includes(event)) {
      if (existing) await putK({ ...existing, status: 'PENDING_VERIFICATION', verifiedBy: '', verifiedAt: '', notes: `${existing.notes || ''} [${event}]`.trim() });
      await raise(c, 'TASK_EVENT_PROBLEM', { refId: `${event}_${id || hash(taskId)}`, subjectUid: p.uid, refLabel: taskId, ownerUid: c.manager.get(p.uid) || '', detail: `Task ${taskId}: ${event.replace('_', ' ')}. The manager decides whether the evidence still counts.` });
      tally.logged++; continue;
    }
    const res = await store(c, incoming(ev, p.uid, 'WEBHOOK'), { uid: 'system', name: 'Task webhook', verified: false });
    if (res.outcome === 'DUPLICATE') { tally.duplicates++; await raise(c, 'DUPLICATE_EVENT', { refId: `hook_${res.item?.id}`, refLabel: taskId, detail: `Task ${taskId} was sent again. It was ignored, so nothing was counted twice.` }); }
    else if (res.outcome === 'REJECTED') { tally.logged++; await raise(c, 'TASK_EVENT_PROBLEM', { refId: `bad_${hash(`${taskId}|${res.message}`)}`, subjectUid: p.uid, refLabel: taskId, detail: `Task ${taskId}: ${res.message}` }); }
    else tally.stored++;
  }
  return ok(tally);
}

// ------------------------------------------------------------------ context a manager sees next to the evidence (never a score)

/** Approved leave days and client allocation in the period. "Availability context only": shown for fairness, never turned into a rating. */
export async function workContext(c: C, uid: string, from: string, to: string) {
  const [leave, map] = await Promise.all([
    db().collection('leaveRequests').where('companyId', '==', c.cid).where('uid', '==', uid).get(),
    db().collection('hrbpItems').where('companyId', '==', c.cid).where('kind', '==', 'mapping').get(),
  ]);
  const days = leave.docs.map((d: any) => d.data() as any).filter((r: any) => r.status === 'APPROVED' && r.from && r.to).reduce((s: number, r: any) => s + overlapDays(r.from, r.to, from, to), 0);
  const m = map.docs.map((d: any) => d.data() as any).find((x: any) => x.employeeUid === uid);
  return { leaveDays: days, businessUnit: m?.businessUnit || '', billable: m?.billable ?? null, clientAllocation: Array.isArray(m?.clientAllocation) ? m.clientAllocation : [] };
}

/** Verified evidence for one person in a period, grouped by KPI target (used by the review screen). Counts are information only. */
export async function evidenceFor(c: C, uid: string, from: string, to: string) {
  const all = (await listK(c.cid, 'evidence')).filter((e) => e.uid === uid && e.status !== 'DELETED');
  const inPeriod = all.filter((e) => { const d = e.completedOn || String(e.createdAt || '').slice(0, 10); return d >= from && d <= to; });
  return inPeriod;
}

export const EVIDENCE_ROUTES: Record<string, Route> = {
  'ev-list': { method: 'GET', who: 'any', run: (c, b, q) => evList(c, b, q) },
  'ev-add': { method: 'POST', who: 'any', run: (c, b) => evAdd(c, b) },
  'ev-verify': { method: 'POST', who: 'any', run: (c, b) => evVerify(c, b) },
  'ev-delete': { method: 'POST', who: 'any', run: (c, b) => evDelete(c, b) },
  'ev-import': { method: 'POST', who: 'any', run: (c, b) => evImport(c, b) },
  'hook-key': { method: 'POST', who: 'hr', run: (c) => hookKey(c) },
  'hook-info': { method: 'GET', who: 'hr', run: (c) => hookInfo(c) },
};

export { addDays, clean };
