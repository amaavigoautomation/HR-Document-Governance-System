/**
 * Founder hiring dashboard: pure calculations over plain records (no I/O), so the numbers can be tested.
 *
 * Definitions (shown on the screen too, so nobody has to guess):
 *  - Time to hire: days from the founder approving the requisition to the candidate accepting the offer (average over accepted offers).
 *  - Offer acceptance rate: accepted or joined, out of all offers that got a final answer (accepted, joined, declined, ghosted, expired).
 *  - Cost per hire: all logged hiring costs divided by hires (accepted or joined offers).
 *  - Budgeted CTC: vacancies x the requisition's maximum CTC, for approved requisitions. Actual: the approved CTC of accepted or joined offers.
 *  - Attrition: completed exits in the last 12 months as a share of today's headcount.
 */

export interface ReqRec { id: string; status: string; departmentName?: string; positionTitle?: string; vacancies?: number; ctcMaxLpa?: number; createdAt?: string; founderApprovedAt?: string }
export interface AppRec { id: string; status: string; source?: string; requisitionId?: string }
export interface OfferRec { id: string; requisitionId?: string; applicationId?: string; status: string; approvedCtcLpa?: number | null; joiningDate?: string; candidateName?: string; designation?: string; source?: string; acceptedAt?: string; department?: string }
export interface CostRec { requisitionId?: string; amount: number; category: string }
export interface ExitRec { completedAt?: string; lastWorkingDay?: string; status: string }

const HIRED = ['ACCEPTED', 'JOINED'];
const ANSWERED = ['ACCEPTED', 'JOINED', 'DECLINED', 'GHOSTED', 'EXPIRED'];
const COMMITTED = ['JD_DRAFT', 'JOB_OPEN'];
const DAY = 86_400_000;
const day = (iso: string) => iso.slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(`${day(b)}T00:00:00Z`) - Date.parse(`${day(a)}T00:00:00Z`)) / DAY);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Dashboard {
  positions: { open: number; closed: number; pendingApproval: number; openVacancies: number };
  vacanciesByDepartment: { department: string; vacancies: number; positions: number }[];
  pipeline: { stage: string; count: number }[];
  timeToHire: { averageDays: number | null; sample: number; slowest: { position: string; days: number }[]; byMonth: { month: string; averageDays: number | null; hires: number }[]; changePct: number | null };
  offers: { total: number; byStatus: Record<string, number>; acceptanceRate: number | null; answered: number };
  costs: { total: number; hires: number; perHire: number | null; byCategory: { category: string; amount: number }[] };
  upcomingJoinings: { next30Days: number; list: { candidateName: string; designation: string; joiningDate: string; daysAway: number }[] };
  budgetVsActual: { department: string; budgetedLpa: number; actualLpa: number; varianceLpa: number }[];
  sources: { source: string; applications: number; selected: number; hires: number; conversionPct: number | null }[];
  attrition: { exits12m: number; headcount: number; ratePct: number | null; byMonth: { month: string; exits: number }[] };
}

