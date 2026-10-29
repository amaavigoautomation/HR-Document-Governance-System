/**
 * Performance Management: data access and shared helpers (server only, company scoped).
 *
 * Collections (all closed to browsers by firestore.rules; every record carries companyId):
 *   perfSettings/{cid}            competency master, role families, evidence webhook key
 *   perfFrameworks/{id}           Performance_Framework_Master (weights, rating scale, effective dates, approval)
 *   perfCycles/{id}               Performance_Cycle
 *   perfSops/{id}                 Department_SOP_Master + Role_SOP_Map (linked to Document Governance)
 *   perfSopAssignments/{id}       Employee_SOP_Assignment (read, acknowledged, verified)
 *   perfTemplates/{cid__tpl__rf}  Role_KRA_Template
 *   perfPlans/{id}                Employee_Performance_Plan with KRA assignments and KPI targets (effective dated)
 *   perfEvidence/{id}             KPI_Evidence
 *   perfReviews/{cid__cycle__uid} Performance_Review (one per person per cycle)
 *   perfCheckins/{cid__uid__month}
 *   perfDevPlans/{id}             Employee_Development_Plan
 *   perfAudit/{id}                Performance_Audit_Log (append only)
 *   perfExceptions/{id}           Performance_Exception_Log
 *   perfNotifications/{id}        in-app messages for this module
 */
import { adminDb } from './firebaseAdmin.js';
import { loadPeople, loadProfiles, notify as mail, personByUid, type Person, type Profile } from './leaveCore.js';
import { safeId } from '../../shared/performanceEngine.js';
import { emptyPerfSettings, type ExceptionCategory, type PerfException, type PerfSettings, type Severity } from '../../shared/performance.js';

export const db = () => adminDb();
export const nowIso = () => new Date().toISOString();
export const str = (v: unknown, max = 500) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
export const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Firestore refuses undefined anywhere in a document. */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

export class PerfError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Result {
  status: number;
  json: any;
}
export const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
export const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

export const C = {
  settings: 'perfSettings',
  frameworks: 'perfFrameworks',
  cycles: 'perfCycles',
  sops: 'perfSops',
  assignments: 'perfSopAssignments',
  templates: 'perfTemplates',
  plans: 'perfPlans',
  evidence: 'perfEvidence',
  reviews: 'perfReviews',
  checkins: 'perfCheckins',
  devPlans: 'perfDevPlans',
  audit: 'perfAudit',
  exceptions: 'perfExceptions',
  notifications: 'perfNotifications',
} as const;

// ------------------------------------------------------------------ generic access

export async function list<T = any>(coll: string, cid: string, where: Record<string, unknown> = {}): Promise<(T & { id: string })[]> {
  let q: any = db().collection(coll).where('companyId', '==', cid);
  for (const [k, v] of Object.entries(where)) q = q.where(k, '==', v);
  const snap = await q.get();
  return snap.docs.map((d: any) => ({ ...(d.data() as T), id: d.id }));
}

/** One document, only if it belongs to this company. */
export async function getOne<T = any>(coll: string, id: string, cid: string): Promise<(T & { id: string }) | null> {
  if (!id) return null;
  const snap = await db().collection(coll).doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return data.companyId === cid ? { ...(data as T), id: snap.id } : null;
}

export async function put(coll: string, id: string, doc: Record<string, any>): Promise<void> {
  await db().collection(coll).doc(id).set(plain({ ...doc, id }));
}

// ------------------------------------------------------------------ settings

export async function loadSettings(cid: string): Promise<PerfSettings> {
  const snap = await db().collection(C.settings).doc(cid).get();
  if (!snap.exists) return emptyPerfSettings(cid);
  return { ...emptyPerfSettings(cid), ...(snap.data() as Partial<PerfSettings>) };
}

export async function saveSettings(cid: string, s: PerfSettings): Promise<void> {
  await db().collection(C.settings).doc(cid).set(plain({ ...s, companyId: cid }));
}

// ------------------------------------------------------------------ people

export interface Directory {
  people: Person[];
  active: Person[];
  profiles: Map<string, Profile>;
  byUid: Map<string, Person>;
  managerOf: (uid: string) => string;
  reportsOf: (uid: string) => string[];
  nameOf: (uid: string) => string;
}

