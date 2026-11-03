/**
 * HR-PM-006 monthly check-ins (workflow PM-006) and HR-PM-007 development plans (workflow PM-008).
 *  - A check-in is generated once per person per month (the id is the person and the month, so running it twice is harmless).
 *  - A development plan comes from an approved review. It is for growth, improvement or recognition. Nothing here starts
 *    disciplinary action: an improvement plan is always written and approved by people, never started by the system or by AI.
 */
import { addDays, isDate, isFinal, monthOf } from '../../shared/pmEngine.js';
import { audit, fail, getK, isMyReport, listK, managerOf, nameOf, nowIso, ok, putK, str, tell, today, newId, type C, type Item, type Route, type Result } from './pmCore.js';

const ciId = (uid: string, month: string) => `ci_${uid}_${month}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);

/** Daily job: make sure every active person who has a manager has a check-in for this month. */
export async function generateCheckins(c: C): Promise<{ created: number }> {
  const month = monthOf(today());
  let created = 0;
  for (const p of c.people.filter((x) => x.active)) {
    const mgr = managerOf(c, p.uid);
    if (!mgr) continue;
    const id = ciId(p.uid, month);
    if (await getK(c.cid, id, 'checkin')) continue;
    await putK({ id, companyId: c.cid, kind: 'checkin', uid: p.uid, employeeName: p.name, managerUid: mgr, managerName: nameOf(c, mgr), month, dueBy: addDays(`${month}-28`, 0), status: 'DUE', focus: '', wins: '', concerns: '', support: '', employeeComment: '', doneAt: '' });
    await tell(c, [mgr], `Monthly check-in with ${p.name}`, `Please hold this month's short check-in and record it under Performance > Check-ins${''}.`);
    created++;
  }
  return { created };
}

async function checkinList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10) || 'mine';
  let items = await listK(c.cid, 'checkin');
  if (scope === 'mine') items = items.filter((x) => x.uid === c.ctx.uid);
  else if (scope === 'team') items = items.filter((x) => isMyReport(c, x.uid) || x.managerUid === c.ctx.uid);
  else if (!c.isHr) return fail(403, 'You do not have permission to see every check-in.');
  if (q.month) items = items.filter((x) => x.month === str(q.month, 7));
  const t = today();
  return ok({ items: items.sort((a, b) => String(b.month).localeCompare(String(a.month)) || String(a.employeeName).localeCompare(String(b.employeeName))).map((x) => ({ ...x, overdue: x.status === 'DUE' && x.dueBy < t })) });
}

async function checkinSave(c: C, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 160), 'checkin');
  if (!it) return fail(404, 'That check-in was not found.');
  if (it.uid === c.ctx.uid) return fail(403, 'Your manager records the check-in. You can add your own comment on it.');
  if (managerOf(c, it.uid) !== c.ctx.uid && !c.isHr) return fail(403, 'Only the reporting manager can record this check-in.');
  const next: Item = { ...it, focus: str(b.focus, 1000), wins: str(b.wins, 1000), concerns: str(b.concerns, 1000), support: str(b.support, 1000) };
  if (b.done === true) {
    if (!next.wins && !next.focus && !next.concerns) return fail(400, 'Write at least one note (wins, focus or concerns) before marking it done.');
    next.status = 'DONE'; next.doneAt = nowIso(); next.managerUid = managerOf(c, it.uid) || it.managerUid;
    await tell(c, [it.uid], 'Your monthly check-in was recorded', 'Open Performance > My performance to read it and add your comment.');
  }
  await putK(next);
  await audit(c, 'checkin', it.id, b.done === true ? 'COMPLETED' : 'SAVED', null, { status: next.status }, it.uid);
  return ok({ item: next });
}

async function checkinComment(c: C, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 160), 'checkin');
  if (!it || it.uid !== c.ctx.uid) return fail(404, 'That check-in was not found.');
  if (it.status !== 'DONE') return fail(409, 'Your manager has not recorded this check-in yet.');
  const next = { ...it, employeeComment: str(b.comment, 1000) };
  await putK(next); await audit(c, 'checkin', it.id, 'EMPLOYEE_COMMENT', null, { comment: next.employeeComment }, it.uid);
  return ok({ item: next });
}

// ------------------------------------------------------------------ development plans

const DEV_TYPES = ['DEVELOPMENT', 'IMPROVEMENT', 'RECOGNITION'] as const;
type DevType = (typeof DEV_TYPES)[number];

