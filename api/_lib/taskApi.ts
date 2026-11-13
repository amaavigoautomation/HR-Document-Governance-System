/**
 * Task Management, reached as /api/tasks/<action>.
 * Tasks, boards (projects), checklists, comments, attachments, review, dashboards and the daily reminder job.
 * The rules themselves (who may assign, who may approve, the numbers on the dashboards) are in shared/taskEngine.ts.
 */
import { randomBytes } from 'node:crypto';
import { authErrorResponse, requireActiveTenant } from './authContext.js';
import { adminDb } from './firebaseAdmin.js';
import { audit, get as pmGet, list as pmList, put as pmPut, del as pmDel, managerOf as pmManagerOf, remindNow } from './pmCore.js';
import { openPlanOf } from './pmPlans.js';
import {
  ATTACHMENT_EXT, LIMITS, STATUSES, PRIORITIES, attachmentProblem, canAssignTo, cleanChecklist, cleanTags, extOf, isOpen, isOverdue, isPriority,
  moveCheck, reviewPlan, sortForList, stats, taskProblem, type MoveWho, type TaskLike,
} from '../../shared/taskEngine.js';
import { addDays, isDate } from '../../shared/pmEngine.js';
import {
  active, attachments, bad, canCreateProject, canEditProject, canSeeTask, canUseProject, denied, fail, isInvolved, isTaskOwner, loadT, loadTSystem,
  logTask, notFound, nowIso, ok, str, tDel, tGet, tList, tNewId, tPut, taskView, tell, today,
  type Doc, type Result, type TC,
} from './taskCore.js';

export interface TaskRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any> }
interface Route { method: 'GET' | 'POST'; run: (c: TC, b: any, q: Record<string, any>) => Promise<Result> }

const rid = () => randomBytes(5).toString('hex');
const nice = (iso?: string) => (iso && isDate(iso) ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'no due date');

async function projectMap(c: TC): Promise<Map<string, Doc>> {
  return new Map((await tList(c.cid, 'projects')).map((p) => [p.id, p]));
}
const person = (c: TC, uid: string) => { const p = c.byUid.get(uid); return p && p.active ? p : null; };
const moveWho = (c: TC, t: Doc): MoveWho => ({ isAssignee: t.assigneeUid === c.ctx.uid, isReviewer: t.reviewerUid === c.ctx.uid, isOwner: isTaskOwner(c, t), isAdmin: c.canManage });
const assignable = (c: TC, target: string) => canAssignTo({ actor: c.ctx.uid, target, actorDownline: c.down, unrestricted: c.canManage });

async function loadTask(c: TC, id: unknown): Promise<{ t: Doc; projects: Map<string, Doc> } | null> {
  const t = await tGet(c.cid, 'items', str(id, 120));
  if (!t) return null;
  const projects = await projectMap(c);
  return canSeeTask(c, t, projects) ? { t, projects } : null;
}

// ------------------------------------------------------------------ KPI link (the evidence goes to Performance once the work is reviewed)

async function kpiOf(c: TC, assigneeUid: string, kpiId: string): Promise<{ planId: string; kpiId: string; kpiName: string } | null> {
  const plan = openPlanOf(await pmList(c.cid, 'plans', { uid: assigneeUid }), assigneeUid);
  const k = plan?.status === 'ACTIVE' ? (plan.kpis || []).find((x: any) => x.id === kpiId) : null;
  return k ? { planId: plan!.id, kpiId: k.id, kpiName: k.kpi } : null;
}

/**
 * A reviewed, finished task becomes work evidence for its KPI. If the reviewer is the person's manager it is already vouched for;
 * otherwise the manager verifies it like any other work item. Counts never turn into a rating by themselves.
 */
