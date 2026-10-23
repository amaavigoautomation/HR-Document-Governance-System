/**
 * Payroll API (one router, reached as /api/leave/payroll-<action> so it needs no extra serverless function).
 *
 * Who can do what:
 *   - everyone signed in to an active company: see their own payslips (only after a run is locked)
 *   - payroll.view: read runs, salaries, inputs and any payslip (read-only)
 *   - payroll.manage (and the company admin): set up payroll, edit salaries, calculate, approve, lock
 *
 * Collections (closed to browsers by firestore.rules; every record carries companyId):
 *   payrollSettings/{companyId}              components, statutory settings, professional tax slabs
 *   payrollStructures/{companyId__uid}       one person's salary and statutory/bank identifiers
 *   payrollAdjustments/{id}                  one-off earnings or deductions for a month
 *   payrollLoans/{id}                        advances and loans recovered in instalments
 *   payrollRuns/{companyId__YYYY-MM}         one run per month: DRAFT > APPROVED > LOCKED > PAID
 *   payrollRunLines/{companyId__month__uid}  each person's calculated line (a snapshot, immutable once locked)
 */
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { buildMonth, monthRange } from './leaveApi.js';
import {
  companyLedger, companyRequests, db, effectiveProfile, loadPeople, loadProfiles, loadSettings, nowIso, personByUid, str,
  type Person,
} from './leaveCore.js';
import { daysBetween, isIsoDate, istToday } from '../../shared/leaveEngine.js';
import {
  INDIAN_STATES, calculateLine, daysInMonth, emptyPayrollSettings, maskAccount, paidDaysFor, payDaysFor, r2, splitCtc,
  starterPayrollSettings, totalsOf,
  type Adjustment, type CtcTemplateRow, type PayComponent, type PayrollLine, type PayrollSettings, type PtSlab, type RunTotals,
  type SalaryStructure,
} from '../../shared/payrollEngine.js';

export interface PayrollRequestIn {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
}

interface Result {
  status: number;
  json: any;
}

const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

export class PayrollError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Who {
  ctx: AuthContext;
  cid: string;
  canManage: boolean;
  canView: boolean;
}

async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new PayrollError(403, 'Open this as a company user.');
  const canManage = ctx.isCompanyAdmin || hasPerm(ctx.perms, 'payroll.manage');
  return { ctx, cid: ctx.companyId, canManage, canView: canManage || hasPerm(ctx.perms, 'payroll.view') };
}

const needManage = (w: Who) => {
  if (!w.canManage) throw new PayrollError(403, 'You do not have permission to run payroll.');
};
const needView = (w: Who) => {
  if (!w.canView) throw new PayrollError(403, 'You do not have access to payroll.');
};

// ------------------------------------------------------------------ small helpers

