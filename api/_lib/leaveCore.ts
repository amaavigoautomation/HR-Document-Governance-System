/**
 * Leave and attendance: data access and business rules (server only, company scoped).
 *
 * Collections (all closed to browsers by firestore.rules; every record carries companyId):
 *   leaveSettings/{companyId}        one document of company-wide configuration
 *   leaveProfiles/{companyId__uid}   location, policy, manager, join date, gender per person
 *   leaveLedger/{id}                 every credit and debit; a balance is the sum of its entries
 *   leaveRequests/{id}               leave requests with their approval steps
 *   leaveAttendance/{companyId__uid__date}
 *   leaveRegularizations/{id}        missed-swipe corrections waiting for approval
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { dispatchLiveEmail } from './serverEmail.js';
import {
  addDays, approvalSteps, countLeaveDays, cycleOf, daysBetween, emptySettings, isIsoDate, istToday,
  plannedCredits, previousCycle, rollover, typeStartMonth,
  type LeaveLocation, type LeavePolicy, type LeaveSettings, type LeaveType, type Step,
} from '../../shared/leaveEngine.js';

export const db = () => adminDb();
export const nowIso = () => new Date().toISOString();
export const str = (v: unknown, max = 500) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);

export class LeaveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ settings and people

export async function loadSettings(companyId: string): Promise<{ settings: LeaveSettings; configured: boolean }> {
  const snap = await db().collection('leaveSettings').doc(companyId).get();
  if (!snap.exists) return { settings: emptySettings(), configured: false };
  const base = emptySettings();
  const data = snap.data() as Partial<LeaveSettings>;
  return { settings: { ...base, ...data, shift: { ...base.shift, ...(data.shift || {}) } } as LeaveSettings, configured: true };
}

export interface Person {
  uid: string;
  docId: string;
  name: string;
  email: string;
  empId: string;
  department: string;
  title: string;
  active: boolean;
  createdDate: string;
}

export interface Profile {
  uid: string;
  locationId?: string;
  policyId?: string;
  managerUid?: string;
  joinDate?: string;
  gender?: 'F' | 'M' | 'O' | '';
  /** Removed from the People list by an admin. Nothing is deleted; the person and their records stay. */
  hidden?: boolean;
}

export interface EffectiveProfile {
  locationId: string;
  policyId: string;
  managerUid: string;
  joinDate: string;
  gender: string;
}

export async function loadPeople(companyId: string): Promise<Person[]> {
  const snap = await db().collection('employees').where('companyId', '==', companyId).get();
  return snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      uid: String(x.authUid || d.id),
      docId: d.id,
      name: str(x.name, 120) || str(x.email, 120),
      email: str(x.email, 160).toLowerCase(),
      empId: str(x.empId || x.id, 40),
      department: str(x.departmentName, 80),
      title: str(x.title, 80),
      active: x.active !== false,
      createdDate: str(x.createdAt, 30).slice(0, 10) || istToday(),
    };
  });
}

export async function loadProfiles(companyId: string): Promise<Map<string, Profile>> {
  const snap = await db().collection('leaveProfiles').where('companyId', '==', companyId).get();
  const map = new Map<string, Profile>();
  snap.docs.forEach((d) => {
    const x = d.data() as any;
    map.set(String(x.uid), x as Profile);
  });
  return map;
}

export const profileId = (companyId: string, uid: string) => `${companyId}__${uid}`;

export function effectiveProfile(settings: LeaveSettings, person: Pick<Person, 'createdDate'>, p?: Profile): EffectiveProfile {
  const loc = settings.locations.find((l) => l.id === p?.locationId) || settings.locations[0];
  const pol = settings.policies.find((x) => x.id === p?.policyId) || settings.policies.find((x) => x.isDefault) || settings.policies[0];
  return {
    locationId: loc?.id || '',
    policyId: pol?.id || '',
    managerUid: p?.managerUid || '',
    joinDate: p?.joinDate && isIsoDate(p.joinDate) ? p.joinDate : person.createdDate,
    gender: p?.gender || '',
  };
}

export const findLocation = (s: LeaveSettings, id: string): LeaveLocation | undefined => s.locations.find((l) => l.id === id);
export const findPolicy = (s: LeaveSettings, id: string): LeavePolicy | undefined => s.policies.find((p) => p.id === id);
export const findType = (s: LeaveSettings, id: string): LeaveType | undefined => s.types.find((t) => t.id === id);

