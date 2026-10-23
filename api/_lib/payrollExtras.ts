/**
 * Payroll extras, reached through the same router as the rest of payroll (/api/leave/payroll-<action>):
 *   - salary revisions with arrears
 *   - reimbursements (expense claims)
 *   - full and final settlements
 *
 * Collections (closed to browsers by firestore.rules; every record carries companyId):
 *   payrollRevisions/{id}                 an effective-dated salary change: SCHEDULED > APPLIED (or CANCELLED)
 *   payrollClaims/{id}                    an expense claim: SUBMITTED > APPROVED > PAID (or REJECTED)
 *   payrollClaimFiles/{claimId}           the bill, kept apart from the claim so lists stay small
 *   payrollSettlements/{companyId__uid}   one full and final settlement per person: DRAFT > APPROVED > PAID
 */
import {
  addDays, cycleOf, daysBetween, isIsoDate, istToday, typeStartMonth,
} from '../../shared/leaveEngine.js';
import {
  calculateLine, daysInMonth, lineFacts, paidDaysFor, r2, splitCtc,
  type Adjustment, type PayrollLine, type PayrollSettings, type SalaryStructure,
} from '../../shared/payrollEngine.js';
import {
  arrearsFor, gratuityFor, noticeFor, settlementTotals, type GratuityResult, type NoticeResult, type PaidMonth, type SettlementTotals,
} from '../../shared/settlementEngine.js';
import { fyStartYear } from '../../shared/taxEngine.js';
import {
  balanceOf, db, effectiveProfile, entryData, findType, ledgerRef, loadPeople, loadProfiles, loadSettings, nowIso, personByUid,
  profileOf, str, userLedger, type Person,
} from './leaveCore.js';
import {
  PayrollError, actorName, clean, commitChunks, fail, grossOf, lineId, loadInputs, loadLines, loadLoans, loadPayrollSettings, loadStructures,
  money, needManage, needMonth, needOpenMonth, needView, ok, runOf, structureId, type Result, type Who,
} from './payrollKit.js';
import { declarationFor, loadDeclaration, monthlyTds, paidLinesInFy, sumPaid } from './payrollTax.js';

const isDate = (v: unknown): v is string => typeof v === 'string' && isIsoDate(v);

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

// ================================================================== salary revisions

interface RevisionDoc {
  companyId: string;
  uid: string;
  effectiveFrom: string;
  amounts: Record<string, number>;
  annualCtc: number;
  note: string;
  status: 'SCHEDULED' | 'APPLIED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
  appliedAt?: string;
  appliedBy?: string;
  appliedMonth?: string;
  previousAmounts?: Record<string, number>;
  arrears?: { month: string; amount: number }[];
  arrearsTotal?: number;
}

const revisionOwner = (r: { id: string } & RevisionDoc) => r.uid;

async function loadRevisions(cid: string): Promise<(RevisionDoc & { id: string })[]> {
  const snap = await db().collection('payrollRevisions').where('companyId', '==', cid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as RevisionDoc) }));
}

export async function dueRevisionCount(cid: string, month: string): Promise<number> {
  const all = await loadRevisions(cid);
  return all.filter((r) => r.status === 'SCHEDULED' && r.effectiveFrom.slice(0, 7) <= month).length;
}

async function revisionsList(who: Who, q: any): Promise<Result> {
  needView(who);
  const uid = str(q?.uid, 128);
  const [all, people, structures, { settings }] = await Promise.all([loadRevisions(who.cid), loadPeople(who.cid), loadStructures(who.cid), loadPayrollSettings(who.cid)]);
  const items = all.filter((r) => !uid || r.uid === uid).map((r) => ({
    ...r, name: people.find((p) => p.uid === r.uid)?.name || '', empId: people.find((p) => p.uid === r.uid)?.empId || '',
    currentGross: structures.get(r.uid) ? grossOf(structures.get(r.uid)!, settings) : 0,
    newGross: grossOf({ amounts: r.amounts }, settings),
  })).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.name.localeCompare(b.name));
  return ok({ items });
}

async function saveRevision(who: Who, body: any): Promise<Result> {
  needManage(who);
  const { settings, configured } = await loadPayrollSettings(who.cid);
  if (!configured) throw new PayrollError(409, 'Set up payroll components first.');
  const uid = str(body?.uid, 128);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const structure = (await loadStructures(who.cid)).get(uid);
  if (!structure) throw new PayrollError(409, `${person.name} has no salary yet. Set the salary first; revisions change an existing salary.`);
  const effectiveFrom = str(body?.effectiveFrom, 10);
  if (!isDate(effectiveFrom) || effectiveFrom.slice(8, 10) !== '01') throw new PayrollError(400, 'A revision must take effect from the first day of a month.');
  let amounts = cleanAmounts(body?.amounts, settings);
  let annualCtc = body?.annualCtc !== undefined && body.annualCtc !== '' ? money(body.annualCtc, 'Annual CTC') : 0;
  if (Object.keys(amounts).length === 0) {
    if (!annualCtc) throw new PayrollError(400, 'Give the new amounts, or an annual CTC to split with the template.');
    const split = splitCtc(annualCtc, settings.ctcTemplate, settings.components);
    if (split.warnings.length) throw new PayrollError(400, split.warnings[0]);
    amounts = split.amounts;
  } else if (!annualCtc) {
    annualCtc = r2(grossOf({ amounts }, settings) * 12);
  }
  if (grossOf({ amounts }, settings) <= 0) throw new PayrollError(400, 'The new salary has no earnings.');

  const id = str(body?.id, 128);
  if (id) {
    const snap = await db().collection('payrollRevisions').doc(id).get();
    if (!snap.exists || snap.get('companyId') !== who.cid) return fail(404, 'Revision not found.');
    if (snap.get('status') !== 'SCHEDULED') throw new PayrollError(409, 'Only a scheduled revision can be edited.');
  }
  const ref = db().collection('payrollRevisions').doc(id || db().collection('payrollRevisions').doc().id);
  const doc: RevisionDoc = {
    companyId: who.cid, uid, effectiveFrom, amounts, annualCtc, note: str(body?.note, 300), status: 'SCHEDULED',
    createdBy: await actorName(who), createdAt: nowIso(),
  };
  await ref.set(doc);
  return ok({ id: ref.id });
}