const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const money = (v: unknown, label: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) throw new PayrollError(400, `${label} must be a number between 0 and 100,000,000.`);
  return r2(n);
};
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const needMonth = (m: unknown): string => {
  if (!isMonth(m)) throw new PayrollError(400, 'Choose a valid month.');
  return m;
};
/** Firestore rejects undefined values, so strip them before saving. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const structureId = (cid: string, uid: string) => `${cid}__${uid}`;
const runId = (cid: string, month: string) => `${cid}__${month}`;
const lineId = (cid: string, month: string, uid: string) => `${cid}__${month}__${uid}`;

async function commitChunks(ops: { ref: any; data?: any; del?: boolean }[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db().batch();
    ops.slice(i, i + 400).forEach((o) => (o.del ? batch.delete(o.ref) : batch.set(o.ref, o.data)));
    await batch.commit();
  }
}

async function actorName(who: Who): Promise<string> {
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
  };
  return { settings, configured: settings.components.length > 0 };
}

export function sanitizePayrollSettings(input: any): PayrollSettings {
  if (!input || typeof input !== 'object') throw new PayrollError(400, 'Settings are missing.');
  const usedIds = new Set<string>();
  const usedCodes = new Set<string>();
  const components: PayComponent[] = (Array.isArray(input.components) ? input.components : []).slice(0, 40).map((c: any, i: number) => {
    const kind: PayComponent['kind'] = c?.kind === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING';
    let id = slug(str(c?.id, 40)) || slug(str(c?.code, 12)) || `item-${i + 1}`;
    let n = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    let code = str(c?.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || `C${i + 1}`;
    while (usedCodes.has(code)) code = `${code}X`;
    usedCodes.add(code);
    return {
      id, code, name: str(c?.name, 60) || code, kind, active: c?.active !== false,
      prorate: kind === 'EARNING' ? c?.prorate !== false : false,
      pfWage: kind === 'EARNING' && c?.pfWage === true,
      esicWage: kind === 'EARNING' && c?.esicWage !== false,
      isBasic: kind === 'EARNING' && c?.isBasic === true ? true : undefined,
    } as PayComponent;
  });
  let basicSeen = false;
  components.forEach((c) => {
    if (c.isBasic) {
      if (basicSeen) c.isBasic = undefined;
      basicSeen = true;
    }
  });
  const ids = new Set(components.filter((c) => c.kind === 'EARNING').map((c) => c.id));

  const ctcTemplate: CtcTemplateRow[] = (Array.isArray(input.ctcTemplate) ? input.ctcTemplate : [])
    .filter((r: any) => ids.has(str(r?.componentId, 40)))
    .slice(0, 40)
    .map((r: any) => ({
      componentId: str(r.componentId, 40),
      mode: ['PERCENT_OF_CTC', 'PERCENT_OF_BASIC', 'FIXED', 'BALANCE'].includes(r.mode) ? r.mode : 'FIXED',
      value: num(r.value, 0, 100_000_000, 0),
    }));
  if (ctcTemplate.filter((r) => r.mode === 'BALANCE').length > 1) throw new PayrollError(400, 'Only one component can be the balancing component.');

  const states: Record<string, PtSlab[]> = {};
  for (const [state, slabs] of Object.entries<any>(input.pt?.states || {})) {
    if (!INDIAN_STATES.includes(state) || !Array.isArray(slabs)) continue;
    states[state] = slabs.slice(0, 20).map((s: any) => ({
      from: num(s?.from, 0, 100_000_000, 0),
      to: s?.to === null || s?.to === '' || s?.to === undefined ? null : num(s.to, 0, 100_000_000, 0),
      amount: num(s?.amount, 0, 100_000, 0),
      ...(s?.febAmount !== undefined && s?.febAmount !== null && s?.febAmount !== '' ? { febAmount: num(s.febAmount, 0, 100_000, 0) } : {}),
      gender: s?.gender === 'F' || s?.gender === 'M' ? s.gender : 'ANY',
    }));
  }
  const defaultState = INDIAN_STATES.includes(str(input.pt?.defaultState, 60)) ? str(input.pt.defaultState, 60) : '';

  return {
    daysBasis: input.daysBasis === 'FIXED_30' ? 'FIXED_30' : 'CALENDAR',
    attendanceMode: input.attendanceMode === 'ATTENDANCE' ? 'ATTENDANCE' : 'LEAVE_ONLY',
    deductLateMarks: input.deductLateMarks === true,
    encashmentBase: input.encashmentBase === 'GROSS' ? 'GROSS' : 'BASIC',
    components, ctcTemplate,
    pf: {
      enabled: input.pf?.enabled !== false,
      employeePct: num(input.pf?.employeePct, 0, 100, 12), employerPct: num(input.pf?.employerPct, 0, 100, 12),
      edliPct: num(input.pf?.edliPct, 0, 100, 0.5), adminPct: num(input.pf?.adminPct, 0, 100, 0.5),
      wageCeiling: num(input.pf?.wageCeiling, 0, 100_000_000, 15000),
    },
    esic: {
      enabled: input.esic?.enabled !== false,
      employeePct: num(input.esic?.employeePct, 0, 100, 0.75), employerPct: num(input.esic?.employerPct, 0, 100, 3.25),
      wageCeiling: num(input.esic?.wageCeiling, 0, 100_000_000, 21000),
    },
    pt: { enabled: input.pt?.enabled !== false, defaultState, states },
    company: { legalName: str(input.company?.legalName, 120), address: str(input.company?.address, 300) },
  };
}

async function getSettings(who: Who): Promise<Result> {
  needView(who);
  const { settings, configured } = await loadPayrollSettings(who.cid);
  return ok({ settings, configured, states: INDIAN_STATES, canManage: who.canManage });
}

async function saveSettings(who: Who, body: any): Promise<Result> {
  needManage(who);
  const settings = sanitizePayrollSettings(body?.settings);
  await db().collection('payrollSettings').doc(who.cid).set(clean({ ...settings, companyId: who.cid, updatedAt: nowIso() }));
  return ok({ settings });
}

async function applyStarter(who: Who): Promise<Result> {
  needManage(who);
  const prev = await loadPayrollSettings(who.cid);
  if (prev.configured) throw new PayrollError(409, 'Payroll is already set up. Edit the existing setup instead.');
  const company = await db().collection('companies').doc(who.cid).get();
  const settings = starterPayrollSettings();
  settings.company.legalName = str(company.get('name'), 120);
  await db().collection('payrollSettings').doc(who.cid).set(clean({ ...settings, companyId: who.cid, updatedAt: nowIso() }));
  return ok({ settings });
}

// ------------------------------------------------------------------ salary structures

interface StructureDoc extends SalaryStructure {
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

async function loadStructures(cid: string): Promise<Map<string, StructureDoc>> {
  const snap = await db().collection('payrollStructures').where('companyId', '==', cid).get();
  const m = new Map<string, StructureDoc>();
  snap.docs.forEach((d) => m.set(String((d.data() as any).uid), d.data() as StructureDoc));
  return m;
}

const grossOf = (st: Pick<SalaryStructure, 'amounts'>, s: PayrollSettings) =>
  r2(s.components.filter((c) => c.kind === 'EARNING' && c.active).reduce((n, c) => n + (st.amounts[c.id] || 0), 0));

function cleanAmounts(raw: any, s: PayrollSettings): Record<string, number> {
  const out: Record<string, number> = {};
  const known = new Set(s.components.map((c) => c.id));
  for (const [k, v] of Object.entries<any>(raw || {})) {
    if (!known.has(k)) continue;
    const n = money(v, `Amount for ${k}`);
    if (n !== 0) out[k] = n;
  }
  return out;
}

const yes = (v: unknown, dflt: boolean) => {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return dflt;
  return !/^(n|no|false|0|na|n\/a)$/.test(t);
};

function buildStructure(cid: string, uid: string, b: any, s: PayrollSettings, prev: StructureDoc | undefined, by: string): StructureDoc {
  const state = str(b?.state, 60);
  if (state && !INDIAN_STATES.includes(state)) throw new PayrollError(400, `Unknown state ${state}.`);
  const amounts = cleanAmounts(b?.amounts, s);
  const doc: StructureDoc = {
    companyId: cid, uid, amounts, annualCtc: b?.annualCtc !== undefined && b?.annualCtc !== '' ? money(b.annualCtc, 'Annual CTC') : prev?.annualCtc || 0,
    state: state || prev?.state || '', gender: prev?.gender || '',
    pfApplicable: b?.pfApplicable !== undefined ? b.pfApplicable === true : prev?.pfApplicable ?? true,
    esicApplicable: b?.esicApplicable !== undefined ? b.esicApplicable === true : prev?.esicApplicable ?? true,
    pfOnActualWage: b?.pfOnActualWage !== undefined ? b.pfOnActualWage === true : prev?.pfOnActualWage ?? false,
    pan: str(b?.pan ?? prev?.pan, 20).toUpperCase(), uan: str(b?.uan ?? prev?.uan, 20), esicNo: str(b?.esicNo ?? prev?.esicNo, 20),
    bankName: str(b?.bankName ?? prev?.bankName, 80), bankAccount: str(b?.bankAccount ?? prev?.bankAccount, 30).replace(/\s+/g, ''),
    ifsc: str(b?.ifsc ?? prev?.ifsc, 15).toUpperCase(),
    updatedAt: nowIso(), updatedBy: by,
    history: prev ? [{ at: prev.updatedAt, by: prev.updatedBy, amounts: prev.amounts, annualCtc: prev.annualCtc }, ...(prev.history || [])].slice(0, 20) : [],
  };
  return doc;
}

async function structures(who: Who): Promise<Result> {
  needView(who);
  const [{ settings }, people, map] = await Promise.all([loadPayrollSettings(who.cid), loadPeople(who.cid), loadStructures(who.cid)]);
  const rows = people.filter((p) => p.active).map((p) => {
    const st = map.get(p.uid);
    return {
      uid: p.uid, name: p.name, email: p.email, empId: p.empId, department: p.department, title: p.title,
      hasStructure: !!st, monthlyGross: st ? grossOf(st, settings) : 0, annualCtc: st?.annualCtc || 0, state: st?.state || '',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return ok({ rows });
}

async function structureOf(who: Who, q: any): Promise<Result> {
  needView(who);
  const uid = str(q.uid, 128);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const snap = await db().collection('payrollStructures').doc(structureId(who.cid, uid)).get();
  return ok({ person: { uid: person.uid, name: person.name, empId: person.empId }, structure: snap.exists ? snap.data() : null });
}

async function saveStructure(who: Who, body: any): Promise<Result> {
  needManage(who);
  const uid = str(body?.uid, 128);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const { settings, configured } = await loadPayrollSettings(who.cid);
  if (!configured) throw new PayrollError(409, 'Set up payroll components first.');
  const ref = db().collection('payrollStructures').doc(structureId(who.cid, uid));
  const prev = await ref.get();
  const doc = buildStructure(who.cid, uid, body, settings, prev.exists ? (prev.data() as StructureDoc) : undefined, await actorName(who));
  if (Object.keys(doc.amounts).length === 0) throw new PayrollError(400, 'Enter at least one salary component.');
  await ref.set(doc);
  return ok({});
}

async function splitCtcAction(who: Who, body: any): Promise<Result> {
  needManage(who);
  const { settings } = await loadPayrollSettings(who.cid);
  const res = splitCtc(money(body?.annualCtc, 'Annual CTC'), settings.ctcTemplate, settings.components);
  return ok(res);
}

async function importStructures(who: Who, body: any): Promise<Result> {
  needManage(who);
  const { settings, configured } = await loadPayrollSettings(who.cid);
  if (!configured) throw new PayrollError(409, 'Set up payroll components first.');
  const rows: Record<string, string>[] = Array.isArray(body?.rows) ? body.rows.slice(0, 1000) : [];
  const [people, existing, by] = await Promise.all([loadPeople(who.cid), loadStructures(who.cid), actorName(who)]);
  const errors: { row: number; error: string }[] = [];
  const ops: { ref: any; data: any }[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, i) => {
    const r: Record<string, string> = {};
    Object.entries(raw || {}).forEach(([k, v]) => (r[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v ?? '').trim()));
    const person = people.find((p) => p.email === (r.email || '').toLowerCase());
    if (!person) return errors.push({ row: i + 2, error: `No employee with email ${r.email || '(empty)'}` });
    if (seen.has(person.uid)) return errors.push({ row: i + 2, error: `${person.email} appears twice in this file` });
    seen.add(person.uid);
    try {
      const amounts: Record<string, number> = {};
      settings.components.forEach((c) => {
        const cell = r[c.code.toLowerCase()];
        if (cell !== undefined && cell !== '') amounts[c.id] = money(cell.replace(/,/g, ''), c.code);
      });
      let annualCtc = r.annualctc ? money(r.annualctc.replace(/,/g, ''), 'annual_ctc') : 0;
      let usedAmounts = amounts;
      if (Object.keys(amounts).length === 0) {
        if (!annualCtc) throw new PayrollError(400, 'Give salary component columns or annual_ctc');
        const split = splitCtc(annualCtc, settings.ctcTemplate, settings.components);
        if (split.warnings.length) throw new PayrollError(400, split.warnings[0]);
        usedAmounts = split.amounts;
      } else if (!annualCtc) {
        annualCtc = r2(grossOf({ amounts }, settings) * 12);
      }
      const prev = existing.get(person.uid);
      const doc = buildStructure(who.cid, person.uid, {
        amounts: usedAmounts, annualCtc, state: r.state, pan: r.pan || undefined, uan: r.uan || undefined, esicNo: r.esicno || undefined,
        bankName: r.bankname || undefined, bankAccount: r.bankaccount || undefined, ifsc: r.ifsc || undefined,
        pfApplicable: yes(r.pf, prev?.pfApplicable ?? true), esicApplicable: yes(r.esic, prev?.esicApplicable ?? true),
      }, settings, prev, by);
      ops.push({ ref: db().collection('payrollStructures').doc(structureId(who.cid, person.uid)), data: doc });
    } catch (e: any) {
      errors.push({ row: i + 2, error: e?.message || 'Invalid row' });
    }
  });
  await commitChunks(ops);
  return ok({ saved: ops.length, errors });
}

// ------------------------------------------------------------------ monthly inputs (phase 1)

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

async function loadInputs(cid: string, month: string, ps: PayrollSettings, overrides: Record<string, { lopDelta: number; note: string }> = {}): Promise<{ rows: InputRow[]; people: Person[]; notes: string[] }> {
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

  const rows: InputRow[] = people.filter((p) => p.active).map((p) => {
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

async function inputs(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const { settings } = await loadPayrollSettings(who.cid);
  const run = await db().collection('payrollRuns').doc(runId(who.cid, month)).get();
  const overrides = run.exists ? (run.get('overrides') || {}) : {};
  const { rows, notes } = await loadInputs(who.cid, month, settings, overrides);
  return ok({ month, attendanceMode: settings.attendanceMode, daysBasis: settings.daysBasis, notes, rows });
}

// ------------------------------------------------------------------ adjustments and loans

interface RunDoc {
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

async function runOf(cid: string, month: string): Promise<RunDoc | null> {
  const snap = await db().collection('payrollRuns').doc(runId(cid, month)).get();
  return snap.exists ? (snap.data() as RunDoc) : null;
}

async function needOpenMonth(cid: string, month: string) {
  const run = await runOf(cid, month);
  if (run && run.status !== 'DRAFT') {
    throw new PayrollError(409, run.status === 'APPROVED'
      ? `The ${month} payroll is approved. Reopen it before changing anything.`
      : `The ${month} payroll is ${run.status.toLowerCase()} and cannot change. Add this to next month instead.`);
  }
}

async function adjustments(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const snap = await db().collection('payrollAdjustments').where('companyId', '==', who.cid).where('month', '==', month).get();
  const people = await loadPeople(who.cid);
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).map((a) => ({ ...a, name: people.find((p) => p.uid === a.uid)?.name || '' }));
  return ok({ month, items: items.sort((a, b) => String(a.name).localeCompare(String(b.name))) });
}

async function saveAdjustment(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const person = await personByUid(who.cid, str(body?.uid, 128));
  if (!person) return fail(400, 'Choose an employee.');
  const label = str(body?.label, 80);
  if (!label) return fail(400, 'Give the adjustment a label, such as Bonus or Arrears.');
  const amount = money(body?.amount, 'Amount');
  if (amount <= 0) return fail(400, 'Enter an amount above zero.');
  await needOpenMonth(who.cid, month);
  const id = db().collection('payrollAdjustments').doc().id;
  await db().collection('payrollAdjustments').doc(id).set({
    companyId: who.cid, uid: person.uid, month, kind: body?.kind === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING', label, amount,
    note: str(body?.note, 300), by: await actorName(who), createdAt: nowIso(),
  });
  return ok({ id });
}

async function deleteAdjustment(who: Who, body: any): Promise<Result> {
  needManage(who);
  const ref = db().collection('payrollAdjustments').doc(str(body?.id, 128));
  const snap = await ref.get();
  if (!snap.exists || snap.get('companyId') !== who.cid) return fail(404, 'Adjustment not found.');
  await needOpenMonth(who.cid, String(snap.get('month')));
  await ref.delete();
  return ok({});
}

interface LoanDoc {
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

async function loadLoans(cid: string): Promise<(LoanDoc & { id: string })[]> {
  const snap = await db().collection('payrollLoans').where('companyId', '==', cid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as LoanDoc) }));
}

async function loans(who: Who): Promise<Result> {
  needView(who);
  const [list, people] = await Promise.all([loadLoans(who.cid), loadPeople(who.cid)]);
  return ok({ items: list.map((l) => ({ ...l, name: people.find((p) => p.uid === l.uid)?.name || '' })).sort((a, b) => a.name.localeCompare(b.name)) });
}

async function saveLoan(who: Who, body: any): Promise<Result> {
  needManage(who);
  const person = await personByUid(who.cid, str(body?.uid, 128));
  if (!person) return fail(400, 'Choose an employee.');
  const label = str(body?.label, 80) || 'Loan';
  const principal = money(body?.principal, 'Amount');
  const installment = money(body?.installment, 'Monthly instalment');
  if (principal <= 0 || installment <= 0) return fail(400, 'Enter the amount and the monthly instalment.');
  if (installment > principal) return fail(400, 'The instalment cannot be more than the amount.');
  const id = db().collection('payrollLoans').doc().id;
  const doc: LoanDoc = {
    companyId: who.cid, uid: person.uid, label, principal, installment, balance: principal, active: true, appliedMonths: [],
    note: str(body?.note, 300), by: await actorName(who), createdAt: nowIso(),
  };
  await db().collection('payrollLoans').doc(id).set(doc);
  return ok({ id });
}

async function closeLoan(who: Who, body: any): Promise<Result> {
  needManage(who);
  const ref = db().collection('payrollLoans').doc(str(body?.id, 128));
  const snap = await ref.get();
  if (!snap.exists || snap.get('companyId') !== who.cid) return fail(404, 'Loan not found.');
  await ref.update({ active: false });
  return ok({});
}

// ------------------------------------------------------------------ the run

interface LineDoc {
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
  createdAt: string;
}

async function loadLines(cid: string, month: string): Promise<LineDoc[]> {
  const snap = await db().collection('payrollRunLines').where('companyId', '==', cid).where('month', '==', month).get();
  return snap.docs.map((d) => d.data() as LineDoc).sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}

const stripBank = (l: LineDoc) => { const { bank, ...rest } = l; void bank; return rest; };

async function calculateRun(who: Who, month: string): Promise<{ run: RunDoc; lines: LineDoc[] }> {
  const existing = await runOf(who.cid, month);
  if (existing && existing.status !== 'DRAFT') throw new PayrollError(409, `The ${month} payroll is ${existing.status.toLowerCase()}. ${existing.status === 'APPROVED' ? 'Reopen it to recalculate.' : 'It can no longer change.'}`);
  const { settings: ps, configured } = await loadPayrollSettings(who.cid);
  if (!configured) throw new PayrollError(409, 'Set up payroll components first.');
  const overrides = existing?.overrides || {};
  const [{ rows, notes }, structures, adjSnap, loanList, by] = await Promise.all([
    loadInputs(who.cid, month, ps, overrides),
    loadStructures(who.cid),
    db().collection('payrollAdjustments').where('companyId', '==', who.cid).where('month', '==', month).get(),
    loadLoans(who.cid),
    actorName(who),
  ]);
  const adj = adjSnap.docs.map((d) => d.data() as any);
  const lines: LineDoc[] = [];
  const skipped: RunDoc['skipped'] = [];
  const warnings: string[] = [...notes];
  const { to } = monthRange(month);
  const now = nowIso();

  for (const r of rows) {
    const st = structures.get(r.uid);
    if (!st) {
      skipped.push({ uid: r.uid, name: r.name, reason: 'No salary structure' });
      continue;
    }
    const loanRecoveries = loanList
      .filter((l) => l.uid === r.uid && l.active && l.balance > 0 && !l.appliedMonths.includes(month))
      .map((l) => ({ id: l.id, label: l.label, amount: r2(Math.min(l.installment, l.balance)) }));
    const adjustmentsFor: Adjustment[] = adj.filter((a) => a.uid === r.uid).map((a) => ({ kind: a.kind, label: a.label, amount: a.amount }));
    const line = calculateLine({
      settings: ps,
      structure: { ...st, gender: (r.gender as any) || st.gender || '' },
      month, paidDays: r.paidDays, payDays: r.payDays, encashDays: r.encashDays, adjustments: adjustmentsFor, loanRecoveries,
    });
    r.warnings.forEach((w) => line.warnings.push(w));
    if (r.incompleteDays > 0) line.blocking = true;
    lines.push({
      companyId: who.cid, month, uid: r.uid,
      employee: {
        name: r.name, empId: r.empId, department: r.department, title: r.title, email: r.email, joinDate: r.joinDate, state: st.state || ps.pt.defaultState,
        pan: st.pan, uan: st.uan, esicNo: st.esicNo, bankName: st.bankName, bankAccountMasked: maskAccount(st.bankAccount || ''), ifsc: st.ifsc,
      },
      bank: { account: st.bankAccount || '' },
      inputs: {
        monthDays: r.monthDays, payDays: r.payDays, paidDays: r.paidDays, lopDays: r.lopDays, lop: r.lop, paidLeaveDays: r.paidLeaveDays,
        holidays: r.holidays, weeklyOffs: r.weeklyOffs, encashDays: r.encashDays, preJoinDays: r.preJoinDays,
      },
      line, createdAt: now,
    });
  }
  if (skipped.length) warnings.push(`${skipped.length} active employee(s) have no salary structure and are not in this run.`);
  if (lines.length === 0) warnings.push('No one is in this run yet. Add salary structures first.');
  if (istToday() <= to) warnings.push(`${month} has not ended yet: days still to come are counted as paid.`);

  // replace the previous draft lines
  const old = await db().collection('payrollRunLines').where('companyId', '==', who.cid).where('month', '==', month).get();
  const ops: { ref: any; data?: any; del?: boolean }[] = old.docs.map((d) => ({ ref: d.ref, del: true }));
  lines.forEach((l) => ops.push({ ref: db().collection('payrollRunLines').doc(lineId(who.cid, month, l.uid)), data: l }));
  await commitChunks(ops);

  const run: RunDoc = {
    companyId: who.cid, month, status: 'DRAFT', totals: totalsOf(lines.map((l) => l.line)), warnings, skipped, overrides,
    calculatedAt: now, calculatedBy: by,
    events: [...(existing?.events || []), { at: now, by, action: 'CALCULATED', note: `${lines.length} people, net ${totalsOf(lines.map((l) => l.line)).net}` }].slice(-100),
  };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(run);
  return { run, lines };
}

async function calculate(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const { run, lines } = await calculateRun(who, month);
  return ok({ run, lines: lines.map(stripBank) });
}

async function runs(who: Who): Promise<Result> {
  needView(who);
  const snap = await db().collection('payrollRuns').where('companyId', '==', who.cid).get();
  const items = snap.docs.map((d) => d.data() as RunDoc).sort((a, b) => b.month.localeCompare(a.month));
  return ok({ items: items.map((r) => ({ month: r.month, status: r.status, totals: r.totals, calculatedAt: r.calculatedAt })) });
}

async function runDetail(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const run = await runOf(who.cid, month);
  if (!run) return ok({ run: null, lines: [] });
  const lines = await loadLines(who.cid, month);
  return ok({ run, lines: lines.map(stripBank) });
}

async function setOverride(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run) throw new PayrollError(409, 'Calculate the run first.');
  if (run.status !== 'DRAFT') throw new PayrollError(409, 'Reopen the run before changing it.');
  const uid = str(body?.uid, 128);
  const delta = num(body?.lopDelta, -31, 31, 0);
  const note = str(body?.note, 200);
  if (delta !== 0 && !note) return fail(400, 'A note is required for a manual change to paid days.');
  const overrides = { ...run.overrides };
  if (delta === 0) delete overrides[uid];
  else overrides[uid] = { lopDelta: r2(delta), note };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(clean({ ...run, overrides }));
  const { run: next, lines } = await calculateRun(who, month);
  return ok({ run: next, lines: lines.map(stripBank) });
}

async function pushEvent(who: Who, month: string, patch: Partial<RunDoc>, action: string, note = '') {
  const run = (await runOf(who.cid, month))!;
  const by = await actorName(who);
  const next: RunDoc = { ...run, ...patch, events: [...run.events, { at: nowIso(), by, action, note }].slice(-100) };
  await db().collection('payrollRuns').doc(runId(who.cid, month)).set(clean(next));
  return { next: clean(next), by };
}

async function approve(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run) throw new PayrollError(409, 'Calculate the run first.');
  if (run.status !== 'DRAFT') throw new PayrollError(409, `This run is already ${run.status.toLowerCase()}.`);
  if (body?.expectedNet === undefined || !Number.isFinite(Number(body.expectedNet))) throw new PayrollError(400, 'Send the net pay total you reviewed.');
  // recalculate so that what is approved is exactly what is stored now
  const { run: fresh, lines } = await calculateRun(who, month);
  if (Math.abs(fresh.totals.net - Number(body.expectedNet)) > 0.5) {
    throw new PayrollError(409, `The figures changed since you last looked (net pay is now ${fresh.totals.net}). Review the run again.`);
  }
  if (lines.length === 0) throw new PayrollError(409, 'There is nobody in this run.');
  const blocked = lines.filter((l) => l.line.blocking);
  if (blocked.length) throw new PayrollError(409, `Fix these first: ${blocked.slice(0, 5).map((l) => l.employee.name).join(', ')}${blocked.length > 5 ? ` and ${blocked.length - 5} more` : ''}.`);
  if (!(body?.force === true) && istToday() <= monthRange(month).to) {
    throw new PayrollError(409, `${month} has not ended yet. Approve anyway only if you are sure the remaining days are paid.`);
  }
  const { next } = await pushEvent(who, month, { status: 'APPROVED', approvedAt: nowIso(), approvedBy: await actorName(who) }, 'APPROVED', body?.force === true ? 'before month end' : '');
  return ok({ run: next });
}

async function reopen(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run) throw new PayrollError(409, 'Nothing to reopen.');
  if (run.status !== 'APPROVED') throw new PayrollError(409, run.status === 'DRAFT' ? 'This run is already a draft.' : `A ${run.status.toLowerCase()} run cannot be reopened.`);
  const { next } = await pushEvent(who, month, { status: 'DRAFT', approvedAt: undefined, approvedBy: undefined }, 'REOPENED');
  return ok({ run: next });
}

async function lock(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run || run.status !== 'APPROVED') throw new PayrollError(409, 'Approve the run before locking it.');
  const lines = await loadLines(who.cid, month);
  // apply loan recoveries once per month
  const loanList = await loadLoans(who.cid);
  const ops: { ref: any; data: any }[] = [];
  for (const l of loanList) {
    if (l.appliedMonths.includes(month)) continue;
    const taken = lines.flatMap((x) => x.line.loans).filter((x) => x.id === l.id).reduce((n, x) => n + x.amount, 0);
    if (taken <= 0) continue;
    const balance = r2(Math.max(0, l.balance - taken));
    const { id, ...rest } = l;
    ops.push({ ref: db().collection('payrollLoans').doc(id), data: { ...rest, balance, active: balance > 0 && l.active, appliedMonths: [...l.appliedMonths, month] } });
  }
  await commitChunks(ops);
  const { next } = await pushEvent(who, month, { status: 'LOCKED', lockedAt: nowIso(), lockedBy: await actorName(who) }, 'LOCKED', 'payslips released');
  return ok({ run: next });
}

async function markPaid(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run || run.status !== 'LOCKED') throw new PayrollError(409, 'Lock the run before marking it paid.');
  const paidOn = isIsoDate(body?.paidOn) ? body.paidOn : istToday();
  const { next } = await pushEvent(who, month, { status: 'PAID', paidAt: nowIso(), paidBy: await actorName(who), paidOn, paidRef: str(body?.ref, 80) }, 'PAID', `on ${paidOn}`);
  return ok({ run: next });
}

async function deleteRun(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const run = await runOf(who.cid, month);
  if (!run) return ok({});
  if (run.status !== 'DRAFT') throw new PayrollError(409, 'Only a draft run can be deleted.');
  const old = await db().collection('payrollRunLines').where('companyId', '==', who.cid).where('month', '==', month).get();
  await commitChunks([...old.docs.map((d) => ({ ref: d.ref, del: true })), { ref: db().collection('payrollRuns').doc(runId(who.cid, month)), del: true }]);
  return ok({});
}

// ------------------------------------------------------------------ payslips and exports

async function me(who: Who): Promise<Result> {
  const { configured } = await loadPayrollSettings(who.cid);
  return ok({ configured, canManage: who.canManage, canView: who.canView });
}

async function myPayslips(who: Who): Promise<Result> {
  const [snap, runSnap] = await Promise.all([
    db().collection('payrollRunLines').where('companyId', '==', who.cid).where('uid', '==', who.ctx.uid).get(),
    db().collection('payrollRuns').where('companyId', '==', who.cid).get(),
  ]);
  const status = new Map<string, string>();
  runSnap.docs.forEach((d) => status.set(String(d.get('month')), String(d.get('status'))));
  const items = snap.docs.map((d) => d.data() as LineDoc)
    .filter((l) => ['LOCKED', 'PAID'].includes(status.get(l.month) || ''))
    .map((l) => ({ month: l.month, gross: l.line.gross, deductions: l.line.totalDeductions, net: l.line.net, status: status.get(l.month) }))
    .sort((a, b) => b.month.localeCompare(a.month));
  return ok({ items });
}

async function payslip(who: Who, q: any): Promise<Result> {
  const month = needMonth(q.month);
  const uid = str(q.uid, 128) || who.ctx.uid;
  const own = uid === who.ctx.uid;
  if (!own) needView(who);
  const [lineSnap, run, { settings }] = await Promise.all([
    db().collection('payrollRunLines').doc(lineId(who.cid, month, uid)).get(), runOf(who.cid, month), loadPayrollSettings(who.cid),
  ]);
  if (!lineSnap.exists || !run) return fail(404, 'No payslip for that month.');
  if (own && !who.canView && !['LOCKED', 'PAID'].includes(run.status)) return fail(404, 'No payslip for that month.');
  const l = lineSnap.data() as LineDoc;
  return ok({ month, status: run.status, paidOn: run.paidOn || '', company: settings.company, employee: l.employee, inputs: l.inputs, line: l.line });
}

async function exportRun(who: Who, q: any): Promise<Result> {
  needView(who);
  const month = needMonth(q.month);
  const run = await runOf(who.cid, month);
  if (!run || run.status === 'DRAFT') return fail(409, 'Approve the run before exporting.');
  const lines = await loadLines(who.cid, month);
  const kind = str(q.kind, 20);
  let header: string[];
  let rows: (string | number)[][];
  switch (kind) {
    case 'bank':
      header = ['Employee ID', 'Name', 'Bank', 'Account number', 'IFSC', 'Net pay', 'Narration'];
      rows = lines.filter((l) => l.line.net > 0).map((l) => [l.employee.empId, l.employee.name, l.employee.bankName, l.bank.account, l.employee.ifsc, l.line.net, `Salary ${month}`]);
      break;
    case 'pf':
      header = ['UAN', 'Name', 'PF wage', 'Employee PF', 'Employer PF', 'EDLI', 'Admin charge'];
      rows = lines.filter((l) => l.line.statutory.pfEmployee > 0).map((l) => [l.employee.uan, l.employee.name, l.line.statutory.pfWage, l.line.statutory.pfEmployee, l.line.statutory.pfEmployer, l.line.statutory.edli, l.line.statutory.pfAdmin]);
      break;
    case 'esic':
      header = ['ESIC number', 'Name', 'Paid days', 'ESIC wage', 'Employee ESIC', 'Employer ESIC'];
      rows = lines.filter((l) => l.line.statutory.esicEmployee > 0).map((l) => [l.employee.esicNo, l.employee.name, l.line.paidDays, l.line.statutory.esicWage, l.line.statutory.esicEmployee, l.line.statutory.esicEmployer]);
      break;
    case 'pt':
      header = ['Employee ID', 'Name', 'State', 'Gross', 'Professional tax'];
      rows = lines.filter((l) => l.line.statutory.pt > 0).map((l) => [l.employee.empId, l.employee.name, l.employee.state, l.line.gross, l.line.statutory.pt]);
      break;
    case 'register':
      header = ['Employee ID', 'Name', 'Department', 'Paid days', 'LOP days', 'Gross', 'PF', 'ESIC', 'Professional tax', 'Other deductions', 'Net pay', 'Employer cost'];
      rows = lines.map((l) => {
        const s = l.line.statutory;
        return [l.employee.empId, l.employee.name, l.employee.department, l.line.paidDays, l.inputs.lopDays, l.line.gross, s.pfEmployee, s.esicEmployee, s.pt,
          r2(l.line.totalDeductions - s.pfEmployee - s.esicEmployee - s.pt), l.line.net, l.line.employerCost];
      });
      break;
    default:
      return fail(400, 'Unknown export.');
  }
  return ok({ month, kind, header, rows, note: 'Generic CSV layouts, not the exact upload formats of the PF, ESIC or bank portals.' });
}

// ------------------------------------------------------------------ router

export async function routePayroll(r: PayrollRequestIn): Promise<Result> {
  try {
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    let who: Who;
    try {
      who = await whoIs(r.headers);
    } catch (err) {
      if (err instanceof PayrollError) return fail(err.status, err.message);
      const known = authErrorResponse(err);
      if (known) return { status: known.status, json: known.json };
      throw err;
    }
    const GET = r.method === 'GET';
    const POST = r.method === 'POST';
    switch (r.action) {
      case 'me': if (GET) return await me(who); break;
      case 'my-payslips': if (GET) return await myPayslips(who); break;
      case 'payslip': if (GET) return await payslip(who, r.query); break;
      case 'settings': if (GET) return await getSettings(who); break;
      case 'save-settings': if (POST) return await saveSettings(who, body); break;
      case 'apply-starter': if (POST) return await applyStarter(who); break;
      case 'structures': if (GET) return await structures(who); break;
      case 'structure': if (GET) return await structureOf(who, r.query); break;
      case 'save-structure': if (POST) return await saveStructure(who, body); break;
      case 'split-ctc': if (POST) return await splitCtcAction(who, body); break;
      case 'import-structures': if (POST) return await importStructures(who, body); break;
      case 'inputs': if (GET) return await inputs(who, r.query); break;
      case 'adjustments': if (GET) return await adjustments(who, r.query); break;
      case 'save-adjustment': if (POST) return await saveAdjustment(who, body); break;
      case 'delete-adjustment': if (POST) return await deleteAdjustment(who, body); break;
      case 'loans': if (GET) return await loans(who); break;
      case 'save-loan': if (POST) return await saveLoan(who, body); break;
      case 'close-loan': if (POST) return await closeLoan(who, body); break;
      case 'runs': if (GET) return await runs(who); break;
      case 'run': if (GET) return await runDetail(who, r.query); break;
      case 'calculate': if (POST) return await calculate(who, body); break;
      case 'set-override': if (POST) return await setOverride(who, body); break;
      case 'approve': if (POST) return await approve(who, body); break;
      case 'reopen': if (POST) return await reopen(who, body); break;
      case 'lock': if (POST) return await lock(who, body); break;
      case 'mark-paid': if (POST) return await markPaid(who, body); break;
      case 'delete-run': if (POST) return await deleteRun(who, body); break;
      case 'export': if (GET) return await exportRun(who, r.query); break;
      default: return fail(404, `Unknown payroll action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  } catch (err: any) {
    if (err instanceof PayrollError) return fail(err.status, err.message);
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Payroll] error:', err);
    return fail(500, err?.message || 'Payroll request failed.');
  }
}
