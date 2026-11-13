/**
 * Task Management: shared plumbing for every /api/tasks action.
 *
 * Three server-only collections, each record carrying its companyId so companies never see each other's data:
 *   taskProjects  a board: company-wide, or for one department
 *   taskItems     one task (checklist, attachments and the KPI link live inside it)
 *   taskLog       comments and the activity trail of a task (told apart by `kind`); append-only
 *
 * Who sees what: a person sees the tasks they are involved in (doing, gave, review, or watch), the tasks of everyone who
 * reports up to them, and every task in a project they may open. Admins and people with task.manage / task.view_all see all.
 */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { downline } from '../../shared/taskEngine.js';
import { notify } from './leaveCore.js';
import { load, managerOf, nameOf, type C, type Doc as PmDoc } from './pmCore.js';

export { bad, clean, denied, fail, notFound, nowIso, ok, str, today, active, reportsOf } from './pmCore.js';
export type { Result } from './pmCore.js';

/** A stored record. Tasks, boards and log entries share this loose shape; the screens and rules know which fields each has. */
export type Doc = PmDoc & { status: string; assigneeUid: string; creatorUid: string; priority?: string; dueDate?: string; reviewerUid?: string; requiresReview?: boolean; name?: string; scope?: string };

export const TCOLL = { projects: 'taskProjects', items: 'taskItems', log: 'taskLog' } as const;
export type TColl = keyof typeof TCOLL;

// ------------------------------------------------------------------ storage

const stamp = () => new Date().toISOString();
export async function tList(cid: string, coll: TColl, eq: Record<string, string> = {}): Promise<Doc[]> {
  let q: any = adminDb().collection(TCOLL[coll]).where('companyId', '==', cid);
  for (const [k, v] of Object.entries(eq)) q = q.where(k, '==', v);
  return (await q.get()).docs.map((d: any) => d.data() as Doc);
}
export async function tGet(cid: string, coll: TColl, id: string): Promise<Doc | null> {
  if (!id) return null;
  const s = await adminDb().collection(TCOLL[coll]).doc(id).get();
  const d = s.exists ? (s.data() as Doc) : null;
  return d && d.companyId === cid ? d : null;
}
export async function tPut(coll: TColl, d: PmDoc): Promise<Doc> {
  const next = JSON.parse(JSON.stringify({ ...d, updatedAt: stamp(), createdAt: d.createdAt || stamp() }));
  await adminDb().collection(TCOLL[coll]).doc(d.id).set(next);
  return next;
}
export const tDel = (coll: TColl, id: string) => adminDb().collection(TCOLL[coll]).doc(id).delete();
export const tNewId = (coll: TColl) => adminDb().collection(TCOLL[coll]).doc().id;

// ------------------------------------------------------------------ who is asking

export interface TC extends C {
  /** task.manage or company admin: sees and edits everything */
  canManage: boolean;
  /** task.view_all: sees every task and the company dashboard, read-only */
  canViewAll: boolean;
  /** everyone who reports up to me, directly or through others */
  down: Set<string>;
  /** names of the departments I head */
  headOf: string[];
}

export async function loadT(ctx: Parameters<typeof load>[0]): Promise<TC> {
  const c = await load(ctx);
  const mgr: Record<string, string> = {};
  for (const p of c.people) if (p.active) mgr[p.uid] = managerOf(c, p.uid);
  const depts = await adminDb().collection('departments').where('companyId', '==', c.cid).get();
  const headOf = depts.docs.map((d: any) => d.data() as any).filter((d: any) => { const h = c.byUid.get(String(d.headUserId || '')); return !!h && h.uid === ctx.uid; }).map((d: any) => String(d.name || ''));
  return {
    ...c, canManage: ctx.isCompanyAdmin || ctx.perms.includes('task.manage'), canViewAll: ctx.perms.includes('task.view_all'),
    down: downline(mgr, ctx.uid), headOf,
  };
}

/** A context for the daily job: no signed-in person. */
export async function loadTSystem(cid: string): Promise<TC> {
  const c = await loadT({ uid: 'system', email: '', companyId: cid, companyStatus: 'ACTIVE', perms: [], isCompanyAdmin: false, isPlatformAdmin: false });
  return { ...c, who: 'System', me: undefined, system: true };
}