async function cancelRevision(who: Who, body: any): Promise<Result> {
  needManage(who);
  const ref = db().collection('payrollRevisions').doc(str(body?.id, 128));
  const snap = await ref.get();
  if (!snap.exists || snap.get('companyId') !== who.cid) return fail(404, 'Revision not found.');
  if (snap.get('status') !== 'SCHEDULED') throw new PayrollError(409, 'Only a scheduled revision can be cancelled.');
  await ref.update({ status: 'CANCELLED' });
  return ok({});
}

/**
 * Makes every revision that is due by `month` live: the salary changes now, and the difference for months that
 * were already locked or paid becomes one arrears adjustment in `month`. With dryRun it only reports.
 */
async function applyRevisions(who: Who, body: any): Promise<Result> {
  needManage(who);
  const month = needMonth(body?.month);
  const dryRun = body?.dryRun === true;
  await needOpenMonth(who.cid, month);
  const [{ settings }, all, structures, people, by] = await Promise.all([
    loadPayrollSettings(who.cid), loadRevisions(who.cid), loadStructures(who.cid), loadPeople(who.cid), actorName(who),
  ]);
  const due = all.filter((r) => r.status === 'SCHEDULED' && r.effectiveFrom.slice(0, 7) <= month)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt));
  if (due.length === 0) return ok({ month, items: [], applied: false });

  const earliest = due[0].effectiveFrom.slice(0, 7);
  const paidByMonth = new Map<string, Map<string, PayrollLine>>();
  const runSnap = await db().collection('payrollRuns').where('companyId', '==', who.cid).get();
  for (const d of runSnap.docs) {
    const m = String(d.get('month'));
    if (m >= earliest && m < month && ['DRAFT', 'APPROVED'].includes(String(d.get('status')))) {
      throw new PayrollError(409, `The ${m} payroll is still ${String(d.get('status')).toLowerCase()}. Lock or delete it first so the arrears for that month are worked out correctly.`);
    }
    if (m < earliest || m >= month || !['LOCKED', 'PAID'].includes(String(d.get('status')))) continue;
    const map = new Map<string, PayrollLine>();
    (await loadLines(who.cid, m)).forEach((l) => map.set(l.uid, l.line));
    paidByMonth.set(m, map);
  }

  const items: any[] = [];
  const ops: { ref: any; data: any }[] = [];
  const uids = [...new Set(due.map(revisionOwner))];
  for (const uid of uids) {
    const mine = due.filter((r) => r.uid === uid);
    const st = structures.get(uid);
    const name = people.find((p) => p.uid === uid)?.name || uid;
    if (!st) {
      items.push({ uid, name, revisionIds: mine.map((r) => r.id), skipped: 'No salary on file.', arrearsTotal: 0, months: [] });
      continue;
    }
    const attributed = new Map<string, { month: string; amount: number }[]>();
    const monthsOut: { month: string; amount: number }[] = [];
    for (const [m, lines] of [...paidByMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const line = lines.get(uid);
      if (!line) continue;
      const rev = [...mine].reverse().find((r) => r.effectiveFrom.slice(0, 7) <= m);
      if (!rev) continue;
      const paid: PaidMonth = {
        month: m, payDays: line.payDays, paidDays: line.paidDays,
        oldEarnings: Object.fromEntries(line.earnings.map((e) => [e.id, e.full])),
      };
      const res = arrearsFor(rev.amounts, settings.components, [paid]);
      if (res.months.length) {
        monthsOut.push(res.months[0]);
        attributed.set(rev.id, [...(attributed.get(rev.id) || []), res.months[0]]);
      }
    }
    const total = r2(monthsOut.reduce((n, x) => n + x.amount, 0));
    const last = mine[mine.length - 1];
    items.push({
      uid, name, revisionIds: mine.map((r) => r.id), effectiveFrom: mine[0].effectiveFrom, oldGross: grossOf(st, settings), newGross: grossOf({ amounts: last.amounts }, settings),
      arrearsTotal: total, months: monthsOut,
    });
    if (dryRun) continue;

    const now = nowIso();
    ops.push({
      ref: db().collection('payrollStructures').doc(structureId(who.cid, uid)),
      data: {
        ...st, amounts: last.amounts, annualCtc: last.annualCtc || st.annualCtc, updatedAt: now, updatedBy: by,
        history: [{ at: st.updatedAt, by: st.updatedBy, amounts: st.amounts, annualCtc: st.annualCtc }, ...(st.history || [])].slice(0, 20),
      },
    });
    for (const r of mine) {
      const rows = attributed.get(r.id) || [];
      ops.push({
        ref: db().collection('payrollRevisions').doc(r.id),
        data: clean({
          ...(({ id, ...rest }) => { void id; return rest; })(r), status: 'APPLIED', appliedAt: now, appliedBy: by, appliedMonth: month,
          previousAmounts: st.amounts, arrears: rows, arrearsTotal: r2(rows.reduce((n, x) => n + x.amount, 0)),
        }),
      });
    }
    if (total !== 0) {
      const first = monthsOut[0].month;
      const lastM = monthsOut[monthsOut.length - 1].month;
      ops.push({
        ref: db().collection('payrollAdjustments').doc(),
        data: {
          companyId: who.cid, uid, month, kind: total > 0 ? 'EARNING' : 'DEDUCTION', label: `Arrears (salary revision ${first}${first === lastM ? '' : ` to ${lastM}`})`,
          amount: Math.abs(total), note: 'Worked out automatically. PF, ESIC and professional tax are not recalculated on arrears.', by, createdAt: now, source: 'REVISION',
        },
      });
    }
  }
  if (!dryRun) await commitChunks(ops);
  return ok({ month, items, applied: !dryRun });
}

