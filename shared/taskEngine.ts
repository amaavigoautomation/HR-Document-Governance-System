/**
 * Task Management: the rules, with no database and no screen in them (so they are easy to test).
 * Used by api/_lib/taskApi.ts and by the Tasks screens.
 */
import { addDays, isDate } from './pmEngine';

// ------------------------------------------------------------------ vocabulary

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'REWORK' | 'DONE';
/** What a status means, whatever it is called: used for dashboards and "is this still open?". */
export type StatusType = 'NOT_STARTED' | 'ACTIVE' | 'REVIEW' | 'DONE';

export const STATUSES: { key: TaskStatus; label: string; type: StatusType }[] = [
  { key: 'TODO', label: 'Not started', type: 'NOT_STARTED' },
  { key: 'IN_PROGRESS', label: 'In progress', type: 'ACTIVE' },
  { key: 'IN_REVIEW', label: 'In review', type: 'REVIEW' },
  { key: 'REWORK', label: 'Needs changes', type: 'ACTIVE' },
  { key: 'DONE', label: 'Done', type: 'DONE' },
];
export const STATUS_KEYS = STATUSES.map((s) => s.key);
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
export const isStatus = (v: unknown): v is TaskStatus => STATUS_KEYS.includes(v as TaskStatus);
export const isOpen = (status: string) => status !== 'DONE';

export type Priority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
export const PRIORITIES: { key: Priority; label: string; rank: number }[] = [
  { key: 'URGENT', label: 'Urgent', rank: 0 },
  { key: 'HIGH', label: 'High', rank: 1 },
  { key: 'NORMAL', label: 'Normal', rank: 2 },
  { key: 'LOW', label: 'Low', rank: 3 },
];
export const isPriority = (v: unknown): v is Priority => PRIORITIES.some((p) => p.key === v);
export const priorityRank = (p: string) => PRIORITIES.find((x) => x.key === p)?.rank ?? 2;

export const LIMITS = {
  title: 200, description: 4000, checklist: 40, checklistText: 200, attachments: 10, attachmentBytes: 10 * 1024 * 1024,
  comment: 2000, tags: 8, tag: 24, projectName: 80, projectText: 400, watchers: 20,
};
/** Files people may attach. Anything that can run (exe, js, html, svg ...) is not on the list. */
export const ATTACHMENT_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt'];
export const extOf = (name: string) => (String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] || '');
export function attachmentProblem(name: string, bytes: number, already: number): string | null {
  if (!ATTACHMENT_EXT.includes(extOf(name))) return `This file type cannot be attached. Allowed: ${ATTACHMENT_EXT.join(', ')}.`;
  if (!(bytes > 0)) return 'The file is empty.';
  if (bytes > LIMITS.attachmentBytes) return `Files can be up to ${LIMITS.attachmentBytes / 1024 / 1024} MB.`;
  if (already >= LIMITS.attachments) return `A task can have up to ${LIMITS.attachments} attachments.`;
  return null;
}

// ------------------------------------------------------------------ who may assign to whom

/** Everyone below `uid` in the reporting line (reports, their reports, and so on). `manager` maps person -> their manager. */
export function downline(manager: Record<string, string>, uid: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const [p, m] of Object.entries(manager)) if (m && m !== p) kids.set(m, [...(kids.get(m) || []), p]);
  const out = new Set<string>();
  const queue = [uid];
  while (queue.length) {
    for (const k of kids.get(queue.shift()!) || []) if (k !== uid && !out.has(k)) { out.add(k); queue.push(k); }
  }
  return out;
}

/** A person may give a task to themselves; a manager to anyone who reports up to them; an admin to anyone. */
export function canAssignTo(o: { actor: string; target: string; actorDownline: Set<string>; unrestricted: boolean }): boolean {
  return !!o.target && (o.unrestricted || o.target === o.actor || o.actorDownline.has(o.target));
}

// ------------------------------------------------------------------ the task and its checks

export interface ChecklistItem { id: string; text: string; done: boolean }

export interface TaskInput {
  title?: unknown; description?: unknown; priority?: unknown; startDate?: unknown; dueDate?: unknown; tags?: unknown; checklist?: unknown;
}

const clip = (v: unknown, max: number) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));

export function cleanTags(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out: string[] = [];
  for (const t of raw) { const s = clip(t, LIMITS.tag).toLowerCase(); if (s && !out.includes(s)) out.push(s); }
  return out.slice(0, LIMITS.tags);
}