export async function loadDirectory(cid: string): Promise<Directory> {
  const [people, profiles] = await Promise.all([loadPeople(cid), loadProfiles(cid)]);
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const hidden = (uid: string) => profiles.get(uid)?.hidden === true;
  const active = people.filter((p) => p.active && !hidden(p.uid));
  return {
    people, active, profiles, byUid,
    managerOf: (uid) => profiles.get(uid)?.managerUid || '',
    reportsOf: (uid) => active.filter((p) => profiles.get(p.uid)?.managerUid === uid).map((p) => p.uid),
    nameOf: (uid) => byUid.get(uid)?.name || '',
  };
}

export { personByUid };

/** People holding at least one of these permissions through their roles (company admins always count). */
export async function peopleWithPerm(cid: string, ...perms: string[]): Promise<string[]> {
  const roles = await list<{ permissions?: string[]; isAdmin?: boolean }>('roles', cid);
  const ids = new Set(roles.filter((r) => r.isAdmin || (r.permissions || []).some((p) => perms.includes(p))).map((r) => r.id));
  if (ids.size === 0) return [];
  const emps = await list<{ authUid?: string; roleIds?: string[]; active?: boolean }>('employees', cid);
  return emps.filter((e) => e.active !== false && (e.roleIds || []).some((r) => ids.has(r))).map((e) => String(e.authUid || e.id));
}

// ------------------------------------------------------------------ audit, exceptions, messages

export async function audit(cid: string, entity: string, entityId: string, action: string, actor: { name: string; uid: string }, oldValue?: unknown, newValue?: unknown): Promise<void> {
  const ref = db().collection(C.audit).doc();
  await ref.set({ id: ref.id, companyId: cid, entity, entityId, action, actor: actor.name, actorUid: actor.uid, at: nowIso(), oldValue: plain(oldValue ?? null), newValue: plain(newValue ?? null) });
}

/** Records a problem for HR to work through. The id comes from what it is about, so a rerun stays one open item. */
export async function raise(cid: string, e: { category: ExceptionCategory; severity?: Severity; message: string; uid?: string; refId?: string; owner?: string; key?: string }): Promise<void> {
  const id = safeId(`${cid}__${e.category}__${e.key || e.refId || e.uid || 'general'}`);
  const ref = db().collection(C.exceptions).doc(id);
  const cur = await ref.get();
  if (cur.exists && (cur.data() as PerfException).status === 'OPEN') return;
  const doc: PerfException = {
    id, companyId: cid, category: e.category, severity: e.severity || 'MEDIUM', message: e.message.slice(0, 400), uid: e.uid || '', refId: e.refId || '',
    owner: e.owner || 'HR', status: 'OPEN', createdAt: nowIso(), resolvedAt: '', resolvedBy: '', resolution: '',
  };
  await ref.set(doc);
}

export interface Note {
  id: string;
  companyId: string;
  uid: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

/**
 * Tells people about something: an in-app message and an email. A key makes it idempotent (a reminder that
 * must only ever go once). Email failures never break the action that caused the message.
 */
export async function tell(cid: string, uids: string[], title: string, body: string, link = '', key = '', dir?: Directory): Promise<void> {
  const targets = [...new Set(uids.filter(Boolean))];
  if (targets.length === 0) return;
  const now = nowIso();
  const fresh: string[] = [];
  await Promise.all(targets.map(async (uid) => {
    const id = key ? safeId(`${cid}__${uid}__${key}`) : db().collection(C.notifications).doc().id;
    const ref = db().collection(C.notifications).doc(id);
    if (key && (await ref.get()).exists) return;
    const note: Note = { id, companyId: cid, uid, title: title.slice(0, 160), body: body.slice(0, 400), link, read: false, createdAt: now };
    await ref.set(note);
    fresh.push(uid);
  }));
  if (fresh.length === 0) return;
  try {
    const people = dir ? dir.people : await loadPeople(cid);
    const emails = people.filter((p) => fresh.includes(p.uid)).map((p) => p.email);
    await mail(cid, emails, title, body);
  } catch (err: any) {
    console.warn('[Performance] email failed:', err?.message || err);
  }
}
