/**
 * Performance Management: shared plumbing for every /api/pm action.
 *
 * Nine server-only collections, each record carrying its companyId so companies never see each other's data:
 *   pmSettings   one per company: weights, behaviours, SOP library, timings
 *   pmTemplates  KRA/KPI template per designation
 *   pmPlans      one per employee per role period (KPIs + targets, behaviours, SOPs with acknowledgement)
 *   pmEvidence   work done, linked to a KPI, verified by the manager
 *   pmCheckins   monthly manager check-in
 *   pmCycles     one per company per quarter
 *   pmReviews    one per employee per quarter, with a frozen copy of the plan it was scored against
 *   pmDevPlans   development / improvement / recognition plan that follows a review
 *   pmLog        audit trail and exceptions (told apart by `kind`)
 */
import { adminDb } from './firebaseAdmin.js';
import type { AuthContext } from './authContext.js';
import { loadPeople, loadProfiles, notify, type Person } from './leaveCore.js';
import { DEFAULT_COMPETENCIES, DEFAULT_WEIGHTS, istToday, type Competency, type Weights } from '../../shared/pmEngine.js';

export const COLL = {
  settings: 'pmSettings', templates: 'pmTemplates', plans: 'pmPlans', evidence: 'pmEvidence', checkins: 'pmCheckins',
  cycles: 'pmCycles', reviews: 'pmReviews', growth: 'pmDevPlans', log: 'pmLog',
} as const;
export type Coll = keyof typeof COLL;

export interface Doc { id: string; companyId: string; createdAt?: string; updatedAt?: string; [k: string]: any }
export type Result = { status: number; json: any };