export const myDepartment = (c: TC) => c.me?.department || '';
export const isAdminish = (c: TC) => c.canManage;

// ------------------------------------------------------------------ projects

export function canUseProject(c: TC, p: Doc): boolean {
  if (p.status === 'ARCHIVED') return false;
  if (c.canManage || c.canViewAll || p.ownerUid === c.ctx.uid) return true;
  if (p.scope === 'COMPANY') return true;
  return !!p.department && (myDepartment(c) === p.department || c.headOf.includes(p.department));
}
export function canEditProject(c: TC, p: Doc): boolean {
  return c.canManage || p.ownerUid === c.ctx.uid || (p.scope === 'DEPARTMENT' && c.headOf.includes(p.department));
}
/** Company-wide boards: task.manage. Department boards: task.manage, the department head, or a manager in that department. */
export function canCreateProject(c: TC, scope: string, department: string): boolean {
  if (c.canManage) return true;
  if (scope !== 'DEPARTMENT' || !department) return false;
  return c.headOf.includes(department) || (c.down.size > 0 && myDepartment(c) === department);
}

// ------------------------------------------------------------------ task access

export const isInvolved = (c: TC, t: Doc) => {
  const me = c.ctx.uid;
  return t.assigneeUid === me || t.creatorUid === me || t.reviewerUid === me || (Array.isArray(t.watchers) && t.watchers.includes(me));
};
export const aboveAssignee = (c: TC, t: Doc) => c.down.has(t.assigneeUid);

export function canSeeTask(c: TC, t: Doc, projects: Map<string, Doc>): boolean {
  if (c.canManage || c.canViewAll || isInvolved(c, t) || aboveAssignee(c, t)) return true;
  const p = t.projectId ? projects.get(t.projectId) : null;
  return !!p && canUseProject(c, p);
}
/** Creator, a manager above the assignee, or an admin: may change the task itself, not only move it. */
export const isTaskOwner = (c: TC, t: Doc) => c.canManage || t.creatorUid === c.ctx.uid || aboveAssignee(c, t);

/** The task as the screens get it: names filled in, attachment storage details left out. */
export function taskView(c: TC, t: Doc, projects: Map<string, Doc>): Doc {
  const { reminded, evidenceId, ...rest } = t;
  const attachments = (Array.isArray(t.attachments) ? t.attachments : []).map((a: any) => ({ id: a.id, name: a.name, bytes: a.bytes, type: a.type, at: a.at, byName: a.byName, resourceType: a.resourceType }));
  return {
    ...rest, attachments,
    assigneeName: nameOf(c, t.assigneeUid) || t.assigneeName || '', creatorName: nameOf(c, t.creatorUid) || t.creatorName || '',
    reviewerName: t.reviewerUid ? nameOf(c, t.reviewerUid) || t.reviewerName || '' : '',
    projectName: t.projectId ? projects.get(t.projectId)?.name || '' : '',
    evidenceStatus: t.evidenceStatus || '',
    mine: t.assigneeUid === c.ctx.uid,
  };
}

// ------------------------------------------------------------------ activity and messages

export async function logTask(c: TC, taskId: string, action: string, detail = '', kind: 'ACTIVITY' | 'COMMENT' = 'ACTIVITY'): Promise<Doc> {
  const id = tNewId('log');
  return tPut('log', { id, companyId: c.cid, taskId, kind, action, detail: String(detail).slice(0, kind === 'COMMENT' ? 2000 : 600), byUid: c.ctx.uid, byName: c.who, at: stamp() });
}

export async function tell(c: { cid: string; byUid: Map<string, any> }, uids: string[], subject: string, body: string): Promise<void> {
  const emails = Array.from(new Set(uids)).map((u) => c.byUid.get(u)?.email || '').filter(Boolean);
  if (emails.length) await notify(c.cid, emails, subject, `${body}\n\nOpen the HR portal → Tasks to see it.`);
}