async function devList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10) || 'mine';
  let items = await listK(c.cid, 'devPlan');
  if (scope === 'mine') items = items.filter((x) => x.uid === c.ctx.uid && !(x.type === 'IMPROVEMENT' && x.status === 'PROPOSED'));
  else if (scope === 'team') items = items.filter((x) => isMyReport(c, x.uid) || x.managerUid === c.ctx.uid);
  else if (!c.isHr) return fail(403, 'You do not have permission to see every development plan.');
  return ok({ items: items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

const cleanActions = (v: unknown, prev: any[] = []) => (Array.isArray(v) ? v : []).slice(0, 20).map((a: any, i: number) => {
  const old = prev.find((p) => p.id === a?.id);
  const due = isDate(a?.dueDate) ? a.dueDate : '';
  return { id: old?.id || `a${Date.now().toString(36)}${i}`, text: str(a?.text, 300), dueDate: due, done: !!(a?.done ?? old?.done), doneAt: a?.done && !old?.done ? nowIso() : old?.doneAt || '' };
}).filter((a: any) => a.text);

async function devSave(c: C, b: any): Promise<Result> {
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'devPlan') : null;
  if (b.id && !prev) return fail(404, 'That plan was not found.');
  const uid = prev?.uid || str(b.uid, 120);
  const p = c.byKey.get(uid);
  if (!p) return fail(400, 'Choose the employee.');
  if (uid === c.ctx.uid) return fail(403, 'You cannot write your own plan. Your manager does this with you.');
  if (managerOf(c, uid) !== c.ctx.uid && !c.isHr) return fail(403, 'Only the reporting manager or HR can write this plan.');
  const type = (DEV_TYPES as readonly string[]).includes(str(b.type, 20)) ? (str(b.type, 20) as DevType) : prev?.type || 'DEVELOPMENT';
  const reviewId = str(b.reviewId ?? prev?.reviewId, 160);
  if (type === 'IMPROVEMENT') {
    const rv = reviewId ? await getK(c.cid, reviewId, 'review') : null;
    if (!rv || rv.uid !== uid || !isFinal(rv.status)) return fail(400, 'An improvement plan must come from this person\'s approved review. Pick the review it is based on.');
  }
  if (prev && ['COMPLETED', 'CANCELLED'].includes(prev.status)) return fail(409, 'This plan is closed.');
  const title = str(b.title, 160);
  if (!title) return fail(400, 'Give the plan a short title.');
  const actions = cleanActions(b.actions, prev?.actions);
  if (actions.length === 0) return fail(400, 'Add at least one action, with what the person will do and by when.');
  const item: Item = {
    ...(prev || {}), id: prev?.id || newId(), companyId: c.cid, kind: 'devPlan', uid, employeeName: p.name, managerUid: managerOf(c, uid), managerName: nameOf(c, managerOf(c, uid)),
    type, reviewId, title, goal: str(b.goal, 800), actions, supportNeeded: str(b.supportNeeded, 600), reviewOn: isDate(b.reviewOn) ? b.reviewOn : prev?.reviewOn || '',
    // Growth and recognition plans start at once; an improvement plan waits for HR to approve it.
    status: prev?.status || (type === 'IMPROVEMENT' ? 'PROPOSED' : 'ACTIVE'), createdBy: prev?.createdBy || c.who,
  };
  await putK(item);
  await audit(c, 'devPlan', item.id, prev ? 'UPDATED' : 'CREATED', prev ? { status: prev.status } : null, { type, status: item.status }, uid);
  if (!prev && item.status === 'ACTIVE') await tell(c, [uid], 'You have a new development plan', `${title}. Open Performance > Development to see it.`);
  return ok({ item, message: item.status === 'PROPOSED' ? 'Saved. An improvement plan needs HR approval before the employee sees it.' : 'Saved.' });
}

async function devAct(c: C, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 80), 'devPlan');
  if (!it) return fail(404, 'That plan was not found.');
  const action = str(b.action, 20).toUpperCase();
  const mine = it.uid === c.ctx.uid;
  const mgr = managerOf(c, it.uid) === c.ctx.uid;
  if (action === 'TICK') {
    if (!(mine || mgr || c.isHr)) return fail(403, 'You cannot update this plan.');
    if (it.status !== 'ACTIVE') return fail(409, 'This plan is not active.');
    const actions = it.actions.map((a: any) => (a.id === str(b.actionId, 60) ? { ...a, done: b.done !== false, doneAt: b.done !== false ? nowIso() : '' } : a));
    await putK({ ...it, actions }); await audit(c, 'devPlan', it.id, 'ACTION_TICKED', null, { actionId: b.actionId }, it.uid);
    return ok({ item: { ...it, actions } });
  }
  if (action === 'APPROVE') {
    if (!c.isHr || mine) return fail(403, 'Only HR (not the employee) can approve an improvement plan.');
    if (it.status !== 'PROPOSED') return fail(409, 'This plan is not waiting for approval.');
    const next = { ...it, status: 'ACTIVE', approvedBy: c.who, approvedAt: nowIso() }; await putK(next);
    await audit(c, 'devPlan', it.id, 'APPROVED', { status: 'PROPOSED' }, { status: 'ACTIVE' }, it.uid);
    await tell(c, [it.uid], 'You have a new plan', `${it.title}. Open Performance > Development to see it and talk it through with your manager.`);
    return ok({ item: next });
  }
  if (action === 'COMPLETE' || action === 'CANCEL') {
    if (!(mgr || c.isHr) || mine) return fail(403, 'Only the manager or HR can close a plan.');
    if (!['ACTIVE', 'PROPOSED'].includes(it.status)) return fail(409, 'This plan is already closed.');
    const note = str(b.note, 600);
    if (!note) return fail(400, 'Write a short closing note.');
    const next = { ...it, status: action === 'COMPLETE' ? 'COMPLETED' : 'CANCELLED', closingNote: note, closedAt: nowIso(), closedBy: c.who }; await putK(next);
    await audit(c, 'devPlan', it.id, action === 'COMPLETE' ? 'COMPLETED' : 'CANCELLED', { status: it.status }, { status: next.status, note }, it.uid);
    return ok({ item: next });
  }
  return fail(400, 'Unknown action.');
}

export const GROWTH_ROUTES: Record<string, Route> = {
  'checkin-list': { method: 'GET', who: 'any', run: (c, b, q) => checkinList(c, b, q) },
  'checkin-save': { method: 'POST', who: 'any', run: (c, b) => checkinSave(c, b) },
  'checkin-comment': { method: 'POST', who: 'any', run: (c, b) => checkinComment(c, b) },
  'dev-list': { method: 'GET', who: 'any', run: (c, b, q) => devList(c, b, q) },
  'dev-save': { method: 'POST', who: 'any', run: (c, b) => devSave(c, b) },
  'dev-act': { method: 'POST', who: 'any', run: (c, b) => devAct(c, b) },
};
