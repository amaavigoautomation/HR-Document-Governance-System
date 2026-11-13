/**
 * Task Management: the rules, then the whole API (who may assign, review and approval, boards, KPI evidence, attachments, daily reminders).
 * Run: npx tsx tests/task.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTasks, runDaily } from '../api/_lib/taskApi.ts';
import { __useAttachmentStore, cloudinarySign, type AttachmentStore } from '../api/_lib/taskCore.ts';
import {
  attachmentProblem, canAssignTo, downline, moveCheck, reviewPlan, sortForList, stats, taskProblem, weekStart, type MoveWho,
} from '../shared/taskEngine.ts';
import { addDays, istToday } from '../shared/pmEngine.ts';

// ---------------------------------------------------------------- pure rules
{
  const mgr = { a: 'boss', b: 'boss', boss: 'ceo', c: 'a', loop1: 'loop2', loop2: 'loop1' };
  assert.deepEqual([...downline(mgr, 'boss')].sort(), ['a', 'b', 'c'], 'reports and their reports');
  assert.deepEqual([...downline(mgr, 'ceo')].sort(), ['a', 'b', 'boss', 'c']);
  assert.equal(downline(mgr, 'a').has('boss'), false, 'never upwards');
  assert.doesNotThrow(() => downline(mgr, 'loop1'), 'a reporting loop does not hang');
  const dl = downline(mgr, 'boss');
  assert.equal(canAssignTo({ actor: 'boss', target: 'c', actorDownline: dl, unrestricted: false }), true);
  assert.equal(canAssignTo({ actor: 'a', target: 'b', actorDownline: downline(mgr, 'a'), unrestricted: false }), false, 'peers cannot give each other tasks');
  assert.equal(canAssignTo({ actor: 'a', target: 'a', actorDownline: new Set(), unrestricted: false }), true, 'anyone may plan their own work');
  assert.equal(canAssignTo({ actor: 'a', target: 'boss', actorDownline: new Set(), unrestricted: false }), false, 'nobody gives work upwards');
  assert.equal(canAssignTo({ actor: 'hr', target: 'b', actorDownline: new Set(), unrestricted: true }), true, 'admins assign to anyone');

  const T = istToday();
  assert.match(taskProblem({ title: 'a' }, T, { creating: true })!, /title/);
  assert.match(taskProblem({ title: 'Ship it', dueDate: addDays(T, -1) }, T, { creating: true })!, /past/);
  assert.equal(taskProblem({ title: 'Ship it', dueDate: addDays(T, -1) }, T, { creating: false }), null, 'an old due date stays editable');
  assert.match(taskProblem({ title: 'Ship it', startDate: addDays(T, 5), dueDate: addDays(T, 2) }, T, { creating: true })!, /before the start/);
  assert.match(taskProblem({ title: 'Ship it', priority: 'ASAP' }, T, { creating: true })!, /priority/);

  assert.equal(reviewPlan({ requiresReview: false, kpiLinked: false, creatorUid: 'boss', assigneeUid: 'a' }).requiresReview, false);
  assert.equal(reviewPlan({ requiresReview: false, kpiLinked: true, creatorUid: 'boss', assigneeUid: 'a' }).reviewerUid, 'boss', 'a KPI-linked task always needs review');
  assert.equal(reviewPlan({ requiresReview: true, kpiLinked: false, creatorUid: 'a', assigneeUid: 'a', assigneeManager: 'boss' }).reviewerUid, 'boss', 'self-given: the manager reviews');
  assert.match(reviewPlan({ requiresReview: true, kpiLinked: false, creatorUid: 'a', assigneeUid: 'a' }).error!, /Choose who/);
  assert.match(reviewPlan({ requiresReview: true, kpiLinked: false, creatorUid: 'boss', assigneeUid: 'a', reviewerUid: 'a' }).error!, /someone other/);

  const w = (o: Partial<MoveWho>): MoveWho => ({ isAssignee: false, isReviewer: false, isOwner: false, isAdmin: false, ...o });
  const task = (status: string, requiresReview = true) => ({ status, assigneeUid: 'a', creatorUid: 'boss', reviewerUid: 'boss', requiresReview });
  assert.equal(moveCheck(task('TODO', false), 'DONE', w({ isAssignee: true })).ok, true, 'no review: the person finishes it');
  assert.equal(moveCheck(task('TODO', false), 'IN_REVIEW', w({ isAssignee: true })).ok, false, 'no review: cannot be sent for review');
  assert.equal(moveCheck(task('IN_PROGRESS'), 'DONE', w({ isAssignee: true })).ok, false, 'reviewed task cannot skip the review');
  assert.equal(moveCheck(task('IN_PROGRESS'), 'IN_REVIEW', w({ isAssignee: true })).ok, true);
  assert.equal(moveCheck(task('IN_REVIEW'), 'DONE', w({ isAssignee: true })).ok, false, 'nobody approves their own work');
  assert.equal(moveCheck(task('IN_REVIEW'), 'DONE', w({ isAssignee: true, isAdmin: true })).ok, false, 'not even an admin who is the assignee');
  assert.equal(moveCheck(task('IN_REVIEW'), 'DONE', w({ isOwner: true })).ok, false, 'the person who gave it is not automatically the reviewer');
  const approve = moveCheck(task('IN_REVIEW'), 'DONE', w({ isReviewer: true, isOwner: true }));
  assert.ok(approve.ok && approve.approves);
  const back = moveCheck(task('IN_REVIEW'), 'REWORK', w({ isReviewer: true }));
  assert.ok(back.ok && back.needsNote, 'sending back needs a reason');
  assert.equal(moveCheck(task('IN_PROGRESS'), 'REWORK', w({ isReviewer: true })).ok, false);
  assert.equal(moveCheck(task('DONE'), 'IN_PROGRESS', w({ isAssignee: true })).ok, false, 'a reviewed, approved task cannot be quietly reopened by the doer');
  assert.equal(moveCheck(task('DONE'), 'IN_PROGRESS', w({ isReviewer: true })).ok, true);
  assert.equal(moveCheck(task('IN_PROGRESS', false), 'TODO', w({ isAssignee: true })).ok, true);
  assert.equal(moveCheck(task('IN_PROGRESS', false), 'TODO', w({})).ok, false, 'a stranger cannot move it');

  assert.equal(attachmentProblem('plan.pdf', 1000, 0), null);
  assert.match(attachmentProblem('run.exe', 1000, 0)!, /cannot be attached/);
  assert.match(attachmentProblem('big.pdf', 11 * 1024 * 1024, 0)!, /10 MB/);
  assert.match(attachmentProblem('x.pdf', 10, 10)!, /up to 10/);
  assert.equal(weekStart('2026-11-15'), '2026-11-09', 'weeks start on Monday');

  const base = { assigneeUid: 'a', creatorUid: 'boss' };
  const s = stats([
    { ...base, status: 'IN_PROGRESS', dueDate: addDays(T, -2) }, { ...base, status: 'TODO', dueDate: T }, { ...base, assigneeUid: 'b', status: 'IN_REVIEW' },
    { ...base, status: 'DONE', completedAt: `${T}T05:00:00Z`, createdAt: `${addDays(T, -4)}T05:00:00Z` },
  ] as any, T);
  assert.equal(s.open, 3); assert.equal(s.done, 1); assert.equal(s.overdue, 1); assert.equal(s.dueToday, 1); assert.equal(s.inReview, 1); assert.equal(s.noDueDate, 1);
  assert.equal(s.workload[0].uid, 'a'); assert.equal(s.workload[0].overdue, 1);
  assert.ok(s.workload.every((x) => !('done' in x)), 'the workload view never counts finished tasks per person');
  assert.equal(s.throughput.at(-1)!.done, 1); assert.equal(s.avgDaysToFinish, 4);
  const sorted = sortForList([{ status: 'TODO', priority: 'LOW', dueDate: addDays(T, 1) }, { status: 'TODO', priority: 'HIGH', dueDate: addDays(T, 9) }, { status: 'TODO', priority: 'LOW', dueDate: addDays(T, -1) }], T);
  assert.equal(sorted[0].dueDate, addDays(T, -1), 'late work first'); assert.equal(sorted[1].priority, 'HIGH');
  // Cloudinary's documented example: parameters sorted, joined, secret appended, SHA-1.
  assert.equal(cloudinarySign({ timestamp: 1315060510, public_id: 'sample' }, 'abcd'), cloudinarySign({ public_id: 'sample', timestamp: 1315060510 }, 'abcd'), 'order of parameters does not matter');
}

// ---------------------------------------------------------------- the app
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['task.manage']); const AP = tok('u_ap', ['task.view_all']); const BOSS = tok('u_boss'); const A = tok('u_a'); const B = tok('u_b'); const D = tok('u_d');
const OTHER = tok('x1', ['task.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeTasks({ method, action, headers: h, body, query });
const get = (h: any, action: string, query: any = {}) => call(h, 'GET', action, {}, query);
const post = (h: any, action: string, body: any = {}) => call(h, 'POST', action, body);
const okc = (r: any, msg = '') => { assert.equal(r.status, 200, `${msg} ${JSON.stringify(r.json)}`); return r.json; };
const no = (r: any, status: number, msg = '') => assert.equal(r.status, status, `${msg} ${JSON.stringify(r.json)}`);

const emp = (id: string, name: string, dept: string, title: string, perms: string[] = []) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title, perms, createdAt: '2025-01-01T00:00:00Z' });
emp('u_hr', 'Neha HR', 'HR', 'HR Manager', ['task.manage']); emp('u_ap', 'Ajay Founder', 'Management', 'Founder', ['task.view_all']); emp('u_boss', 'Rahul', 'Design', 'Design Lead');
emp('u_a', 'Priya', 'Design', 'Designer'); emp('u_b', 'Bilal', 'Design', 'Designer'); emp('u_d', 'Dev', 'Sales', 'Sales Executive');
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other', email: 'x1@o.com', active: true, departmentName: 'Design', title: 'Designer' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
const mgr = (uid: string, m: string) => fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: m });
mgr('u_a', 'u_boss'); mgr('u_b', 'u_boss'); mgr('u_d', 'u_boss'); mgr('u_boss', 'u_ap'); mgr('u_hr', 'u_ap');
const T = istToday();

// A fake file store, standing in for Cloudinary.
const files = new Map<string, { bytes: number; format: string; resourceType: string }>();
const removed: string[] = [];
let configured = true;
const fake: AttachmentStore = {
  name: 'fake', configured: () => configured,
  ticket: (publicId) => ({ uploadUrl: 'https://upload.test/x', apiKey: 'k', fields: { public_id: publicId, signature: 's' } }),
  inspect: async (publicId, resourceType) => (files.has(publicId) ? { ...files.get(publicId)!, resourceType } : null),
  link: (publicId, _rt, _f, name) => `https://files.test/${publicId}?n=${name}`,
  remove: async (publicId) => { removed.push(publicId); files.delete(publicId); },
};
__useAttachmentStore(fake);

async function main() {
  // ---- access
  no(await call({}, 'GET', 'meta'), 401);
  no(await post(A, 'meta'), 405);
  no(await get(A, 'nope'), 404);

  // ---- who can give tasks to whom
  let m = okc(await get(A, 'meta'));
  assert.deepEqual(m.assignable, ['u_a'], 'an employee can only plan their own work');
  assert.equal(m.flags.manager, false);
  m = okc(await get(BOSS, 'meta'));
  assert.deepEqual([...m.assignable].sort(), ['u_a', 'u_b', 'u_boss', 'u_d'], 'a manager: themselves and their reports');
  assert.equal(m.flags.manager, true);
  assert.equal(okc(await get(HR, 'meta')).assignable.length, 6, 'task.manage: everyone');
  assert.equal(okc(await get(A, 'meta')).storage.enabled, true);

  const mine = okc(await post(A, 'save', { title: 'Plan my week', dueDate: T, priority: 'HIGH', tags: 'Planning, planning, weekly', checklist: [{ text: 'Mon' }, { text: 'Tue' }] })).item;
  assert.equal(mine.assigneeUid, 'u_a'); assert.deepEqual(mine.tags, ['planning', 'weekly'], 'tags are tidied'); assert.equal(mine.checklist.length, 2);
  no(await post(A, 'save', { title: 'Do this for Bilal', assigneeUid: 'u_b' }), 403, 'peers cannot give each other tasks');
  no(await post(A, 'save', { title: 'Do this for boss', assigneeUid: 'u_boss' }), 403, 'nobody gives work upwards');
  no(await post(A, 'save', { title: 'x' }), 400, 'title too short');
  no(await post(BOSS, 'save', { title: 'Old thing', dueDate: addDays(T, -3), assigneeUid: 'u_a' }), 400, 'due date in the past');
  no(await post(BOSS, 'save', { title: 'Ghost task', assigneeUid: 'nobody' }), 400);
  okc(await post(HR, 'save', { title: 'HR gives a task to Dev', assigneeUid: 'u_d' }));

  // ---- who sees which task
  no(await get(B, 'get', { id: mine.id }), 404, 'a peer cannot open a personal task');
  okc(await get(A, 'get', { id: mine.id }));
  okc(await get(BOSS, 'get', { id: mine.id }));
  okc(await get(AP, 'get', { id: mine.id }));
  okc(await get(HR, 'get', { id: mine.id }));
  no(await get(OTHER, 'get', { id: mine.id }), 404, 'another company sees nothing');
  assert.equal(okc(await get(B, 'list')).items.length, 0);
  assert.equal(okc(await get(BOSS, 'list', { scope: 'team' })).items.length, 2, "boss's team list: Priya's and Dev's tasks");
  assert.equal(okc(await get(A, 'list', { scope: 'team' })).items.length, 0, 'an employee has an empty team list');
  no(await get(A, 'list', { scope: 'all' }), 403);
  assert.equal(okc(await get(AP, 'list', { scope: 'all' })).items.length, 2);

  // ---- ordinary task: the person finishes it themselves
  no(await post(B, 'move', { id: mine.id, status: 'IN_PROGRESS' }), 404);
  okc(await post(A, 'move', { id: mine.id, status: 'IN_PROGRESS' }));
  no(await post(A, 'move', { id: mine.id, status: 'IN_REVIEW' }), 400, 'no review needed');
  let ck = okc(await post(A, 'check', { id: mine.id, itemId: mine.checklist[0].id, done: true })).item;
  assert.equal(ck.checklist[0].done, true);
  no(await post(B, 'check', { id: mine.id, itemId: mine.checklist[0].id, done: true }), 404);
  okc(await post(A, 'comment', { id: mine.id, text: 'Started on Monday items' }));
  no(await post(A, 'comment', { id: mine.id, text: '' }), 400);
  const done = okc(await post(A, 'move', { id: mine.id, status: 'DONE' })).item;
  assert.ok(done.completedAt);
  no(await post(A, 'check', { id: mine.id, itemId: mine.checklist[1].id, done: true }), 400, 'a finished task is locked');
  no(await post(BOSS, 'save', { id: mine.id, title: 'Edited after done' }), 400, 'reopen first');
  let det = okc(await get(A, 'get', { id: mine.id }));
  assert.ok(det.log.some((l: any) => l.kind === 'COMMENT' && /Monday/.test(l.detail)) && det.log.some((l: any) => l.action === 'MOVED'), 'comments and activity are kept');
  assert.equal(det.can.edit, false);

  // ---- a reviewed task: boss gives Priya work, she sends it for review, he approves or sends it back
  const rv = okc(await post(BOSS, 'save', { title: 'Brand guidelines v2', assigneeUid: 'u_a', requiresReview: true, dueDate: addDays(T, 5) })).item;
  assert.equal(rv.reviewerUid, 'u_boss', 'the person who gave the task reviews it by default'); assert.equal(rv.requiresReview, true);
  no(await post(BOSS, 'save', { title: 'Self reviewed', assigneeUid: 'u_a', requiresReview: true, reviewerUid: 'u_a' }), 400, 'cannot review your own task');
  no(await post(A, 'save', { id: rv.id, title: 'Hijacked' }), 403, 'the person doing it cannot rewrite it');
  no(await post(A, 'move', { id: rv.id, status: 'DONE' }), 400, 'must go through review');
  okc(await post(A, 'move', { id: rv.id, status: 'IN_PROGRESS' }));
  okc(await post(A, 'move', { id: rv.id, status: 'IN_REVIEW' }));
  assert.equal(okc(await get(BOSS, 'list', { scope: 'review' })).items.length, 1, 'it shows in the reviewer\'s list');
  no(await post(A, 'move', { id: rv.id, status: 'DONE' }), 400, 'cannot approve own work');
  no(await post(BOSS, 'move', { id: rv.id, status: 'REWORK' }), 400, 'a reason is required');
  okc(await post(BOSS, 'move', { id: rv.id, status: 'REWORK', note: 'Colour palette is missing' }));
  det = okc(await get(A, 'get', { id: rv.id }));
  assert.ok(det.log.some((l: any) => l.kind === 'COMMENT' && /palette/.test(l.detail)), 'the reason is on the task');
  okc(await post(A, 'move', { id: rv.id, status: 'IN_REVIEW' }));
  const appr = okc(await post(BOSS, 'move', { id: rv.id, status: 'DONE' })).item;
  assert.equal(appr.status, 'DONE'); assert.equal(appr.reviewedBy, 'Rahul');
  no(await post(A, 'move', { id: rv.id, status: 'IN_PROGRESS' }), 400, 'the doer cannot quietly reopen approved work');
  okc(await post(BOSS, 'move', { id: rv.id, status: 'IN_PROGRESS' }));

  // ---- boards: company-wide and per department
  no(await post(A, 'project-save', { name: 'Everyone board', scope: 'COMPANY' }), 403, 'only task.manage makes company-wide boards');
  no(await post(A, 'project-save', { name: 'Design board', scope: 'DEPARTMENT', department: 'Design' }), 403, 'an employee cannot create boards');
  const company = okc(await post(HR, 'project-save', { name: 'Company goals', scope: 'COMPANY' })).item;
  const design = okc(await post(BOSS, 'project-save', { name: 'Design sprint', scope: 'DEPARTMENT', department: 'Design' })).item;
  no(await post(BOSS, 'project-save', { name: 'Sales sprint', scope: 'DEPARTMENT', department: 'Sales' }), 403, 'a manager creates boards only for their own department');
  no(await post(BOSS, 'project-save', { name: 'design sprint', scope: 'DEPARTMENT', department: 'Design' }), 400, 'duplicate name');
  assert.equal(okc(await get(A, 'meta')).projects.length, 2, 'Priya (Design) sees the company board and the Design board');
  assert.deepEqual(okc(await get(D, 'meta')).projects.map((p: any) => p.name), ['Company goals'], 'Dev (Sales) sees only the company board');
  no(await post(D, 'save', { title: 'Sneaky', projectId: design.id }), 400, 'cannot use a board you cannot open');
  const onBoard = okc(await post(A, 'save', { title: 'Moodboard', projectId: design.id })).item;
  assert.equal(onBoard.projectName, 'Design sprint');
  assert.equal(okc(await get(B, 'list', { scope: 'project', projectId: design.id })).items.length, 1, 'everyone on the board sees its tasks, including a peer');
  okc(await get(B, 'get', { id: onBoard.id }));
  no(await get(D, 'list', { scope: 'project', projectId: design.id }), 404, 'Sales cannot open the Design board');
  no(await get(D, 'get', { id: onBoard.id }), 404);
  okc(await post(A, 'save', { id: onBoard.id, title: 'Moodboard', projectId: design.id, description: 'ok' }), 'the creator can edit their own task');
  no(await post(D, 'project-archive', { id: design.id }), 403);
  okc(await post(BOSS, 'project-archive', { id: design.id }));
  assert.equal(okc(await get(A, 'meta')).projects.length, 1, 'archived boards disappear from the pickers');
  okc(await post(BOSS, 'project-archive', { id: design.id, archived: false }));

  // ---- Performance link: a KPI-linked task becomes work evidence once reviewed
  fdb.seed('pmPlans', 'plan_a', { id: 'plan_a', companyId: CID, uid: 'u_a', status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z', kpis: [{ id: 'k1', kra: 'Delivery', kpi: 'Deliverables on time', measure: 'task records', weight: 100 }] });
  assert.equal(okc(await get(BOSS, 'kpis', { uid: 'u_a' })).items.length, 1);
  assert.equal(okc(await get(B, 'kpis', { uid: 'u_a' })).items.length, 0, 'a peer cannot read someone else\'s KPIs');
  no(await post(BOSS, 'save', { title: 'Wrong KPI', assigneeUid: 'u_a', kpiId: 'nope' }), 400);
  const kt = okc(await post(BOSS, 'save', { title: 'Diwali campaign creatives', assigneeUid: 'u_a', kpiId: 'k1' })).item;
  assert.equal(kt.requiresReview, true, 'a KPI-linked task always needs a review'); assert.equal(kt.kpi.kpiName, 'Deliverables on time');
  okc(await post(A, 'move', { id: kt.id, status: 'IN_REVIEW' }));
  const ktDone = okc(await post(BOSS, 'move', { id: kt.id, status: 'DONE' }));
  assert.equal(ktDone.item.evidenceStatus, 'VERIFIED', "the person's manager reviewed it, so the work is already vouched for");
  const ev = (await fdb.collection('pmEvidence').doc(`${CID}_task_${kt.id}`).get()).data()!;
  assert.equal(ev.uid, 'u_a'); assert.equal(ev.kpiId, 'k1'); assert.equal(ev.source, 'TASK'); assert.equal(ev.status, 'VERIFIED');
  no(await post(BOSS, 'delete', { id: kt.id }), 400, 'verified work cannot be deleted');
  // reviewed by someone other than the manager: the manager still verifies it
  const kt2 = okc(await post(HR, 'save', { title: 'Newsletter redesign', assigneeUid: 'u_a', kpiId: 'k1', reviewerUid: 'u_hr' })).item;
  okc(await post(A, 'move', { id: kt2.id, status: 'IN_REVIEW' }));
  assert.equal(okc(await post(HR, 'move', { id: kt2.id, status: 'DONE' })).item.evidenceStatus, 'PENDING');
  assert.equal((await fdb.collection('pmEvidence').doc(`${CID}_task_${kt2.id}`).get()).data()!.status, 'PENDING');
  okc(await post(HR, 'move', { id: kt2.id, status: 'IN_PROGRESS' }));
  assert.equal((await fdb.collection('pmEvidence').doc(`${CID}_task_${kt2.id}`).get()).exists, false, 'reopening withdraws evidence that nobody has verified yet');

  // ---- attachments (stored privately, opened through signed links)
  no(await post(D, 'attach-sign', { id: onBoard.id, name: 'a.pdf', bytes: 100 }), 404);
  no(await post(B, 'attach-sign', { id: onBoard.id, name: 'a.pdf', bytes: 100 }), 403, 'only people involved can attach');
  no(await post(A, 'attach-sign', { id: onBoard.id, name: 'virus.exe', bytes: 100 }), 400);
  no(await post(A, 'attach-sign', { id: onBoard.id, name: 'big.pdf', bytes: 50 * 1024 * 1024 }), 400);
  configured = false; no(await post(A, 'attach-sign', { id: onBoard.id, name: 'a.pdf', bytes: 100 }), 503); configured = true;
  const sign = okc(await post(A, 'attach-sign', { id: onBoard.id, name: 'brief.pdf', bytes: 2048 }));
  assert.ok(sign.publicId.startsWith(`tasks/${CID}/${onBoard.id}/`), 'files are filed under the company and task');
  no(await post(A, 'attach-add', { id: onBoard.id, publicId: sign.publicId, resourceType: 'raw', name: 'brief.pdf' }), 400, 'nothing was uploaded yet');
  files.set(sign.publicId, { bytes: 2048, format: 'pdf', resourceType: 'raw' });
  no(await post(A, 'attach-add', { id: onBoard.id, publicId: `tasks/c2/${onBoard.id}/stolen`, resourceType: 'raw', name: 'brief.pdf' }), 400, "another company's file cannot be attached");
  const withFile = okc(await post(A, 'attach-add', { id: onBoard.id, publicId: sign.publicId, resourceType: 'raw', name: 'brief.pdf' })).item;
  assert.equal(withFile.attachments.length, 1); assert.equal(withFile.attachments[0].bytes, 2048); assert.ok(!('publicId' in withFile.attachments[0]), 'storage details never reach the browser');
  no(await post(A, 'attach-add', { id: onBoard.id, publicId: sign.publicId, resourceType: 'raw', name: 'brief.pdf' }), 400, 'twice');
  const link = okc(await get(B, 'attach-link', { id: onBoard.id, attId: withFile.attachments[0].id }));
  assert.match(link.url, /^https:\/\/files\.test\/tasks\//, 'anyone who can see the task can open the file');
  no(await get(D, 'attach-link', { id: onBoard.id, attId: withFile.attachments[0].id }), 404);
  const s2 = okc(await post(A, 'attach-sign', { id: onBoard.id, name: 'lie.pdf', bytes: 10 }));
  files.set(s2.publicId, { bytes: 99 * 1024 * 1024, format: 'pdf', resourceType: 'raw' });
  no(await post(A, 'attach-add', { id: onBoard.id, publicId: s2.publicId, resourceType: 'raw', name: 'lie.pdf' }), 400, 'the store\'s real size is checked, not the browser\'s claim');
  assert.ok(removed.includes(s2.publicId), 'and the oversized upload is removed');
  no(await post(B, 'attach-remove', { id: onBoard.id, attId: withFile.attachments[0].id }), 403);
  okc(await post(A, 'attach-remove', { id: onBoard.id, attId: withFile.attachments[0].id }));
  assert.ok(removed.includes(sign.publicId));

  // ---- delete
  no(await post(A, 'delete', { id: rv.id }), 403, 'the person doing a task cannot delete it');
  okc(await post(BOSS, 'delete', { id: rv.id }));
  no(await get(A, 'get', { id: rv.id }), 404);
  assert.equal((await fdb.collection('taskLog').where('taskId', '==', rv.id).get()).size, 0, 'its comments and activity go with it');

  // ---- dashboards
  const me = okc(await get(A, 'dashboard', { view: 'me' }));
  assert.ok(me.stats.open >= 1 && me.stats.done >= 1);
  const team = okc(await get(BOSS, 'dashboard', { view: 'team' }));
  assert.ok(team.stats.workload.length >= 1 && team.departments.length >= 1);
  no(await get(A, 'dashboard', { view: 'team' }), 403, 'no team, no team dashboard');
  no(await get(A, 'dashboard', { view: 'company' }), 403);
  okc(await get(AP, 'dashboard', { view: 'company' })); okc(await get(HR, 'dashboard', { view: 'company' }));
  no(await get(D, 'dashboard', { view: 'project', projectId: design.id }), 404);
  okc(await get(A, 'dashboard', { view: 'project', projectId: design.id }));
  assert.ok(team.stats.workload.every((x: any) => !('done' in x)), 'no finished-task leaderboard');

  // ---- reassign
  const rt = okc(await post(BOSS, 'save', { title: 'Reassignable', assigneeUid: 'u_a', requiresReview: true })).item;
  okc(await post(A, 'move', { id: rt.id, status: 'IN_REVIEW' }));
  const re = okc(await post(BOSS, 'save', { id: rt.id, title: 'Reassignable', assigneeUid: 'u_b' })).item;
  assert.equal(re.assigneeUid, 'u_b'); assert.equal(re.status, 'IN_PROGRESS', 'a task that changes hands goes back to doing');
  no(await post(A, 'save', { id: rt.id, title: 'Reassignable', assigneeUid: 'u_a' }), 404, 'after it changed hands, the old assignee no longer sees it');

  // ---- daily reminders: idempotent, one email per person
  const old = okc(await post(BOSS, 'save', { title: 'Will be late', assigneeUid: 'u_b', dueDate: addDays(T, 1) })).item;
  await fdb.collection('taskItems').doc(old.id).set({ ...(await fdb.collection('taskItems').doc(old.id).get()).data(), dueDate: addDays(T, -2) });
  const first = await runDaily(CID);
  assert.ok(first.reminded >= 1 && first.emails >= 1, JSON.stringify(first));
  const second = await runDaily(CID);
  assert.equal(second.reminded, 0, 'running the job twice does not send twice');
  no(await get({}, 'daily'), 401, 'the cron needs its key');
  process.env.CRON_SECRET = 'sekret';
  no(await get({ authorization: 'Bearer wrong' }, 'daily'), 401);
  const cron = okc(await get({ authorization: 'Bearer sekret' }, 'daily'));
  assert.equal(cron.companies, 1);

  console.log('task tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