// ------------------------------------------------------------------ attachment storage (Cloudinary for now)

export interface UploadTicket { uploadUrl: string; apiKey: string; fields: Record<string, string> }
export interface StoredFile { bytes: number; format: string; resourceType: string }
/**
 * Where attachment bytes live. Cloudinary today (files are uploaded straight from the browser with a short-lived signature,
 * and kept private: they can only be opened through a link this server signs for people who may see the task).
 * To move to another store later, implement this interface and change `store` below; nothing else in the module knows about Cloudinary.
 */
export interface AttachmentStore {
  name: string;
  configured(): boolean;
  /** A signed ticket the browser uses to upload exactly one file to `publicId`. */
  ticket(publicId: string): UploadTicket;
  /** Looks the file up at the store, so the size we record is the store's own and not the browser's claim. */
  inspect(publicId: string, resourceType: string): Promise<StoredFile | null>;
  /** A link that works for a few minutes. */
  link(publicId: string, resourceType: string, format: string, name: string): string;
  remove(publicId: string, resourceType: string): Promise<void>;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
/** Cloudinary's rule: sort the parameters, join as a=b&c=d, add the API secret, SHA-1. */
export const cloudinarySign = (params: Record<string, string | number>, secret: string) =>
  sha1(Object.keys(params).filter((k) => params[k] !== '' && params[k] !== undefined).sort().map((k) => `${k}=${params[k]}`).join('&') + secret);

const cloudEnv = () => ({ cloud: (process.env.CLOUDINARY_CLOUD_NAME || '').trim(), key: (process.env.CLOUDINARY_API_KEY || '').trim(), secret: (process.env.CLOUDINARY_API_SECRET || '').trim() });
const RESOURCE_TYPES = ['image', 'raw', 'video'];

export const cloudinaryStore: AttachmentStore = {
  name: 'cloudinary',
  configured: () => { const e = cloudEnv(); return !!(e.cloud && e.key && e.secret); },
  ticket(publicId) {
    const e = cloudEnv();
    const fields: Record<string, string> = { public_id: publicId, type: 'authenticated', timestamp: String(Math.floor(Date.now() / 1000)) };
    fields.signature = cloudinarySign(fields, e.secret);
    return { uploadUrl: `https://api.cloudinary.com/v1_1/${e.cloud}/auto/upload`, apiKey: e.key, fields };
  },
  async inspect(publicId, resourceType) {
    const e = cloudEnv();
    if (!RESOURCE_TYPES.includes(resourceType)) return null;
    const res = await fetch(`https://api.cloudinary.com/v1_1/${e.cloud}/resources/${resourceType}/authenticated/${publicId.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${e.key}:${e.secret}`).toString('base64')}` },
    });
    if (!res.ok) return null;
    const j: any = await res.json().catch(() => null);
    return j && Number.isFinite(Number(j.bytes)) ? { bytes: Number(j.bytes), format: String(j.format || ''), resourceType } : null;
  },
  link(publicId, resourceType, format, name) {
    const e = cloudEnv();
    const p: Record<string, string | number> = { public_id: publicId, type: 'authenticated', timestamp: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 300, attachment: name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file' };
    if (format) p.format = format;
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])), api_key: e.key, signature: cloudinarySign(p, e.secret) });
    return `https://api.cloudinary.com/v1_1/${e.cloud}/${resourceType}/download?${qs.toString()}`;
  },
  async remove(publicId, resourceType) {
    const e = cloudEnv();
    const p: Record<string, string | number> = { public_id: publicId, type: 'authenticated', timestamp: Math.floor(Date.now() / 1000), invalidate: 'true' };
    const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)])), api_key: e.key, signature: cloudinarySign(p, e.secret) });
    await fetch(`https://api.cloudinary.com/v1_1/${e.cloud}/${resourceType}/destroy`, { method: 'POST', body }).catch(() => null);
  },
};

let store: AttachmentStore = cloudinaryStore;
export const attachments = () => store;
/** Tests swap the store for a fake one. */
export const __useAttachmentStore = (s: AttachmentStore | null) => { store = s || cloudinaryStore; };