export function computeDashboard(input: { requisitions: ReqRec[]; applications: AppRec[]; offers: OfferRec[]; costs: CostRec[]; exits: ExitRec[]; headcount: number; today: string; stages: readonly string[] }): Dashboard {
  const { requisitions, applications, offers, costs, exits, headcount, today, stages } = input;
  const reqById = new Map(requisitions.map((r) => [r.id, r]));

  // ---- positions and vacancies
  const open = requisitions.filter((r) => COMMITTED.includes(r.status));
  const byDept = new Map<string, { vacancies: number; positions: number }>();
  for (const r of open) {
    const k = r.departmentName || 'Unassigned';
    const cur = byDept.get(k) || { vacancies: 0, positions: 0 };
    cur.vacancies += Math.max(0, Math.floor(Number(r.vacancies) || 0));
    cur.positions += 1;
    byDept.set(k, cur);
  }

  // ---- pipeline
  const counts = new Map<string, number>();
  for (const a of applications) counts.set(a.status, (counts.get(a.status) || 0) + 1);
  const pipeline = [...stages.map((s) => ({ stage: s, count: counts.get(s) || 0 })), ...[...counts.keys()].filter((k) => !stages.includes(k)).map((k) => ({ stage: k, count: counts.get(k)! }))];

  // ---- time to hire
  const tth: { position: string; days: number; month: string }[] = [];
  for (const o of offers) {
    if (!HIRED.includes(o.status) || !o.acceptedAt) continue;
    const r = o.requisitionId ? reqById.get(o.requisitionId) : undefined;
    const from = r?.founderApprovedAt || r?.createdAt;
    if (!from) continue;
    tth.push({ position: o.designation || r?.positionTitle || 'Position', days: Math.max(0, diff(from, o.acceptedAt)), month: day(o.acceptedAt).slice(0, 7) });
  }

  // ---- offers
  const byStatus: Record<string, number> = {};
  for (const o of offers) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  const answered = offers.filter((o) => ANSWERED.includes(o.status)).length;
  const hires = offers.filter((o) => HIRED.includes(o.status)).length;

  // ---- costs
  const catTotals = new Map<string, number>();
  let costTotal = 0;
  for (const c of costs) { costTotal += c.amount; catTotals.set(c.category, (catTotals.get(c.category) || 0) + c.amount); }

  // ---- joinings
  const upcoming = offers
    .filter((o) => o.status === 'ACCEPTED' && o.joiningDate && o.joiningDate >= today)
    .map((o) => ({ candidateName: o.candidateName || '', designation: o.designation || '', joiningDate: o.joiningDate!, daysAway: diff(today, o.joiningDate!) }))
    .sort((a, b) => a.joiningDate.localeCompare(b.joiningDate));

  // ---- budget vs actual by department (approved requisitions only)
  const budget = new Map<string, { b: number; a: number }>();
  for (const r of open) {
    const k = r.departmentName || 'Unassigned';
    const cur = budget.get(k) || { b: 0, a: 0 };
    cur.b += (Number(r.ctcMaxLpa) || 0) * Math.max(0, Math.floor(Number(r.vacancies) || 0));
    budget.set(k, cur);
  }
  for (const o of offers) {
    if (!HIRED.includes(o.status) || typeof o.approvedCtcLpa !== 'number') continue;
    const r = o.requisitionId ? reqById.get(o.requisitionId) : undefined;
    const k = r?.departmentName || o.department || 'Unassigned';
    const cur = budget.get(k) || { b: 0, a: 0 };
    cur.a += o.approvedCtcLpa;
    budget.set(k, cur);
  }

  // ---- source effectiveness
  const src = new Map<string, { applications: number; selected: number; hires: number }>();
  const srcOf = (s?: string) => (s || 'MANUAL');
  for (const a of applications) {
    const cur = src.get(srcOf(a.source)) || { applications: 0, selected: 0, hires: 0 };
    cur.applications++;
    if (a.status === 'Selected') cur.selected++;
    src.set(srcOf(a.source), cur);
  }
  const appById = new Map(applications.map((a) => [a.id, a]));
  for (const o of offers) {
    if (!HIRED.includes(o.status)) continue;
    const s = srcOf(o.source || appById.get(o.applicationId || '')?.source);
    const cur = src.get(s) || { applications: 0, selected: 0, hires: 0 };
    cur.hires++;
    src.set(s, cur);
  }

  // ---- attrition
  const months: string[] = [];
  const base = new Date(`${today}T00:00:00Z`);
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const exitMonths = new Map<string, number>();
  for (const e of exits) {
    if (e.status !== 'COMPLETED') continue;
    const when = (e.lastWorkingDay || e.completedAt || '').slice(0, 7);
    if (months.includes(when)) exitMonths.set(when, (exitMonths.get(when) || 0) + 1);
  }
  const tthMonths = months.slice(-6).map((month) => {
    const list = tth.filter((t) => t.month === month);
    return { month, averageDays: list.length ? r1(list.reduce((a, c) => a + c.days, 0) / list.length) : null, hires: list.length };
  });
  // Change: latest month with hires against the month with hires before it (negative means faster).
  const withHires = tthMonths.filter((m) => m.averageDays !== null);
  const last2 = withHires.slice(-2);
  const tthChange = last2.length === 2 && last2[0].averageDays! > 0 ? Math.round(((last2[1].averageDays! - last2[0].averageDays!) / last2[0].averageDays!) * 100) : null;
  const exits12 = [...exitMonths.values()].reduce((a, c) => a + c, 0);

  return {
    positions: {
      open: open.length, closed: requisitions.filter((r) => r.status === 'CLOSED').length,
      pendingApproval: requisitions.filter((r) => ['PENDING_ASSIGNMENT', 'PENDING_HR', 'PENDING_FOUNDER'].includes(r.status)).length,
      openVacancies: [...byDept.values()].reduce((a, c) => a + c.vacancies, 0),
    },
    vacanciesByDepartment: [...byDept.entries()].map(([department, v]) => ({ department, ...v })).sort((a, b) => b.vacancies - a.vacancies),
    pipeline,
    timeToHire: {
      averageDays: tth.length ? r1(tth.reduce((a, c) => a + c.days, 0) / tth.length) : null, sample: tth.length,
      slowest: [...tth].sort((a, b) => b.days - a.days).slice(0, 3).map(({ position, days }) => ({ position, days })),
      byMonth: tthMonths, changePct: tthChange,
    },
    offers: { total: offers.length, byStatus, answered, acceptanceRate: answered ? r1((hires / answered) * 100) : null },
    costs: {
      total: costTotal, hires, perHire: hires && costTotal ? Math.round(costTotal / hires) : null,
      byCategory: [...catTotals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    },
    upcomingJoinings: { next30Days: upcoming.filter((u) => u.daysAway <= 30).length, list: upcoming.slice(0, 10) },
    budgetVsActual: [...budget.entries()].map(([department, v]) => ({ department, budgetedLpa: r2(v.b), actualLpa: r2(v.a), varianceLpa: r2(v.b - v.a) })).sort((a, b) => b.budgetedLpa - a.budgetedLpa),
    sources: [...src.entries()].map(([source, v]) => ({ source, ...v, conversionPct: v.applications ? r1((v.hires / v.applications) * 100) : null })).sort((a, b) => b.hires - a.hires || b.applications - a.applications),
    attrition: { exits12m: exits12, headcount, ratePct: headcount ? r1((exits12 / headcount) * 100) : null, byMonth: months.map((month) => ({ month, exits: exitMonths.get(month) || 0 })) },
  };
}
