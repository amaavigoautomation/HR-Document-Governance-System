/**
 * Employee lifecycle API: onboarding tasks, exit management, letters, directory and org chart.
 * Reached as /api/leave/lifecycle-<action> (shares the leave serverless function: Vercel Hobby allows only 12).
 *
 * Collections (all closed to browsers by firestore.rules; every record carries companyId):
 *   lifecycleSettings/{cid}        task templates, clearance departments, notice days, letter templates
 *   lifecycleTasks/{cid__uid__t}   one onboarding task for one person
 *   lifecycleBank/{cid__uid}       bank details the new joiner shared (also copied to their salary record if one exists)
 *   lifecycleExits/{cid__uid}      one exit case per person: resignation, approvals, notice, clearance
 *   lifecycleLetters/{id}          letters issued (the text is stored as issued)
 */
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import {
  db, loadPeople, loadProfiles, notify, nowIso, personByUid, profileId, profileOf, str, companyLabel, type Person, type Profile,
} from './leaveCore.js';
import { istToday } from '../../shared/leaveEngine.js';
import {
  ASSIGNEE_LABEL, DEFAULT_CLEARANCE, DEFAULT_LETTERS, DEFAULT_TASK_TEMPLATES, EXIT_REASONS, EXIT_STATUS_LABEL, MERGE_FIELDS,
  addDaysIso, clearanceTotals, dueDateFor, earliestLastDay, fieldsIn, isDate, noticeServed, noticeShortfall, prettyDate, renderTemplate,
  tenureText, wouldCycle,
  type ClearanceDept, type ClearanceItem, type ExitReason, type ExitStatus, type LetterTemplate, type TaskAssignee, type TaskKind, type TaskTemplate,
} from '../../shared/lifecycleEngine.js';

export interface LifecycleRequestIn {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
}
interface Result { status: number; json: any }
const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });
class LcError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface Who { ctx: AuthContext; cid: string; uid: string; canManage: boolean }

async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new LcError(403, 'Open this as a company user.');
  const canManage = ctx.isCompanyAdmin || hasPerm(ctx.perms, 'lifecycle.manage');
  return { ctx, cid: ctx.companyId, uid: ctx.uid, canManage };
}
const needManage = (w: Who) => {
  if (!w.canManage) throw new LcError(403, 'You do not have permission to manage the employee lifecycle.');
};
const actorOf = async (w: Who) => (await personByUid(w.cid, w.uid))?.name || w.ctx.email || w.uid;

// ------------------------------------------------------------------ settings

export interface LifecycleSettings {
  taskTemplates: TaskTemplate[];
  clearance: ClearanceDept[];
  noticeDays: number;
  /** Person who gets IT-assigned onboarding tasks (empty: any lifecycle manager). */
  itOwnerUid: string;
  letters: LetterTemplate[];
}

export const defaultSettings = (): LifecycleSettings => ({
  taskTemplates: DEFAULT_TASK_TEMPLATES, clearance: DEFAULT_CLEARANCE, noticeDays: 30, itOwnerUid: '', letters: DEFAULT_LETTERS,
});

async function loadSettings(cid: string): Promise<{ settings: LifecycleSettings; saved: boolean }> {
  const snap = await db().collection('lifecycleSettings').doc(cid).get();
  const base = defaultSettings();
  if (!snap.exists) return { settings: base, saved: false };
  const x = snap.data() as Partial<LifecycleSettings>;
  return {
    saved: true,
    settings: {
      taskTemplates: Array.isArray(x.taskTemplates) && x.taskTemplates.length ? x.taskTemplates : base.taskTemplates,
      clearance: Array.isArray(x.clearance) && x.clearance.length ? x.clearance : base.clearance,
      noticeDays: Number.isFinite(Number(x.noticeDays)) ? Number(x.noticeDays) : base.noticeDays,
      itOwnerUid: str(x.itOwnerUid, 128),
      letters: Array.isArray(x.letters) && x.letters.length ? x.letters : base.letters,
    },
  };
}

const idOf = (v: string, fallback: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || fallback;

function cleanSettings(raw: any): LifecycleSettings {
  const used = new Set<string>();
  const uniq = (id: string) => { let n = id; let i = 2; while (used.has(n)) n = `${id}-${i++}`; used.add(n); return n; };
  const tpl = (Array.isArray(raw?.taskTemplates) ? raw.taskTemplates : []).slice(0, 40).map((t: any, i: number): TaskTemplate => {
    const title = str(t?.title, 120);
    if (!title) throw new LcError(400, `Task ${i + 1} needs a title.`);
    const kind: TaskKind = (['DOCUMENT', 'ASSET', 'BANK', 'POLICY', 'GENERAL'] as const).includes(t?.kind) ? t.kind : 'GENERAL';
    const assignee: TaskAssignee = (['EMPLOYEE', 'HR', 'MANAGER', 'IT'] as const).includes(t?.assignee) ? t.assignee : 'HR';
    if (kind === 'BANK' && assignee !== 'EMPLOYEE') throw new LcError(400, 'The bank details task has to be given to the new joiner.');
    const off = Number(t?.dueOffsetDays);
    return { id: uniq(idOf(str(t?.id, 30) || title, `t${i + 1}`)), title, kind, assignee, dueOffsetDays: Number.isFinite(off) ? Math.max(-60, Math.min(365, Math.round(off))) : 0, description: str(t?.description, 300) };
  });
  used.clear();
  const clr = (Array.isArray(raw?.clearance) ? raw.clearance : []).slice(0, 15).map((d: any, i: number): ClearanceDept => {
    const label = str(d?.label, 80);
    if (!label) throw new LcError(400, `Clearance department ${i + 1} needs a name.`);
    return { id: uniq(idOf(str(d?.id, 30) || label, `d${i + 1}`)), label, ownerUid: str(d?.ownerUid, 128) };
  });
  used.clear();
  const letters = (Array.isArray(raw?.letters) ? raw.letters : []).slice(0, 30).map((l: any, i: number): LetterTemplate => {
    const name = str(l?.name, 80);
    const body = String(l?.body ?? '').slice(0, 20000);
    if (!name || !body.trim()) throw new LcError(400, `Letter ${i + 1} needs a name and some text.`);
    const kind = (['OFFER', 'APPOINTMENT', 'EXPERIENCE', 'RELIEVING', 'CUSTOM'] as const).includes(l?.kind) ? l.kind : 'CUSTOM';
    return { id: uniq(idOf(str(l?.id, 30) || name, `l${i + 1}`)), kind, name, body };
  });
  if (!tpl.length || !clr.length || !letters.length) throw new LcError(400, 'Keep at least one onboarding task, one clearance department and one letter.');
  const nd = Number(raw?.noticeDays);
  return {
    taskTemplates: tpl, clearance: clr, letters,
    noticeDays: Number.isFinite(nd) ? Math.max(0, Math.min(365, Math.round(nd))) : 30,
    itOwnerUid: str(raw?.itOwnerUid, 128),
  };
}

// ------------------------------------------------------------------ people

async function managerOf(cid: string, uid: string): Promise<string> {
  return (await profileOf(cid, uid))?.managerUid || '';
}
export async function isManagerOf(cid: string, mgrUid: string, uid: string): Promise<boolean> {
  return !!mgrUid && (await managerOf(cid, uid)) === mgrUid;
}
async function reportUids(cid: string, mgrUid: string): Promise<Set<string>> {
  return new Set([...(await loadProfiles(cid)).values()].filter((p) => p.managerUid === mgrUid).map((p) => p.uid));
}
const nameMap = (people: Person[]) => new Map(people.map((p) => [p.uid, p]));

// ------------------------------------------------------------------ onboarding

export interface TaskDoc {
  companyId: string;
  uid: string;
  templateId: string;
  title: string;
  kind: TaskKind;
  assignee: TaskAssignee;
  assigneeUid: string;
  description: string;
  dueDate: string;
  status: 'OPEN' | 'DONE' | 'SKIPPED';
  note: string;
  doneAt?: string;
  doneBy?: string;
  createdAt: string;
}
const taskId = (cid: string, uid: string, t: string) => `${cid}__${uid}__${t}`;

async function loadTasks(cid: string, uid?: string): Promise<(TaskDoc & { id: string })[]> {
  let q: any = db().collection('lifecycleTasks').where('companyId', '==', cid);
  if (uid) q = q.where('uid', '==', uid);
  const snap = await q.get();
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as TaskDoc) }));
}

