/**
 * Performance Management setup (HR-PM-001): who is asking, competency master, role families, frameworks, cycles
 * and KRA/KPI templates. Reached through api/_lib/perfApi.ts.
 */
import { randomBytes } from 'node:crypto';
import { requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { istToday, isIsoDate } from '../../shared/leaveEngine.js';
import {
  EMPLOYEE_CATEGORIES, STARTER_COMPETENCIES, DEFAULT_WEIGHTS,
  type Competency, type CompetencyGroup, type Cycle, type EmployeeCategory, type Framework, type KraTemplate, type ReviewFrequency, type ReviewType, type RoleFamily,
} from '../../shared/performance.js';
import { addDays } from '../../shared/leaveEngine.js';
import { cleanKras, safeId, validateFramework, validateKpiWeights } from '../../shared/performanceEngine.js';
import {
  C, PerfError, audit, db, getOne, list, loadDirectory, loadSettings, nowIso, ok, personByUid, put, saveSettings, str, type Directory, type Result,
} from './perfCore.js';

// ------------------------------------------------------------------ who

export interface Who {
  ctx: AuthContext;
  cid: string;
  uid: string;
  name: string;
  canManage: boolean;
  canApprove: boolean;
  canView: boolean;
}

export async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new PerfError(403, 'Open this as a company user.');
  const has = (k: string) => ctx.isCompanyAdmin || hasPerm(ctx.perms, k);
  const me = await personByUid(ctx.companyId, ctx.uid);
  const canManage = has('perf.manage');
  const canApprove = has('perf.approve');
  return { ctx, cid: ctx.companyId, uid: ctx.uid, name: me?.name || ctx.email, canManage, canApprove, canView: canManage || canApprove || has('perf.view') };
}

export const needManage = (w: Who) => {
  if (!w.canManage) throw new PerfError(403, 'Only HR can do this.');
};
export const needHrOrApprover = (w: Who) => {
  if (!w.canManage && !w.canApprove) throw new PerfError(403, 'Only HR or an authorised approver can do this.');
};

export type Relation = 'SELF' | 'MANAGER' | 'HR' | 'NONE';
/** How the signed-in person relates to someone: themselves, their manager, HR (manage or approve), or nobody special. */
export function relationTo(w: Who, dir: Directory, uid: string): Relation {
  if (uid === w.uid) return 'SELF';
  if (dir.managerOf(uid) === w.uid) return 'MANAGER';
  if (w.canManage || w.canApprove) return 'HR';
  return 'NONE';
}

export const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ------------------------------------------------------------------ me

export async function me(w: Who): Promise<Result> {
  const dir = await loadDirectory(w.cid);
  const [settings, frameworks, plans, assignments, reviews, notes] = await Promise.all([
    loadSettings(w.cid),
    list<Framework>(C.frameworks, w.cid),
    list<any>(C.plans, w.cid),
    list<any>(C.assignments, w.cid, { uid: w.uid, status: 'ACTIVE' }),
    list<any>(C.reviews, w.cid),
    list<any>(C.notifications, w.cid, { uid: w.uid }),
  ]);
  const reports = dir.reportsOf(w.uid);
  const myPlan = plans.find((p) => p.uid === w.uid && p.status !== 'SUPERSEDED');
  const myReviews = reviews.filter((r) => r.uid === w.uid);
  const teamReviews = reviews.filter((r) => reports.includes(r.uid));
  const todo = {
    planToAcknowledge: myPlan?.status === 'PENDING_ACK' ? 1 : 0,
    sopsToAcknowledge: assignments.filter((a) => a.ackStatus === 'PENDING').length,
    selfReviewsDue: myReviews.filter((r) => r.status === 'SELF_PENDING').length,
    reviewsToAcknowledge: myReviews.filter((r) => r.status === 'PUBLISHED').length,
    teamPlansToCustomise: plans.filter((p) => reports.includes(p.uid) && p.status === 'DRAFT').length,
    teamReviewsDue: teamReviews.filter((r) => r.status === 'MANAGER_PENDING' || r.status === 'DISCUSSION_PENDING').length,
    plansToApprove: w.canManage || w.canApprove ? plans.filter((p) => p.status === 'SUBMITTED').length : 0,
    reviewsToApprove: w.canManage || w.canApprove ? reviews.filter((r) => r.status === 'HR_REVIEW' || r.status === 'APPROVAL_PENDING').length : 0,
    unreadMessages: notes.filter((n) => !n.read).length,
  };
  return ok({
    uid: w.uid,
    name: w.name,
    canManage: w.canManage,
    canApprove: w.canApprove,
    canView: w.canView,
    isManager: reports.length > 0,
    reportsCount: reports.length,
    configured: settings.competencies.length > 0 && frameworks.some((f) => f.status === 'APPROVED'),
    hasCompetencies: settings.competencies.length > 0,
    frameworksApproved: frameworks.filter((f) => f.status === 'APPROVED').length,
    todo,
  });
}

