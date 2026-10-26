/**
 * Home dashboard API: GET /api/leave/dashboard-me (shares the leave serverless function, like payroll and people do).
 *
 * One call returns the widgets this person is allowed to see, with their data. Who sees what is decided here,
 * on the server, from the verified token claims plus facts the leave, payroll and people modules already
 * compute (are you someone's manager, are you covering for one). The browser only draws what it is sent.
 *
 * Nothing here reads more than the person's permissions allow: document, hiring and admin data are only
 * queried when the person holds the matching permission, and personal data is always scoped to their own id.
 */
import { authErrorResponse, requireActiveTenant } from './authContext.js';
import { hasAnyPerm, hasPerm } from '../../shared/permissions.js';
import { addDays, istToday } from '../../shared/leaveEngine.js';
import {
  ADMIN_PERMS, DOC_AUTHOR_PERMS, HIRING_PERMS, buildWidgets,
  type DashboardInput, type DocFacts, type DocRef, type HiringFacts, type LeaveFacts, type LifecycleFacts, type PayrollFacts,
} from '../../shared/dashboard.js';
import { db, personByUid } from './leaveCore.js';
import { routeLeave } from './leaveApi.js';
import { routePayroll } from './payrollApi.js';
import { routeLifecycle } from './lifecycleApi.js';

export interface DashboardRequestIn {
  method: string;
  action: string;
  headers: Record<string, any>;
  ip?: string;
}

interface Result {
  status: number;
  json: any;
}

const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

/** Keeps document reads small: versions carry whole files, and the dashboard only needs a few fields. */
const slim = (q: any, ...fields: string[]) => (typeof q.select === 'function' ? q.select(...fields) : q);

/** A module that is off, not set up, or failing must not break the dashboard: it just contributes nothing. */
async function moduleJson(p: Promise<{ status: number; json: any }>): Promise<any | null> {
  try {
    const r = await p;
    return r.status === 200 && r.json?.success !== false ? r.json : null;
  } catch {
    return null;
  }
}

const dayOf = (v: unknown) => String(v || '').slice(0, 10);

async function leaveFacts(headers: Record<string, any>): Promise<LeaveFacts | null> {
  const j = await moduleJson(routeLeave({ method: 'GET', action: 'me', query: {}, body: undefined, headers }));
  if (!j) return null;
  return {
    found: j.found !== false,
    configured: !!j.configured,
    canManage: !!j.canManage,
    canReport: !!j.canReport,
    isManager: !!j.isManager,
    isDelegate: !!j.isDelegate,
    approvals: Number(j.approvals) || 0,
    balances: Array.isArray(j.balances) ? j.balances : [],
    attendanceToday: { checkIn: j.attendanceToday?.checkIn ?? null, checkOut: j.attendanceToday?.checkOut ?? null },
  };
}

async function payrollFacts(headers: Record<string, any>, cid: string): Promise<PayrollFacts | null> {
  const [me, slips] = await Promise.all([
    moduleJson(routePayroll({ method: 'GET', action: 'me', query: {}, body: undefined, headers })),
    moduleJson(routePayroll({ method: 'GET', action: 'my-payslips', query: {}, body: undefined, headers })),
  ]);
  if (!me) return null;
  const first = Array.isArray(slips?.items) ? slips.items[0] : null;
  let latestRun: PayrollFacts['latestRun'] = null;
  if (me.canView) {
    try {
      const runs = await db().collection('payrollRuns').where('companyId', '==', cid).get();
      const sorted = runs.docs.map((d: any) => ({ month: String(d.get('month') || ''), status: String(d.get('status') || '') })).filter((r: any) => r.month)
        .sort((a: any, b: any) => b.month.localeCompare(a.month));
      latestRun = sorted[0] || null;
    } catch {
      latestRun = null;
    }
  }
  return {
    configured: !!me.configured,
    canManage: !!me.canManage,
    canView: !!me.canView,
    isManager: !!me.isManager,
    latestPayslip: first ? { month: String(first.month), gross: Number(first.gross) || 0, deductions: Number(first.deductions) || 0, net: Number(first.net) || 0, status: String(first.status || '') } : null,
    latestRun,
  };
}