/** Creates the checklist for one person. Safe to run again: tasks that already exist are left alone. */
export async function startChecklist(cid: string, uid: string, opts: { joinDate?: string; templateIds?: string[] } = {}): Promise<{ created: number; existing: number }> {
  const person = await personByUid(cid, uid);
  if (!person) throw new LcError(404, 'Employee not found.');
  const [{ settings }, profile] = await Promise.all([loadSettings(cid), profileOf(cid, uid)]);
  const join = opts.joinDate || profile?.joinDate || person.createdDate;
  if (!isDate(join)) throw new LcError(400, 'The joining date is not a valid date.');
  const mgr = profile?.managerUid || '';
  const wanted = opts.templateIds?.length ? settings.taskTemplates.filter((t) => opts.templateIds!.includes(t.id)) : settings.taskTemplates;
  let created = 0;
  let existing = 0;
  for (const t of wanted) {
    const ref = db().collection('lifecycleTasks').doc(taskId(cid, uid, t.id));
    if ((await ref.get()).exists) { existing++; continue; }
    const assigneeUid = t.assignee === 'EMPLOYEE' ? uid : t.assignee === 'MANAGER' ? mgr : t.assignee === 'IT' ? settings.itOwnerUid : '';
    const doc: TaskDoc = {
      companyId: cid, uid, templateId: t.id, title: t.title, kind: t.kind, assignee: t.assignee, assigneeUid, description: t.description,
      dueDate: dueDateFor(join, t.dueOffsetDays), status: 'OPEN', note: '', createdAt: nowIso(),
    };
    await ref.set(clean(doc));
    created++;
  }
  return { created, existing };
}

/** Called when a candidate is onboarded: starts the checklist when an account with this email exists. Never throws. */
export async function startChecklistForEmail(cid: string, email: string, joinDate?: string): Promise<boolean> {
  try {
    const e = email.trim().toLowerCase();
    if (!e) return false;
    const snap = await db().collection('employees').where('companyId', '==', cid).where('email', '==', e).get();
    const d = snap.docs[0];
    if (!d) return false;
    const x = d.data() as any;
    await startChecklist(cid, String(x.authUid || d.id), { joinDate: joinDate && isDate(joinDate) ? joinDate : undefined });
    return true;
  } catch (err: any) {
    console.warn('[Lifecycle] could not start checklist:', err?.message || err);
    return false;
  }
}

const canActOnTask = (w: Who, t: TaskDoc) => w.canManage || t.assigneeUid === w.uid || (t.assignee === 'EMPLOYEE' && t.uid === w.uid);

async function onboardingStart(w: Who, body: any): Promise<Result> {
  needManage(w);
  const uid = str(body?.uid, 128);
  const join = str(body?.joinDate, 10);
  if (join && !isDate(join)) return fail(400, 'The joining date is not a valid date.');
  const r = await startChecklist(w.cid, uid, { joinDate: join || undefined });
  return ok(r);
}

async function onboardingList(w: Who): Promise<Result> {
  needManage(w);
  const [tasks, people, profiles] = await Promise.all([loadTasks(w.cid), loadPeople(w.cid), loadProfiles(w.cid)]);
  const by = nameMap(people);
  const today = istToday();
  const groups = new Map<string, (TaskDoc & { id: string })[]>();
  tasks.forEach((t) => groups.set(t.uid, [...(groups.get(t.uid) || []), t]));
  const rows = [...groups.entries()].map(([uid, list]) => {
    const open = list.filter((t) => t.status === 'OPEN');
    return {
      uid, name: by.get(uid)?.name || uid, empId: by.get(uid)?.empId || '', department: by.get(uid)?.department || '', joinDate: profiles.get(uid)?.joinDate || '',
      total: list.length, open: open.length, overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
      tasks: list.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).map((t) => ({ ...t, assigneeName: t.assigneeUid ? by.get(t.assigneeUid)?.name || '' : ASSIGNEE_LABEL[t.assignee] })),
    };
  }).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  const withList = new Set(groups.keys());
  return ok({ rows, today, withoutChecklist: people.filter((p) => p.active && !withList.has(p.uid)).map((p) => ({ uid: p.uid, name: p.name, empId: p.empId, joinDate: profiles.get(p.uid)?.joinDate || '' })) });
}

async function onboardingMy(w: Who): Promise<Result> {
  const all = await loadTasks(w.cid);
  const people = await loadPeople(w.cid);
  const by = nameMap(people);
  const mine = all.filter((t) => t.uid === w.uid || t.assigneeUid === w.uid || (w.canManage && t.assignee === 'HR' && t.status === 'OPEN') || (w.canManage && t.assignee === 'IT' && !t.assigneeUid && t.status === 'OPEN'));
  const bank = await db().collection('lifecycleBank').doc(`${w.cid}__${w.uid}`).get();
  return ok({
    today: istToday(),
    tasks: mine.sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9')).map((t) => ({ ...t, forName: by.get(t.uid)?.name || t.uid, own: t.uid === w.uid })),
    bankSubmitted: bank.exists,
  });
}