export async function personByUid(companyId: string, uid: string): Promise<Person | null> {
  const direct = await db().collection('employees').doc(uid).get();
  let d = direct.exists ? direct : null;
  if (!d) {
    const q = await db().collection('employees').where('authUid', '==', uid).where('companyId', '==', companyId).limit(1).get();
    d = q.empty ? null : q.docs[0];
  }
  if (!d) return null;
  const x = d.data() as any;
  if (x.companyId !== companyId) return null;
  return {
    uid: String(x.authUid || d.id), docId: d.id, name: str(x.name, 120) || str(x.email, 120), email: str(x.email, 160).toLowerCase(),
    empId: str(x.empId || x.id, 40), department: str(x.departmentName, 80), title: str(x.title, 80), active: x.active !== false,
    createdDate: str(x.createdAt, 30).slice(0, 10) || istToday(),
  };
}

export async function profileOf(companyId: string, uid: string): Promise<Profile | undefined> {
  const snap = await db().collection('leaveProfiles').doc(profileId(companyId, uid)).get();
  return snap.exists ? (snap.data() as Profile) : undefined;
}

// ------------------------------------------------------------------ ledger

export interface LedgerEntry {
  id: string;
  companyId: string;
  uid: string;
  typeId: string;
  cycle: string;
  delta: number;
  kind: 'OPENING' | 'ACCRUAL' | 'USED' | 'RESTORED' | 'ADJUST' | 'ENCASH' | 'LAPSE' | 'CARRY_OUT' | 'CARRY_IN';
  date: string;
  ref?: string;
  note?: string;
  by?: string;
  createdAt: string;
}

export async function companyLedger(companyId: string): Promise<LedgerEntry[]> {
  const snap = await db().collection('leaveLedger').where('companyId', '==', companyId).get();
  return snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
}