// ================================================================== reimbursements

interface ClaimDoc {
  companyId: string;
  uid: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
  approvedAmount: number;
  decisionNote: string;
  decidedBy: string;
  decidedAt: string;
  paidMonth: string;
  hasBill: boolean;
  billName: string;
  createdAt: string;
}

const BILL_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BILL_CHARS = 700_000; // base64 text; about 500 KB of file, which keeps the document under the 1 MB limit

export async function loadApprovedClaims(cid: string): Promise<(ClaimDoc & { id: string })[]> {
  const snap = await db().collection('payrollClaims').where('companyId', '==', cid).where('status', '==', 'APPROVED').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClaimDoc) }));
}

async function reportsOf(cid: string, uid: string): Promise<Set<string>> {
  const profiles = await loadProfiles(cid);
  return new Set([...profiles.values()].filter((p) => p.managerUid === uid).map((p) => p.uid));
}

/** True when this person manages someone (so they get the claims approval list). */
export async function isLineManager(cid: string, uid: string): Promise<boolean> {
  return (await reportsOf(cid, uid)).size > 0;
}

const claimView = (c: ClaimDoc & { id: string }, name = '') => ({ ...c, name });

async function myClaims(who: Who): Promise<Result> {
  const snap = await db().collection('payrollClaims').where('companyId', '==', who.cid).where('uid', '==', who.ctx.uid).get();
  const { settings } = await loadPayrollSettings(who.cid);
  const items = snap.docs.map((d) => claimView({ id: d.id, ...(d.data() as ClaimDoc) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok({ items, categories: settings.claims.categories, billRequiredAbove: settings.claims.billRequiredAbove });
}

async function submitClaim(who: Who, body: any): Promise<Result> {
  const { settings } = await loadPayrollSettings(who.cid);
  const category = str(body?.category, 60);
  if (!settings.claims.categories.includes(category)) return fail(400, 'Choose a claim category.');
  const amount = money(body?.amount, 'Amount');
  if (amount <= 0) return fail(400, 'Enter the amount you spent.');
  if (amount > 1_000_000) return fail(400, 'Claims above 10,00,000 need to be raised with HR directly.');
  const expenseDate = str(body?.expenseDate, 10);
  if (!isDate(expenseDate)) return fail(400, 'Enter the date of the expense.');
  if (expenseDate > istToday()) return fail(400, 'The expense date cannot be in the future.');
  if (expenseDate < addDays(istToday(), -366)) return fail(400, 'Claims older than a year cannot be raised.');
  const description = str(body?.description, 300);
  if (!description) return fail(400, 'Say what the expense was for.');
  const bill = body?.bill;
  if (!bill && amount > settings.claims.billRequiredAbove) return fail(400, `Attach the bill for claims above ${settings.claims.billRequiredAbove}.`);
  if (bill) {
    if (!BILL_TYPES.includes(String(bill.type))) return fail(400, 'The bill must be a JPG, PNG, WebP or PDF file.');
    if (typeof bill.data !== 'string' || bill.data.length === 0) return fail(400, 'The bill file is empty.');
    if (bill.data.length > MAX_BILL_CHARS) return fail(400, 'The bill is too large. Use a photo under 500 KB or a smaller PDF.');
  }
  const ref = db().collection('payrollClaims').doc();
  const doc: ClaimDoc = {
    companyId: who.cid, uid: who.ctx.uid, category, description, amount, expenseDate, status: 'SUBMITTED', approvedAmount: 0, decisionNote: '',
    decidedBy: '', decidedAt: '', paidMonth: '', hasBill: !!bill, billName: bill ? str(bill.name, 100) : '', createdAt: nowIso(),
  };
  await ref.set(doc);
  if (bill) await db().collection('payrollClaimFiles').doc(ref.id).set({ companyId: who.cid, uid: who.ctx.uid, name: doc.billName, type: bill.type, data: bill.data });
  return ok({ id: ref.id });
}

async function withdrawClaim(who: Who, body: any): Promise<Result> {
  const ref = db().collection('payrollClaims').doc(str(body?.id, 128));
  const snap = await ref.get();
  if (!snap.exists || snap.get('companyId') !== who.cid || snap.get('uid') !== who.ctx.uid) return fail(404, 'Claim not found.');
  if (snap.get('status') !== 'SUBMITTED') throw new PayrollError(409, 'Only a claim that is still waiting can be withdrawn.');
  await ref.delete();
  if (snap.get('hasBill')) await db().collection('payrollClaimFiles').doc(ref.id).delete();
  return ok({});
}

async function claimsList(who: Who, q: any): Promise<Result> {
  const reports = await reportsOf(who.cid, who.ctx.uid);
  if (!who.canView && reports.size === 0) throw new PayrollError(403, 'You do not have access to claims.');
  const status = str(q?.status, 20);
  const snap = await db().collection('payrollClaims').where('companyId', '==', who.cid).get();
  const people = await loadPeople(who.cid);
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClaimDoc) }))
    .filter((c) => (who.canView ? true : reports.has(c.uid)) && (!status || c.status === status))
    .map((c) => claimView(c, people.find((p) => p.uid === c.uid)?.name || ''))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok({ items, scope: who.canView ? 'ALL' : 'REPORTS' });
}