async function recordEvidence(c: TC, t: Doc): Promise<{ evidenceId: string; evidenceStatus: string; note: string }> {
  const none = { evidenceId: '', evidenceStatus: '', note: '' };
  if (!t.kpi) return none;
  const id = `${c.cid}_task_${t.id}`;
  const already = await pmGet(c.cid, 'evidence', id);
  if (already) return { evidenceId: id, evidenceStatus: already.status, note: '' };
  const k = await kpiOf(c, t.assigneeUid, t.kpi.kpiId);
  if (!k) return { ...none, note: 'Not added to Performance: the person no longer has approved targets with this KPI.' };
  const vouched = pmManagerOf(c, t.assigneeUid) === c.ctx.uid;
  const ev = await pmPut('evidence', {
    id, companyId: c.cid, uid: t.assigneeUid, name: t.assigneeName || '', planId: k.planId, kpiId: k.kpiId, kpiName: k.kpiName, date: today(), title: String(t.title).slice(0, 200), link: '',
    source: 'TASK', taskId: t.id, status: vouched ? 'VERIFIED' : 'PENDING', addedBy: c.who, addedByUid: c.ctx.uid, verifiedBy: vouched ? c.who : '', verifiedAt: vouched ? nowIso() : '',
  });
  await audit(c, id, 'EVIDENCE_FROM_TASK', `${t.title} → ${k.kpiName}`, t.assigneeUid);
  return { evidenceId: id, evidenceStatus: ev.status, note: vouched ? 'Added to Performance as verified work.' : 'Added to Performance. The manager will verify it.' };
}
async function withdrawEvidence(c: TC, t: Doc): Promise<void> {
  if (!t.evidenceId) return;
  const ev = await pmGet(c.cid, 'evidence', t.evidenceId);
  if (ev && ev.status === 'PENDING') await pmDel('evidence', ev.id);
}

// ------------------------------------------------------------------ meta (everything a screen needs to open)

async function meta(c: TC): Promise<Result> {
  const me = c.ctx.uid;
  const [items, projects] = await Promise.all([tList(c.cid, 'items'), projectMap(c)]);
  const t = today();
  const mine = items.filter((x) => x.assigneeUid === me && isOpen(x.status));
  const review = items.filter((x) => x.reviewerUid === me && x.status === 'IN_REVIEW');
  const people = active(c).map((p) => ({ uid: p.uid, name: p.name, department: p.department, title: p.title }));
  const list = [...projects.values()].filter((p) => canUseProject(c, p));
  return ok({
    me: { uid: me, name: c.who, department: c.me?.department || '' },
    flags: { manager: c.down.size > 0, canManage: c.canManage, canViewAll: c.canViewAll, headOf: c.headOf, companyWide: c.canManage },
    people, assignable: people.filter((p) => assignable(c, p.uid)).map((p) => p.uid),
    departments: Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort(),
    projects: list.map((p) => ({ id: p.id, name: p.name, scope: p.scope, department: p.department, color: p.color || '' })),
    counts: { open: mine.length, overdue: mine.filter((x) => isOverdue(x, t)).length, review: review.length },
    storage: { enabled: attachments().configured(), maxMb: LIMITS.attachmentBytes / 1024 / 1024, allowed: ATTACHMENT_EXT },
    statuses: STATUSES, priorities: PRIORITIES, limits: LIMITS,
  });
}

// ------------------------------------------------------------------ lists

async function listTasks(c: TC, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 20) || 'mine'; const me = c.ctx.uid; const t = today();
  const projects = await projectMap(c);
  let rows: Doc[] = [];
  if (scope === 'mine') rows = await tList(c.cid, 'items', { assigneeUid: me });
  else if (scope === 'created') rows = (await tList(c.cid, 'items', { creatorUid: me })).filter((x) => x.assigneeUid !== me);
  else if (scope === 'review') rows = (await tList(c.cid, 'items', { reviewerUid: me })).filter((x) => x.status === 'IN_REVIEW');
  else if (scope === 'team') rows = (await tList(c.cid, 'items')).filter((x) => c.down.has(x.assigneeUid));
  else if (scope === 'project') {
    const p = projects.get(str(q.projectId, 120));
    if (!p || !canUseProject(c, p)) return notFound('That board');
    rows = await tList(c.cid, 'items', { projectId: p.id });
  } else if (scope === 'all') {
    if (!c.canManage && !c.canViewAll) return denied('You do not have access to every task.');
    rows = await tList(c.cid, 'items');
  } else return bad('Unknown list.');
  const uid = str(q.uid, 120); const status = str(q.status, 20); const text = str(q.q, 80).toLowerCase();
  if (uid) rows = rows.filter((x) => x.assigneeUid === uid);
  if (status === 'open') rows = rows.filter((x) => isOpen(x.status)); else if (status) rows = rows.filter((x) => x.status === status);
  if (text) rows = rows.filter((x) => `${x.title} ${(x.tags || []).join(' ')}`.toLowerCase().includes(text));
  // Finished work older than a month stays out of the way unless asked for.
  if (!status && q.history !== '1') rows = rows.filter((x) => isOpen(x.status) || String(x.completedAt || '').slice(0, 10) >= addDays(t, -30));
  const out = sortForList(rows.slice(0, 1500), t).map((x) => taskView(c, x, projects));
  return ok({ items: out, truncated: rows.length > 1500, today: t });
}

