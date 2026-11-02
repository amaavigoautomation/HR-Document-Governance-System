/**
 * Founder hiring dashboard (reached through hiringRouter.ts as /api/recruitment/hdash).
 * Read-only. Visible to the founder, leadership with HRBP access, and company admins: it shows offered salaries and hiring spend.
 * The calculations are in shared/hiringAnalytics.ts.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { listApplications, APPLICATION_STAGES } from './recruitmentData.js';
import { listItems, type PipeRequest } from './pipelineApi.js';
import { loadPeople } from './leaveCore.js';
import { computeDashboard, type Dashboard } from '../../shared/hiringAnalytics.js';

type Result = { status: number; json: any };
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const canSee = (ctx: AuthContext) => ctx.isCompanyAdmin || ['req.founder_decide', 'hrbp.view', 'hrbp.manage'].some((p) => ctx.perms.includes(p));

export async function loadDashboard(cid: string): Promise<Dashboard> {
  const db = adminDb();
  const [reqSnap, apps, offers, costs, exitSnap, people] = await Promise.all([
    db.collection('requisitions').where('companyId', '==', cid).get(),
    listApplications(cid),
    listItems(cid, 'offer'),
    listItems(cid, 'hcost'),
    db.collection('lifecycleExits').where('companyId', '==', cid).get(),
    loadPeople(cid),
  ]);
  const requisitions = reqSnap.docs.map((d: any) => {
    const r = d.data() as any;
    return { id: r.id || d.id, status: r.status, departmentName: r.departmentName, positionTitle: r.positionTitle, vacancies: r.vacancies, ctcMaxLpa: r.ctcMaxLpa, createdAt: r.createdAt, founderApprovedAt: r.founderDecision?.at };
  });
  return computeDashboard({
    requisitions,
    applications: apps.map((a) => ({ id: a.id, status: a.status, source: a.source, requisitionId: a.requisitionId })),
    offers: offers.map((o) => ({
      id: o.id, requisitionId: o.requisitionId, applicationId: o.applicationId, status: o.status, approvedCtcLpa: o.approvedCtcLpa, joiningDate: o.joiningDate,
      candidateName: o.candidateName, designation: o.designation, source: o.source, department: o.department,
      acceptedAt: ((o.history || []) as any[]).filter((h) => h.action === 'accept').map((h) => h.at).pop(),
    })),
    costs: costs.map((c) => ({ requisitionId: c.requisitionId, amount: Number(c.amount) || 0, category: c.category })),
    exits: exitSnap.docs.map((d: any) => d.data() as any),
    headcount: people.filter((p) => p.active).length,
    today: todayIst(),
    stages: APPLICATION_STAGES,
  });
}

export async function routeAnalytics(r: PipeRequest): Promise<Result | null> {
  if (r.action !== 'hdash') return null;
  try {
    if (r.method !== 'GET') return { status: 405, json: { success: false, error: 'Method not allowed.' } };
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return { status: 403, json: { success: false, error: 'Open this as a company user.' } };
    if (!canSee(ctx)) return { status: 403, json: { success: false, error: 'You do not have permission to do this.' } };
    return { status: 200, json: { success: true, dashboard: await loadDashboard(ctx.companyId), generatedAt: new Date().toISOString() } };
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Analytics] error:', err);
    return { status: 500, json: { success: false, error: err?.message || 'Dashboard request failed.' } };
  }
}