async function decideClaim(who: Who, body: any): Promise<Result> {
  const ref = db().collection('payrollClaims').doc(str(body?.id, 128));
  const snap = await ref.get();
  if (!snap.exists || snap.get('companyId') !== who.cid) return fail(404, 'Claim not found.');
  const c = snap.data() as ClaimDoc;
  if (c.uid === who.ctx.uid) throw new PayrollError(403, 'Someone else has to decide on your own claim.');
  const reports = await reportsOf(who.cid, who.ctx.uid);
  if (!who.canManage && !reports.has(c.uid)) throw new PayrollError(403, 'You can only decide on claims from your own team.');
  if (c.status !== 'SUBMITTED') throw new PayrollError(409, `This claim is already ${c.status.toLowerCase()}.`);
  const note = str(body?.note, 300);
  const by = await actorName(who);
  if (body?.decision === 'REJECT') {
    if (!note) return fail(400, 'Say why the claim is rejected.');
    await ref.update({ status: 'REJECTED', decisionNote: note, decidedBy: by, decidedAt: nowIso() });
    return ok({});
  }
  const approved = body?.approvedAmount !== undefined && body.approvedAmount !== '' ? money(body.approvedAmount, 'Approved amount') : c.amount;
  if (approved <= 0 || approved > c.amount) return fail(400, 'The approved amount must be above zero and no more than the claim.');
  if (approved < c.amount && !note) return fail(400, 'Say why only part of the claim is approved.');
  await ref.update({ status: 'APPROVED', approvedAmount: approved, decisionNote: note, decidedBy: by, decidedAt: nowIso() });
  return ok({});
}

async function claimBill(who: Who, q: any): Promise<Result> {
  const id = str(q?.id, 128);
  const claim = await db().collection('payrollClaims').doc(id).get();
  if (!claim.exists || claim.get('companyId') !== who.cid) return fail(404, 'Claim not found.');
  const owner = claim.get('uid') === who.ctx.uid;
  if (!owner && !who.canView && !(await reportsOf(who.cid, who.ctx.uid)).has(String(claim.get('uid')))) throw new PayrollError(403, 'You cannot open this bill.');
  const file = await db().collection('payrollClaimFiles').doc(id).get();
  if (!file.exists) return fail(404, 'No bill was attached.');
  return ok({ name: file.get('name'), type: file.get('type'), data: file.get('data') });
}

// ================================================================== full and final settlement