export const db = () => adminDb();
export const nowIso = () => new Date().toISOString();
export const today = istToday;
export const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
export const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
export const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
export const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
export const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
export const lc = (s: unknown) => str(s, 200).toLowerCase();
export const slug = (s: unknown) => lc(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'none';

// ------------------------------------------------------------------ storage

export async function list(cid: string, coll: Coll, eq: Record<string, string> = {}): Promise<Doc[]> {
  let q: any = db().collection(COLL[coll]).where('companyId', '==', cid);
  for (const [k, v] of Object.entries(eq)) q = q.where(k, '==', v);
  const s = await q.get();
  return s.docs.map((d: any) => d.data() as Doc);
}
export async function get(cid: string, coll: Coll, id: string): Promise<Doc | null> {
  if (!id) return null;
  const s = await db().collection(COLL[coll]).doc(id).get();
  const d = s.exists ? (s.data() as Doc) : null;
  return d && d.companyId === cid ? d : null;
}
export async function put(coll: Coll, d: Doc): Promise<Doc> {
  const next = clean({ ...d, updatedAt: nowIso(), createdAt: d.createdAt || nowIso() });
  await db().collection(COLL[coll]).doc(d.id).set(next);
  return next;
}
export const del = (coll: Coll, id: string) => db().collection(COLL[coll]).doc(id).delete();
export const newId = (coll: Coll) => db().collection(COLL[coll]).doc().id;

// ------------------------------------------------------------------ who is asking

export interface C {
  ctx: AuthContext; cid: string; people: Person[]; byUid: Map<string, Person>; who: string; me: Person | undefined;
  /** employee uid -> reporting manager uid */
  manager: Map<string, string>;
  /** pm.manage or company admin: runs setup, approves plans and reviews */
  isHr: boolean;
  /** pm.approve: may also approve reviews and amend final ones */
  isApprover: boolean;
  /** may see grouped figures */
  canReports: boolean;
  system: boolean;
}

export async function load(ctx: AuthContext): Promise<C> {
  const cid = ctx.companyId!;
  const [people, profiles, depts] = await Promise.all([loadPeople(cid), loadProfiles(cid), db().collection('departments').where('companyId', '==', cid).get()]);
  const byUid = new Map<string, Person>();
  for (const p of people) { byUid.set(p.uid, p); if (!byUid.has(p.docId)) byUid.set(p.docId, p); }
  const manager = new Map<string, string>();
  for (const p of people) manager.set(p.uid, profiles.get(p.uid)?.managerUid || '');
  const me = byUid.get(ctx.uid);
  const heads = depts.docs.some((d: any) => { const h = byUid.get(String((d.data() as any).headUserId || '')); return !!h && h.uid === ctx.uid; });
  const isHr = ctx.isCompanyAdmin || ctx.perms.includes('pm.manage');
  const isApprover = ctx.isCompanyAdmin || ctx.perms.includes('pm.approve');
  return { ctx, cid, people, byUid, who: me?.name || ctx.email, me, manager, isHr, isApprover, canReports: isHr || isApprover || ctx.perms.includes('pm.view') || heads, system: false };
}

/** Work done by the system itself (the daily job): no signed-in person. */
export async function loadSystem(cid: string): Promise<C> {
  const ctx: AuthContext = { uid: 'system', email: '', companyId: cid, companyStatus: 'ACTIVE', perms: [], isCompanyAdmin: false, isPlatformAdmin: false };
  const c = await load(ctx);
  return { ...c, who: 'System', me: undefined, isHr: false, isApprover: false, canReports: false, system: true };
}

export const active = (c: C) => c.people.filter((p) => p.active);
export const nameOf = (c: C, uid?: string) => (uid ? c.byUid.get(uid)?.name || '' : '');
export const managerOf = (c: C, uid: string): string => { const m = c.manager.get(uid) || ''; const p = m ? c.byUid.get(m) : null; return p && p.active && p.uid !== uid ? p.uid : ''; };
export const reportsOf = (c: C, mgr: string) => active(c).filter((p) => managerOf(c, p.uid) === mgr);
export const isManagerOf = (c: C, uid: string) => !!uid && managerOf(c, uid) === c.ctx.uid;
export const hasReports = (c: C, uid: string) => active(c).some((p) => managerOf(c, p.uid) === uid);
/** The person, their manager, HR and approvers may see one person's records. */
export const canSee = (c: C, uid: string) => c.ctx.uid === uid || isManagerOf(c, uid) || c.isHr || c.isApprover;
export const hrUids = async (c: C): Promise<string[]> => {
  const snap = await db().collection('employees').where('companyId', '==', c.cid).get();
  const out: string[] = [];
  for (const d of snap.docs) {
    const x = d.data() as any;
    const perms: string[] = Array.isArray(x.perms) ? x.perms : Array.isArray(x.permissions) ? x.permissions : [];
    if (x.active !== false && (x.isCompanyAdmin === true || perms.includes('pm.manage'))) out.push(String(x.authUid || d.id));
  }
  return out;
};

// ------------------------------------------------------------------ settings

export interface SopDef { documentId: string; title: string; departments: string[]; designations: string[]; critical: boolean }
export interface Timing { selfDays: number; managerDays: number; hrDays: number; publishDelayDays: number; remindEvery: number; escalateAfter: number }
export interface Settings extends Doc {
  weights: Weights; competencies: Competency[]; managerExtras: boolean; sops: SopDef[]; timing: Timing;
  feedUrl: string; feedLast: string; setupDone: boolean; setupDoneAt: string; aiOn: boolean;
}
export const DEFAULT_TIMING: Timing = { selfDays: 7, managerDays: 7, hrDays: 5, publishDelayDays: 2, remindEvery: 3, escalateAfter: 7 };
export async function settingsOf(cid: string): Promise<Settings> {
  const d = (await get(cid, 'settings', cid)) as Settings | null;
  const base: Settings = {
    id: cid, companyId: cid, weights: { ...DEFAULT_WEIGHTS }, competencies: DEFAULT_COMPETENCIES.map((x) => ({ ...x })), managerExtras: true, sops: [],
    timing: { ...DEFAULT_TIMING }, feedUrl: '', feedLast: '', setupDone: false, setupDoneAt: '', aiOn: false,
  };
  return d ? { ...base, ...d, timing: { ...DEFAULT_TIMING, ...(d.timing || {}) } } : base;
}

// ------------------------------------------------------------------ audit trail and exceptions

/** Append-only. Nothing here is ever changed or deleted. */
export async function audit(c: C, ref: string, action: string, detail = '', subjectUid = ''): Promise<void> {
  const id = newId('log');
  await put('log', { id, companyId: c.cid, kind: 'AUDIT', ref, action, detail: str(detail, 800), subjectUid, actor: c.who, actorUid: c.ctx.uid, at: nowIso() });
}

/** The three ways an exception is handled (the spec's 15 cases fold into these). */
export type Behaviour = 'BLOCK' | 'REMIND' | 'LOG';
export const EXCEPTIONS: Record<string, { label: string; behaviour: Behaviour }> = {
  SETUP_UNFINISHED: { label: 'Performance setup is not finished', behaviour: 'BLOCK' },
  NO_MANAGER: { label: 'No reporting manager', behaviour: 'BLOCK' },
  NO_TEMPLATE: { label: 'No KRA/KPI template for this designation', behaviour: 'BLOCK' },
  NO_PLAN_FOR_REVIEW: { label: 'Review waiting for an approved plan', behaviour: 'BLOCK' },
  TARGETS_LATE: { label: 'Targets not set on time', behaviour: 'REMIND' },
  PLAN_ACK_LATE: { label: 'Targets not acknowledged', behaviour: 'REMIND' },
  SOP_ACK_LATE: { label: 'SOP not acknowledged', behaviour: 'REMIND' },
  CHECKIN_LATE: { label: 'Monthly check-in missed', behaviour: 'REMIND' },
  REVIEW_LATE: { label: 'Review step is late', behaviour: 'REMIND' },
  REVIEW_DISPUTED: { label: 'Employee disagrees with a review', behaviour: 'LOG' },
  CRITICAL_SOP: { label: 'Critical SOP marked not compliant', behaviour: 'LOG' },
  RATING_PATTERN: { label: 'Unusual rating pattern', behaviour: 'LOG' },
  NO_EVIDENCE: { label: 'KPI rated without evidence', behaviour: 'LOG' },
  ROLE_CHANGED: { label: 'Department or designation changed', behaviour: 'LOG' },
  MANAGER_CHANGED: { label: 'Manager changed', behaviour: 'LOG' },
  SOP_VERSION_CHANGED: { label: 'SOP has a new version', behaviour: 'LOG' },
  EXTENDED_LEAVE: { label: 'Long approved leave in the review period', behaviour: 'LOG' },
  NO_SOP: { label: 'No SOP applies to a department', behaviour: 'LOG' },
  IMPORT_UNMATCHED: { label: 'Imported work could not be matched', behaviour: 'LOG' },
  FEED_FAILED: { label: 'Evidence feed could not be read', behaviour: 'LOG' },
  AI_DISCARDED: { label: 'AI answer discarded', behaviour: 'LOG' },
};
const exId = (code: string, ref: string) => `${code}__${ref}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);
/** One open entry per situation per record; raising it again while open only refreshes it. Returns true when newly opened. */
export async function raise(c: C, code: string, ref: string, o: { subjectUid?: string; text: string; notify?: string[] }): Promise<boolean> {
  const id = exId(code, ref);
  const prev = await get(c.cid, 'log', id);
  const def = EXCEPTIONS[code] || { label: code, behaviour: 'LOG' as Behaviour };
  const opening = !prev || prev.status !== 'OPEN';
  await put('log', {
    ...(prev || {}), id, companyId: c.cid, kind: 'EXCEPTION', code, label: def.label, behaviour: def.behaviour, ref,
    subjectUid: o.subjectUid || '', subjectName: nameOf(c, o.subjectUid), text: str(o.text, 800), status: 'OPEN',
    openedAt: opening ? nowIso() : prev!.openedAt, times: (prev?.times || 0) + (opening ? 1 : 0), resolvedAt: '', resolution: '',
  });
  if (opening) {
    await audit(c, ref, `EXCEPTION_${code}`, o.text, o.subjectUid || '');
    if (o.notify?.length) await tell(c, o.notify, `Performance: ${def.label}`, o.text);
  }
  return opening;
}
export async function clear(c: C, code: string, ref: string, note: string): Promise<void> {
  const id = exId(code, ref);
  const prev = await get(c.cid, 'log', id);
  if (prev && prev.status === 'OPEN') {
    await put('log', { ...prev, status: 'RESOLVED', resolvedAt: nowIso(), resolution: str(note, 400), resolvedBy: c.who });
    await audit(c, ref, `RESOLVED_${code}`, note, prev.subjectUid || '');
  }
}

// ------------------------------------------------------------------ messages and reminders

export async function tell(c: C, uids: string[], subject: string, body: string): Promise<void> {
  const emails = Array.from(new Set(uids)).map((u) => c.byUid.get(u)?.email || '').filter(Boolean);
  if (emails.length) await notify(c.cid, emails, subject, `${body}\n\nOpen the HR portal → Performance to do this.`);
}
/** True when a reminder with this key has not been sent in the last `every` days. Marks it as sent on the record (caller saves). */
export function remindNow(rec: Doc, key: string, every: number, on = today()): boolean {
  const last = rec.reminded?.[key];
  if (last && Date.parse(`${on}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`) < every * 86_400_000) return false;
  rec.reminded = { ...(rec.reminded || {}), [key]: on };
  return true;
}

// ------------------------------------------------------------------ route table shape

/** any = every signed-in company user (the action checks the person itself); hr = pm.manage; approver = HR or pm.approve; reports = grouped figures. */
export type Who = 'any' | 'hr' | 'approver' | 'reports';
export interface Route { method: 'GET' | 'POST'; who: Who; run: (c: C, b: any, q: Record<string, any>) => Promise<Result> }
export const bad = (msg: string) => fail(400, msg);
export const denied = (msg = 'You cannot do this.') => fail(403, msg);
export const notFound = (what = 'It') => fail(404, `${what} was not found.`);
