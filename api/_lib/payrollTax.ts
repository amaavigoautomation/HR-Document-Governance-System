/**
 * Income tax (TDS) on salary: declarations, the monthly projection used by payroll runs, an employee's tax
 * estimate and the annual tax statement (the figures behind Form 130, the Income-tax Act 2025 replacement for Form 16).
 *
 * Collection: payrollDeclarations/{companyId__uid__fyStartYear}  one declaration per person per financial year
 */
import { istToday } from '../../shared/leaveEngine.js';
import { db, loadPeople, nowIso, personByUid, str } from './leaveCore.js';
import {
  calculateLine, lineFacts, r2, type PayComponent, type PayrollLine, type PayrollSettings, type SalaryStructure,
} from '../../shared/payrollEngine.js';
import {
  computeAnnualTax, emptyDeclaration, fyLabel, fyMonths, fyStartYear, monthsAfterInFy, projectTds, sanitizeDeclaration,
  type MonthFacts, type Regime, type TaxDeclaration, type TdsResult,
} from '../../shared/taxEngine.js';
import {
  PayrollError, actorName, fail, loadLines, loadPayrollSettings, loadStructures, needManage, needView, ok, runOf,
  type Result, type Who,
} from './payrollKit.js';

export const declId = (cid: string, uid: string, fy: number) => `${cid}__${uid}__${fy}`;

export interface DeclarationDoc extends TaxDeclaration {
  companyId: string;
  uid: string;
  fy: number;
  status: 'SUBMITTED' | 'VERIFIED';
  updatedAt: string;
  updatedBy: string;
  note: string;
}

export async function loadDeclaration(cid: string, uid: string, fy: number): Promise<DeclarationDoc | null> {
  const snap = await db().collection('payrollDeclarations').doc(declId(cid, uid, fy)).get();
  return snap.exists ? (snap.data() as DeclarationDoc) : null;
}

export async function loadDeclarations(cid: string, fy: number): Promise<Map<string, DeclarationDoc>> {
  const snap = await db().collection('payrollDeclarations').where('companyId', '==', cid).where('fy', '==', fy).get();
  const m = new Map<string, DeclarationDoc>();
  snap.docs.forEach((d) => m.set(String((d.data() as any).uid), d.data() as DeclarationDoc));
  return m;
}

export type Paid = MonthFacts & { tds: number };
const zeroPaid = (): Paid => ({ gross: 0, basic: 0, hra: 0, epf: 0, pt: 0, tds: 0 });

export interface PaidMonthLine {
  month: string;
  line: PayrollLine;
}

/** Every person's locked or paid lines in a financial year, optionally only the months before `beforeMonth`. */
export async function paidLinesInFy(cid: string, fy: number, beforeMonth = '9999-99'): Promise<Map<string, PaidMonthLine[]>> {
  const months = fyMonths(fy).filter((m) => m < beforeMonth);
  const byUid = new Map<string, PaidMonthLine[]>();
  await Promise.all(months.map(async (m) => {
    const run = await runOf(cid, m);
    if (!run || !['LOCKED', 'PAID'].includes(run.status)) return;
    (await loadLines(cid, m)).forEach((l) => {
      const list = byUid.get(l.uid) || [];
      list.push({ month: m, line: l.line });
      byUid.set(l.uid, list);
    });
  }));
  return byUid;
}

export function sumPaid(lines: PaidMonthLine[] | undefined, components: PayComponent[]): Paid {
  const t = zeroPaid();
  for (const x of lines || []) {
    const f = lineFacts(x.line, components);
    t.gross += f.gross; t.basic += f.basic; t.hra += f.hra; t.epf += f.epf; t.pt += f.pt; t.tds += f.tds;
  }
  (Object.keys(t) as (keyof Paid)[]).forEach((k) => { t[k] = r2(t[k]); });
  return t;
}

/** A normal full month at the person's current salary: the basis for projecting the months still to come. */
export function fullMonthFacts(settings: PayrollSettings, structure: SalaryStructure, month: string, payDays: number): MonthFacts {
  const l = calculateLine({ settings, structure, month, paidDays: payDays, payDays, encashDays: 0, adjustments: [], loanRecoveries: [], tds: 0 });
  const f = lineFacts(l, settings.components);
  return { gross: f.gross, basic: f.basic, hra: f.hra, epf: f.epf, pt: f.pt };
}

export function declarationFor(settings: PayrollSettings, d: DeclarationDoc | null | undefined): TaxDeclaration {
  return d ? sanitizeDeclaration(d, settings.tax.defaultRegime) : emptyDeclaration(settings.tax.defaultRegime);
}

