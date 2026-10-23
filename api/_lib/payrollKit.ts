/**
 * Shared building blocks for the payroll API files (payrollApi, payrollExtras, payrollTax):
 * request/response helpers, access checks and loaders. No handlers live here.
 */
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { buildMonth, monthRange } from './leaveApi.js';
import {
  companyLedger, companyRequests, db, effectiveProfile, loadPeople, loadProfiles, loadSettings, nowIso, personByUid, str,
  type Person,
} from './leaveCore.js';
import { daysBetween, isIsoDate } from '../../shared/leaveEngine.js';
import {
  daysInMonth, emptyPayrollSettings, paidDaysFor, payDaysFor, r2,
  type PayrollLine, type PayrollSettings, type RunTotals, type SalaryStructure,
} from '../../shared/payrollEngine.js';

void authErrorResponse;

export interface PayrollRequestIn {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
}

export interface Result {
  status: number;
  json: any;
}

export const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
export const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

export class PayrollError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Who {
  ctx: AuthContext;
  cid: string;
  canManage: boolean;
  canView: boolean;
}

export async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new PayrollError(403, 'Open this as a company user.');
  const canManage = ctx.isCompanyAdmin || hasPerm(ctx.perms, 'payroll.manage');
  return { ctx, cid: ctx.companyId, canManage, canView: canManage || hasPerm(ctx.perms, 'payroll.view') };
}

export const needManage = (w: Who) => {
  if (!w.canManage) throw new PayrollError(403, 'You do not have permission to run payroll.');
};
export const needView = (w: Who) => {
  if (!w.canView) throw new PayrollError(403, 'You do not have access to payroll.');
};

// ------------------------------------------------------------------ small helpers

export const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
export const money = (v: unknown, label: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new PayrollError(400, `${label} must be a number between 0 and 100,000,000.`);
  return r2(n);
};
export const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
export const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const needMonth = (m: unknown): string => {
  if (!isMonth(m)) throw new PayrollError(400, 'Choose a valid month.');
  return m;
};
/** Firestore rejects undefined values, so strip them before saving. */
export const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export const structureId = (cid: string, uid: string) => `${cid}__${uid}`;
export const runId = (cid: string, month: string) => `${cid}__${month}`;
export const lineId = (cid: string, month: string, uid: string) => `${cid}__${month}__${uid}`;

export async function commitChunks(ops: { ref: any; data?: any; del?: boolean }[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db().batch();
    ops.slice(i, i + 400).forEach((o) => (o.del ? batch.delete(o.ref) : batch.set(o.ref, clean(o.data))));
    await batch.commit();
  }
}

export async function actorName(who: Who): Promise<string> {
  const p = await personByUid(who.cid, who.ctx.uid);
  return p?.name || who.ctx.email || who.ctx.uid;
}

// ------------------------------------------------------------------ settings

export async function loadPayrollSettings(cid: string): Promise<{ settings: PayrollSettings; configured: boolean }> {
  const snap = await db().collection('payrollSettings').doc(cid).get();
  if (!snap.exists) return { settings: emptyPayrollSettings(), configured: false };
  const base = emptyPayrollSettings();
  const d = snap.data() as Partial<PayrollSettings>;
  const settings: PayrollSettings = {
    ...base, ...d,
    pf: { ...base.pf, ...(d.pf || {}) }, esic: { ...base.esic, ...(d.esic || {}) },
    pt: { ...base.pt, ...(d.pt || {}), states: { ...(d.pt?.states || {}) } },
    company: { ...base.company, ...(d.company || {}) },
    gratuity: { ...base.gratuity, ...(d.gratuity || {}) },
    claims: { ...base.claims, ...(d.claims || {}) },
    tax: {
      ...base.tax, ...(d.tax || {}),
      new: { ...base.tax.new, ...(d.tax?.new || {}) }, old: { ...base.tax.old, ...(d.tax?.old || {}) },
      limits: { ...base.tax.limits, ...(d.tax?.limits || {}) },
    },
  };
  return { settings, configured: settings.components.length > 0 };
}

export interface StructureDoc extends SalaryStructure {
  companyId: string;
  uid: string;
  annualCtc: number;
  pan: string;
  uan: string;
  esicNo: string;
  bankName: string;
  bankAccount: string;
  ifsc: string;
  updatedAt: string;
  updatedBy: string;
  history: { at: string; by: string; amounts: Record<string, number>; annualCtc: number }[];
}

