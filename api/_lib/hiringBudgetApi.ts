/**
 * Department hiring budgets, the budget check on a requisition, and the founder's final approval (which also issues the
 * Position ID). Reached through api/_lib/hiringRouter.ts as /api/recruitment/<action>:
 *
 *   budget-list          GET   departments with their budget, people in the team now and vacancies already approved
 *   budget-save          POST  set a department's approved headcount and CTC limit        (hiring.budget.manage)
 *   budget-check         GET   ?requisitionId=  the budget check for one requisition
 *   req-founder-approve  POST  founder approves: runs the check, needs a reason when it is not OK, issues the Position ID
 *
 * Collections (Admin SDK only, see firestore.rules): hiringBudgets (one document per company and department), counters
 * (running number for Position IDs). Every record carries a companyId and every query filters on it.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requirePermission, type AuthContext } from './authContext.js';
import { defaultPrefix } from './recruitmentData.js';
import {
  BUDGET_STATUS_LABEL, COMMITTED_STATUSES, cleanBudgetInput, deptKey, evaluateBudget, formatPositionId, requisitionMaxCtcLpa,
  type BudgetCheck,
} from '../../shared/hiringBudget.js';

export interface BudgetRequest {
  method: string;
  action: string;
  query: Record<string, any>;
  body?: any;
  headers: Record<string, any>;
}

type Result = { status: number; json: any };

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim().slice(0, max));
const budgetDocId = (cid: string, key: string) => `${cid}__${key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'dept'}`;

const READ_PERMS = ['hiring.budget.manage', 'req.founder_decide', 'req.hr_decide', 'req.assign', 'req.view_all'];

// ------------------------------------------------------------------ reading the numbers a check needs

interface BudgetDoc {
  companyId: string;
  departmentName: string;
  departmentKey: string;
  approvedHeadcount: number | null;
  maxCtcLpa: number | null;
  updatedBy?: string;
  updatedAt?: string;
  history?: { at: string; by: string; approvedHeadcount: number | null; maxCtcLpa: number | null }[];
}

async function loadBudgets(cid: string): Promise<Map<string, BudgetDoc>> {
  const snap = await db().collection('hiringBudgets').where('companyId', '==', cid).get();
  const out = new Map<string, BudgetDoc>();
  for (const d of snap.docs) {
    const b = d.data() as BudgetDoc;
    out.set(b.departmentKey || deptKey(b.departmentName), b);
  }
  return out;
}

/** People currently working in each department (active employees). */
async function loadHeadcount(cid: string): Promise<Map<string, number>> {
  const snap = await db().collection('employees').where('companyId', '==', cid).get();
  const out = new Map<string, number>();
  for (const d of snap.docs) {
    const e = d.data() as { active?: boolean; departmentName?: string };
    if (e.active === false) continue;
    const key = deptKey(e.departmentName);
    if (key) out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

/** Vacancies on requisitions the founder has already approved (job draft or open), per department. */
async function loadCommitted(cid: string, excludeId = ''): Promise<Map<string, number>> {
  const snap = await db().collection('requisitions').where('companyId', '==', cid).get();
  const out = new Map<string, number>();
  for (const d of snap.docs) {
    const r = d.data() as { id?: string; status?: string; departmentName?: string; vacancies?: number };
    if ((r.id || d.id) === excludeId) continue;
    if (!(COMMITTED_STATUSES as readonly string[]).includes(String(r.status))) continue;
    const key = deptKey(r.departmentName);
    const n = Math.max(0, Math.floor(Number(r.vacancies) || 0));
    if (key && n) out.set(key, (out.get(key) || 0) + n);
  }
  return out;
}

async function loadRequisition(cid: string, id: string): Promise<(Record<string, any> & { id: string }) | null> {
  if (!id) return null;
  const snap = await db().collection('requisitions').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, any>;
  return data.companyId === cid ? { ...data, id: snap.id } : null;
}

export async function budgetCheckFor(cid: string, req: Record<string, any>): Promise<BudgetCheck> {
  const key = deptKey(req.departmentName);
  const [budgets, headcount, committed] = await Promise.all([loadBudgets(cid), loadHeadcount(cid), loadCommitted(cid, String(req.id || ''))]);
  const b = budgets.get(key);
  return evaluateBudget({
    budget: b ? { approvedHeadcount: b.approvedHeadcount, maxCtcLpa: b.maxCtcLpa } : null,
    currentHeadcount: headcount.get(key) || 0,
    committedVacancies: committed.get(key) || 0,
    requestedVacancies: Number(req.vacancies) || 0,
    requestedCtcMaxLpa: requisitionMaxCtcLpa(req),
  });
}

/** Name and employee id of the person acting, from the employee record the server owns. */
async function whoIs(ctx: AuthContext): Promise<{ id: string; name: string }> {
  try {
    const snap = await db().collection('employees').where('authUid', '==', ctx.uid).limit(1).get();
    const d = snap.docs[0];
    const e = d?.data() as { companyId?: string; name?: string } | undefined;
    if (d && e && e.companyId === ctx.companyId) return { id: d.id, name: e.name || ctx.email };
  } catch (err) {
    console.warn('[HiringBudget] could not look up the acting person:', err);
  }
  return { id: ctx.uid, name: ctx.email || ctx.uid };
}

// ------------------------------------------------------------------ actions

async function listBudgets(cid: string): Promise<Result> {
  const [deptSnap, budgets, headcount, committed] = await Promise.all([
    db().collection('departments').where('companyId', '==', cid).get(),
    loadBudgets(cid),
    loadHeadcount(cid),
    loadCommitted(cid),
  ]);
  const seen = new Set<string>();
  const items: Record<string, any>[] = [];
  const add = (name: string) => {
    const key = deptKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const b = budgets.get(key);
    items.push({
      departmentName: name,
      approvedHeadcount: b?.approvedHeadcount ?? null,
      maxCtcLpa: b?.maxCtcLpa ?? null,
      currentHeadcount: headcount.get(key) || 0,
      committedVacancies: committed.get(key) || 0,
      updatedBy: b?.updatedBy || '',
      updatedAt: b?.updatedAt || '',
    });
  };
  for (const d of deptSnap.docs) add(String((d.data() as { name?: string }).name || ''));
  items.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return { status: 200, json: { success: true, items } };
}

async function saveBudget(ctx: AuthContext, body: any): Promise<Result> {
  const cid = ctx.companyId as string;
  const name = str(body?.departmentName, 200);
  if (!name) return { status: 400, json: { success: false, error: 'Choose a department.' } };
  const cleaned = cleanBudgetInput({ approvedHeadcount: body?.approvedHeadcount, maxCtcLpa: body?.maxCtcLpa });
  if (!cleaned.value) return { status: 400, json: { success: false, error: cleaned.error || 'Invalid budget.' } };

  // Only a department the company really has: this stops typos creating budgets nothing will ever match.
  const deptSnap = await db().collection('departments').where('companyId', '==', cid).get();
  const match = deptSnap.docs.find((d) => deptKey((d.data() as { name?: string }).name) === deptKey(name));
  if (!match) return { status: 404, json: { success: false, error: `There is no department called '${name}'.` } };
  const canonical = String((match.data() as { name?: string }).name);
  const key = deptKey(canonical);

  const who = await whoIs(ctx);
  const ref = db().collection('hiringBudgets').doc(budgetDocId(cid, key));
  const cur = await ref.get();
  const prev = cur.exists ? (cur.data() as BudgetDoc) : null;
  const at = nowIso();
  const doc: BudgetDoc = {
    companyId: cid,
    departmentName: canonical,
    departmentKey: key,
    approvedHeadcount: cleaned.value.approvedHeadcount,
    maxCtcLpa: cleaned.value.maxCtcLpa,
    updatedBy: who.name,
    updatedAt: at,
    history: [...(prev?.history || []), { at, by: who.name, approvedHeadcount: cleaned.value.approvedHeadcount, maxCtcLpa: cleaned.value.maxCtcLpa }].slice(-20),
  };
  await ref.set(doc);
  return { status: 200, json: { success: true } };
}

async function budgetCheck(ctx: AuthContext, query: Record<string, any>): Promise<Result> {
  const cid = ctx.companyId as string;
  const req = await loadRequisition(cid, str(query.requisitionId, 128));
  if (!req) return { status: 404, json: { success: false, error: 'Requisition not found.' } };
  return { status: 200, json: { success: true, check: await budgetCheckFor(cid, req) } };
}

/** Next Position ID for the company, from a counter that only ever goes up. */
async function companyPrefix(cid: string): Promise<string> {
  const snap = await db().collection('companies').doc(cid).get();
  const name = String((snap.data() as { name?: string } | undefined)?.name || '');
  return name ? defaultPrefix(name) : '';
}

async function founderApprove(ctx: AuthContext, body: any): Promise<Result> {
  const cid = ctx.companyId as string;
  const id = str(body?.requisitionId, 128);
  const comments = str(body?.comments, 2000);
  const first = await loadRequisition(cid, id);
  if (!first) return { status: 404, json: { success: false, error: 'Requisition not found.' } };
  if (first.status !== 'PENDING_FOUNDER') {
    return { status: 409, json: { success: false, error: 'This requisition is not waiting for the founder (it may already have been decided).' } };
  }

  const check = await budgetCheckFor(cid, first);
  if (check.overrideRequired && !comments) {
    return {
      status: 400,
      json: {
        success: false,
        overrideRequired: true,
        budgetCheck: check,
        error: `${BUDGET_STATUS_LABEL[check.status]}. Give a reason to approve it anyway.`,
      },
    };
  }

  const who = await whoIs(ctx);
  const prefix = await companyPrefix(cid);
  const year = new Date().getFullYear();
  const reqRef = db().collection('requisitions').doc(id);
  const counterRef = db().collection('counters').doc(`positionId_${cid}_${year}`);

  const saved = await db().runTransaction(async (t) => {
    const [reqSnap, counterSnap] = await Promise.all([t.get(reqRef), t.get(counterRef)]);
    const current = reqSnap.exists ? (reqSnap.data() as Record<string, any>) : null;
    if (!current || current.companyId !== cid) throw Object.assign(new Error('Requisition not found.'), { httpStatus: 404 });
    // Re-checked inside the transaction so two founders pressing Approve together cannot both succeed.
    if (current.status !== 'PENDING_FOUNDER') throw Object.assign(new Error('This requisition has already been decided.'), { httpStatus: 409 });

    let positionId = String(current.positionId || '');
    if (!positionId) {
      const next = (counterSnap.exists ? Number((counterSnap.data() as { n?: number }).n) || 0 : 0) + 1;
      t.set(counterRef, { companyId: cid, n: next, updatedAt: nowIso() });
      positionId = formatPositionId(prefix, year, next);
    }

    const at = nowIso();
    const decision = { decision: 'APPROVED', byId: who.id, byName: who.name, at, comments };
    const events = Array.isArray(current.events) ? current.events : [];
    const note = comments || '';
    const action = check.overrideRequired
      ? `Founder approved with a budget exception (${BUDGET_STATUS_LABEL[check.status]}). Position ID ${positionId}`
      : `Founder approved the requisition. Position ID ${positionId}`;
    const event: Record<string, any> = { at, action, byId: who.id, byName: who.name };
    if (note) event.note = note;

    const update = {
      status: 'JD_DRAFT',
      founderDecision: decision,
      positionId,
      budgetCheck: { ...check, overrideReason: check.overrideRequired ? comments : '' },
      events: [...events, event],
      updatedAt: at,
    };
    t.update(reqRef, update);
    return { ...current, id, ...update };
  }).catch((err: any) => {
    if (err?.httpStatus) return { __error: { status: err.httpStatus as number, message: String(err.message) } } as const;
    throw err;
  });

  if ('__error' in saved) return { status: saved.__error.status, json: { success: false, error: saved.__error.message } };
  return { status: 200, json: { success: true, requisition: saved, budgetCheck: check } };
}

// ------------------------------------------------------------------ router

const ACTIONS = new Set(['budget-list', 'budget-save', 'budget-check', 'req-founder-approve']);

/** Returns null when the action is not one of this file's, so the caller can try the next router. */
export async function routeHiringBudget(r: BudgetRequest): Promise<Result | null> {
  if (!ACTIONS.has(r.action)) return null;
  try {
    const isWrite = r.action === 'budget-save' || r.action === 'req-founder-approve';
    if (r.method !== (isWrite ? 'POST' : 'GET')) return { status: 405, json: { success: false, error: 'Method not allowed.' } };

    const perms = r.action === 'budget-save' ? ['hiring.budget.manage'] : r.action === 'req-founder-approve' ? ['req.founder_decide'] : READ_PERMS;
    const ctx = await requirePermission(r.headers, ...perms);
    if (!ctx.companyId) return { status: 403, json: { success: false, error: 'Open this as a company user.' } };

    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'budget-list': return await listBudgets(ctx.companyId);
      case 'budget-save': return await saveBudget(ctx, body);
      case 'budget-check': return await budgetCheck(ctx, r.query);
      default: return await founderApprove(ctx, body);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[HiringBudget] error:', err);
    return { status: 500, json: { success: false, error: err?.message || 'Hiring budget request failed.' } };
  }
}