/** The TDS to deduct this month. `current` is this month's line (computed without TDS). */
export function monthlyTds(opts: {
  settings: PayrollSettings;
  decl: TaxDeclaration;
  month: string;
  paid: Paid;
  current: PayrollLine;
  fullMonth: MonthFacts;
  monthsAfter?: number;
}): TdsResult {
  const f = lineFacts(opts.current, opts.settings.components);
  return projectTds({
    settings: opts.settings.tax, decl: opts.decl, month: opts.month, paid: opts.paid,
    current: { gross: f.gross, basic: f.basic, hra: f.hra, epf: f.epf, pt: f.pt }, fullMonth: opts.fullMonth, monthsAfter: opts.monthsAfter,
  });
}

// ------------------------------------------------------------------ handlers

const needFy = (q: any, fallbackMonth = istToday().slice(0, 7)): number => {
  const raw = str(q?.fy, 8);
  const y = /^\d{4}/.test(raw) ? parseInt(raw.slice(0, 4), 10) : fyStartYear(fallbackMonth);
  if (y < 2000 || y > 2100) throw new PayrollError(400, 'Choose a valid financial year.');
  return y;
};

/** Self always; someone else's needs payroll view access. */
async function targetUid(who: Who, q: any): Promise<string> {
  const uid = str(q?.uid, 128) || who.ctx.uid;
  if (uid !== who.ctx.uid) needView(who);
  return uid;
}

export async function getDeclaration(who: Who, q: any): Promise<Result> {
  const uid = await targetUid(who, q);
  const fy = needFy(q);
  const { settings } = await loadPayrollSettings(who.cid);
  const doc = await loadDeclaration(who.cid, uid, fy);
  const person = await personByUid(who.cid, uid);
  return ok({
    fy, fyLabel: fyLabel(fy), name: person?.name || '', declaration: declarationFor(settings, doc), status: doc?.status || 'NONE',
    updatedAt: doc?.updatedAt || '', note: doc?.note || '', mode: settings.tax.mode, limits: settings.tax.limits, canEdit: who.canManage || doc?.status !== 'VERIFIED',
  });
}

export async function saveDeclaration(who: Who, body: any): Promise<Result> {
  const uid = str(body?.uid, 128) || who.ctx.uid;
  if (uid !== who.ctx.uid) needManage(who);
  const person = await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const fy = needFy(body);
  const { settings } = await loadPayrollSettings(who.cid);
  const prev = await loadDeclaration(who.cid, uid, fy);
  if (prev?.status === 'VERIFIED' && !who.canManage) return fail(409, 'This declaration has been verified by HR. Ask HR to change it.');
  const decl = sanitizeDeclaration(body?.declaration, settings.tax.defaultRegime);
  const doc: DeclarationDoc = {
    ...decl, companyId: who.cid, uid, fy, status: who.canManage && body?.verify === true ? 'VERIFIED' : 'SUBMITTED',
    updatedAt: nowIso(), updatedBy: await actorName(who), note: who.canManage ? str(body?.note, 300) : prev?.note || '',
  };
  await db().collection('payrollDeclarations').doc(declId(who.cid, uid, fy)).set(doc);
  return ok({ status: doc.status });
}

export async function verifyDeclaration(who: Who, body: any): Promise<Result> {
  needManage(who);
  const uid = str(body?.uid, 128);
  const fy = needFy(body);
  const doc = await loadDeclaration(who.cid, uid, fy);
  if (!doc) return fail(404, 'No declaration to verify.');
  await db().collection('payrollDeclarations').doc(declId(who.cid, uid, fy)).set({
    ...doc, status: body?.verified === false ? 'SUBMITTED' : 'VERIFIED', updatedAt: nowIso(), updatedBy: await actorName(who), note: str(body?.note, 300) || doc.note,
  });
  return ok({});
}

