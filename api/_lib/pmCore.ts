/**
 * Performance Management: shared plumbing for every /api/pm action.
 *
 * One server-only collection, pmItems, told apart by `kind`. Every record carries a companyId, so Amaavigo and
 * Puratech never see each other's frameworks, plans or reviews. The kinds follow the specification's database master
 * (section 12) one-to-one:
 *
 *   framework  Performance_Framework_Master      cycle       Performance_Cycle        plan        Employee_Performance_Plan
 *   kraMaster  KRA_Master                        kpiMaster   KPI_Master               roleTemplate Role_KRA_Template
 *   kraAssign  Employee_KRA_Assignment           kpiTarget   Employee_KPI_Target      evidence    KPI_Evidence
 *   kraAck     KRA_Acknowledgement               competency  Competency_Master        roleCompetency Role_Competency_Map
 *   compAssess Employee_Competency_Assessment    sop         Department_SOP_Master    roleSop     Role_SOP_Map
 *   sopAssign  Employee_SOP_Assignment           sopCheck    SOP_Compliance_Assessment
 *   review     Performance_Review                approval    Performance_Review_Approval
 *   devPlan    Employee_Development_Plan         audit       Performance_Audit_Log     exception   Performance_Exception_Log
 *   role       Role master (department + designation)   checkin  monthly manager check-in   setting  per-company settings
 */
import { adminDb } from './firebaseAdmin.js';
import type { AuthContext } from './authContext.js';
import { loadPeople, loadProfiles, notify, type Person } from './leaveCore.js';
import { EXCEPTION_TYPES, exceptionLabel, istToday, isDate } from '../../shared/pmEngine.js';

export interface Item { id: string; companyId: string; kind: string; createdAt?: string; updatedAt?: string; [k: string]: any }
export type Result = { status: number; json: any };

export const COLL = 'pmItems';
export const db = () => adminDb();
export const nowIso = () => new Date().toISOString();
export const today = istToday;
export const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
export const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
export const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
export const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
export const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
export const isoDate = isDate;
export const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(str(v, 60) as T) ? (str(v, 60) as T) : dflt);
export const strList = (v: unknown, max = 60, each = 200): string[] => (Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : []);

// ------------------------------------------------------------------ storage

export async function listK(cid: string, kind: string): Promise<Item[]> {
  const s = await db().collection(COLL).where('companyId', '==', cid).where('kind', '==', kind).get();
  return s.docs.map((d: any) => d.data() as Item);
}
export async function getK(cid: string, id: string, kind: string): Promise<Item | null> {
  if (!id) return null;
  const s = await db().collection(COLL).doc(id).get();
  const it = s.exists ? (s.data() as Item) : null;
  return it && it.companyId === cid && it.kind === kind ? it : null;
}
export const putK = async (it: Item) => { await db().collection(COLL).doc(it.id).set(clean({ ...it, updatedAt: nowIso(), createdAt: it.createdAt || nowIso() })); };
export const newId = () => db().collection(COLL).doc().id;
/** Records that may change only through their own workflow are stamped with who and when; this just returns a fresh copy. */
export const fresh = <T,>(v: T): T => clean(v);

// ------------------------------------------------------------------ who is asking

export interface C {
  ctx: AuthContext; cid: string; people: Person[]; byKey: Map<string, Person>; who: string; me: Person | undefined;
  /** employee uid -> that person's reporting manager uid (from the leave/people profile) */
  manager: Map<string, string>;
  /** names of the departments this person heads */
  headOf: string[];
  isHr: boolean; isApprover: boolean; canViewAggregate: boolean;
}

export const isHrCtx = (ctx: AuthContext) => ctx.isCompanyAdmin || ctx.perms.includes('pm.manage');
export const isApproverCtx = (ctx: AuthContext) => ctx.isCompanyAdmin || ctx.perms.includes('pm.approve');