export function cleanChecklist(v: unknown, makeId: () => string): ChecklistItem[] {
  if (!Array.isArray(v)) return [];
  const out: ChecklistItem[] = [];
  for (const x of v.slice(0, LIMITS.checklist)) {
    const text = clip((x as any)?.text, LIMITS.checklistText);
    if (!text) continue;
    const id = clip((x as any)?.id, 40) || makeId();
    out.push({ id: out.some((o) => o.id === id) ? makeId() : id, text, done: (x as any)?.done === true });
  }
  return out;
}

/** Plain-words problem with the editable fields of a task, or null when they are fine. */
export function taskProblem(t: TaskInput, today: string, o: { creating: boolean }): string | null {
  if (clip(t.title, LIMITS.title).length < 3) return 'Give the task a short title (at least 3 letters).';
  if (t.priority !== undefined && t.priority !== '' && !isPriority(t.priority)) return 'Pick a priority from the list.';
  const due = clip(t.dueDate, 10); const start = clip(t.startDate, 10);
  if (due && !isDate(due)) return 'The due date is not a valid date.';
  if (start && !isDate(start)) return 'The start date is not a valid date.';
  if (due && start && due < start) return 'The due date cannot be before the start date.';
  if (o.creating && due && due < today) return 'The due date cannot be in the past.';
  if (due && due > addDays(today, 3660)) return 'That due date is too far away.';
  return null;
}

export interface TaskLike {
  status: string; assigneeUid: string; creatorUid: string; reviewerUid?: string; requiresReview?: boolean; dueDate?: string;
  checklist?: { done: boolean }[]; completedAt?: string; createdAt?: string;
}

export const isOverdue = (t: Pick<TaskLike, 'status' | 'dueDate'>, today: string) => isOpen(t.status) && !!t.dueDate && t.dueDate < today;
export function progressOf(t: Pick<TaskLike, 'checklist'>): { done: number; total: number } {
  const list = t.checklist || [];
  return { done: list.filter((c) => c.done).length, total: list.length };
}

/**
 * Who must review. A task linked to a KPI always needs a review (it ends up as performance evidence).
 * Default reviewer: the person who gave the task; when people gave themselves the task, their manager.
 */
export function reviewPlan(o: { requiresReview: boolean; kpiLinked: boolean; reviewerUid?: string; creatorUid: string; assigneeUid: string; assigneeManager?: string }): { requiresReview: boolean; reviewerUid: string; error?: string } {
  const requiresReview = o.requiresReview || o.kpiLinked;
  if (!requiresReview) return { requiresReview: false, reviewerUid: '' };
  const pick = o.reviewerUid || (o.creatorUid !== o.assigneeUid ? o.creatorUid : o.assigneeManager || '');
  if (!pick) return { requiresReview, reviewerUid: '', error: 'Choose who will review this task: you have no manager on record to review it.' };
  if (pick === o.assigneeUid) return { requiresReview, reviewerUid: '', error: 'The reviewer must be someone other than the person doing the task.' };
  return { requiresReview, reviewerUid: pick };
}

export interface MoveWho { isAssignee: boolean; isReviewer: boolean; /** creator, a manager above the assignee, or an admin */ isOwner: boolean; isAdmin: boolean }
export interface MoveResult { ok: boolean; needsNote: boolean; approves: boolean; error?: string }