async function getTask(c: TC, q: Record<string, any>): Promise<Result> {
  const f = await loadTask(c, q.id);
  if (!f) return notFound('That task');
  const { t, projects } = f;
  const log = (await tList(c.cid, 'log', { taskId: t.id })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const moves: Record<string, { ok: boolean; needsNote?: boolean; error?: string }> = {};
  for (const s of STATUSES) { const r = moveCheck(t as TaskLike, s.key, moveWho(c, t)); moves[s.key] = r.ok ? { ok: true, needsNote: r.needsNote } : { ok: false, error: r.error }; }
  const owner = isTaskOwner(c, t);
  return ok({
    item: taskView(c, t, projects), log: log.map((l) => ({ id: l.id, kind: l.kind, action: l.action, detail: l.detail, byUid: l.byUid, byName: l.byName, at: l.at })),
    can: { edit: owner && t.status !== 'DONE', reopen: owner, delete: c.canManage || t.creatorUid === c.ctx.uid, check: (t.assigneeUid === c.ctx.uid || owner) && t.status !== 'DONE', attach: isInvolved(c, t) || owner, moves },
  });
}

// ------------------------------------------------------------------ create / edit / move / delete

function pickDates(b: any) { return { startDate: str(b.startDate, 10), dueDate: str(b.dueDate, 10) }; }

async function saveTask(c: TC, b: any): Promise<Result> {
  const id = str(b.id, 120);
  const existing = id ? await tGet(c.cid, 'items', id) : null;
  if (id && !existing) return notFound('That task');
  const projects = await projectMap(c);
  if (existing) {
    if (!canSeeTask(c, existing, projects)) return notFound('That task');
    if (!isTaskOwner(c, existing)) return denied('Only the person who gave this task, their manager or an admin can change it. You can move it, tick the checklist and comment.');
    if (existing.status === 'DONE') return bad('Reopen the task before changing it.');
  }
  const problem = taskProblem({ title: b.title, priority: b.priority, ...pickDates(b) }, today(), { creating: !existing });
  if (problem) return bad(problem);

  const assigneeUid = str(b.assigneeUid, 120) || existing?.assigneeUid || c.ctx.uid;
  const who = person(c, assigneeUid);
  if (!who) return bad('Pick someone who works here to do this task.');
  if ((!existing || existing.assigneeUid !== assigneeUid) && !assignable(c, assigneeUid)) return denied('You can give tasks to yourself and the people who report to you.');

  const projectId = str(b.projectId, 120);
  if (projectId) {
    const p = projects.get(projectId);
    if (!p || (!canUseProject(c, p) && existing?.projectId !== projectId)) return bad('That board is not available to you.');
  }
  const kpiId = str(b.kpiId, 60);
  const reassigned = !!existing && existing.assigneeUid !== assigneeUid;
  let kpi: Doc['kpi'] = existing && !reassigned ? existing.kpi || null : null;
  if (b.kpiId !== undefined || reassigned) {
    kpi = null;
    if (kpiId) { kpi = await kpiOf(c, assigneeUid, kpiId); if (!kpi) return bad(`${who.name} has no approved Performance targets with that KPI.`); }
  }
  const assigneeManager = pmManagerOf(c, assigneeUid);
  const rp = reviewPlan({
    requiresReview: b.requiresReview === undefined ? !!existing?.requiresReview : b.requiresReview === true, kpiLinked: !!kpi,
    reviewerUid: b.reviewerUid === undefined ? (reassigned ? '' : existing?.reviewerUid || '') : str(b.reviewerUid, 120), creatorUid: existing?.creatorUid || c.ctx.uid, assigneeUid, assigneeManager,
  });
  if (rp.error) return bad(rp.error);
  if (rp.reviewerUid && !person(c, rp.reviewerUid)) return bad('Pick a reviewer who works here.');
  const watchers: string[] = (Array.isArray(b.watchers) ? b.watchers : existing?.watchers || []).map((x: any) => str(x, 120)).filter((x: string) => x && person(c, x)).slice(0, LIMITS.watchers);

  const base = existing || { id: tNewId('items'), companyId: c.cid, creatorUid: c.ctx.uid, creatorName: c.who, status: 'TODO', order: Date.now(), attachments: [], reminded: {}, completedAt: '' } as unknown as Doc;
  const next: Doc = {
    ...base,
    title: str(b.title, LIMITS.title), description: str(b.description === undefined ? existing?.description : b.description, LIMITS.description),
    priority: isPriority(b.priority) ? b.priority : existing?.priority || 'NORMAL', ...pickDates(b),
    tags: cleanTags(b.tags === undefined ? existing?.tags : b.tags),
    checklist: b.checklist === undefined ? existing?.checklist || [] : cleanChecklist(b.checklist, rid),
    assigneeUid, assigneeName: who.name, projectId, kpi, requiresReview: rp.requiresReview, reviewerUid: rp.reviewerUid, reviewerName: rp.reviewerUid ? person(c, rp.reviewerUid)?.name || '' : '', watchers,
  };
  // A task that changes hands starts again; a task waiting for review goes back to the new person's hands.
  if (reassigned && (next.status === 'IN_REVIEW' || next.status === 'REWORK')) next.status = 'IN_PROGRESS';
  if (!rp.requiresReview && next.status === 'IN_REVIEW') next.status = 'IN_PROGRESS';
  const saved = await tPut('items', next);

  if (!existing) {
    await logTask(c, saved.id, 'CREATED', `Created and given to ${who.name}.`);
    if (assigneeUid !== c.ctx.uid) await tell(c, [assigneeUid], `New task: ${saved.title}`, `${c.who} gave you a task: "${saved.title}" (due ${nice(saved.dueDate)}).`);
  } else {
    const changes: string[] = [];
    if (existing.title !== saved.title) changes.push('title');
    if ((existing.dueDate || '') !== saved.dueDate) changes.push(`due date ${nice(existing.dueDate)} → ${nice(saved.dueDate)}`);
    if (existing.priority !== saved.priority) changes.push(`priority ${existing.priority} → ${saved.priority}`);
    if ((existing.projectId || '') !== saved.projectId) changes.push('board');
    if (reassigned) changes.push(`given to ${who.name}`);
    if ((existing.kpi?.kpiId || '') !== (saved.kpi?.kpiId || '')) changes.push(saved.kpi ? `linked to KPI "${saved.kpi.kpiName}"` : 'KPI link removed');
    if ((existing.reviewerUid || '') !== saved.reviewerUid) changes.push(saved.reviewerUid ? `reviewer ${saved.reviewerName}` : 'review not needed');
    if (changes.length) await logTask(c, saved.id, 'EDITED', changes.join('; '));
    if (reassigned && assigneeUid !== c.ctx.uid) await tell(c, [assigneeUid], `Task given to you: ${saved.title}`, `${c.who} gave you the task "${saved.title}" (due ${nice(saved.dueDate)}).`);
  }
  return ok({ item: taskView(c, saved, projects), message: existing ? 'Saved.' : 'Task created.' });
}

async function moveTask(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const { t, projects } = f;
  const to = str(b.status, 20);
  const r = moveCheck(t as TaskLike, to, moveWho(c, t));
  if (!r.ok) return bad(r.error);
  const note = str(b.note, 1000);
  if (r.needsNote && note.length < 3) return bad('Say briefly what needs to change, so the person knows what to fix.');
  const order = Number.isFinite(Number(b.order)) && b.order !== '' && b.order !== null ? Number(b.order) : t.order;
  if (to === t.status) { const same = await tPut('items', { ...t, order }); return ok({ item: taskView(c, same, projects) }); }

  const from = t.status;
  const next: Doc = { ...t, status: to, order };
  let message = '';
  if (to === 'DONE') {
    next.completedAt = nowIso(); next.completedBy = c.who;
    if (r.approves) { next.reviewedAt = nowIso(); next.reviewedBy = c.who; }
    const ev = await recordEvidence(c, next);
    next.evidenceId = ev.evidenceId; next.evidenceStatus = ev.evidenceStatus; message = ev.note;
  } else if (from === 'DONE') {
    await withdrawEvidence(c, t);
    next.completedAt = ''; next.completedBy = ''; next.reviewedAt = ''; next.reviewedBy = '';
    if (t.evidenceId) { next.evidenceId = ''; next.evidenceStatus = ''; message = 'Reopened. Work already verified in Performance stays there.'; }
  }
  const saved = await tPut('items', next);
  const words = (s: string) => STATUSES.find((x) => x.key === s)?.label || s;
  await logTask(c, t.id, 'MOVED', `${words(from)} → ${words(to)}${r.approves ? ' (approved)' : ''}`);
  if (note) await logTask(c, t.id, 'COMMENT', note, 'COMMENT');

  if (to === 'IN_REVIEW' && t.reviewerUid) await tell(c, [t.reviewerUid], `Please review: ${t.title}`, `${t.assigneeName} sent "${t.title}" for your review.`);
  if (to === 'REWORK') await tell(c, [t.assigneeUid], `Changes needed: ${t.title}`, `${c.who} sent "${t.title}" back: ${note}`);
  if (to === 'DONE' && t.assigneeUid !== c.ctx.uid) await tell(c, [t.assigneeUid], `${r.approves ? 'Approved' : 'Marked done'}: ${t.title}`, `${c.who} ${r.approves ? 'approved' : 'marked as done'} "${t.title}".`);
  return ok({ item: taskView(c, saved, projects), message });
}

async function checkItem(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const { t, projects } = f;
  if (t.assigneeUid !== c.ctx.uid && !isTaskOwner(c, t)) return denied('Only the person doing this task, or whoever gave it, can tick its checklist.');
  if (t.status === 'DONE') return bad('This task is done. Reopen it to change the checklist.');
  const item = (t.checklist || []).find((x: any) => x.id === str(b.itemId, 40));
  if (!item) return notFound('That checklist item');
  const saved = await tPut('items', { ...t, checklist: t.checklist.map((x: any) => (x.id === item.id ? { ...x, done: b.done === true } : x)) });
  return ok({ item: taskView(c, saved, projects) });
}

async function comment(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const text = str(b.text, LIMITS.comment);
  if (text.length < 1) return bad('Write a comment first.');
  const l = await logTask(c, f.t.id, 'COMMENT', text, 'COMMENT');
  return ok({ entry: { id: l.id, kind: l.kind, action: l.action, detail: l.detail, byUid: l.byUid, byName: l.byName, at: l.at } });
}

async function removeTask(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const { t } = f;
  if (!c.canManage && t.creatorUid !== c.ctx.uid) return denied('Only the person who created this task, or an admin, can delete it.');
  if (t.evidenceId) { const ev = await pmGet(c.cid, 'evidence', t.evidenceId); if (ev && ev.status !== 'PENDING') return bad('This task was counted as work in Performance. It cannot be deleted; ask HR if it is wrong.'); await withdrawEvidence(c, t); }
  for (const a of t.attachments || []) await attachments().remove(a.publicId, a.resourceType).catch(() => null);
  for (const l of await tList(c.cid, 'log', { taskId: t.id })) await tDel('log', l.id);
  await tDel('items', t.id);
  return ok({ message: 'Deleted.' });
}

// ------------------------------------------------------------------ KPI list for the task form

async function kpis(c: TC, q: Record<string, any>): Promise<Result> {
  const uid = str(q.uid, 120) || c.ctx.uid;
  if (!assignable(c, uid)) return ok({ items: [] });
  const plan = openPlanOf(await pmList(c.cid, 'plans', { uid }), uid);
  return ok({ items: plan?.status === 'ACTIVE' ? (plan.kpis || []).map((k: any) => ({ id: k.id, kra: k.kra, kpi: k.kpi })) : [] });
}

// ------------------------------------------------------------------ projects (boards)

async function projectList(c: TC): Promise<Result> {
  const [projects, items] = await Promise.all([projectMap(c), tList(c.cid, 'items')]);
  const rows = [...projects.values()].filter((p) => canUseProject(c, p) || (p.status === 'ARCHIVED' && canEditProject(c, p)));
  return ok({
    items: rows.map((p) => {
      const mine = items.filter((x) => x.projectId === p.id);
      return { ...p, open: mine.filter((x) => isOpen(x.status)).length, done: mine.filter((x) => !isOpen(x.status)).length, overdue: mine.filter((x) => isOverdue(x, today())).length, canEdit: canEditProject(c, p) };
    }).sort((a, b) => Number(a.status === 'ARCHIVED') - Number(b.status === 'ARCHIVED') || String(a.name).localeCompare(String(b.name))),
    canCreate: { company: c.canManage, departments: c.canManage ? 'all' : c.headOf.concat(c.down.size ? [c.me?.department || ''] : []).filter(Boolean) },
  });
}

async function projectSave(c: TC, b: any): Promise<Result> {
  const id = str(b.id, 120);
  const existing = id ? await tGet(c.cid, 'projects', id) : null;
  if (id && !existing) return notFound('That board');
  const name = str(b.name, LIMITS.projectName);
  if (name.length < 2) return bad('Give the board a name.');
  const scope = existing?.scope || (b.scope === 'DEPARTMENT' ? 'DEPARTMENT' : 'COMPANY');
  const department = existing?.department ?? (scope === 'DEPARTMENT' ? str(b.department, 120) : '');
  if (scope === 'DEPARTMENT' && !department) return bad('Pick the department this board is for.');
  if (existing ? !canEditProject(c, existing) : !canCreateProject(c, scope, department)) return denied(scope === 'COMPANY' ? 'Only an admin can create a company-wide board.' : 'You can create boards for a department you head or manage people in.');
  if ((await tList(c.cid, 'projects')).some((p) => p.id !== id && p.status !== 'ARCHIVED' && p.scope === scope && p.department === department && String(p.name).toLowerCase() === name.toLowerCase())) return bad('A board with this name already exists.');
  const color = /^#[0-9a-fA-F]{6}$/.test(str(b.color, 7)) ? str(b.color, 7) : existing?.color || '#6d4cf0';
  const saved = await tPut('projects', { ...(existing || { id: tNewId('projects'), companyId: c.cid, ownerUid: c.ctx.uid, ownerName: c.who, status: 'ACTIVE' }), name, description: str(b.description, LIMITS.projectText), scope, department, color });
  return ok({ item: saved, message: existing ? 'Saved.' : 'Board created.' });
}

async function projectArchive(c: TC, b: any): Promise<Result> {
  const p = await tGet(c.cid, 'projects', str(b.id, 120));
  if (!p) return notFound('That board');
  if (!canEditProject(c, p)) return denied('Only the board owner, the department head or an admin can do this.');
  const saved = await tPut('projects', { ...p, status: b.archived === false ? 'ACTIVE' : 'ARCHIVED' });
  return ok({ item: saved, message: saved.status === 'ARCHIVED' ? 'Board archived. Its tasks stay with the people involved.' : 'Board restored.' });
}

// ------------------------------------------------------------------ dashboards

async function dashboard(c: TC, q: Record<string, any>): Promise<Result> {
  const view = str(q.view, 20) || 'me'; const t = today(); const me = c.ctx.uid;
  const projects = await projectMap(c);
  let rows: Doc[] = []; let label = '';
  if (view === 'me') { rows = await tList(c.cid, 'items', { assigneeUid: me }); label = 'My tasks'; }
  else if (view === 'team') {
    if (c.down.size === 0 && !c.canManage) return denied('You have no team yet.');
    rows = (await tList(c.cid, 'items')).filter((x) => c.down.has(x.assigneeUid)); label = 'My team';
  } else if (view === 'project') {
    const p = projects.get(str(q.projectId, 120));
    if (!p || !canUseProject(c, p)) return notFound('That board');
    rows = await tList(c.cid, 'items', { projectId: p.id }); label = p.name;
  } else if (view === 'company') {
    if (!c.canManage && !c.canViewAll) return denied('You do not have access to the company dashboard.');
    rows = await tList(c.cid, 'items'); label = 'Whole company';
  } else return bad('Unknown dashboard.');
  const s = stats(rows as TaskLike[], t);
  const names: Record<string, string> = {};
  for (const w of s.workload) names[w.uid] = c.byUid.get(w.uid)?.name || 'Former employee';
  let departments: { name: string; open: number; overdue: number }[] | undefined;
  if (view === 'company' || view === 'team') {
    const by = new Map<string, { name: string; open: number; overdue: number }>();
    for (const x of rows.filter((r) => isOpen(r.status))) {
      const d = c.byUid.get(x.assigneeUid)?.department || 'No department';
      const row = by.get(d) || { name: d, open: 0, overdue: 0 };
      row.open++; if (isOverdue(x, t)) row.overdue++;
      by.set(d, row);
    }
    departments = [...by.values()].sort((a, b) => b.open - a.open);
  }
  const soon = sortForList(rows.filter((x) => isOpen(x.status) && (isOverdue(x, t) || (x.dueDate && x.dueDate <= addDays(t, 7)))), t).slice(0, 8).map((x) => taskView(c, x, projects));
  return ok({ view, label, stats: s, names, departments, soon, today: t });
}

// ------------------------------------------------------------------ attachments

async function attachSign(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const { t } = f;
  if (!isInvolved(c, t) && !isTaskOwner(c, t)) return denied('Only people involved in this task can attach files.');
  if (!attachments().configured()) return fail(503, 'File attachments are not set up yet. Ask your admin to add the Cloudinary keys.');
  const name = str(b.name, 150); const bytes = Number(b.bytes);
  const problem = attachmentProblem(name, bytes, (t.attachments || []).length);
  if (problem) return bad(problem);
  const publicId = `tasks/${c.cid}/${t.id}/${rid()}${rid()}`;
  return ok({ publicId, ticket: attachments().ticket(publicId) });
}

async function attachAdd(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const { t, projects } = f;
  if (!isInvolved(c, t) && !isTaskOwner(c, t)) return denied('Only people involved in this task can attach files.');
  const publicId = str(b.publicId, 300); const resourceType = str(b.resourceType, 10); const name = str(b.name, 150);
  if (!publicId.startsWith(`tasks/${c.cid}/${t.id}/`)) return bad('That file does not belong to this task.');
  if ((t.attachments || []).some((a: any) => a.publicId === publicId)) return bad('This file is already attached.');
  const stored = await attachments().inspect(publicId, resourceType).catch(() => null);
  if (!stored) return bad('The upload could not be found. Try attaching the file again.');
  const problem = attachmentProblem(name, stored.bytes, (t.attachments || []).length);
  if (problem) { await attachments().remove(publicId, resourceType).catch(() => null); return bad(problem); }
  const att = { id: rid(), name, bytes: stored.bytes, type: extOf(name), publicId, resourceType: stored.resourceType, format: stored.format, at: nowIso(), byUid: c.ctx.uid, byName: c.who };
  const saved = await tPut('items', { ...t, attachments: [...(t.attachments || []), att] });
  await logTask(c, t.id, 'ATTACHED', name);
  return ok({ item: taskView(c, saved, projects), message: 'File attached.' });
}

async function attachRemove(c: TC, b: any): Promise<Result> {
  const f = await loadTask(c, b.id);
  if (!f) return notFound('That task');
  const { t, projects } = f;
  const a = (t.attachments || []).find((x: any) => x.id === str(b.attId, 40));
  if (!a) return notFound('That file');
  if (a.byUid !== c.ctx.uid && !isTaskOwner(c, t)) return denied('Only the person who attached this file, or whoever gave the task, can remove it.');
  await attachments().remove(a.publicId, a.resourceType).catch(() => null);
  const saved = await tPut('items', { ...t, attachments: t.attachments.filter((x: any) => x.id !== a.id) });
  await logTask(c, t.id, 'DETACHED', a.name);
  return ok({ item: taskView(c, saved, projects), message: 'File removed.' });
}

async function attachLink(c: TC, q: Record<string, any>): Promise<Result> {
  const f = await loadTask(c, q.id);
  if (!f) return notFound('That task');
  const a = (f.t.attachments || []).find((x: any) => x.id === str(q.attId, 40));
  if (!a) return notFound('That file');
  return ok({ url: attachments().link(a.publicId, a.resourceType, a.format || '', a.name), name: a.name });
}

// ------------------------------------------------------------------ daily job

/**
 * One email a day per person, listing what is due or late. Safe to run twice: every reminder is stamped on its task.
 *  - due today: once.  - late: every 3 days to the person; once a week to whoever gave the task.  - waiting for review: every 3 days to the reviewer.
 */
export async function runDaily(cid: string): Promise<Record<string, number>> {
  const c = await loadTSystem(cid);
  const t = today();
  const items = (await tList(cid, 'items')).filter((x) => isOpen(x.status));
  const lines = new Map<string, string[]>();
  const add = (uid: string, line: string) => { if (uid && c.byUid.get(uid)?.active) lines.set(uid, [...(lines.get(uid) || []), line]); };
  let reminded = 0;
  for (const x of items) {
    let touched = false;
    if (x.dueDate === t && remindNow(x, `due:${t}`, 365, t)) { add(x.assigneeUid, `Due today: ${x.title}`); touched = true; }
    if (isOverdue(x, t)) {
      if (remindNow(x, 'late', 3, t)) { add(x.assigneeUid, `Late since ${nice(x.dueDate)}: ${x.title}`); touched = true; }
      if (x.creatorUid !== x.assigneeUid && remindNow(x, 'lateGiver', 7, t)) { add(x.creatorUid, `${x.assigneeName || 'Someone'} is late on "${x.title}" (due ${nice(x.dueDate)})`); touched = true; }
    }
    if (x.status === 'IN_REVIEW' && x.reviewerUid && String(x.updatedAt || '').slice(0, 10) <= addDays(t, -2) && remindNow(x, 'review', 3, t)) { add(x.reviewerUid, `Waiting for your review: ${x.title}`); touched = true; }
    if (touched) { await tPut('items', x); reminded++; }
  }
  for (const [uid, list] of lines) await tell(c, [uid], `Tasks: ${list.length} thing${list.length > 1 ? 's' : ''} need${list.length > 1 ? '' : 's'} your attention`, list.map((l) => `• ${l}`).join('\n'));
  return { tasks: items.length, reminded, emails: lines.size };
}

// ------------------------------------------------------------------ routes

const ROUTES: Record<string, Route> = {
  meta: { method: 'GET', run: (c) => meta(c) },
  list: { method: 'GET', run: (c, _b, q) => listTasks(c, q) },
  get: { method: 'GET', run: (c, _b, q) => getTask(c, q) },
  kpis: { method: 'GET', run: (c, _b, q) => kpis(c, q) },
  save: { method: 'POST', run: (c, b) => saveTask(c, b) },
  move: { method: 'POST', run: (c, b) => moveTask(c, b) },
  check: { method: 'POST', run: (c, b) => checkItem(c, b) },
  comment: { method: 'POST', run: (c, b) => comment(c, b) },
  delete: { method: 'POST', run: (c, b) => removeTask(c, b) },
  projects: { method: 'GET', run: (c) => projectList(c) },
  'project-save': { method: 'POST', run: (c, b) => projectSave(c, b) },
  'project-archive': { method: 'POST', run: (c, b) => projectArchive(c, b) },
  dashboard: { method: 'GET', run: (c, _b, q) => dashboard(c, q) },
  'attach-sign': { method: 'POST', run: (c, b) => attachSign(c, b) },
  'attach-add': { method: 'POST', run: (c, b) => attachAdd(c, b) },
  'attach-remove': { method: 'POST', run: (c, b) => attachRemove(c, b) },
  'attach-link': { method: 'GET', run: (c, _b, q) => attachLink(c, q) },
};

export async function routeTasks(r: TaskRequest): Promise<Result> {
  // The daily job (cron: GET with CRON_SECRET, like /api/pm/daily).
  if (r.action === 'daily') {
    const secret = (process.env.CRON_SECRET || '').trim();
    const auth = String(r.headers?.authorization || r.headers?.Authorization || '');
    if (!secret || auth !== `Bearer ${secret}`) return fail(401, 'Not allowed.');
    const snap = await adminDb().collection('companies').where('status', '==', 'ACTIVE').get();
    const results: Record<string, any> = {};
    for (const d of snap.docs) { try { results[d.id] = await runDaily(d.id); } catch (e: any) { results[d.id] = { error: e?.message || 'failed' }; } }
    return ok({ companies: snap.size, results });
  }
  const route = ROUTES[r.action];
  if (!route) return fail(404, 'Unknown Tasks action.');
  try {
    if (r.method !== route.method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    const c = await loadT(ctx);
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    return await route.run(c, body, r.query || {});
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    if (err?.status && err.status < 500) return fail(err.status, err.message);
    console.error('[Tasks] error:', err);
    return fail(500, err?.message || 'Tasks request failed.');
  }
}