export async function load(ctx: AuthContext): Promise<C> {
  const cid = ctx.companyId!;
  const [people, profiles, depts] = await Promise.all([
    loadPeople(cid),
    loadProfiles(cid),
    db().collection('departments').where('companyId', '==', cid).get(),
  ]);
  const byKey = new Map<string, Person>();
  for (const p of people) { byKey.set(p.uid, p); byKey.set(p.docId, p); }
  const me = byKey.get(ctx.uid);
  const manager = new Map<string, string>();
  for (const p of people) manager.set(p.uid, profiles.get(p.uid)?.managerUid || '');
  const headOf: string[] = [];
  for (const d of depts.docs) {
    const x = d.data() as any;
    const head = byKey.get(String(x.headUserId || ''));
    if (head && head.uid === ctx.uid) headOf.push(str(x.name, 80));
  }
  const isHr = isHrCtx(ctx);
  const isApprover = isApproverCtx(ctx);
  return { ctx, cid, people, byKey, who: me?.name || ctx.email, me, manager, headOf, isHr, isApprover, canViewAggregate: isHr || isApprover || ctx.perms.includes('pm.view') || headOf.length > 0 };
}

/** An active person of THIS company, found by either id. Another company's people are never found. */
export const person = (c: C, id: unknown): Person | null => { const p = c.byKey.get(str(id, 120)); return p && p.active ? p : null; };
export const anyPerson = (c: C, id: unknown): Person | null => c.byKey.get(str(id, 120)) || null;
export const nameOf = (c: C, uid?: string) => (uid ? c.byKey.get(uid)?.name || '' : '');
export const managerOf = (c: C, uid: string): string => { const m = c.manager.get(uid) || ''; const p = m ? c.byKey.get(m) : null; return p && p.active ? p.uid : ''; };
export const reportsOf = (c: C, mgr: string): Person[] => c.people.filter((p) => p.active && c.manager.get(p.uid) === mgr);
export const isMyReport = (c: C, uid: string) => c.manager.get(uid) === c.ctx.uid;
export const isManagerCtx = (c: C) => c.people.some((p) => p.active && c.manager.get(p.uid) === c.ctx.uid);
export const inMyDepartments = (c: C, p: Person) => c.headOf.length > 0 && c.headOf.includes(p.department);

/** Who may see one person's individual performance records: the person, their reporting manager, and HR / authorized approvers. */
export const canSeePerson = (c: C, uid: string) => c.ctx.uid === uid || isMyReport(c, uid) || c.isHr || c.isApprover;

// ------------------------------------------------------------------ audit trail and exception log (HR-PM-009, workflow PM-010)

/** One append-only trail. Nothing here is ever updated or deleted. */
export async function audit(c: C, entity: string, entityId: string, action: string, oldValue?: unknown, newValue?: unknown, subjectUid = ''): Promise<void> {
  const id = newId();
  await putK({ id, companyId: c.cid, kind: 'audit', entity, entityId, action, actor: c.who, actorUid: c.ctx.uid, subjectUid, at: nowIso(), oldValue: oldValue === undefined ? null : clean(oldValue), newValue: newValue === undefined ? null : clean(newValue) });
}

export interface RaiseOpts { ownerUid?: string; refId: string; refLabel?: string; subjectUid?: string; detail?: string; notifyUids?: string[] }
/**
 * Logs a situation the specification says must be handled on purpose. The same situation about the same record is one open
 * entry, not a pile of duplicates; if it was resolved and happens again it reopens.
 */