/** Can this person move this task to `to`? Reviewed tasks can only be finished by their reviewer. */
export function moveCheck(t: TaskLike, to: string, w: MoveWho): MoveResult {
  const from = t.status;
  const yes = (needsNote = false, approves = false): MoveResult => ({ ok: true, needsNote, approves });
  const no = (error: string): MoveResult => ({ ok: false, needsNote: false, approves: false, error });
  if (!isStatus(to)) return no('Pick a status from the list.');
  if (to === from) return yes();
  const doer = w.isAssignee || w.isOwner || w.isAdmin;
  // Nobody approves their own work, not even an admin.
  const judge = (w.isReviewer || w.isAdmin) && !w.isAssignee;
  if (to === 'IN_REVIEW') {
    if (!t.requiresReview) return no('This task does not need a review. Mark it done instead.');
    return doer && (from === 'IN_PROGRESS' || from === 'REWORK' || from === 'TODO') ? yes() : no('Only the person doing the task (or their manager) can send it for review.');
  }
  if (to === 'REWORK') {
    if (from !== 'IN_REVIEW') return no('Only a task that is in review can be sent back for changes.');
    return judge ? yes(true) : no('Only the reviewer can send a task back for changes.');
  }
  if (to === 'DONE') {
    if (t.requiresReview) {
      if (from !== 'IN_REVIEW') return no('This task needs a review first. Send it for review.');
      return judge ? yes(false, true) : no('Only the reviewer can approve this task.');
    }
    return doer ? yes() : no('You cannot finish this task.');
  }
  // TODO / IN_PROGRESS
  if (from === 'DONE') {
    if (t.requiresReview) return judge || w.isOwner ? yes() : no('Only the reviewer or the person who gave the task can reopen it.');
    return doer ? yes() : no('You cannot reopen this task.');
  }
  if (from === 'IN_REVIEW') return judge || w.isOwner ? yes() : no('This task is waiting for its reviewer.');
  return doer ? yes() : no('You cannot change this task.');
}

// ------------------------------------------------------------------ dashboards

export const weekStart = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export interface Stats {
  total: number; open: number; done: number; overdue: number; dueToday: number; dueThisWeek: number; inReview: number; noDueDate: number;
  byStatus: Record<string, number>; byPriority: Record<string, number>;
  /** Open work per person: context for who is stretched. Never a count of finished tasks per person. */
  workload: { uid: string; open: number; overdue: number; inReview: number }[];
  /** Tasks finished per week, for the whole group together. */
  throughput: { week: string; done: number }[];
  avgDaysToFinish: number | null;
}

export function stats(tasks: (TaskLike & { id?: string })[], today: string, weeks = 6): Stats {
  const byStatus: Record<string, number> = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
  const byPriority: Record<string, number> = Object.fromEntries(PRIORITIES.map((p) => [p.key, 0]));
  const load = new Map<string, { uid: string; open: number; overdue: number; inReview: number }>();
  const weekEnd = addDays(today, 6 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  let overdue = 0; let dueToday = 0; let dueThisWeek = 0; let inReview = 0; let noDate = 0; let open = 0;
  const thisWeek = weekStart(today);
  const buckets = new Map<string, number>();
  for (let i = weeks - 1; i >= 0; i--) buckets.set(addDays(thisWeek, -7 * i), 0);
  const spans: number[] = [];
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    if (!isOpen(t.status)) {
      const when = String(t.completedAt || '').slice(0, 10);
      if (isDate(when)) { const w = weekStart(when); if (buckets.has(w)) buckets.set(w, (buckets.get(w) || 0) + 1); }
      if (when && t.createdAt) { const days = (Date.parse(`${when}T00:00:00Z`) - Date.parse(`${String(t.createdAt).slice(0, 10)}T00:00:00Z`)) / 86_400_000; if (days >= 0 && days < 400) spans.push(days); }
      continue;
    }
    open++;
    byPriority[(t as any).priority || 'NORMAL'] = (byPriority[(t as any).priority || 'NORMAL'] || 0) + 1;
    const row = load.get(t.assigneeUid) || { uid: t.assigneeUid, open: 0, overdue: 0, inReview: 0 };
    row.open++;
    if (t.status === 'IN_REVIEW') { inReview++; row.inReview++; }
    if (isOverdue(t, today)) { overdue++; row.overdue++; }
    if (t.dueDate === today) dueToday++;
    if (t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd) dueThisWeek++;
    if (!t.dueDate) noDate++;
    load.set(t.assigneeUid, row);
  }
  return {
    total: tasks.length, open, done: tasks.length - open, overdue, dueToday, dueThisWeek, inReview, noDueDate: noDate, byStatus, byPriority,
    workload: [...load.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    throughput: [...buckets.entries()].map(([week, done]) => ({ week, done })),
    avgDaysToFinish: spans.length ? Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10) / 10 : null,
  };
}

/** Order for the lists: overdue first, then by priority, then by due date. */
export function sortForList<T extends { status: string; priority?: string; dueDate?: string }>(rows: T[], today: string): T[] {
  return [...rows].sort((a, b) =>
    Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
    priorityRank(a.priority || 'NORMAL') - priorityRank(b.priority || 'NORMAL') ||
    String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
}