async function taskUpdate(w: Who, body: any): Promise<Result> {
  const ref = db().collection('lifecycleTasks').doc(str(body?.id, 200));
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as TaskDoc).companyId !== w.cid) return fail(404, 'Task not found.');
  const t = snap.data() as TaskDoc;
  if (!canActOnTask(w, t)) return fail(403, 'This task is not assigned to you.');
  const status = body?.status;
  if (!['OPEN', 'DONE', 'SKIPPED'].includes(status)) return fail(400, 'Choose a status.');
  if (status === 'SKIPPED' && !w.canManage) return fail(403, 'Only HR can skip a task.');
  if (status === 'DONE' && t.kind === 'BANK') {
    const bank = await db().collection('lifecycleBank').doc(`${w.cid}__${t.uid}`).get();
    if (!bank.exists && !w.canManage) return fail(409, 'Share the bank details first.');
  }
  const next: TaskDoc = {
    ...t, status, note: body?.note !== undefined ? str(body.note, 300) : t.note,
    doneAt: status === 'OPEN' ? undefined : nowIso(), doneBy: status === 'OPEN' ? undefined : await actorOf(w),
  };
  await ref.set(clean(next));
  return ok({});
}

async function taskAdd(w: Who, body: any): Promise<Result> {
  needManage(w);
  const uid = str(body?.uid, 128);
  const person = await personByUid(w.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const title = str(body?.title, 120);
  if (!title) return fail(400, 'Enter a task title.');
  const assignee: TaskAssignee = (['EMPLOYEE', 'HR', 'MANAGER', 'IT'] as const).includes(body?.assignee) ? body.assignee : 'HR';
  const due = str(body?.dueDate, 10);
  if (due && !isDate(due)) return fail(400, 'The due date is not a valid date.');
  const { settings } = await loadSettings(w.cid);
  const mgr = await managerOf(w.cid, uid);
  const assigneeUid = assignee === 'EMPLOYEE' ? uid : assignee === 'MANAGER' ? mgr : assignee === 'IT' ? settings.itOwnerUid : '';
  const id = taskId(w.cid, uid, `x${Date.now().toString(36)}`);
  const doc: TaskDoc = { companyId: w.cid, uid, templateId: 'custom', title, kind: 'GENERAL', assignee, assigneeUid, description: str(body?.description, 300), dueDate: due, status: 'OPEN', note: '', createdAt: nowIso() };
  await db().collection('lifecycleTasks').doc(id).set(clean(doc));
  return ok({ id });
}

async function taskDelete(w: Who, body: any): Promise<Result> {
  needManage(w);
  const ref = db().collection('lifecycleTasks').doc(str(body?.id, 200));
  const snap = await ref.get();
  if (snap.exists && (snap.data() as TaskDoc).companyId === w.cid) await ref.delete();
  return ok({});
}

async function submitBank(w: Who, body: any): Promise<Result> {
  const holder = str(body?.holder, 100);
  const account = str(body?.account, 24).replace(/\s+/g, '');
  const ifsc = str(body?.ifsc, 15).toUpperCase().replace(/\s+/g, '');
  const bankName = str(body?.bankName, 80);
  if (!holder || !bankName) return fail(400, 'Enter the account holder name and the bank name.');
  if (!/^\d{6,20}$/.test(account)) return fail(400, 'The account number should be 6 to 20 digits.');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return fail(400, 'The IFSC code looks wrong (for example HDFC0001234).');
  await db().collection('lifecycleBank').doc(`${w.cid}__${w.uid}`).set({ companyId: w.cid, uid: w.uid, holder, account, ifsc, bankName, submittedAt: nowIso() });
  // copy to the salary record when one exists (their own details; payroll keeps using its own copy afterwards)
  let copied = false;
  const sref = db().collection('payrollStructures').doc(`${w.cid}__${w.uid}`);
  const sd = await sref.get();
  if (sd.exists && (sd.data() as any).companyId === w.cid) {
    await sref.set(clean({ ...(sd.data() as any), bankName, bankAccount: account, ifsc }));
    copied = true;
  }
  const t = db().collection('lifecycleTasks').doc(taskId(w.cid, w.uid, 'bank'));
  const ts = await t.get();
  if (ts.exists && (ts.data() as TaskDoc).status === 'OPEN') await t.set(clean({ ...(ts.data() as TaskDoc), status: 'DONE', doneAt: nowIso(), doneBy: await actorOf(w) }));
  return ok({ copiedToSalary: copied });
}

// ------------------------------------------------------------------ exit

export interface ExitDoc {
  companyId: string;
  uid: string;
  status: ExitStatus;
  reason: ExitReason;
  resignationDate: string;
  requestedLastDay: string;
  lastWorkingDay: string;
  noticeRequiredDays: number;
  noticeServedDays: number;
  noticeShortfallDays: number;
  comments: string;
  managerUid: string;
  clearance: ClearanceItem[];
  events: { at: string; by: string; action: string; note: string }[];
  initiatedBy: 'EMPLOYEE' | 'HR';
  createdAt: string;
  completedAt?: string;
}
const exitId = (cid: string, uid: string) => `${cid}__${uid}`;
async function loadExit(cid: string, uid: string): Promise<ExitDoc | null> {
  const s = await db().collection('lifecycleExits').doc(exitId(cid, uid)).get();
  return s.exists && (s.data() as ExitDoc).companyId === cid ? (s.data() as ExitDoc) : null;
}
const saveExit = (e: ExitDoc) => db().collection('lifecycleExits').doc(exitId(e.companyId, e.uid)).set(clean(e));
const isOpen = (e: ExitDoc | null) => !!e && ['SUBMITTED', 'MANAGER_APPROVED', 'APPROVED'].includes(e.status);
const ev = (by: string, action: string, note = '') => ({ at: nowIso(), by, action, note });

function parseReason(v: unknown): ExitReason {
  return (EXIT_REASONS as readonly string[]).includes(String(v)) ? (v as ExitReason) : 'RESIGNATION';
}

function applyNotice(e: ExitDoc, required: number) {
  e.noticeRequiredDays = required;
  e.noticeServedDays = noticeServed(e.resignationDate, e.lastWorkingDay);
  e.noticeShortfallDays = noticeShortfall(required, e.noticeServedDays);
}

async function buildClearance(cid: string, uid: string, settings: LifecycleSettings): Promise<ClearanceItem[]> {
  const mgr = await managerOf(cid, uid);
  return settings.clearance.map((d) => ({
    deptId: d.id, label: d.label, ownerUid: d.ownerUid === 'MANAGER' ? mgr : d.ownerUid, status: 'PENDING' as const, dues: 0, note: '',
  }));
}

async function view(cid: string, e: ExitDoc, people?: Person[]) {
  const list = people || (await loadPeople(cid));
  const by = nameMap(list);
  const profile = await profileOf(cid, e.uid);
  const p = by.get(e.uid);
  const sres = await db().collection('payrollSettlements').doc(`${cid}__${e.uid}`).get();
  return {
    ...e,
    statusLabel: EXIT_STATUS_LABEL[e.status],
    employee: { uid: e.uid, name: p?.name || e.uid, empId: p?.empId || '', department: p?.department || '', title: p?.title || '', joinDate: profile?.joinDate || '' },
    managerName: e.managerUid ? by.get(e.managerUid)?.name || '' : '',
    clearance: e.clearance.map((c) => ({ ...c, ownerName: c.ownerUid ? by.get(c.ownerUid)?.name || '' : '' })),
    totals: clearanceTotals(e.clearance),
    settlementStatus: sres.exists ? String((sres.data() as any).status || '') : '',
  };
}

async function exitMy(w: Who): Promise<Result> {
  const { settings } = await loadSettings(w.cid);
  const e = await loadExit(w.cid, w.uid);
  const profile = await profileOf(w.cid, w.uid);
  return ok({ exit: e ? await view(w.cid, e) : null, noticeDays: settings.noticeDays, hasManager: !!profile?.managerUid, today: istToday() });
}

async function exitResign(w: Who, body: any): Promise<Result> {
  const prev = await loadExit(w.cid, w.uid);
  if (isOpen(prev)) return fail(409, 'You already have an exit request in progress.');
  if (prev?.status === 'COMPLETED') return fail(409, 'Your exit has already been completed.');
  const { settings } = await loadSettings(w.cid);
  const today = istToday();
  const wanted = str(body?.requestedLastDay, 10);
  const earliest = earliestLastDay(today, settings.noticeDays);
  const lastDay = wanted || earliest;
  if (!isDate(lastDay)) return fail(400, 'Enter a valid last working day.');
  if (lastDay < today) return fail(400, 'The last working day cannot be in the past.');
  if (lastDay > addDaysIso(today, 365)) return fail(400, 'The last working day is too far away.');
  const mgr = await managerOf(w.cid, w.uid);
  const name = await actorOf(w);
  const e: ExitDoc = {
    companyId: w.cid, uid: w.uid, status: mgr ? 'SUBMITTED' : 'MANAGER_APPROVED', reason: 'RESIGNATION', resignationDate: today, requestedLastDay: lastDay,
    lastWorkingDay: lastDay, noticeRequiredDays: 0, noticeServedDays: 0, noticeShortfallDays: 0, comments: str(body?.comments, 1000), managerUid: mgr, clearance: [],
    events: [ev(name, 'RESIGNED', `Last working day asked for: ${lastDay}`)], initiatedBy: 'EMPLOYEE', createdAt: nowIso(),
  };
  applyNotice(e, settings.noticeDays);
  await saveExit(e);
  const people = await loadPeople(w.cid);
  const mp = people.find((p) => p.uid === mgr);
  if (mp?.email) await notify(w.cid, [mp.email], `${name} has resigned`, `${name} has submitted a resignation with ${prettyDate(lastDay)} as the last working day. Please review it in People > Exits.`);
  return ok({ exit: await view(w.cid, e, people) });
}

async function exitWithdraw(w: Who): Promise<Result> {
  const e = await loadExit(w.cid, w.uid);
  if (!e || !['SUBMITTED', 'MANAGER_APPROVED'].includes(e.status)) return fail(409, 'Only a request that is still waiting for approval can be withdrawn. Ask HR to cancel it.');
  await saveExit({ ...e, status: 'WITHDRAWN', events: [...e.events, ev(await actorOf(w), 'WITHDRAWN')] });
  return ok({});
}

async function exitStart(w: Who, body: any): Promise<Result> {
  needManage(w);
  const uid = str(body?.uid, 128);
  const person = await personByUid(w.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  if (uid === w.uid) return fail(403, 'You cannot start your own exit. Use Resign.');
  const prev = await loadExit(w.cid, uid);
  if (isOpen(prev)) return fail(409, 'This person already has an exit in progress.');
  if (prev?.status === 'COMPLETED') return fail(409, 'This person has already exited.');
  const today = istToday();
  const resign = str(body?.resignationDate, 10) || today;
  const last = str(body?.lastWorkingDay, 10);
  if (!isDate(resign) || !isDate(last)) return fail(400, 'Enter the notice date and the last working day.');
  if (last < resign) return fail(400, 'The last working day is before the notice date.');
  const { settings } = await loadSettings(w.cid);
  const mgr = await managerOf(w.cid, uid);
  const name = await actorOf(w);
  const e: ExitDoc = {
    companyId: w.cid, uid, status: 'APPROVED', reason: parseReason(body?.reason), resignationDate: resign, requestedLastDay: last, lastWorkingDay: last,
    noticeRequiredDays: 0, noticeServedDays: 0, noticeShortfallDays: 0, comments: str(body?.comments, 1000), managerUid: mgr,
    clearance: await buildClearance(w.cid, uid, settings), events: [ev(name, 'STARTED_BY_HR', `Last working day ${last}`)], initiatedBy: 'HR', createdAt: nowIso(),
  };
  const req = body?.noticeRequiredDays;
  applyNotice(e, req === undefined || req === '' ? settings.noticeDays : Math.max(0, Math.min(365, Math.round(Number(req) || 0))));
  await saveExit(e);
  return ok({ exit: await view(w.cid, e) });
}

async function exitDecide(w: Who, body: any): Promise<Result> {
  const uid = str(body?.uid, 128);
  const e = await loadExit(w.cid, uid);
  if (!e || !['SUBMITTED', 'MANAGER_APPROVED'].includes(e.status)) return fail(409, 'There is nothing waiting for a decision.');
  if (uid === w.uid) return fail(403, 'You cannot decide on your own exit.');
  const isMgr = await isManagerOf(w.cid, w.uid, uid);
  const name = await actorOf(w);
  const note = str(body?.note, 500);
  const decision = body?.decision;
  if (!['APPROVE', 'REJECT'].includes(decision)) return fail(400, 'Choose approve or reject.');
  if (e.status === 'SUBMITTED' && !isMgr && !w.canManage) return fail(403, 'Only the reporting manager or HR can decide this.');
  if (e.status === 'MANAGER_APPROVED' && !w.canManage) return fail(403, 'This is waiting for HR.');
  if (decision === 'REJECT') {
    await saveExit({ ...e, status: 'REJECTED', events: [...e.events, ev(name, 'REJECTED', note)] });
    return ok({});
  }
  const { settings } = await loadSettings(w.cid);
  // a manager's approval moves it to HR; HR's approval finalises it (HR may approve straight away)
  if (e.status === 'SUBMITTED' && isMgr && !w.canManage) {
    await saveExit({ ...e, status: 'MANAGER_APPROVED', events: [...e.events, ev(name, 'MANAGER_APPROVED', note)] });
    return ok({});
  }
  const last = str(body?.lastWorkingDay, 10) || e.requestedLastDay;
  if (!isDate(last) || last < e.resignationDate) return fail(400, 'The last working day is not valid.');
  if (last > addDaysIso(e.resignationDate, 400)) return fail(400, 'The last working day is too far away.');
  const next: ExitDoc = { ...e, status: 'APPROVED', lastWorkingDay: last, managerUid: await managerOf(w.cid, uid), clearance: await buildClearance(w.cid, uid, settings) };
  const req = body?.noticeRequiredDays;
  applyNotice(next, req === undefined || req === '' ? e.noticeRequiredDays || settings.noticeDays : Math.max(0, Math.min(365, Math.round(Number(req) || 0))));
  next.events = [...e.events, ev(name, 'APPROVED', note || `Last working day ${last}; notice shortfall ${next.noticeShortfallDays} day(s)`)];
  await saveExit(next);
  const person = await personByUid(w.cid, uid);
  if (person?.email) await notify(w.cid, [person.email], 'Your resignation has been accepted', `Your last working day is ${prettyDate(last)}. Please complete the no-dues clearance before then.`);
  return ok({ exit: await view(w.cid, next) });
}

async function exitSetDates(w: Who, body: any): Promise<Result> {
  needManage(w);
  const uid = str(body?.uid, 128);
  const e = await loadExit(w.cid, uid);
  if (!e || e.status !== 'APPROVED') return fail(409, 'Dates can be changed only while the person is serving notice.');
  const last = str(body?.lastWorkingDay, 10) || e.lastWorkingDay;
  if (!isDate(last) || last < e.resignationDate) return fail(400, 'The last working day is not valid.');
  const next = { ...e, lastWorkingDay: last };
  const req = body?.noticeRequiredDays;
  applyNotice(next, req === undefined || req === '' ? e.noticeRequiredDays : Math.max(0, Math.min(365, Math.round(Number(req) || 0))));
  next.events = [...e.events, ev(await actorOf(w), 'DATES_CHANGED', `Last working day ${last}, notice ${next.noticeRequiredDays} day(s)`)];
  await saveExit(next);
  return ok({ exit: await view(w.cid, next) });
}

async function exitCancel(w: Who, body: any): Promise<Result> {
  needManage(w);
  const e = await loadExit(w.cid, str(body?.uid, 128));
  if (!isOpen(e)) return fail(409, 'There is no exit in progress.');
  const settle = await db().collection('payrollSettlements').doc(exitId(w.cid, e!.uid)).get();
  if (settle.exists && (settle.data() as any).status === 'PAID') return fail(409, 'The settlement is already paid.');
  await saveExit({ ...e!, status: 'WITHDRAWN', clearance: [], events: [...e!.events, ev(await actorOf(w), 'CANCELLED', str(body?.note, 300))] });
  return ok({});
}

async function exitClear(w: Who, body: any): Promise<Result> {
  const uid = str(body?.uid, 128);
  const e = await loadExit(w.cid, uid);
  if (!e || e.status !== 'APPROVED') return fail(409, 'Clearance is open only while the person is serving notice.');
  const item = e.clearance.find((c) => c.deptId === str(body?.deptId, 40));
  if (!item) return fail(404, 'Department not found.');
  const mine = !!item.ownerUid && item.ownerUid === w.uid;
  if (!w.canManage && !mine) return fail(403, 'You are not the owner of this clearance.');
  if (uid === w.uid && !w.canManage) return fail(403, 'You cannot clear your own dues.');
  const status = body?.status;
  if (!['PENDING', 'CLEARED', 'DUES', 'WAIVED'].includes(status)) return fail(400, 'Choose a status.');
  if (status === 'WAIVED' && !w.canManage) return fail(403, 'Only HR can waive a clearance.');
  let dues = 0;
  if (status === 'DUES') {
    dues = Math.round(Number(body?.dues) * 100) / 100;
    if (!Number.isFinite(dues) || dues <= 0 || dues > 10_000_000) return fail(400, 'Enter the amount owed.');
    if (!str(body?.note, 300)) return fail(400, 'Say what the dues are for.');
  }
  const name = await actorOf(w);
  const next = {
    ...e,
    clearance: e.clearance.map((c) => (c === item ? { ...c, status, dues, note: str(body?.note, 300), by: name, at: nowIso() } : c)),
    events: [...e.events, ev(name, `CLEARANCE_${status}`, `${item.label}${status === 'DUES' ? `: ${dues}` : ''}`)].slice(-100),
  };
  await saveExit(next);
  return ok({ exit: await view(w.cid, next) });
}

async function exitComplete(w: Who, body: any): Promise<Result> {
  needManage(w);
  const e = await loadExit(w.cid, str(body?.uid, 128));
  if (!e || e.status !== 'APPROVED') return fail(409, 'The exit is not in its notice period.');
  const t = clearanceTotals(e.clearance);
  if (!t.complete) return fail(409, `${t.pending} clearance item(s) are still pending.`);
  if (istToday() < e.lastWorkingDay && body?.early !== true) return fail(409, `The last working day is ${e.lastWorkingDay}. Complete the exit on or after that day.`);
  const next: ExitDoc = { ...e, status: 'COMPLETED', completedAt: nowIso(), events: [...e.events, ev(await actorOf(w), 'COMPLETED')] };
  await saveExit(next);
  return ok({ exit: await view(w.cid, next), reminder: 'Deactivate the user in Administration, and issue the experience and relieving letters.' });
}

async function exitsList(w: Who): Promise<Result> {
  const snap = await db().collection('lifecycleExits').where('companyId', '==', w.cid).get();
  let list = snap.docs.map((d: any) => d.data() as ExitDoc);
  if (!w.canManage) {
    const reports = await reportUids(w.cid, w.uid);
    list = list.filter((e) => reports.has(e.uid));
  }
  const people = await loadPeople(w.cid);
  const out = await Promise.all(list.map((e) => view(w.cid, e, people)));
  out.sort((a, b) => {
    const open = (x: ExitDoc) => (isOpen(x) ? 0 : 1);
    return open(a) - open(b) || a.lastWorkingDay.localeCompare(b.lastWorkingDay);
  });
  return ok({ exits: out, today: istToday() });
}

async function exitCase(w: Who, q: any): Promise<Result> {
  const uid = str(q?.uid, 128) || w.uid;
  if (uid !== w.uid && !w.canManage && !(await isManagerOf(w.cid, w.uid, uid))) return fail(403, 'You cannot open this exit.');
  const e = await loadExit(w.cid, uid);
  return ok({ exit: e ? await view(w.cid, e) : null });
}

// ------------------------------------------------------------------ letters

export interface LetterDoc {
  companyId: string;
  uid: string;
  templateId: string;
  kind: string;
  title: string;
  number: string;
  recipient: string;
  text: string;
  issuedBy: string;
  issuedAt: string;
}

async function companyBlock(cid: string) {
  const ps = await db().collection('payrollSettings').doc(cid).get();
  const co = (ps.data() as any)?.company || {};
  return { name: str(co.legalName, 120) || (await companyLabel(cid)), address: str(co.address, 300) };
}

/** Values we can fill without asking: from the employee record, the reporting line and the exit case. */
async function autoValues(cid: string, uid: string | ''): Promise<Record<string, string>> {
  const co = await companyBlock(cid);
  const v: Record<string, string> = { date: prettyDate(istToday()), company_name: co.name, company_address: co.address };
  if (!uid) return v;
  const person = await personByUid(cid, uid);
  if (!person) return v;
  const [profile, exit, people] = await Promise.all([profileOf(cid, uid), loadExit(cid, uid), loadPeople(cid)]);
  const join = profile?.joinDate || '';
  const last = exit && ['APPROVED', 'COMPLETED'].includes(exit.status) ? exit.lastWorkingDay : '';
  Object.assign(v, {
    employee_name: person.name, employee_id: person.empId, designation: person.title, department: person.department,
    manager_name: people.find((p) => p.uid === profile?.managerUid)?.name || '', join_date: join ? prettyDate(join) : '',
    last_working_day: last ? prettyDate(last) : '', resignation_date: exit?.resignationDate ? prettyDate(exit.resignationDate) : '',
    tenure: join && last ? tenureText(join, last) : '',
  });
  return v;
}

async function letterPreview(w: Who, body: any): Promise<Result> {
  needManage(w);
  const { settings } = await loadSettings(w.cid);
  const tpl = settings.letters.find((l) => l.id === str(body?.templateId, 40));
  if (!tpl) return fail(404, 'Choose a letter template.');
  const uid = str(body?.uid, 128);
  if (uid && !(await personByUid(w.cid, uid))) return fail(404, 'Employee not found.');
  const auto = await autoValues(w.cid, uid);
  const typed: Record<string, string> = {};
  Object.entries(body?.values && typeof body.values === 'object' ? body.values : {}).forEach(([k, val]) => {
    if (/^[a-z0-9_]{1,40}$/.test(k) && String(val ?? '').trim()) typed[k] = String(val).slice(0, 300);
  });
  const values = { ...auto, ...typed };
  if (!uid && str(body?.recipient, 120)) values.employee_name = values.employee_name || str(body.recipient, 120);
  const r = renderTemplate(tpl.body, values);
  const warnings: string[] = [];
  if (uid && ['EXPERIENCE', 'RELIEVING'].includes(tpl.kind)) {
    const e = await loadExit(w.cid, uid);
    if (!e || !['APPROVED', 'COMPLETED'].includes(e.status)) warnings.push('This person has no accepted exit yet, so the last working day is blank.');
    else if (tpl.kind === 'RELIEVING' && e.status !== 'COMPLETED') warnings.push('The exit is not completed yet (clearance may be pending).');
  }
  return ok({ text: r.text, missing: r.missing, values, fields: fieldsIn(tpl.body), warnings, catalog: MERGE_FIELDS });
}

async function letterIssue(w: Who, body: any): Promise<Result> {
  needManage(w);
  const prev = await letterPreview(w, body);
  if (prev.status !== 200) return prev;
  const { settings } = await loadSettings(w.cid);
  const tpl = settings.letters.find((l) => l.id === str(body?.templateId, 40))!;
  const uid = str(body?.uid, 128);
  const recipient = (uid ? (await personByUid(w.cid, uid))?.name : '') || str(body?.recipient, 120);
  if (!recipient) return fail(400, 'Enter the name of the person this letter is for.');
  // HR may have edited the wording in the preview; otherwise use what the template produces
  const edited = typeof body?.text === 'string' && body.text.trim() ? String(body.text).slice(0, 30000) : '';
  const text = edited || prev.json.text;
  if (!edited && prev.json.missing.length && body?.allowMissing !== true) return fail(409, `Fill these in first: ${prev.json.missing.join(', ')}.`);
  if (/\{\{[a-z0-9_]+\}\}/i.test(text) && body?.allowMissing !== true) return fail(409, 'The letter still has {{fields}} that are not filled in.');
  const prefix = ({ OFFER: 'OFR', APPOINTMENT: 'APT', EXPERIENCE: 'EXP', RELIEVING: 'REL', CUSTOM: 'LTR' } as Record<string, string>)[tpl.kind] || 'LTR';
  const year = istToday().slice(0, 4);
  const existing = await db().collection('lifecycleLetters').where('companyId', '==', w.cid).get();
  const seq = existing.docs.filter((d: any) => String(d.get('number') || '').startsWith(`${prefix}/${year}/`)).length + 1;
  const number = `${prefix}/${year}/${String(seq).padStart(4, '0')}`;
  const doc: LetterDoc = {
    companyId: w.cid, uid, templateId: tpl.id, kind: tpl.kind, title: tpl.name, number, recipient, text, issuedBy: await actorOf(w), issuedAt: nowIso(),
  };
  const ref = db().collection('lifecycleLetters').doc();
  await ref.set(clean(doc));
  return ok({ id: ref.id, letter: { id: ref.id, ...doc } });
}

const letterRow = (id: string, d: LetterDoc, withText: boolean) => ({
  id, number: d.number, title: d.title, kind: d.kind, recipient: d.recipient, uid: d.uid, issuedBy: d.issuedBy, issuedAt: d.issuedAt, ...(withText ? { text: d.text } : {}),
});

async function lettersList(w: Who, q: any): Promise<Result> {
  needManage(w);
  const uid = str(q?.uid, 128);
  let query: any = db().collection('lifecycleLetters').where('companyId', '==', w.cid);
  if (uid) query = query.where('uid', '==', uid);
  const snap = await query.get();
  const rows = snap.docs.map((d: any) => letterRow(d.id, d.data() as LetterDoc, false)).sort((a: any, b: any) => b.issuedAt.localeCompare(a.issuedAt));
  return ok({ letters: rows });
}

async function myLetters(w: Who): Promise<Result> {
  const snap = await db().collection('lifecycleLetters').where('companyId', '==', w.cid).where('uid', '==', w.uid).get();
  return ok({ letters: snap.docs.map((d: any) => letterRow(d.id, d.data() as LetterDoc, true)).sort((a: any, b: any) => b.issuedAt.localeCompare(a.issuedAt)) });
}

async function letterGet(w: Who, q: any): Promise<Result> {
  const snap = await db().collection('lifecycleLetters').doc(str(q?.id, 128)).get();
  if (!snap.exists) return fail(404, 'Letter not found.');
  const d = snap.data() as LetterDoc;
  if (d.companyId !== w.cid || (!w.canManage && d.uid !== w.uid)) return fail(404, 'Letter not found.');
  return ok({ letter: letterRow(snap.id, d, true) });
}

// ------------------------------------------------------------------ directory

async function directory(w: Who, q: any): Promise<Result> {
  const [people, profiles] = await Promise.all([loadPeople(w.cid), loadProfiles(w.cid)]);
  const by = nameMap(people);
  const showAll = w.canManage && q?.all === '1';
  const rows = people
    .filter((p) => showAll || p.active)
    .map((p) => {
      const pr: Profile | undefined = profiles.get(p.uid);
      const mgr = pr?.managerUid && by.has(pr.managerUid) ? pr.managerUid : '';
      return { uid: p.uid, name: p.name, email: p.email, empId: p.empId, department: p.department, title: p.title, active: p.active, managerUid: mgr, managerName: mgr ? by.get(mgr)!.name : '', joinDate: pr?.joinDate || '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const counts = new Map<string, number>();
  rows.forEach((r) => r.managerUid && counts.set(r.managerUid, (counts.get(r.managerUid) || 0) + 1));
  return ok({ people: rows.map((r) => ({ ...r, directReports: counts.get(r.uid) || 0 })), canEdit: w.canManage || hasPerm(w.ctx.perms, 'leave.manage') || w.ctx.isCompanyAdmin, me: w.uid });
}

async function setManager(w: Who, body: any): Promise<Result> {
  if (!(w.canManage || hasPerm(w.ctx.perms, 'leave.manage'))) return fail(403, 'You cannot change reporting lines.');
  const uid = str(body?.uid, 128);
  const managerUid = str(body?.managerUid, 128);
  const people = await loadPeople(w.cid);
  if (!people.some((p) => p.uid === uid)) return fail(404, 'Employee not found.');
  if (managerUid && !people.some((p) => p.uid === managerUid && p.active)) return fail(404, 'Manager not found or not active.');
  const profiles = await loadProfiles(w.cid);
  const org = people.map((p) => ({ uid: p.uid, name: p.name, managerUid: profiles.get(p.uid)?.managerUid || '' }));
  if (wouldCycle(org, uid, managerUid)) return fail(409, 'That would make a reporting loop (someone would end up reporting to themselves).');
  const prev = profiles.get(uid) || { uid };
  await db().collection('leaveProfiles').doc(profileId(w.cid, uid)).set(clean({ ...prev, uid, managerUid, companyId: w.cid, updatedAt: nowIso() }));
  return ok({});
}

// ------------------------------------------------------------------ employee profile (Employee > Employee Master)
//
// One page per person. Core facts come from the employee record, leave profile and exit case; the extra fields HR fills in
// live in the server-only employeeProfiles collection, and the birth date stays in personalDates (colleagues must not read it).

const PROFILE_TEXT = ['machineCode', 'oldCode', 'salutation', 'firstName', 'middleName', 'lastName', 'shortName', 'nameInLocal', 'mobile'] as const;
const PROFILE_DATES = ['confirmationDate', 'wef'] as const;
const profileDocId = (cid: string, uid: string) => `${cid}__${uid}`;
const canSeeProfiles = (w: Who) => w.canManage || hasPerm(w.ctx.perms, 'leave.manage');

async function profileGet(w: Who, q: any): Promise<Result> {
  const uid = str(q?.uid, 128) || w.uid;
  if (uid !== w.uid && !canSeeProfiles(w)) return fail(403, 'You can only open your own profile.');
  const [person, profiles, people, extraSnap, datesSnap, exit] = await Promise.all([
    personByUid(w.cid, uid), loadProfiles(w.cid), loadPeople(w.cid),
    db().collection('employeeProfiles').doc(profileDocId(w.cid, uid)).get(),
    db().collection('personalDates').doc(profileDocId(w.cid, uid)).get(),
    loadExit(w.cid, uid),
  ]);
  if (!person) return fail(404, 'Employee not found.');
  const pr: Profile | undefined = profiles.get(uid);
  const x: any = extraSnap.exists && extraSnap.data().companyId === w.cid ? extraSnap.data() : {};
  const dates: any = datesSnap.exists && datesSnap.data().companyId === w.cid ? datesSnap.data() : {};
  const by = nameMap(people);
  const mgrUid = pr?.managerUid && by.has(pr.managerUid) ? pr.managerUid : '';
  const mgr = mgrUid ? by.get(mgrUid)! : null;
  let approving = mgr;
  if (mgrUid) {
    const del = await db().collection('leaveDelegations').doc(`${w.cid}__${mgrUid}`).get();
    const d: any = del.exists ? del.data() : null;
    const today = istToday();
    if (d && d.from <= today && today <= d.to) {
      const cover = people.find((p) => p.uid === d.delegateUid && p.active);
      if (cover) approving = by.get(cover.uid)!;
    }
  }
  const parts = person.name.trim().split(/\s+/);
  const fallbackFirst = parts[0] || '';
  const fallbackLast = parts.length > 1 ? parts[parts.length - 1] : '';
  const fallbackMiddle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
  const left = exit && exit.status === 'COMPLETED' ? exit.lastWorkingDay : exit && ['APPROVED', 'MANAGER_APPROVED', 'SUBMITTED'].includes(exit.status) ? exit.lastWorkingDay || exit.requestedLastDay : '';
  return ok({
    canEdit: w.canManage,
    profile: {
      uid, name: person.name, email: person.email, empId: person.empId, department: person.department, title: person.title, active: person.active,
      salutation: x.salutation || '', firstName: x.firstName || fallbackFirst, middleName: x.middleName ?? fallbackMiddle, lastName: x.lastName || fallbackLast,
      shortName: x.shortName || '', nameInLocal: x.nameInLocal || '', machineCode: x.machineCode || '', oldCode: x.oldCode || '', mobile: x.mobile || '',
      gender: x.gender || (pr?.gender === 'M' ? 'Male' : pr?.gender === 'F' ? 'Female' : pr?.gender === 'O' ? 'Other' : ''),
      dob: dates.dob || '', joinDate: pr?.joinDate || '', leavingDate: left || '', confirmationDate: x.confirmationDate || '', wef: x.wef || pr?.joinDate || '',
      reportingManager: mgr ? { uid: mgr.uid, name: mgr.name, empId: mgr.empId } : null,
      approvingManager: approving ? { uid: approving.uid, name: approving.name, empId: approving.empId } : null,
      exitStatus: exit?.status || '', exitReason: exit?.reason || '', resignationDate: exit?.resignationDate || '', lastWorkingDay: exit?.lastWorkingDay || '',
    },
  });
}

async function profileSave(w: Who, body: any): Promise<Result> {
  needManage(w);
  const uid = str(body?.uid, 128);
  if (!(await personByUid(w.cid, uid))) return fail(404, 'Employee not found.');
  const f = body?.fields && typeof body.fields === 'object' ? body.fields : {};
  const next: Record<string, string> = {};
  for (const k of PROFILE_TEXT) if (f[k] !== undefined) next[k] = str(f[k], k === 'mobile' ? 20 : 80);
  if (f.gender !== undefined) {
    if (!['', 'Male', 'Female', 'Other'].includes(f.gender)) return fail(400, 'Choose Male, Female or Other for gender.');
    next.gender = f.gender;
  }
  for (const k of PROFILE_DATES) {
    if (f[k] === undefined) continue;
    const v = str(f[k], 10);
    if (v && !isDate(v)) return fail(400, 'Use a valid date for ' + k + '.');
    next[k] = v;
  }
  if (next.mobile && !/^[0-9+()\-\s]{6,20}$/.test(next.mobile)) return fail(400, 'Enter a valid mobile number.');
  const ref = db().collection('employeeProfiles').doc(profileDocId(w.cid, uid));
  const cur = await ref.get();
  await ref.set(clean({ ...(cur.exists ? cur.data() : {}), ...next, uid, companyId: w.cid, updatedAt: nowIso(), updatedBy: w.uid }));
  if (f.dob !== undefined) {
    const dob = str(f.dob, 10);
    if (dob && (!isDate(dob) || dob < '1900-01-01' || dob > istToday())) return fail(400, 'Use a valid date of birth.');
    const dref = db().collection('personalDates').doc(profileDocId(w.cid, uid));
    const dcur = await dref.get();
    const d: any = dcur.exists ? dcur.data() : {};
    await dref.set(clean({ showCelebrations: true, showMarriage: false, marriageDate: '', ...d, companyId: w.cid, uid, dob, updatedAt: nowIso(), updatedBy: w.uid }));
  }
  return ok({});
}

// ------------------------------------------------------------------ router

async function me(w: Who): Promise<Result> {
  // Only my own data: a one-row check for direct reports, and only the tasks that are mine or assigned to me.
  const [hasReports, myExit, mine, assigned] = await Promise.all([
    db().collection('leaveProfiles').where('companyId', '==', w.cid).where('managerUid', '==', w.uid).limit(1).get(),
    loadExit(w.cid, w.uid),
    loadTasks(w.cid, w.uid),
    db().collection('lifecycleTasks').where('companyId', '==', w.cid).where('assigneeUid', '==', w.uid).get(),
  ]);
  const ids = new Set<string>();
  const open = [...mine, ...assigned.docs.map((d: any) => ({ id: d.id, ...(d.data() as TaskDoc) }))]
    .filter((t) => t.status === 'OPEN' && !ids.has(t.id) && ids.add(t.id)).length;
  return ok({ uid: w.uid, canManage: w.canManage, isManager: !hasReports.empty, hasExit: isOpen(myExit), openTasks: open });
}

async function getSettings(w: Who): Promise<Result> {
  needManage(w);
  const { settings, saved } = await loadSettings(w.cid);
  return ok({ settings, saved, people: (await loadPeople(w.cid)).filter((p) => p.active).map((p) => ({ uid: p.uid, name: p.name })), catalog: MERGE_FIELDS });
}

async function saveSettings(w: Who, body: any): Promise<Result> {
  needManage(w);
  const settings = cleanSettings(body?.settings);
  await db().collection('lifecycleSettings').doc(w.cid).set(clean({ ...settings, companyId: w.cid, updatedAt: nowIso() }));
  return ok({ settings });
}

export async function routeLifecycle(r: LifecycleRequestIn): Promise<Result> {
  try {
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    let w: Who;
    try {
      w = await whoIs(r.headers);
    } catch (err) {
      if (err instanceof LcError) return fail(err.status, err.message);
      const known = authErrorResponse(err);
      if (known) return { status: known.status, json: known.json };
      throw err;
    }
    const GET = r.method === 'GET';
    const POST = r.method === 'POST';
    const wrong = fail(404, 'Unknown request.');
    switch (r.action) {
      case 'me': return GET ? await me(w) : wrong;
      case 'settings': return GET ? await getSettings(w) : wrong;
      case 'save-settings': return POST ? await saveSettings(w, body) : wrong;
      case 'onboarding': return GET ? await onboardingList(w) : wrong;
      case 'onboarding-my': return GET ? await onboardingMy(w) : wrong;
      case 'onboarding-start': return POST ? await onboardingStart(w, body) : wrong;
      case 'task-update': return POST ? await taskUpdate(w, body) : wrong;
      case 'task-add': return POST ? await taskAdd(w, body) : wrong;
      case 'task-delete': return POST ? await taskDelete(w, body) : wrong;
      case 'submit-bank': return POST ? await submitBank(w, body) : wrong;
      case 'exit-my': return GET ? await exitMy(w) : wrong;
      case 'exit-resign': return POST ? await exitResign(w, body) : wrong;
      case 'exit-withdraw': return POST ? await exitWithdraw(w) : wrong;
      case 'exit-start': return POST ? await exitStart(w, body) : wrong;
      case 'exit-decide': return POST ? await exitDecide(w, body) : wrong;
      case 'exit-dates': return POST ? await exitSetDates(w, body) : wrong;
      case 'exit-cancel': return POST ? await exitCancel(w, body) : wrong;
      case 'exit-clear': return POST ? await exitClear(w, body) : wrong;
      case 'exit-complete': return POST ? await exitComplete(w, body) : wrong;
      case 'exits': return GET ? await exitsList(w) : wrong;
      case 'exit': return GET ? await exitCase(w, r.query) : wrong;
      case 'letter-preview': return POST ? await letterPreview(w, body) : wrong;
      case 'letter-issue': return POST ? await letterIssue(w, body) : wrong;
      case 'letters': return GET ? await lettersList(w, r.query) : wrong;
      case 'my-letters': return GET ? await myLetters(w) : wrong;
      case 'letter': return GET ? await letterGet(w, r.query) : wrong;
      case 'profile': return GET ? await profileGet(w, r.query) : wrong;
      case 'profile-save': return POST ? await profileSave(w, body) : wrong;
      case 'directory': return GET ? await directory(w, r.query) : wrong;
      case 'set-manager': return POST ? await setManager(w, body) : wrong;
      default: return wrong;
    }
  } catch (err: any) {
    if (err instanceof LcError) return fail(err.status, err.message);
    console.error('[Lifecycle] error:', err);
    return fail(500, err?.message || 'Request failed.');
  }
}