export async function listDeclarations(who: Who, q: any): Promise<Result> {
  needView(who);
  const fy = needFy(q);
  const [people, decls, structures, { settings }] = await Promise.all([loadPeople(who.cid), loadDeclarations(who.cid, fy), loadStructures(who.cid), loadPayrollSettings(who.cid)]);
  const rows = people.filter((p) => p.active && structures.has(p.uid)).map((p) => {
    const d = decls.get(p.uid);
    return {
      uid: p.uid, name: p.name, empId: p.empId, department: p.department, pan: structures.get(p.uid)?.pan || '',
      status: d?.status || 'NONE', regime: d?.regime || settings.tax.defaultRegime, updatedAt: d?.updatedAt || '',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return ok({ fy, fyLabel: fyLabel(fy), mode: settings.tax.mode, rows });
}

/** What a person's tax looks like for the year under each regime, using their current salary. */
export async function taxPreview(who: Who, q: any): Promise<Result> {
  const uid = await targetUid(who, q);
  const { settings, configured } = await loadPayrollSettings(who.cid);
  if (!configured) return ok({ available: false, reason: 'Payroll has not been set up yet.' });
  const month = istToday().slice(0, 7);
  const fy = fyStartYear(month);
  const structure = (await loadStructures(who.cid)).get(uid);
  if (!structure) return ok({ available: false, reason: 'No salary has been set for this person yet.' });
  const [paidMap, doc] = await Promise.all([paidLinesInFy(who.cid, fy, month), loadDeclaration(who.cid, uid, fy)]);
  const decl = declarationFor(settings, doc);
  const payDays = settings.daysBasis === 'FIXED_30' ? 30 : new Date(Date.UTC(parseInt(month.slice(0, 4), 10), parseInt(month.slice(5, 7), 10), 0)).getUTCDate();
  const full = fullMonthFacts(settings, structure, month, payDays);
  const paid = sumPaid(paidMap.get(uid), settings.components);
  const run = (regime: Regime) => {
    const r = projectTds({ settings: settings.tax, decl: { ...decl, regime }, month, paid, current: full, fullMonth: full });
    return { annualTax: r.annualTax, taxableIncome: r.taxableIncome, monthlyTds: r.tds, computation: r.computation };
  };
  const NEW = run('NEW');
  const OLD = run('OLD');
  return ok({
    available: true, fy, fyLabel: fyLabel(fy), month, mode: settings.tax.mode, chosen: decl.regime, NEW, OLD,
    cheaper: NEW.annualTax <= OLD.annualTax ? 'NEW' : 'OLD', taxDeductedSoFar: r2(paid.tds + decl.prevTds), monthsLeft: 1 + monthsAfterInFy(month),
  });
}

interface StatementRow {
  month: string;
  gross: number;
  tds: number;
}

async function statementFor(who: Who, uid: string, fy: number) {
  const { settings } = await loadPayrollSettings(who.cid);
  const [paidMap, doc, structure, person] = await Promise.all([
    paidLinesInFy(who.cid, fy), loadDeclaration(who.cid, uid, fy), loadStructures(who.cid).then((m) => m.get(uid)), personByUid(who.cid, uid),
  ]);
  return { settings, lines: paidMap.get(uid) || [], decl: declarationFor(settings, doc), declStatus: doc?.status || 'NONE', structure, person };
}

/** The annual tax statement from what was actually paid in the year. Draft layout of the figures behind Form 130. */
export async function taxStatement(who: Who, q: any): Promise<Result> {
  const uid = await targetUid(who, q);
  const fy = needFy(q);
  const s = await statementFor(who, uid, fy);
  if (!s.person) return fail(404, 'Employee not found.');
  const paid = sumPaid(s.lines, s.settings.components);
  const computation = computeAnnualTax(s.settings.tax, s.decl, { grossSalary: paid.gross, basicAnnual: paid.basic, hraAnnual: paid.hra, epfAnnual: paid.epf, ptAnnual: paid.pt });
  const rows: StatementRow[] = s.lines.map((x) => ({ month: x.month, gross: x.line.gross, tds: lineFacts(x.line, s.settings.components).tds }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const deducted = r2(paid.tds + s.decl.prevTds);
  return ok({
    fy, fyLabel: fyLabel(fy), asOf: istToday(), complete: fyMonths(fy)[11] < istToday().slice(0, 7),
    employee: { name: s.person.name, empId: s.person.empId, department: s.person.department, pan: s.structure?.pan || '' },
    employer: { name: s.settings.company.legalName, address: s.settings.company.address, tan: s.settings.company.tan, pan: s.settings.company.pan },
    regime: s.decl.regime, declarationStatus: s.declStatus, months: rows, paid, computation, taxDeducted: deducted, difference: r2(computation.totalTax - deducted),
    declaration: s.decl,
    note: 'Computed from the payroll actually paid in this system. Part A/B of the official certificate (deposit details from the tax portal) are not generated here.',
  });
}

/** One row per person for the year: for filing support and for checking against the tax portal. */
export async function tdsRegister(who: Who, q: any): Promise<Result> {
  needView(who);
  const fy = needFy(q);
  const [{ settings }, people, structures, decls] = await Promise.all([loadPayrollSettings(who.cid), loadPeople(who.cid), loadStructures(who.cid), loadDeclarations(who.cid, fy)]);
  const paidMap = await paidLinesInFy(who.cid, fy);
  const header = ['Employee ID', 'Name', 'PAN', 'Regime', 'Gross salary paid', 'Taxable income', 'Tax for the year', 'Tax deducted', 'Difference'];
  const rows = people.filter((p) => paidMap.has(p.uid)).map((p) => {
    const lines = paidMap.get(p.uid) || [];
    const paid = sumPaid(lines, settings.components);
    const decl = declarationFor(settings, decls.get(p.uid));
    const c = computeAnnualTax(settings.tax, decl, { grossSalary: paid.gross, basicAnnual: paid.basic, hraAnnual: paid.hra, epfAnnual: paid.epf, ptAnnual: paid.pt });
    const deducted = r2(paid.tds + decl.prevTds);
    return [p.empId, p.name, structures.get(p.uid)?.pan || '', decl.regime, paid.gross, c.taxableIncome, c.totalTax, deducted, r2(c.totalTax - deducted)];
  });
  return ok({ fy, fyLabel: fyLabel(fy), header, rows });
}