// ------------------------------------------------------------------ competency master and role families

const GROUPS: CompetencyGroup[] = ['CORE', 'MANAGER', 'BUSINESS_DEVELOPMENT', 'TECHNICAL', 'CREATIVE'];
const CATEGORIES = EMPLOYEE_CATEGORIES.map((c) => c.key);

function uniqueSlug(used: Set<string>, raw: string, fallback: string): string {
  const base = slug(str(raw, 60)) || fallback;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

export function cleanCompetencies(input: unknown): Competency[] {
  const used = new Set<string>();
  return (Array.isArray(input) ? input.slice(0, 60) : []).map((c: any, i: number) => ({
    id: uniqueSlug(used, c?.id || c?.name, `competency-${i + 1}`),
    name: str(c?.name, 80) || `Competency ${i + 1}`,
    standard: str(c?.standard, 300),
    evidence: str(c?.evidence, 300),
    group: GROUPS.includes(c?.group) ? c.group : 'CORE',
    active: c?.active !== false,
  }));
}

export function cleanFamilies(input: unknown, competencyIds: Set<string>): RoleFamily[] {
  const used = new Set<string>();
  return (Array.isArray(input) ? input.slice(0, 80) : []).map((f: any, i: number) => ({
    id: uniqueSlug(used, f?.id || f?.name, `family-${i + 1}`),
    name: str(f?.name, 80) || `Role family ${i + 1}`,
    departmentName: str(f?.departmentName, 80),
    designationKeywords: (Array.isArray(f?.designationKeywords) ? f.designationKeywords : []).map((k: any) => str(k, 60).toLowerCase()).filter(Boolean).slice(0, 12),
    category: CATEGORIES.includes(f?.category) ? (f.category as EmployeeCategory) : 'INDIVIDUAL',
    competencyIds: (Array.isArray(f?.competencyIds) ? f.competencyIds : []).map(String).filter((id: string) => competencyIds.has(id)),
    active: f?.active !== false,
  }));
}

export async function getSettings(w: Who): Promise<Result> {
  needHrOrApprover(w);
  const [settings, dir] = await Promise.all([loadSettings(w.cid), loadDirectory(w.cid)]);
  const departments = [...new Set(dir.active.map((p) => p.department).filter(Boolean))].sort();
  return ok({
    competencies: settings.competencies,
    roleFamilies: settings.roleFamilies,
    competencyVersion: settings.competencyVersion,
    departments,
    webhookKey: w.canManage ? settings.webhookKey : '',
    people: w.canManage ? dir.active.map((p) => ({ uid: p.uid, name: p.name, department: p.department, title: p.title })) : [],
  });
}

export async function postSettings(w: Who, body: any): Promise<Result> {
  needManage(w);
  const prev = await loadSettings(w.cid);
  const competencies = cleanCompetencies(body.competencies ?? prev.competencies);
  const ids = new Set(competencies.map((c) => c.id));
  const roleFamilies = cleanFamilies(body.roleFamilies ?? prev.roleFamilies, ids);
  const changed = JSON.stringify(competencies) !== JSON.stringify(prev.competencies);
  const next = { ...prev, competencies, roleFamilies, competencyVersion: prev.competencyVersion + (changed ? 1 : 0), updatedAt: nowIso(), updatedBy: w.name };
  await saveSettings(w.cid, next);
  await audit(w.cid, 'SETTINGS', w.cid, 'SETTINGS_SAVED', w, { competencies: prev.competencies.length, families: prev.roleFamilies.length }, { competencies: competencies.length, families: roleFamilies.length, version: next.competencyVersion });
  return ok({ competencyVersion: next.competencyVersion });
}

export async function rotateWebhook(w: Who): Promise<Result> {
  needManage(w);
  const s = await loadSettings(w.cid);
  s.webhookKey = randomBytes(16).toString('hex');
  await saveSettings(w.cid, s);
  await audit(w.cid, 'SETTINGS', w.cid, 'WEBHOOK_KEY_ROTATED', w);
  return ok({ webhookKey: s.webhookKey });
}

const DEPT_TECH = /tech|software|develop|engineer|automation|\bit\b|website/i;
const DEPT_CREATIVE = /creative|brand|design|content/i;
const DEPT_SALES = /sales|business dev|\bbd\b/i;

/** The example KRAs from the framework (Performance Marketing Executive). Targets stay blank: they are agreed by people. */
const MARKETING_EXAMPLE = [
  { name: 'Campaign Execution', kpis: [{ code: 'CAMP-01', description: 'Campaigns launched according to approved plan', measurement: 'Launch checklist / task evidence', weightage: 25, frequency: 'MONTHLY', evidenceSource: 'Task system' }] },
  { name: 'Campaign Optimisation', kpis: [{ code: 'OPT-01', description: 'Timely, documented optimisation', measurement: 'Platform and task records', weightage: 20, frequency: 'MONTHLY', evidenceSource: 'Platform and task records' }] },
  { name: 'Lead Quality', kpis: [{ code: 'LEAD-01', description: 'Valid leads and lead-quality feedback', measurement: 'CRM records', weightage: 25, frequency: 'MONTHLY', evidenceSource: 'CRM' }] },
  { name: 'Reporting', kpis: [{ code: 'REP-01', description: 'Accurate, on-time reports', measurement: 'Dashboard / report submission', weightage: 15, frequency: 'MONTHLY', evidenceSource: 'Dashboard / report submission' }] },
  { name: 'Process Compliance', kpis: [{ code: 'PROC-01', description: 'Tracking and QA checklist completed', measurement: 'Approved SOP checklist', weightage: 15, frequency: 'MONTHLY', evidenceSource: 'Department SOP module' }] },
];

/** Adds only what is missing: the competency master, a role family per department, a draft framework and an example template. */
export async function applyStarter(w: Who): Promise<Result> {
  needManage(w);
  const settings = await loadSettings(w.cid);
  const dir = await loadDirectory(w.cid);
  const added = { competencies: 0, families: 0, frameworks: 0, templates: 0 };
  if (settings.competencies.length === 0) {
    settings.competencies = STARTER_COMPETENCIES.map((c) => ({ ...c }));
    settings.competencyVersion += 1;
    added.competencies = settings.competencies.length;
  }
  const have = new Set(settings.roleFamilies.map((f) => f.departmentName.trim().toLowerCase()));
  const ids = new Set(settings.competencies.map((c) => c.id));
  const used = new Set(settings.roleFamilies.map((f) => f.id));
  for (const dept of [...new Set(dir.active.map((p) => p.department).filter(Boolean))]) {
    if (have.has(dept.trim().toLowerCase())) continue;
    const extra = [DEPT_TECH.test(dept) && 'tech-quality', DEPT_CREATIVE.test(dept) && 'creative-craft', DEPT_SALES.test(dept) && 'bd-commercial'].filter(Boolean) as string[];
    settings.roleFamilies.push({
      id: uniqueSlug(used, dept, 'family'), name: dept, departmentName: dept, designationKeywords: [],
      category: DEPT_SALES.test(dept) ? 'SALES' : 'INDIVIDUAL', competencyIds: extra.filter((e) => ids.has(e)), active: true,
    });
    added.families++;
  }
  if (!settings.webhookKey) settings.webhookKey = randomBytes(16).toString('hex');
  settings.updatedAt = nowIso();
  settings.updatedBy = w.name;
  await saveSettings(w.cid, settings);

  const frameworks = await list<Framework>(C.frameworks, w.cid);
  if (frameworks.length === 0) {
    const ref = db().collection(C.frameworks).doc();
    const now = nowIso();
    const fw: Framework = {
      id: ref.id, companyId: w.cid, name: 'Individual contributor framework', employeeCategory: 'INDIVIDUAL', roleFamilyId: '', weights: { ...DEFAULT_WEIGHTS },
      reviewFrequency: 'QUARTERLY', effectiveFrom: istToday(), effectiveTo: '', status: 'DRAFT', version: 1, approvedBy: '', approvedAt: '', createdBy: w.name, createdAt: now, updatedAt: now,
    };
    await put(C.frameworks, ref.id, fw);
    added.frameworks++;
  }
  for (const f of settings.roleFamilies) {
    if (!/marketing/i.test(f.departmentName)) continue;
    const id = templateId(w.cid, f.id);
    if (await getOne(C.templates, id, w.cid)) continue;
    const now = nowIso();
    const t: KraTemplate = { id, companyId: w.cid, roleFamilyId: f.id, name: `${f.name} KRA/KPI template`, kras: cleanKras(MARKETING_EXAMPLE), version: 1, status: 'DRAFT', approvedBy: '', createdAt: now, updatedAt: now };
    await put(C.templates, id, t);
    added.templates++;
  }
  await audit(w.cid, 'SETTINGS', w.cid, 'STARTER_APPLIED', w, null, added);
  return ok({ added });
}

// ------------------------------------------------------------------ frameworks

const FREQUENCIES: ReviewFrequency[] = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'];

export async function getFrameworks(w: Who): Promise<Result> {
  needHrOrApprover(w);
  const items = await list<Framework>(C.frameworks, w.cid);
  return ok({ items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
}

export async function saveFramework(w: Who, body: any): Promise<Result> {
  needManage(w);
  const existing = body.id ? await getOne<Framework>(C.frameworks, str(body.id, 128), w.cid) : null;
  if (body.id && !existing) throw new PerfError(404, 'Framework not found.');
  if (existing && existing.status !== 'DRAFT') throw new PerfError(400, 'An approved framework cannot be edited. Make a new version instead.');
  const settings = await loadSettings(w.cid);
  const category: EmployeeCategory = CATEGORIES.includes(body.employeeCategory) ? body.employeeCategory : 'INDIVIDUAL';
  const roleFamilyId = str(body.roleFamilyId, 60);
  if (roleFamilyId && !settings.roleFamilies.some((f) => f.id === roleFamilyId)) throw new PerfError(400, 'Unknown role family.');
  const w3 = body.weights || {};
  const draft = {
    name: str(body.name, 100),
    weights: { kra: Number(w3.kra), behaviour: Number(w3.behaviour), sop: Number(w3.sop) },
    effectiveFrom: str(body.effectiveFrom, 10),
    effectiveTo: str(body.effectiveTo, 10),
  };
  const problem = validateFramework(draft);
  if (problem) throw new PerfError(400, problem);
  const now = nowIso();
  const doc: Framework = {
    id: existing?.id || db().collection(C.frameworks).doc().id, companyId: w.cid, name: draft.name, employeeCategory: category, roleFamilyId, weights: draft.weights,
    reviewFrequency: FREQUENCIES.includes(body.reviewFrequency) ? body.reviewFrequency : 'QUARTERLY', effectiveFrom: draft.effectiveFrom, effectiveTo: draft.effectiveTo,
    status: 'DRAFT', version: existing?.version || 1, approvedBy: '', approvedAt: '', createdBy: existing?.createdBy || w.name, createdAt: existing?.createdAt || now, updatedAt: now,
  };
  await put(C.frameworks, doc.id, doc);
  await audit(w.cid, 'FRAMEWORK', doc.id, existing ? 'FRAMEWORK_EDITED' : 'FRAMEWORK_CREATED', w, existing, doc);
  return ok({ item: doc });
}

/** A new draft copy of an approved framework, one version higher. */
export async function cloneFramework(w: Who, body: any): Promise<Result> {
  needManage(w);
  const src = await getOne<Framework>(C.frameworks, str(body.id, 128), w.cid);
  if (!src) throw new PerfError(404, 'Framework not found.');
  const now = nowIso();
  const id = db().collection(C.frameworks).doc().id;
  const doc: Framework = { ...src, id, status: 'DRAFT', version: src.version + 1, approvedBy: '', approvedAt: '', effectiveFrom: istToday() > src.effectiveFrom ? istToday() : src.effectiveFrom, effectiveTo: '', createdBy: w.name, createdAt: now, updatedAt: now };
  await put(C.frameworks, id, doc);
  await audit(w.cid, 'FRAMEWORK', id, 'FRAMEWORK_CLONED', w, { from: src.id }, doc);
  return ok({ item: doc });
}

/** Approving ends the earlier open-ended framework for the same scope the day before this one starts. */
export async function approveFramework(w: Who, body: any): Promise<Result> {
  needHrOrApprover(w);
  const f = await getOne<Framework>(C.frameworks, str(body.id, 128), w.cid);
  if (!f) throw new PerfError(404, 'Framework not found.');
  if (f.status !== 'DRAFT') throw new PerfError(400, 'Only a draft can be approved.');
  const problem = validateFramework(f);
  if (problem) throw new PerfError(400, problem);
  const all = await list<Framework>(C.frameworks, w.cid);
  for (const o of all) {
    if (o.id === f.id || o.status !== 'APPROVED' || o.employeeCategory !== f.employeeCategory || o.roleFamilyId !== f.roleFamilyId) continue;
    if (o.effectiveTo && o.effectiveTo < f.effectiveFrom) continue;
    if (!o.effectiveTo || o.effectiveTo >= f.effectiveFrom) {
      const end = addDays(f.effectiveFrom, -1);
      if (end < o.effectiveFrom) continue;
      await put(C.frameworks, o.id, { ...o, effectiveTo: end, updatedAt: nowIso() });
    }
  }
  const now = nowIso();
  const doc: Framework = { ...f, status: 'APPROVED', approvedBy: w.name, approvedAt: now, updatedAt: now };
  await put(C.frameworks, f.id, doc);
  await audit(w.cid, 'FRAMEWORK', f.id, 'FRAMEWORK_APPROVED', w, { status: f.status }, { status: 'APPROVED', version: f.version });
  return ok({ item: doc });
}

export async function retireFramework(w: Who, body: any): Promise<Result> {
  needManage(w);
  const f = await getOne<Framework>(C.frameworks, str(body.id, 128), w.cid);
  if (!f) throw new PerfError(404, 'Framework not found.');
  const doc: Framework = { ...f, status: 'RETIRED', effectiveTo: f.effectiveTo || istToday(), updatedAt: nowIso() };
  await put(C.frameworks, f.id, doc);
  await audit(w.cid, 'FRAMEWORK', f.id, 'FRAMEWORK_RETIRED', w, { status: f.status }, { status: 'RETIRED' });
  return ok({ item: doc });
}

// ------------------------------------------------------------------ cycles

const REVIEW_TYPES: ReviewType[] = ['MONTHLY_CHECKIN', 'PROBATION', 'QUARTERLY', 'ANNUAL', 'IMPROVEMENT'];

export async function getCycles(w: Who): Promise<Result> {
  const items = await list<Cycle>(C.cycles, w.cid);
  return ok({ items: items.sort((a, b) => b.periodStart.localeCompare(a.periodStart)) });
}

export async function saveCycle(w: Who, body: any): Promise<Result> {
  needManage(w);
  const existing = body.id ? await getOne<Cycle>(C.cycles, str(body.id, 128), w.cid) : null;
  if (body.id && !existing) throw new PerfError(404, 'Cycle not found.');
  if (existing && existing.status === 'LOCKED') throw new PerfError(400, 'A locked cycle cannot be changed.');
  const reviewType: ReviewType = REVIEW_TYPES.includes(body.reviewType) ? body.reviewType : 'QUARTERLY';
  const open = existing?.status === 'OPEN';
  const periodStart = open ? existing!.periodStart : str(body.periodStart, 10);
  const periodEnd = open ? existing!.periodEnd : str(body.periodEnd, 10);
  const [selfDeadline, managerDeadline, hrDeadline] = [str(body.selfDeadline, 10), str(body.managerDeadline, 10), str(body.hrDeadline, 10)];
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodEnd < periodStart) throw new PerfError(400, 'Choose a valid review period.');
  for (const d of [selfDeadline, managerDeadline, hrDeadline]) if (!isIsoDate(d)) throw new PerfError(400, 'Set all three deadlines.');
  if (!(selfDeadline <= managerDeadline && managerDeadline <= hrDeadline)) throw new PerfError(400, 'Deadlines must run in order: self-review, then manager, then HR.');
  const name = str(body.name, 100);
  if (!name) throw new PerfError(400, 'Give the cycle a name.');
  const now = nowIso();
  const doc: Cycle = {
    id: existing?.id || db().collection(C.cycles).doc().id, companyId: w.cid, name, reviewType, periodStart, periodEnd, selfDeadline, managerDeadline, hrDeadline,
    scope: open ? existing!.scope : { uids: (Array.isArray(body.scope?.uids) ? body.scope.uids : []).map(String).slice(0, 500), departmentName: str(body.scope?.departmentName, 80) },
    status: existing?.status || 'DRAFT', openedAt: existing?.openedAt || '', lockedAt: '', createdBy: existing?.createdBy || w.name, createdAt: existing?.createdAt || now, updatedAt: now,
  };
  await put(C.cycles, doc.id, doc);
  await audit(w.cid, 'CYCLE', doc.id, existing ? 'CYCLE_EDITED' : 'CYCLE_CREATED', w, existing, doc);
  return ok({ item: doc });
}

// ------------------------------------------------------------------ KRA/KPI templates

export const templateId = (cid: string, roleFamilyId: string) => safeId(`${cid}__tpl__${roleFamilyId}`);

export async function getTemplates(w: Who): Promise<Result> {
  needHrOrApprover(w);
  const items = await list<KraTemplate>(C.templates, w.cid);
  return ok({ items });
}

export async function saveTemplate(w: Who, body: any): Promise<Result> {
  needManage(w);
  const settings = await loadSettings(w.cid);
  const rfId = str(body.roleFamilyId, 60);
  const rf = settings.roleFamilies.find((f) => f.id === rfId);
  if (!rf) throw new PerfError(400, 'Choose a role family.');
  const id = templateId(w.cid, rfId);
  const existing = await getOne<KraTemplate>(C.templates, id, w.cid);
  const kras = cleanKras(body.kras);
  const now = nowIso();
  const changed = !existing || JSON.stringify(existing.kras) !== JSON.stringify(kras);
  const doc: KraTemplate = {
    id, companyId: w.cid, roleFamilyId: rfId, name: str(body.name, 100) || `${rf.name} KRA/KPI template`, kras,
    version: (existing?.version || 0) + (existing && changed && existing.status === 'APPROVED' ? 1 : existing ? 0 : 1),
    status: changed ? 'DRAFT' : existing!.status, approvedBy: changed ? '' : existing!.approvedBy, createdAt: existing?.createdAt || now, updatedAt: now,
  };
  await put(C.templates, id, doc);
  await audit(w.cid, 'TEMPLATE', id, existing ? 'TEMPLATE_EDITED' : 'TEMPLATE_CREATED', w, existing ? { version: existing.version, status: existing.status } : null, { version: doc.version, status: doc.status });
  return ok({ item: doc, weightProblem: validateKpiWeights(kras) });
}

export async function approveTemplate(w: Who, body: any): Promise<Result> {
  needHrOrApprover(w);
  const t = await getOne<KraTemplate>(C.templates, str(body.id, 200), w.cid);
  if (!t) throw new PerfError(404, 'Template not found.');
  const problem = validateKpiWeights(t.kras);
  if (problem) throw new PerfError(400, problem);
  const doc: KraTemplate = { ...t, status: 'APPROVED', approvedBy: w.name, updatedAt: nowIso() };
  await put(C.templates, t.id, doc);
  await audit(w.cid, 'TEMPLATE', t.id, 'TEMPLATE_APPROVED', w, { status: t.status }, { status: 'APPROVED', version: t.version });
  return ok({ item: doc });
}