export async function loadStructures(cid: string): Promise<Map<string, StructureDoc>> {
  const snap = await db().collection('payrollStructures').where('companyId', '==', cid).get();
  const m = new Map<string, StructureDoc>();
  snap.docs.forEach((d) => m.set(String((d.data() as any).uid), d.data() as StructureDoc));
  return m;
}

export const grossOf = (st: Pick<SalaryStructure, 'amounts'>, s: PayrollSettings) =>
  r2(s.components.filter((c) => c.kind === 'EARNING' && c.active).reduce((n, c) => n + (st.amounts[c.id] || 0), 0));

export interface InputRow {
  uid: string;
  name: string;
  email: string;
  empId: string;
  department: string;
  title: string;
  hasStructure: boolean;
  monthDays: number;
  payDays: number;
  paidDays: number;
  lopDays: number;
  lop: { absent: number; halfDay: number; unpaidLeave: number; late: number; manual: number };
  paidLeaveDays: number;
  holidays: number;
  weeklyOffs: number;
  incompleteDays: number;
  preJoinDays: number;
  encashDays: number;
  joinDate: string;
  gender: string;
  warnings: string[];
}

export async function loadInputs(cid: string, month: string, ps: PayrollSettings, overrides: Record<string, { lopDelta: number; note: string }> = {}, includeUids: string[] = []): Promise<{ rows: InputRow[]; people: Person[]; notes: string[] }> {
  const { from, to } = monthRange(month);
  const monthDays = daysInMonth(month);
  const payDays = payDaysFor(ps, month);
  const [{ settings: ls, configured }, people, profiles, requests, ledger, attSnap, structures] = await Promise.all([
    loadSettings(cid), loadPeople(cid), loadProfiles(cid), companyRequests(cid), companyLedger(cid),
    db().collection('leaveAttendance').where('companyId', '==', cid).where('month', '==', month).get(),
    loadStructures(cid),
  ]);
  const leaveReady = configured && ls.locations.length > 0;
  const notes: string[] = [];
  if (!leaveReady) notes.push('Leave & attendance is not set up, so every day is treated as paid and no loss of pay is applied.');
  if (ps.attendanceMode === 'ATTENDANCE' && !leaveReady) notes.push('Attendance mode needs leave & attendance to be set up.');

  const recs = new Map<string, Map<string, any>>();
  attSnap.docs.forEach((d) => {
    const x = d.data() as any;
    if (!recs.has(x.uid)) recs.set(x.uid, new Map());
    recs.get(x.uid)!.set(x.date, x);
  });
  const unpaidTypes = new Set(ls.types.filter((t) => t.paid === false || t.isLop).map((t) => t.id));

  const extra = new Set(includeUids);
  const rows: InputRow[] = people.filter((p) => p.active || extra.has(p.uid)).map((p) => {
    const prof = effectiveProfile(ls, p, profiles.get(p.uid));
    const explicitJoin = profiles.get(p.uid)?.joinDate;
    const join = explicitJoin && isIsoDate(explicitJoin) ? explicitJoin : '';
    const warnings: string[] = [];
    const mine = requests.filter((r) => r.uid === p.uid);

    let unpaidLeave = 0;
    mine.filter((r) => (r.status === 'APPROVED' || r.status === 'CANCEL_REQUESTED') && unpaidTypes.has(r.typeId)).forEach((r) =>
      r.detail.forEach((d) => { if (d.date >= from && d.date <= to) unpaidLeave += d.value; }));

    let absent = 0, halfDay = 0, late = 0, incomplete = 0, paidLeave = 0, holidays = 0, weeklyOffs = 0;
    if (leaveReady) {
      const m = buildMonth(ls, prof.locationId, prof.joinDate, month, recs.get(p.uid) || new Map(), mine);
      incomplete = m.summary.incomplete;
      paidLeave = Math.max(0, r2(m.summary.leave - unpaidLeave));
      holidays = m.summary.holidays;
      weeklyOffs = m.summary.weeklyOffs;
      if (ps.attendanceMode === 'ATTENDANCE') {
        absent = m.summary.absent;
        halfDay = r2(m.summary.halfDay * 0.5);
        if (ps.deductLateMarks) late = m.summary.lateDeductionDays;
      }
    }
    if (incomplete > 0) warnings.push(`${incomplete} day(s) have a check-in but no check-out. Fix them in Attendance before running payroll.`);

    let preJoin = 0;
    if (!join) warnings.push('No joining date is set, so this person is paid for the full month.');
    else if (join > to) preJoin = payDays;
    else if (join > from) preJoin = Math.min(payDays, daysBetween(from, join));

    const manual = overrides[p.uid]?.lopDelta || 0;
    const lopDays = r2(absent + halfDay + unpaidLeave + late + manual);
    const encash = r2(-ledger.filter((e) => e.uid === p.uid && e.kind === 'ENCASH' && e.date >= from && e.date <= to).reduce((n, e) => n + e.delta, 0));
    return {
      uid: p.uid, name: p.name, email: p.email, empId: p.empId, department: p.department, title: p.title,
      hasStructure: structures.has(p.uid), monthDays, payDays, paidDays: paidDaysFor(payDays, lopDays, preJoin), lopDays,
      lop: { absent, halfDay, unpaidLeave: r2(unpaidLeave), late, manual }, paidLeaveDays: paidLeave, holidays, weeklyOffs,
      incompleteDays: incomplete, preJoinDays: preJoin, encashDays: Math.max(0, encash), joinDate: join, gender: prof.gender || '', warnings,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { rows, people, notes };
}

export interface RunDoc {
  companyId: string;
  month: string;
  status: 'DRAFT' | 'APPROVED' | 'LOCKED' | 'PAID';
  totals: RunTotals;
  warnings: string[];
  skipped: { uid: string; name: string; reason: string }[];
  overrides: Record<string, { lopDelta: number; note: string }>;
  calculatedAt: string;
  calculatedBy: string;
  approvedAt?: string;
  approvedBy?: string;
  lockedAt?: string;
  lockedBy?: string;
  paidAt?: string;
  paidBy?: string;
  paidOn?: string;
  paidRef?: string;
  events: { at: string; by: string; action: string; note: string }[];
}

export async function runOf(cid: string, month: string): Promise<RunDoc | null> {
  const snap = await db().collection('payrollRuns').doc(runId(cid, month)).get();
  return snap.exists ? (snap.data() as RunDoc) : null;
}

export async function needOpenMonth(cid: string, month: string) {
  const run = await runOf(cid, month);
  if (run && run.status !== 'DRAFT') {
    throw new PayrollError(409, run.status === 'APPROVED'
      ? `The ${month} payroll is approved. Reopen it before changing anything.`
      : `The ${month} payroll is ${run.status.toLowerCase()} and cannot change. Add this to next month instead.`);
  }
}

export interface LoanDoc {
  companyId: string;
  uid: string;
  label: string;
  principal: number;
  installment: number;
  balance: number;
  active: boolean;
  appliedMonths: string[];
  note: string;
  by: string;
  createdAt: string;
}

export async function loadLoans(cid: string): Promise<(LoanDoc & { id: string })[]> {
  const snap = await db().collection('payrollLoans').where('companyId', '==', cid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as LoanDoc) }));
}

export interface LineDoc {
  companyId: string;
  month: string;
  uid: string;
  employee: {
    name: string; empId: string; department: string; title: string; email: string; joinDate: string; state: string;
    pan: string; uan: string; esicNo: string; bankName: string; bankAccountMasked: string; ifsc: string;
  };
  bank: { account: string };
  inputs: Pick<InputRow, 'monthDays' | 'payDays' | 'paidDays' | 'lopDays' | 'lop' | 'paidLeaveDays' | 'holidays' | 'weeklyOffs' | 'encashDays' | 'preJoinDays'>;
  line: PayrollLine;
  /** How the income tax for this month was worked out (AUTO tax mode only). */
  tax?: { regime: string; annualTax: number; taxDeductedSoFar: number; monthsLeft: number; taxableIncome: number };
  createdAt: string;
}

export async function loadLines(cid: string, month: string): Promise<LineDoc[]> {
  const snap = await db().collection('payrollRunLines').where('companyId', '==', cid).where('month', '==', month).get();
  return snap.docs.map((d) => d.data() as LineDoc).sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}

export const stripBank = (l: LineDoc) => { const { bank, ...rest } = l; void bank; return rest; };