export async function userLedger(companyId: string, uid: string): Promise<LedgerEntry[]> {
  const snap = await db().collection('leaveLedger').where('companyId', '==', companyId).where('uid', '==', uid).get();
  return snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function balanceOf(entries: LedgerEntry[], typeId: string, cycleKey: string): number {
  return r2(entries.filter((e) => e.typeId === typeId && e.cycle === cycleKey).reduce((n, e) => n + e.delta, 0));
}

export function ledgerRef(id: string) {
  return db().collection('leaveLedger').doc(id);
}

export function entryData(e: Omit<LedgerEntry, 'id' | 'createdAt'>): Omit<LedgerEntry, 'id'> {
  return { ...e, delta: r2(e.delta), createdAt: nowIso() };
}

// ------------------------------------------------------------------ requests

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CANCEL_REQUESTED' | 'INFO_REQUESTED' | 'WITHDRAWN';

export interface RequestStep {
  role: Step;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  by?: string;
  byName?: string;
  at?: string;
  comment?: string;
}

export interface LeaveRequest {
  id: string;
  companyId: string;
  uid: string;
  name: string;
  email: string;
  managerUid: string;
  typeId: string;
  typeName: string;
  typeCode: string;
  requiresBalance: boolean;
  from: string;
  to: string;
  halfFrom: boolean;
  halfTo: boolean;
  /** For a single half day: which half is taken. (On a longer leave the first day is always the second half and the last day the first half.) */
  halfPart?: 'FIRST' | 'SECOND';
  days: number;
  detail: { date: string; value: number }[];
  byCycle: Record<string, number>;
  reason: string;
  docUrl: string;
  /** Id of a privately stored upload (only the employee and HR can open it). */
  privateDocId?: string;
  privateDocName?: string;
  /** Notes from the checks the approver should know about (for example: balance goes below zero). */
  warnings?: string[];
  /** Policy version in force when the request was made (history stays traceable after the policy changes). */
  policyVersion?: number;
  /** Policy version in force when the final decision was made. */
  decisionPolicyVersion?: number;
  /** Emergency leave: applied for after the fact, provisional until approved. */
  emergency?: boolean;
  status: RequestStatus;
  steps: RequestStep[];
  stepIndex: number;
  onBehalfOf?: boolean;
  escalatedOn?: string;
  remindedOn?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  events: { at: string; by: string; message: string }[];
}

/** Requests that hold balance while they wait for a decision. */
export const RESERVING: RequestStatus[] = ['PENDING', 'CANCEL_REQUESTED', 'INFO_REQUESTED'];
export const ACTIVE_STATUSES: RequestStatus[] = ['PENDING', 'CANCEL_REQUESTED', 'APPROVED', 'INFO_REQUESTED'];

export async function requestsOfUser(companyId: string, uid: string): Promise<LeaveRequest[]> {
  const snap = await db().collection('leaveRequests').where('companyId', '==', companyId).where('uid', '==', uid).get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

export async function companyRequests(companyId: string): Promise<LeaveRequest[]> {
  const snap = await db().collection('leaveRequests').where('companyId', '==', companyId).get();
  return snap.docs.map((d) => d.data() as LeaveRequest);
}

export interface ApplyInput {
  typeId: string;
  from: string;
  to: string;
  halfFrom: boolean;
  halfTo: boolean;
  halfPart: 'FIRST' | 'SECOND';
  reason: string;
  docUrl: string;
  /** A document uploaded with the request (kept private; see leaveDocs). */
  docData: string;
  docName: string;
  /** Emergency leave: no advance notice is needed; the request stays provisional until approved. */
  emergency: boolean;
}

export function parseApplyInput(body: any): ApplyInput {
  const from = str(body?.from, 10);
  const to = str(body?.to, 10) || from;
  if (!isIsoDate(from) || !isIsoDate(to)) throw new LeaveError(400, 'Choose valid dates.');
  if (to < from) throw new LeaveError(400, 'The end date is before the start date.');
  return {
    typeId: str(body?.typeId, 40),
    from, to,
    halfFrom: body?.halfFrom === true,
    halfTo: body?.halfTo === true,
    halfPart: body?.halfPart === 'FIRST' ? 'FIRST' : 'SECOND',
    reason: str(body?.reason, 600),
    docUrl: str(body?.docUrl, 500),
    docData: typeof body?.docData === 'string' ? body.docData : '',
    docName: str(body?.docName, 120),
    emergency: body?.emergency === true,
  };
}

export interface Plan {
  type: LeaveType;
  days: number;
  detail: { date: string; value: number }[];
  byCycle: Record<string, number>;
  steps: Step[];
  warnings: string[];
  balanceAfter: Record<string, number>;
}

/**
 * Works out what a request would cost and checks every rule. Throws LeaveError on a hard stop.
 * `relaxed` is used when HR records leave on someone's behalf (no notice, backdating or balance checks).
 */
export async function planRequest(opts: {
  companyId: string;
  settings: LeaveSettings;
  person: Person;
  profile: EffectiveProfile;
  input: ApplyInput;
  relaxed?: boolean;
  ignoreRequestId?: string;
}): Promise<Plan> {
  const { settings, person, profile, input, relaxed } = opts;
  const today = istToday();
  const type = findType(settings, input.typeId);
  if (!type || !type.active) throw new LeaveError(400, 'Choose a leave type.');
  const policy = findPolicy(settings, profile.policyId);
  if (!policy?.entries.some((e) => e.typeId === type.id)) throw new LeaveError(400, `${type.name} is not part of your leave policy.`);

  if (type.gender !== 'ANY' && profile.gender !== type.gender) {
    throw new LeaveError(400, `${type.name} is not available for your profile.`);
  }
  if (type.minServiceDays > 0 && daysBetween(profile.joinDate, input.from) < type.minServiceDays && !relaxed) {
    throw new LeaveError(400, `${type.name} needs at least ${type.minServiceDays} days of service.`);
  }
  if ((input.halfFrom || input.halfTo) && !type.halfDay) throw new LeaveError(400, `${type.name} cannot be taken as a half day.`);

  const loc = findLocation(settings, profile.locationId);
  const counted = countLeaveDays({
    from: input.from, to: input.to, halfFrom: input.halfFrom, halfTo: input.halfTo,
    loc, dayCounting: type.dayCounting, sandwich: settings.sandwichRule,
  });
  if (counted.days <= 0) throw new LeaveError(400, 'There are no working days in the dates you chose (weekly offs and holidays are not counted).');
  const detail = counted.breakdown.filter((d) => d.value > 0).map((d) => ({ date: d.date, value: d.value }));
  const warnings: string[] = [];

  if (!relaxed) {
    if (daysBetween(today, input.from) < -30) throw new LeaveError(400, 'Leave can be applied up to 30 days back. Ask HR to record older leave.');
    if (!input.emergency && input.from >= today && daysBetween(today, input.from) < type.minNoticeDays) {
      throw new LeaveError(400, `${type.name} needs ${type.minNoticeDays} day(s) notice.`);
    }
    if (type.maxDaysPerRequest > 0 && counted.days > type.maxDaysPerRequest) {
      throw new LeaveError(400, `${type.name} allows at most ${type.maxDaysPerRequest} days in one request.`);
    }
    if (type.docRequiredAfterDays > 0 && counted.days > type.docRequiredAfterDays && !input.docUrl && !input.docData) {
      throw new LeaveError(400, `Add a link to the supporting document (needed for ${type.name} longer than ${type.docRequiredAfterDays} day(s)).`);
    }
  }

  // Overlaps with the person's other requests
  const mine = await requestsOfUser(opts.companyId, person.uid);
  const taken = new Map<string, number>();
  for (const r of mine) {
    if (!ACTIVE_STATUSES.includes(r.status) || r.id === opts.ignoreRequestId) continue;
    for (const d of r.detail) taken.set(d.date, (taken.get(d.date) || 0) + d.value);
  }
  for (const d of detail) {
    if ((taken.get(d.date) || 0) + d.value > 1) throw new LeaveError(409, `You already have leave on ${d.date}.`);
  }

  // Balance, per leave year the dates fall in
  const sm = typeStartMonth(type, settings);
  const byCycle: Record<string, number> = {};
  for (const d of detail) {
    const k = cycleOf(d.date, sm).key;
    byCycle[k] = (byCycle[k] || 0) + d.value;
  }
  const balanceAfter: Record<string, number> = {};
  if (type.requiresBalance && !type.isLop) {
    const ledger = await userLedger(opts.companyId, person.uid);
    for (const [key, need] of Object.entries(byCycle)) {
      const reserved = mine
        .filter((r) => r.typeId === type.id && RESERVING.includes(r.status) && r.id !== opts.ignoreRequestId)
        .reduce((n, r) => n + (r.byCycle[key] || 0), 0);
      const available = balanceOf(ledger, type.id, key) - reserved;
      balanceAfter[key] = r2(available - need);
      if (available - need < 0) {
        if (!type.allowNegative && !relaxed) {
          throw new LeaveError(400, `Not enough ${type.name} balance: ${r2(available)} day(s) available, ${need} requested. You can apply for Loss of pay instead.`);
        }
        warnings.push(`Balance goes below zero for ${cycleOf(`${key}-${String(sm).padStart(2, '0')}-01`, sm).label}.`);
      }
    }
  }

  const steps = approvalSteps(type, counted.days, !!profile.managerUid && profile.managerUid !== person.uid, settings);
  return { type, days: counted.days, detail, byCycle, steps, warnings, balanceAfter };
}

/** Ledger entries that charge an approved request to the person's balance. */
export function usageEntries(req: LeaveRequest, settings: LeaveSettings, by: string) {
  if (!req.requiresBalance) return [];
  const type = findType(settings, req.typeId);
  if (!type || type.isLop) return [];
  return Object.entries(req.byCycle).map(([cycle, days]) => ({
    id: `USED_${req.id}_${cycle}`,
    data: entryData({ companyId: req.companyId, uid: req.uid, typeId: req.typeId, cycle, delta: -days, kind: 'USED', date: req.from, ref: req.id, by }),
  }));
}

export function restoreEntries(req: LeaveRequest, by: string) {
  if (!req.requiresBalance) return [];
  return Object.entries(req.byCycle).map(([cycle, days]) => ({
    id: `REST_${req.id}_${cycle}`,
    data: entryData({ companyId: req.companyId, uid: req.uid, typeId: req.typeId, cycle, delta: days, kind: 'RESTORED', date: req.from, ref: req.id, by }),
  }));
}

// ------------------------------------------------------------------ accrual

export interface AccrualResult {
  employees: number;
  credits: number;
  rollovers: number;
}

export async function runAccrual(companyId: string, asOf = istToday()): Promise<AccrualResult> {
  const { settings, configured } = await loadSettings(companyId);
  const out: AccrualResult = { employees: 0, credits: 0, rollovers: 0 };
  if (!configured) return out;
  const [people, profiles, ledger] = await Promise.all([loadPeople(companyId), loadProfiles(companyId), companyLedger(companyId)]);
  const byUser = new Map<string, LedgerEntry[]>();
  ledger.forEach((e) => byUser.set(e.uid, [...(byUser.get(e.uid) || []), e]));

  const writes: { id: string; data: any }[] = [];
  for (const person of people) {
    if (!person.active) continue;
    const prof = effectiveProfile(settings, person, profiles.get(person.uid));
    const policy = findPolicy(settings, prof.policyId);
    if (!policy) continue;
    out.employees++;
    const entries = byUser.get(person.uid) || [];
    const have = new Set(entries.map((e) => e.id));

    for (const entry of policy.entries) {
      const type = findType(settings, entry.typeId);
      if (!type || !type.active || !type.requiresBalance || type.isLop) continue;
      const sm = typeStartMonth(type, settings);
      const cycle = cycleOf(asOf, sm);
      const prev = previousCycle(cycle, sm);

      const marker = `ROLL_${person.uid}_${type.id}_${cycle.key}`;
      const prevEntries = entries.filter((e) => e.typeId === type.id && e.cycle === prev.key);
      if (prevEntries.length > 0 && !have.has(`${marker}_IN`)) {
        const bal = r2(prevEntries.reduce((n, e) => n + e.delta, 0));
        const { carry, lapse } = rollover(bal, entry);
        const base = { companyId, uid: person.uid, typeId: type.id, date: cycle.start, by: 'System' };
        if (lapse > 0) writes.push({ id: `${marker}_LAPSE`, data: entryData({ ...base, cycle: prev.key, delta: -lapse, kind: 'LAPSE', note: `Lapsed at end of ${prev.label}` }) });
        if (carry !== 0) writes.push({ id: `${marker}_OUT`, data: entryData({ ...base, cycle: prev.key, delta: -carry, kind: 'CARRY_OUT', note: `Carried to ${cycle.label}` }) });
        writes.push({ id: `${marker}_IN`, data: entryData({ ...base, cycle: cycle.key, delta: carry, kind: 'CARRY_IN', note: `Carried from ${prev.label}` }) });
        out.rollovers++;
      }

      // What the current rules say should have been credited by now, against what the ledger already holds for this year.
      // Credits are only ever topped up to that figure, so changing the schedule (Monthly <-> Upfront) never credits a year twice.
      const planned = plannedCredits(entry, cycle, prof.joinDate, asOf);
      const plannedTotal = r2(planned.reduce((n, c) => n + c.amount, 0));
      const inCycle = entries.filter((e) => e.typeId === type.id && e.cycle === cycle.key);
      const accrued = inCycle.filter((e) => e.kind === 'ACCRUAL');
      const fixId = `FIXDUP_${person.uid}_${type.id}_${cycle.key}`;
      let credited = r2(accrued.reduce((n, e) => n + e.delta, 0) + inCycle.filter((e) => e.id === fixId).reduce((n, e) => n + e.delta, 0));
      // A year that was credited both upfront and month by month (from before this check existed): take back the excess once.
      const mixed = accrued.some((e) => e.ref === 'U' && !e.note) && accrued.some((e) => /^[MQ]/.test(e.ref || ''));
      if (mixed && !have.has(fixId) && credited - plannedTotal > 0.005) {
        const over = r2(credited - plannedTotal);
        writes.push({ id: fixId, data: entryData({ companyId, uid: person.uid, typeId: type.id, cycle: cycle.key, delta: -over, kind: 'ADJUST', date: asOf, by: 'System', note: 'Correction: this year was credited twice after the credit schedule changed' }) });
        credited = plannedTotal;
      }
      const fresh = planned.filter((c) => !have.has(`ACC_${person.uid}_${type.id}_${cycle.key}_${c.period}`));
      const room = r2(plannedTotal - credited);
      if (fresh.length > 0 && room > 0.005) {
        const freshTotal = r2(fresh.reduce((n, c) => n + c.amount, 0));
        const capped = freshTotal > room + 0.005;
        const list = capped ? [{ ...fresh[0], amount: room }] : fresh;
        for (const c of list) {
          writes.push({ id: `ACC_${person.uid}_${type.id}_${cycle.key}_${c.period}`, data: entryData({ companyId, uid: person.uid, typeId: type.id, cycle: cycle.key, delta: c.amount, kind: 'ACCRUAL', date: c.date, ref: c.period, by: 'System', ...(capped ? { note: 'Topped up to the current schedule (part of this year was already credited)' } : {}) }) });
          out.credits++;
        }
      }
    }
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db().batch();
    writes.slice(i, i + 400).forEach((w) => batch.set(ledgerRef(w.id), w.data));
    await batch.commit();
  }
  return out;
}

// ------------------------------------------------------------------ email

export async function companyLabel(companyId: string): Promise<string> {
  const snap = await db().collection('companies').doc(companyId).get();
  return str(snap.data()?.name, 80) || 'Your company';
}

export async function notify(companyId: string, to: string[], subject: string, body: string): Promise<void> {
  const list = Array.from(new Set(to.map((x) => x.trim().toLowerCase()).filter((x) => /^\S+@\S+\.\S+$/.test(x))));
  if (list.length === 0) return;
  try {
    const fromName = await companyLabel(companyId);
    await Promise.all(list.map((t) => dispatchLiveEmail({ to: t, recipientName: '', subject, body, fromName }).catch(() => null)));
  } catch (err: any) {
    console.warn('[Leave] email failed:', err?.message || err);
  }
}

// ------------------------------------------------------------------ audit trail and exception register

const clean = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export interface AuditEntry {
  id: string;
  companyId: string;
  entity: string;
  entityId: string;
  action: string;
  actor: string;
  actorUid: string;
  at: string;
  oldValue: unknown;
  newValue: unknown;
}

/** One company-wide, append-only trail of who changed what (policies, balances, overrides, payroll corrections). */
export async function audit(companyId: string, entity: string, entityId: string, action: string, actor: { name: string; uid: string },
  oldValue?: unknown, newValue?: unknown): Promise<void> {
  const ref = db().collection('leaveAudit').doc();
  const entry: Omit<AuditEntry, 'id'> = { companyId, entity, entityId, action, actor: actor.name, actorUid: actor.uid, at: nowIso(), oldValue: clean(oldValue), newValue: clean(newValue) };
  await ref.set(entry);
}

export type ExceptionCategory =
  | 'NO_MANAGER' | 'NO_POLICY' | 'MANAGER_AWAY' | 'OVERDUE_APPROVAL' | 'BALANCE_NEGATIVE' | 'ATTENDANCE_MISMATCH'
  | 'PAYROLL_LOCKED_CHANGE' | 'POLICY_CHANGED' | 'RETRO_LEAVE' | 'EMERGENCY_REVIEW' | 'UNAUTHORIZED';

export interface LeaveException {
  id: string;
  companyId: string;
  category: ExceptionCategory;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  requestId: string;
  uid: string;
  assignedTo: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
}

/**
 * Records a business-rule problem for HR to work through. The id is built from the category and what it is about,
 * so the same problem raised twice (a rerun, a retry) stays one open item.
 */
export async function raiseException(companyId: string, e: { category: ExceptionCategory; severity?: LeaveException['severity']; message: string;
  requestId?: string; uid?: string; assignedTo?: string; key?: string }): Promise<void> {
  const id = `${companyId}__${e.category}__${e.key || e.requestId || e.uid || 'general'}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
  const ref = db().collection('leaveExceptions').doc(id);
  const cur = await ref.get();
  if (cur.exists && (cur.data() as LeaveException).status === 'OPEN') return;
  const doc: LeaveException = {
    id, companyId, category: e.category, severity: e.severity || 'MEDIUM', message: e.message.slice(0, 400),
    requestId: e.requestId || '', uid: e.uid || '', assignedTo: e.assignedTo || 'HR', status: 'OPEN', createdAt: nowIso(),
  };
  await ref.set(doc);
}

// ------------------------------------------------------------------ in-app notifications

export interface LeaveNotification {
  id: string;
  companyId: string;
  uid: string;
  title: string;
  body: string;
  /** Where the screen should take the person (a leave section key). */
  link: string;
  read: boolean;
  createdAt: string;
}

/**
 * Puts a message in people's in-app inbox (the email is sent separately by notify). Pass a key to make a message
 * that must only ever appear once (a low-balance alert, a reminder) idempotent.
 */
export async function inApp(companyId: string, uids: string[], title: string, body: string, link = '', key = ''): Promise<void> {
  const now = nowIso();
  await Promise.all([...new Set(uids.filter(Boolean))].map(async (uid) => {
    const id = key ? `${companyId}__${uid}__${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200) : db().collection('leaveNotifications').doc().id;
    const ref = db().collection('leaveNotifications').doc(id);
    if (key && (await ref.get()).exists) return;
    const doc: LeaveNotification = { id, companyId, uid, title: title.slice(0, 160), body: body.slice(0, 400), link, read: false, createdAt: now };
    await ref.set(doc);
  }));
}

export { addDays, FieldValue };