export async function raise(c: C, type: string, o: RaiseOpts): Promise<Item> {
  const id = `ex_${type}_${o.refId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);
  const prev = await getK(c.cid, id, 'exception');
  const row = EXCEPTION_TYPES.find((e) => e.key === type);
  const item: Item = {
    ...(prev || {}),
    id, companyId: c.cid, kind: 'exception', type, label: row?.label || exceptionLabel(type), requiredBehaviour: row?.behaviour || '',
    ownerUid: o.ownerUid || prev?.ownerUid || '', ownerName: nameOf(c, o.ownerUid || prev?.ownerUid || ''), refId: o.refId, refLabel: o.refLabel || prev?.refLabel || '',
    subjectUid: o.subjectUid || prev?.subjectUid || '', subjectName: nameOf(c, o.subjectUid || prev?.subjectUid || ''),
    detail: str(o.detail, 600) || prev?.detail || '', status: 'OPEN', occurrences: (prev?.occurrences || 0) + (prev && prev.status === 'OPEN' ? 0 : 1),
    raisedAt: prev && prev.status === 'OPEN' ? prev.raisedAt : nowIso(), resolvedAt: '', resolution: '',
  };
  if (prev?.status === 'OPEN') { await putK(item); return item; }
  await putK(item);
  await audit(c, 'exception', id, 'RAISED', null, { type, detail: item.detail }, o.subjectUid || '');
  if (o.notifyUids?.length) await tell(c, o.notifyUids, `Performance: ${item.label}`, `${item.label}${item.subjectName ? ` (${item.subjectName})` : ''}.\n\nWhat happens next: ${item.requiredBehaviour}.\n\n${item.detail}`);
  return item;
}

export async function resolveException(c: C, id: string, note: string): Promise<Item | null> {
  const it = await getK(c.cid, id, 'exception');
  if (!it) return null;
  const next = { ...it, status: 'RESOLVED', resolution: str(note, 600), resolvedAt: nowIso(), resolvedBy: c.who };
  await putK(next);
  await audit(c, 'exception', id, 'RESOLVED', { status: it.status }, { status: 'RESOLVED', note: next.resolution }, it.subjectUid || '');
  return next;
}
/** Closes an open exception when the condition is gone (for example the missing KRA/KPI has now been approved). */
export async function clearException(c: C, type: string, refId: string, note: string): Promise<void> {
  const id = `ex_${type}_${refId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140);
  const it = await getK(c.cid, id, 'exception');
  if (it && it.status === 'OPEN') await resolveException(c, id, note);
}

// ------------------------------------------------------------------ messages

export async function tell(c: C, uids: string[], subject: string, body: string): Promise<void> {
  const emails = uids.map((u) => c.byKey.get(u)?.email || '').filter(Boolean);
  await notify(c.cid, emails, subject, body);
}

// ------------------------------------------------------------------ settings

export interface PmSettings extends Item { webhookKey: string; aiAcknowledged: boolean }
export async function settingsOf(cid: string): Promise<PmSettings | null> {
  const s = await db().collection(COLL).doc(`pmset_${cid}`).get();
  const d = s.exists ? (s.data() as PmSettings) : null;
  return d && d.companyId === cid ? d : null;
}
export const saveSettings = (s: PmSettings) => putK(s);

// ------------------------------------------------------------------ small helpers used by several files

export const byCreated = (a: Item, b: Item) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
  return m;
}
export const lc = (s: string) => str(s, 200).toLowerCase();
export const sameDay = (a: string, b: string) => a === b;
export const inRange = (d: string, from: string, to: string) => d >= from && d <= to;
export const ymd = (iso: string) => str(iso, 30).slice(0, 10);

// ------------------------------------------------------------------ route table shape (each pm*.ts file exports one)

/** any = every signed-in company user (the action checks the person itself); hr = pm.manage; approver = pm.approve; aggregate = leadership views. */
export type Who = 'any' | 'hr' | 'approver' | 'aggregate';
export interface Route { method: 'GET' | 'POST'; who: Who; run: (c: C, b: any, q: Record<string, any>) => Promise<Result> }

/** A context for work done by the system itself (the task webhook, the daily job): no signed-in person, company checked by the caller. */
export async function loadSystem(cid: string, label = 'System'): Promise<C> {
  const ctx: AuthContext = { uid: 'system', email: '', companyId: cid, companyStatus: 'ACTIVE', perms: [], isCompanyAdmin: false, isPlatformAdmin: false };
  const c = await load(ctx);
  return { ...c, who: label, me: undefined, isHr: false, isApprover: false, canViewAggregate: false };
}