type SettlementReason = 'RESIGNATION' | 'TERMINATION' | 'RETIREMENT' | 'DEATH' | 'OTHER';
const REASONS: SettlementReason[] = ['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'DEATH', 'OTHER'];

interface SettlementInput {
  reason: SettlementReason;
  lastWorkingDay: string;
  resignationDate: string;
  noticeRequiredDays: number | null;
  noticeServedDays: number | null;
  recoverNotice: boolean;
  encashDays: number | null;
  encashTypeId: string;
  forceGratuity: boolean;
  extras: Adjustment[];
}

interface SettlementCalc {
  line: PayrollLine;
  gratuity: GratuityResult;
  notice: NoticeResult;
  overpaid: { amount: number; months: { month: string; amount: number }[] };
  totals: SettlementTotals;
  inputs: { payDays: number; paidDays: number; lopDays: number; postExitDays: number; salaryAlreadyPaid: boolean; encashLedgerExtra: number };
  tax: { regime: string; annualTax: number; taxDeductedSoFar: number } | null;
  warnings: string[];
  joinDate: string;
}

export interface SettlementDoc {
  companyId: string;
  uid: string;
  status: 'DRAFT' | 'APPROVED' | 'PAID';
  employee: { name: string; empId: string; department: string; title: string; pan: string; bankName: string; bankAccountMasked: string; ifsc: string };
  input: SettlementInput;
  calc: SettlementCalc;
  events: { at: string; by: string; action: string; note: string }[];
  createdAt: string;
  paidOn?: string;
  paidRef?: string;
}

const settlementId = (cid: string, uid: string) => `${cid}__${uid}`;

export async function settledMap(cid: string): Promise<Map<string, string>> {
  const snap = await db().collection('payrollSettlements').where('companyId', '==', cid).get();
  const m = new Map<string, string>();
  snap.docs.forEach((d) => { const x = d.data() as SettlementDoc; m.set(x.uid, x.input.lastWorkingDay.slice(0, 7)); });
  return m;
}

function parseSettlementInput(raw: any, settings: PayrollSettings): SettlementInput {
  const lastWorkingDay = str(raw?.lastWorkingDay, 10);
  if (!isDate(lastWorkingDay)) throw new PayrollError(400, 'Enter the last working day.');
  const resignationDate = str(raw?.resignationDate, 10);
  if (resignationDate && !isDate(resignationDate)) throw new PayrollError(400, 'The resignation date is not a valid date.');
  const optNum = (v: unknown, label: string, max: number) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new PayrollError(400, `${label} must be between 0 and ${max}.`);
    return r2(n);
  };
  const extras: Adjustment[] = (Array.isArray(raw?.extras) ? raw.extras : []).slice(0, 20).map((e: any) => {
    const label = str(e?.label, 80);
    const amount = money(e?.amount, 'Extra amount');
    if (!label || amount <= 0) throw new PayrollError(400, 'Each extra item needs a label and an amount above zero.');
    return { kind: e?.kind === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING', label, amount } as Adjustment;
  });
  void settings;
  return {
    reason: REASONS.includes(raw?.reason) ? raw.reason : 'RESIGNATION', lastWorkingDay, resignationDate,
    noticeRequiredDays: optNum(raw?.noticeRequiredDays, 'Notice period', 365), noticeServedDays: optNum(raw?.noticeServedDays, 'Notice served', 365),
    recoverNotice: raw?.recoverNotice === true, encashDays: optNum(raw?.encashDays, 'Leave days to pay out', 400),
    encashTypeId: str(raw?.encashTypeId, 40), forceGratuity: raw?.forceGratuity === true, extras,
  };
}

async function computeSettlement(cid: string, person: Person, structure: SalaryStructure & { pan?: string }, input: SettlementInput, settings: PayrollSettings): Promise<SettlementCalc> {
  const warnings: string[] = [];
  const uid = person.uid;
  const lwd = input.lastWorkingDay;
  const lwdMonth = lwd.slice(0, 7);
  const profile = await profileOf(cid, uid);
  const joinDate = profile?.joinDate && isDate(profile.joinDate) ? profile.joinDate : '';
  if (joinDate && lwd < joinDate) throw new PayrollError(400, 'The last working day is before the joining date.');
  if (!joinDate) warnings.push('No joining date is recorded, so gratuity cannot be worked out. Set it in Leave & attendance.');
  if (lwd > addDays(istToday(), 120)) throw new PayrollError(400, 'The last working day is too far in the future.');

  const { rows } = await loadInputs(cid, lwdMonth, settings, {}, [uid]);
  const row = rows.find((r) => r.uid === uid);
  if (!row) throw new PayrollError(404, 'Could not find this person in the payroll inputs.');

  const run = await runOf(cid, lwdMonth);
  const lineSnap = run ? await db().collection('payrollRunLines').doc(lineId(cid, lwdMonth, uid)).get() : null;
  const inRun = !!(lineSnap && lineSnap.exists);
  if (run && run.status === 'APPROVED' && inRun) throw new PayrollError(409, `The ${lwdMonth} payroll is approved and includes this person. Reopen it first so it can leave them out.`);
  const alreadyPaid = !!(run && ['LOCKED', 'PAID'].includes(run.status) && inRun);
  if (alreadyPaid) warnings.push(`The ${lwdMonth} payroll was already locked with this person's salary, so the final month's salary is not paid again here.`);
  if (run && run.status === 'DRAFT' && inRun) warnings.push(`The ${lwdMonth} draft payroll includes this person. They will be left out of it the next time it is calculated.`);

  const d = parseInt(lwd.slice(8, 10), 10);
  const postExit = row.payDays === 30 ? Math.max(0, 30 - Math.min(30, d)) : Math.max(0, row.monthDays - d);
  const lop = r2(row.lopDays + postExit);
  const paidDays = alreadyPaid ? 0 : paidDaysFor(row.payDays, lop, row.preJoinDays);
  const encash = input.encashDays ?? (alreadyPaid ? 0 : row.encashDays);
  const encashLedgerExtra = Math.max(0, r2(encash - (alreadyPaid ? 0 : row.encashDays)));

  const loanList = (await loadLoans(cid)).filter((l) => l.uid === uid && l.active && l.balance > 0);
  const loanRecoveries = loanList.map((l) => ({ id: l.id, label: l.label, amount: r2(l.balance) }));
  const claims = (await loadApprovedClaims(cid)).filter((c) => c.uid === uid);
  const reimbursements = claims.map((c) => ({ id: c.id, label: `${c.category}: ${c.description}`.slice(0, 80), amount: c.approvedAmount }));

  // salary paid for months after the last working day has to be taken back
  const runSnap = await db().collection('payrollRuns').where('companyId', '==', cid).get();
  const overMonths: { month: string; amount: number }[] = [];
  for (const rd of runSnap.docs) {
    const m = String(rd.get('month'));
    if (m <= lwdMonth || !['LOCKED', 'PAID'].includes(String(rd.get('status')))) continue;
    const ls = await db().collection('payrollRunLines').doc(lineId(cid, m, uid)).get();
    if (!ls.exists) continue;
    const l = (ls.data() as any).line as PayrollLine;
    const amt = r2(l.net - (l.reimbursementTotal || 0));
    if (amt > 0) overMonths.push({ month: m, amount: amt });
  }
  overMonths.sort((a, b) => a.month.localeCompare(b.month));
  const overpaid = { amount: r2(overMonths.reduce((n, x) => n + x.amount, 0)), months: overMonths };
  if (overpaid.amount > 0) warnings.push(`Salary of ${overpaid.amount} was paid for months after the last working day and is recovered here.`);

  const base = {
    settings, structure: { ...structure, gender: ((row.gender as SalaryStructure['gender']) || structure.gender || '') as SalaryStructure['gender'] }, month: lwdMonth,
    paidDays, payDays: row.payDays, encashDays: encash, adjustments: input.extras, loanRecoveries, reimbursements,
  };
  let line = calculateLine(base);
  let tax: SettlementCalc['tax'] = null;
  if (settings.tax.mode === 'AUTO') {
    const fy = fyStartYear(lwdMonth);
    const [paidMap, declDoc] = await Promise.all([paidLinesInFy(cid, fy, lwdMonth), loadDeclaration(cid, uid, fy)]);
    const decl = declarationFor(settings, declDoc);
    const zero = { gross: 0, basic: 0, hra: 0, epf: 0, pt: 0 };
    const r = monthlyTds({ settings, decl, month: lwdMonth, paid: sumPaid(paidMap.get(uid), settings.components), current: line, fullMonth: zero, monthsAfter: 0 });
    line = calculateLine({ ...base, tds: r.tds });
    tax = { regime: r.regime, annualTax: r.annualTax, taxDeductedSoFar: r.taxDeductedSoFar };
  }
  // the settlement works out its own net (it may be negative), so the monthly shortfall warning does not apply
  line.warnings = line.warnings.filter((w) => !w.startsWith('Deductions exceed pay'));
  line.blocking = false;

  const wageIds = settings.components.filter((c) => c.kind === 'EARNING' && c.active && (c.pfWage || c.isBasic)).map((c) => c.id);
  const lastWage = r2(wageIds.reduce((n, id) => n + (structure.amounts[id] || 0), 0));
  const gratuity = gratuityFor({ settings: settings.gratuity, joinDate, lastDay: lwd, lastWage, forceEligible: input.forceGratuity || input.reason === 'DEATH' });

  const noNotice = input.reason === 'DEATH' || input.reason === 'RETIREMENT';
  const required = noNotice ? 0 : input.noticeRequiredDays ?? settings.defaultNoticeDays;
  const served = input.noticeServedDays ?? (input.resignationDate ? Math.max(0, daysBetween(input.resignationDate, lwd)) : required);
  const notice = noticeFor({ requiredDays: required, servedDays: served, monthlyGross: grossOf(structure, settings), recover: input.recoverNotice });
  if (notice.shortfallDays > 0 && !input.recoverNotice) warnings.push(`Notice is short by ${notice.shortfallDays} day(s) and no recovery is being taken.`);

  const totals = settlementTotals(line, gratuity.amount, notice.recovery, overpaid.amount);
  if (totals.recoverable > 0) warnings.push(`The employee owes ${totals.recoverable} after this settlement. It is shown as recoverable, not paid out.`);
  if (loanRecoveries.length) warnings.push('Outstanding loans are recovered in full from this settlement.');
  return {
    line, gratuity, notice, overpaid, totals, tax, warnings, joinDate,
    inputs: { payDays: row.payDays, paidDays, lopDays: lop, postExitDays: postExit, salaryAlreadyPaid: alreadyPaid, encashLedgerExtra },
  };
}

async function loadSettlement(cid: string, uid: string): Promise<SettlementDoc | null> {
  const snap = await db().collection('payrollSettlements').doc(settlementId(cid, uid)).get();
  return snap.exists ? (snap.data() as SettlementDoc) : null;
}

function employeeBlock(person: Person, st: SalaryStructure & { pan?: string; bankName?: string; bankAccount?: string; ifsc?: string }): SettlementDoc['employee'] {
  const acct = st.bankAccount || '';
  return {
    name: person.name, empId: person.empId, department: person.department, title: person.title, pan: st.pan || '', bankName: st.bankName || '',
    bankAccountMasked: acct.length <= 4 ? acct : `${'X'.repeat(acct.length - 4)}${acct.slice(-4)}`, ifsc: st.ifsc || '',
  };
}

async function settlementsList(who: Who): Promise<Result> {
  needView(who);
  const snap = await db().collection('payrollSettlements').where('companyId', '==', who.cid).get();
  const items = snap.docs.map((d) => d.data() as SettlementDoc).map((s) => ({
    uid: s.uid, name: s.employee.name, empId: s.employee.empId, status: s.status, reason: s.input.reason, lastWorkingDay: s.input.lastWorkingDay,
    net: s.calc.totals.net, payable: s.calc.totals.payable, recoverable: s.calc.totals.recoverable, paidOn: s.paidOn || '',
  })).sort((a, b) => b.lastWorkingDay.localeCompare(a.lastWorkingDay));
  return ok({ items });
}

async function leaveBalances(cid: string, uid: string, lwd: string) {
  const { settings: ls, configured } = await loadSettings(cid);
  if (!configured) return [];
  const ledger = await userLedger(cid, uid);
  return ls.types.filter((t) => t.active && !t.isLop && t.paid)
    .map((t) => ({ typeId: t.id, name: t.name, balance: balanceOf(ledger, t.id, cycleOf(lwd, typeStartMonth(t, ls)).key) }))
    .filter((b) => b.balance > 0);
}

async function settlementOf(who: Who, q: any): Promise<Result> {
  const uid = str(q?.uid, 128) || who.ctx.uid;
  const own = uid === who.ctx.uid;
  if (!own) needView(who);
  const doc = await loadSettlement(who.cid, uid);
  if (own && !who.canView && (!doc || doc.status !== 'PAID')) return ok({ settlement: null, defaults: null });
  const { settings } = await loadPayrollSettings(who.cid);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const profile = await profileOf(who.cid, uid);
  const lwd = doc?.input.lastWorkingDay || istToday();
  const balances = who.canView ? await leaveBalances(who.cid, uid, lwd) : [];
  // an accepted exit in People carries the dates and the no-dues recoveries into the settlement
  let exitHint: any = null;
  if (who.canView) {
    const es = await db().collection('lifecycleExits').doc(`${who.cid}__${uid}`).get();
    const ex: any = es.exists ? es.data() : null;
    if (ex && ex.companyId === who.cid && ['APPROVED', 'COMPLETED'].includes(ex.status)) {
      exitHint = {
        lastWorkingDay: ex.lastWorkingDay, resignationDate: ex.resignationDate, reason: ({ END_OF_CONTRACT: 'OTHER', ABSCONDING: 'TERMINATION' } as Record<string, string>)[ex.reason] || ex.reason, noticeRequiredDays: ex.noticeRequiredDays, noticeServedDays: ex.noticeServedDays,
        extras: (ex.clearance || []).filter((c: any) => c.status === 'DUES' && c.dues > 0).map((c: any) => ({ kind: 'DEDUCTION', label: `No-dues: ${String(c.label).slice(0, 60)}`, amount: c.dues })),
      };
    }
  }
  return ok({
    settlement: doc, company: settings.company,
    exitHint, defaults: { name: person.name, joinDate: profile?.joinDate || '', noticeDays: settings.defaultNoticeDays, leaveBalances: balances, hasStructure: (await loadStructures(who.cid)).has(uid) },
  });
}

async function saveSettlement(who: Who, body: any): Promise<Result> {
  needManage(who);
  const { settings, configured } = await loadPayrollSettings(who.cid);
  if (!configured) throw new PayrollError(409, 'Set up payroll components first.');
  const uid = str(body?.uid, 128);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const structure = (await loadStructures(who.cid)).get(uid);
  if (!structure) throw new PayrollError(409, `${person.name} has no salary on file, so a settlement cannot be worked out.`);
  const prev = await loadSettlement(who.cid, uid);
  if (prev && prev.status !== 'DRAFT') throw new PayrollError(409, prev.status === 'PAID' ? 'This settlement has been paid and cannot change.' : 'Reopen the settlement before changing it.');
  const input = parseSettlementInput(body, settings);
  const calc = await computeSettlement(who.cid, person, structure, input, settings);
  const by = await actorName(who);
  const now = nowIso();
  const doc: SettlementDoc = {
    companyId: who.cid, uid, status: 'DRAFT', employee: employeeBlock(person, structure), input, calc,
    events: [...(prev?.events || []), { at: now, by, action: prev ? 'RECALCULATED' : 'CREATED', note: `net ${calc.totals.net}` }].slice(-50),
    createdAt: prev?.createdAt || now,
  };
  await db().collection('payrollSettlements').doc(settlementId(who.cid, uid)).set(clean(doc));
  return ok({ settlement: doc });
}

async function changeStatus(who: Who, uid: string, from: SettlementDoc['status'][], patch: Partial<SettlementDoc>, action: string, note = ''): Promise<SettlementDoc> {
  const doc = await loadSettlement(who.cid, uid);
  if (!doc) throw new PayrollError(404, 'No settlement for this person.');
  if (!from.includes(doc.status)) throw new PayrollError(409, `This settlement is ${doc.status.toLowerCase()}.`);
  const next: SettlementDoc = { ...doc, ...patch, events: [...doc.events, { at: nowIso(), by: await actorName(who), action, note }].slice(-50) };
  await db().collection('payrollSettlements').doc(settlementId(who.cid, uid)).set(clean(next));
  return next;
}

async function approveSettlement(who: Who, body: any): Promise<Result> {
  needManage(who);
  const uid = str(body?.uid, 128);
  const doc = await loadSettlement(who.cid, uid);
  if (!doc) throw new PayrollError(404, 'No settlement for this person.');
  if (doc.status !== 'DRAFT') throw new PayrollError(409, `This settlement is already ${doc.status.toLowerCase()}.`);
  if (body?.expectedNet === undefined || !Number.isFinite(Number(body.expectedNet))) throw new PayrollError(400, 'Send the net amount you reviewed.');
  const { settings } = await loadPayrollSettings(who.cid);
  const person = await personByUid(who.cid, uid);
  const structure = (await loadStructures(who.cid)).get(uid);
  if (!person || !structure) throw new PayrollError(409, 'The salary or employee record is missing.');
  const calc = await computeSettlement(who.cid, person, structure, doc.input, settings);
  if (Math.abs(calc.totals.net - Number(body.expectedNet)) > 0.5) {
    await db().collection('payrollSettlements').doc(settlementId(who.cid, uid)).set(clean({ ...doc, calc }));
    throw new PayrollError(409, `The figures changed since you last looked (net is now ${calc.totals.net}). Review the settlement again.`);
  }
  const next = await changeStatus(who, uid, ['DRAFT'], { status: 'APPROVED', calc }, 'APPROVED');
  return ok({ settlement: next });
}

async function reopenSettlement(who: Who, body: any): Promise<Result> {
  needManage(who);
  return ok({ settlement: await changeStatus(who, str(body?.uid, 128), ['APPROVED'], { status: 'DRAFT' }, 'REOPENED') });
}

async function deleteSettlement(who: Who, body: any): Promise<Result> {
  needManage(who);
  const uid = str(body?.uid, 128);
  const doc = await loadSettlement(who.cid, uid);
  if (!doc) return ok({});
  if (doc.status === 'PAID') throw new PayrollError(409, 'A paid settlement cannot be deleted.');
  await db().collection('payrollSettlements').doc(settlementId(who.cid, uid)).delete();
  return ok({});
}

async function paySettlement(who: Who, body: any): Promise<Result> {
  needManage(who);
  const uid = str(body?.uid, 128);
  const doc = await loadSettlement(who.cid, uid);
  if (!doc || doc.status !== 'APPROVED') throw new PayrollError(409, 'Approve the settlement before marking it paid.');
  const by = await actorName(who);
  const ops: { ref: any; data: any }[] = [];
  // loans are recovered in full
  const loanList = await loadLoans(who.cid);
  for (const rec of doc.calc.line.loans) {
    const l = loanList.find((x) => x.id === rec.id);
    if (!l) continue;
    const { id, ...rest } = l;
    const balance = r2(Math.max(0, l.balance - rec.amount));
    ops.push({ ref: db().collection('payrollLoans').doc(id), data: { ...rest, balance, active: balance > 0 && l.active, appliedMonths: [...l.appliedMonths, 'FNF'] } });
  }
  // approved claims in this settlement are now paid
  for (const r of doc.calc.line.reimbursements || []) {
    const cs = await db().collection('payrollClaims').doc(r.id).get();
    if (cs.exists) ops.push({ ref: cs.ref, data: { ...(cs.data() as any), status: 'PAID', paidMonth: 'FNF' } });
  }
  // leave paid out in cash comes off the leave balance
  const extra = doc.calc.inputs.encashLedgerExtra;
  if (extra > 0 && doc.input.encashTypeId) {
    const { settings: ls, configured } = await loadSettings(who.cid);
    const type = configured ? findType(ls, doc.input.encashTypeId) : undefined;
    if (type) {
      ops.push({
        ref: ledgerRef(db().collection('leaveLedger').doc().id),
        data: entryData({
          companyId: who.cid, uid, typeId: type.id, cycle: cycleOf(doc.input.lastWorkingDay, typeStartMonth(type, ls)).key, delta: -extra, kind: 'ENCASH',
          date: doc.input.lastWorkingDay, note: 'Full and final settlement', by,
        }),
      });
    }
  }
  await commitChunks(ops);
  const paidOn = isDate(body?.paidOn) ? body.paidOn : istToday();
  const next = await changeStatus(who, uid, ['APPROVED'], { status: 'PAID', paidOn, paidRef: str(body?.ref, 80) }, 'PAID', `on ${paidOn}`);
  return ok({ settlement: next });
}

// ================================================================== router

export async function routeExtras(action: string, method: string, who: Who, body: any, q: Record<string, any>): Promise<Result | null> {
  const GET = method === 'GET';
  const POST = method === 'POST';
  const wrong = fail(405, 'Method not allowed.');
  switch (action) {
    case 'revisions': return GET ? revisionsList(who, q) : wrong;
    case 'save-revision': return POST ? saveRevision(who, body) : wrong;
    case 'cancel-revision': return POST ? cancelRevision(who, body) : wrong;
    case 'apply-revisions': return POST ? applyRevisions(who, body) : wrong;
    case 'my-claims': return GET ? myClaims(who) : wrong;
    case 'submit-claim': return POST ? submitClaim(who, body) : wrong;
    case 'withdraw-claim': return POST ? withdrawClaim(who, body) : wrong;
    case 'claims': return GET ? claimsList(who, q) : wrong;
    case 'decide-claim': return POST ? decideClaim(who, body) : wrong;
    case 'claim-bill': return GET ? claimBill(who, q) : wrong;
    case 'settlements': return GET ? settlementsList(who) : wrong;
    case 'settlement': return GET ? settlementOf(who, q) : wrong;
    case 'save-settlement': return POST ? saveSettlement(who, body) : wrong;
    case 'approve-settlement': return POST ? approveSettlement(who, body) : wrong;
    case 'reopen-settlement': return POST ? reopenSettlement(who, body) : wrong;
    case 'pay-settlement': return POST ? paySettlement(who, body) : wrong;
    case 'delete-settlement': return POST ? deleteSettlement(who, body) : wrong;
    default: return null;
  }
}

void daysInMonth;
void lineFacts;
void effectiveProfile;