async function lifecycleFacts(headers: Record<string, any>, cid: string): Promise<LifecycleFacts | null> {
  const me = await moduleJson(routeLifecycle({ method: 'GET', action: 'me', query: {}, body: undefined, headers }));
  if (!me) return null;
  let companyOpenTasks: number | null = null;
  if (me.canManage) {
    try {
      companyOpenTasks = (await db().collection('lifecycleTasks').where('companyId', '==', cid).where('status', '==', 'OPEN').get()).size;
    } catch {
      companyOpenTasks = null;
    }
  }
  return { canManage: !!me.canManage, isManager: !!me.isManager, hasExit: !!me.hasExit, openTasks: Number(me.openTasks) || 0, companyOpenTasks };
}

/** Document data. Each part is read only when the person's permissions allow it. */
async function docFacts(cid: string, perms: string[], ids: string[], today: string): Promise<DocFacts> {
  const canReview = hasAnyPerm(perms, ['doc.review', 'doc.publish']);
  const canAuthor = hasAnyPerm(perms, DOC_AUTHOR_PERMS);
  const canAck = hasPerm(perms, 'doc.acknowledge');
  const canCompliance = hasPerm(perms, 'compliance.view');
  const facts: DocFacts = { pendingAcks: [], pendingAckCount: 0, reviewQueue: [], reviewQueueCount: 0, myRevisions: [], reReviewDue: [], compliance: null };
  const ref = (v: any): DocRef => ({ documentId: String(v.documentId || ''), title: String(v.documentTitle || v.title || ''), versionNumber: String(v.versionNumber || ''), date: dayOf(v.createdAt) || undefined });
  const versionFields = ['documentId', 'documentTitle', 'versionNumber', 'status', 'createdAt', 'createdById', 'reviewDueDate'];
  const byStatus = async (status: string) => (await slim(db().collection('versions').where('companyId', '==', cid).where('status', '==', status), ...versionFields).get()).docs;

  const tasks: Promise<void>[] = [];

  if (canReview) {
    tasks.push(byStatus('IN_REVIEW').then((docs) => {
      const list = docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })).sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)));
      facts.reviewQueueCount = list.length;
      facts.reviewQueue = list.slice(0, 5).map(ref);
    }));
  }

  if (hasPerm(perms, 'doc.create')) {
    tasks.push(byStatus('REVISION_REQUIRED').then((docs) => {
      facts.myRevisions = docs.map((d: any) => d.data() as any).filter((v: any) => ids.includes(String(v.createdById))).map(ref);
    }));
  }

  // Published versions: re-review dates, and the set a pending acknowledgement must belong to (an older version's
  // pending record is stale once a newer version is published).
  let published: Promise<{ id: string; v: any }[]> | null = null;
  const publishedList = () => (published ||= byStatus('PUBLISHED').then((docs) => docs.map((d: any) => ({ id: d.id, v: d.data() as any }))));

  if (canAuthor) {
    const horizon = addDays(today, 30);
    tasks.push(publishedList().then((list) => {
      facts.reReviewDue = list.map(({ v }) => ({ v, due: dayOf(v.reviewDueDate) })).filter((x) => x.due && x.due <= horizon)
        .sort((a, b) => a.due.localeCompare(b.due))
        .map(({ v, due }) => ({ ...ref(v), date: due, overdue: due < today }));
    }));
  }

  if (canAck) {
    tasks.push((async () => {
      const [list, ...mine] = await Promise.all([
        publishedList(),
        ...ids.map((id) => db().collection('acknowledgments').where('companyId', '==', cid).where('employeeId', '==', id).get()),
      ]);
      const live = new Set(list.map((x) => x.id));
      const seen = new Set<string>();
      const pending: any[] = [];
      for (const snap of mine) {
        for (const d of snap.docs) {
          const a = d.data() as any;
          if (a.status !== 'PENDING' || seen.has(d.id)) continue;
          if (a.documentVersionId && !live.has(String(a.documentVersionId))) continue;
          seen.add(d.id);
          pending.push(a);
        }
      }
      facts.pendingAckCount = pending.length;
      facts.pendingAcks = pending.slice(0, 5).map((a) => ({ documentId: String(a.documentId || ''), title: String(a.documentTitle || ''), versionNumber: String(a.versionNumber || '') }));
    })());
  }

  if (canCompliance) {
    tasks.push((async () => {
      const [pending, done] = await Promise.all([
        db().collection('acknowledgments').where('companyId', '==', cid).where('status', '==', 'PENDING').get(),
        db().collection('acknowledgments').where('companyId', '==', cid).where('status', '==', 'ACKNOWLEDGED').get(),
      ]);
      facts.compliance = { total: pending.size + done.size, acknowledged: done.size, pending: pending.size };
    })());
  }

  await Promise.all(tasks);
  return facts;
}

const REQ_LABEL: Record<string, string> = {
  PENDING_ASSIGNMENT: 'To assign to HR',
  PENDING_HR: 'Awaiting your HR decision',
  PENDING_FOUNDER: 'Awaiting final approval',
  JD_DRAFT: 'Job descriptions to prepare',
};

async function hiringFacts(cid: string, perms: string[], ids: string[]): Promise<HiringFacts> {
  const snap = await slim(db().collection('requisitions').where('companyId', '==', cid), 'status', 'ownerHr', 'requestedBy', 'raisedBy').get();
  const reqs = snap.docs.map((d: any) => d.data() as any);
  const mine = (p: any) => !!p && ids.includes(String(p.id));
  const count = (status: string, pred: (r: any) => boolean = () => true) => reqs.filter((r: any) => r.status === status && pred(r)).length;
  const waiting: HiringFacts['waiting'] = [];
  if (hasPerm(perms, 'req.assign')) waiting.push({ status: 'PENDING_ASSIGNMENT', label: REQ_LABEL.PENDING_ASSIGNMENT, count: count('PENDING_ASSIGNMENT') });
  if (hasPerm(perms, 'req.hr_decide')) waiting.push({ status: 'PENDING_HR', label: REQ_LABEL.PENDING_HR, count: count('PENDING_HR', (r) => mine(r.ownerHr)) });
  if (hasPerm(perms, 'req.founder_decide')) waiting.push({ status: 'PENDING_FOUNDER', label: REQ_LABEL.PENDING_FOUNDER, count: count('PENDING_FOUNDER') });
  if (hasPerm(perms, 'req.manage_jd')) waiting.push({ status: 'JD_DRAFT', label: REQ_LABEL.JD_DRAFT, count: count('JD_DRAFT', (r) => mine(r.ownerHr)) });
  const seesAll = hasPerm(perms, 'req.view_all');
  const open = seesAll
    ? count('JOB_OPEN')
    : reqs.filter((r: any) => !['REJECTED', 'CLOSED'].includes(r.status) && (mine(r.requestedBy) || mine(r.raisedBy))).length;
  return { waiting, open };
}

async function me(headers: Record<string, any>): Promise<Result> {
  const ctx = await requireActiveTenant(headers);
  const today = istToday();
  // A platform administrator has no company, so there is no company home page to build.
  if (!ctx.companyId) return ok({ today, widgets: [] });
  const cid = ctx.companyId;
  const perms = ctx.perms;

  const person = await personByUid(cid, ctx.uid).catch(() => null);
  const ids = Array.from(new Set([ctx.uid, person?.docId].filter(Boolean) as string[]));

  const wantsDocs = hasAnyPerm(perms, ['doc.review', 'doc.publish', 'doc.create', 'doc.acknowledge', 'compliance.view']);
  const wantsHiring = hasAnyPerm(perms, HIRING_PERMS);
  const wantsAdmin = hasAnyPerm(perms, ADMIN_PERMS);

  const [leave, payroll, lifecycle, docs, hiring, activeEmployees] = await Promise.all([
    leaveFacts(headers),
    payrollFacts(headers, cid),
    lifecycleFacts(headers, cid),
    wantsDocs ? docFacts(cid, perms, ids, today).catch(() => null) : Promise.resolve(null),
    wantsHiring ? hiringFacts(cid, perms, ids).catch(() => null) : Promise.resolve(null),
    wantsAdmin
      ? db().collection('employees').where('companyId', '==', cid).get().then((s: any) => s.docs.filter((d: any) => d.get('active') !== false).length).catch(() => null)
      : Promise.resolve(null),
  ]);

  const input: DashboardInput = { perms, today, leave, payroll, lifecycle, docs, hiring, activeEmployees };
  return ok({ today, name: person?.name || '', widgets: buildWidgets(input) });
}

export async function routeDashboard(r: DashboardRequestIn): Promise<Result> {
  try {
    if (r.method === 'GET' && r.action === 'me') return await me(r.headers);
    return fail(404, `Unknown dashboard action: ${r.action}`);
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[dashboard] failed:', err);
    return fail(500, 'Could not load your dashboard.');
  }
}
