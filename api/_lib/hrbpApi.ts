/**
 * HR Business Partner (Phase 3) API, reached as /api/hrbp/<action>.
 *
 * One server-only collection, hrbpItems, told apart by `kind`; every record carries a companyId.
 *
 *   map-*      HRBP-001  employee business mapping (business unit, cost centre, client allocation, billable, HRBP)
 *   bu-*       HRBP-002  business units
 *   org / headcount / resource   HRBP-002..004  org structure, headcount against approved numbers, resource planning (computed)
 *   talent-*   HRBP-005  quarterly talent review (9-box, flight risk)
 *   kpi-*      HRBP-006  KPI governance
 *   pip-*      HRBP-007  performance improvement plan workflow
 *   survey-*   HRBP-008  anonymous pulse surveys (results hidden below 5 answers)
 *   recog-*    HRBP-009  peer recognition
 *   well-*     HRBP-010  wellness programs
 *   need-*     HRBP-011  training needs
 *   path-* / assign-*  HRBP-012  learning paths and assignments
 *   cert-*     HRBP-013  certification and compliance tracker
 *   retention-*, succ-*   retention and succession planning
 *   dash       leadership dashboard (computed)       me   my own HRBP details (everyone)
 *   prob-*, okr-*, promo-*, qc-*   probation, OKRs, promotions, quarterly review round (talentCycleApi.ts)
 */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { loadPeople, loadProfiles, notify, type Person } from './leaveCore.js';
import { routeCycle } from './talentCycleApi.js';
import {
  allocationSummary, certStatus, cleanAllocations, kpiAttainment, kpiStatus, nineBox, pipTransition, successionGap, surveyAggregate, validatePipPlan,
  PIP_FINAL, type PipAction, type PipStatus, type Readiness, type SurveyQuestion,
} from '../../shared/hrbpEngine.js';

export interface HrbpRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any> }
type Result = { status: number; json: any };
interface Item { id: string; companyId: string; kind: string; [k: string]: any }

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (list.includes(str(v, 40) as T) ? (str(v, 40) as T) : dflt);

const canManage = (ctx: AuthContext) => ctx.isCompanyAdmin || ctx.perms.includes('hrbp.manage');
const canView = (ctx: AuthContext) => canManage(ctx) || ctx.perms.includes('hrbp.view');

// ------------------------------------------------------------------ storage

async function listK(cid: string, kind: string): Promise<Item[]> {
  const s = await db().collection('hrbpItems').where('companyId', '==', cid).where('kind', '==', kind).get();
  return s.docs.map((d) => d.data() as Item);
}
async function getK(cid: string, id: string, kind: string): Promise<Item | null> {
  if (!id) return null;
  const s = await db().collection('hrbpItems').doc(id).get();
  const it = s.exists ? (s.data() as Item) : null;
  return it && it.companyId === cid && it.kind === kind ? it : null;
}
const putK = (it: Item) => db().collection('hrbpItems').doc(it.id).set(clean(it));
const newId = () => db().collection('hrbpItems').doc().id;

interface Ctx { ctx: AuthContext; cid: string; people: Person[]; byKey: Map<string, Person>; who: string }
async function load(ctx: AuthContext): Promise<Ctx> {
  const cid = ctx.companyId!;
  const people = await loadPeople(cid);
  const byKey = new Map<string, Person>();
  for (const p of people) { byKey.set(p.uid, p); byKey.set(p.docId, p); }
  const me = byKey.get(ctx.uid);
  return { ctx, cid, people, byKey, who: me?.name || ctx.email };
}
/** Employees are given by either id; both are looked up in this company's people only. */
const person = (c: Ctx, id: unknown): Person | null => { const p = c.byKey.get(str(id, 100)); return p && p.active ? p : null; };
const nameOf = (c: Ctx, uid?: string) => (uid ? c.byKey.get(uid)?.name || '' : '');
const quarterOf = (d = today()) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const isQuarter = (s: string) => /^\d{4}-Q[1-4]$/.test(s);

// ------------------------------------------------------------------ generic kinds

interface KindSpec {
  kind: string;
  /** Returns the fields to store, or an error. `prev` is the record being edited. */
  build: (b: any, c: Ctx, prev: Item | null) => { value?: Record<string, any>; error?: string };
  /** One record per this key (upsert) instead of always creating. */
  unique?: (v: Record<string, any>) => string;
  /** Adds computed fields when listing. */
  decorate?: (it: Item, c: Ctx) => Record<string, any>;
  read?: 'manage' | 'any';
  write?: 'manage';
}

const requirePerson = (c: Ctx, id: unknown): { p?: Person; error?: string } => { const p = person(c, id); return p ? { p } : { error: 'Choose an employee from your company.' }; };

const SPECS: Record<string, KindSpec> = {
  bu: {
    kind: 'businessUnit', unique: (v) => v.name.toLowerCase(),
    build: (b, c) => {
      const name = str(b.name, 80);
      if (!name) return { error: 'Give the business unit a name.' };
      const head = b.headUid ? person(c, b.headUid) : null;
      if (b.headUid && !head) return { error: 'The head must be an employee of your company.' };
      return { value: { name, headUid: head?.uid || '', headName: head?.name || '', description: str(b.description, 300) } };
    },
  },
  map: {
    kind: 'mapping', unique: (v) => v.employeeUid, read: 'manage',
    build: (b, c) => {
      const r = requirePerson(c, b.employeeUid);
      if (!r.p) return { error: r.error };
      const hr = b.hrbpUid ? person(c, b.hrbpUid) : null;
      if (b.hrbpUid && !hr) return { error: 'The HRBP must be an employee of your company.' };
      const alloc = cleanAllocations(b.clientAllocation);
      if (!alloc.value) return { error: alloc.error };
      const billable = b.billable === true || b.billable === 'true';
      if (!billable && alloc.value.length) return { error: 'A non-billable person cannot have client allocations. Mark them billable first.' };
      if (allocationSummary(alloc.value, billable).total > 150) return { error: 'Allocations add up to more than 150 percent. Check the numbers.' };
      return { value: {
        employeeUid: r.p.uid, employeeName: r.p.name, businessUnit: str(b.businessUnit, 80), costCentre: str(b.costCentre, 40), clientAllocation: alloc.value, billable,
        hrbpUid: hr?.uid || '', hrbpName: hr?.name || '', employmentStatus: oneOf(b.employmentStatus, ['PROBATION', 'CONFIRMED', 'NOTICE', 'CONTRACT'] as const, 'CONFIRMED'),
        managerUid: b.managerUid ? person(c, b.managerUid)?.uid || '' : '', notes: str(b.notes, 500),
      } };
    },
  },
  talent: {
    kind: 'talentReview', unique: (v) => `${v.employeeUid}__${v.quarter}`, read: 'manage',
    build: (b, c) => {
      const r = requirePerson(c, b.employeeUid);
      if (!r.p) return { error: r.error };
      const quarter = str(b.quarter, 10) || quarterOf();
      if (!isQuarter(quarter)) return { error: 'Quarter must look like 2026-Q4.' };
      const performance = num(b.performance), potential = num(b.potential);
      if (!nineBox(performance as number, potential as number)) return { error: 'Rate performance and potential from 1 (low) to 3 (high).' };
      return { value: { employeeUid: r.p.uid, employeeName: r.p.name, quarter, performance, potential, flightRisk: oneOf(b.flightRisk, ['LOW', 'MEDIUM', 'HIGH'] as const, 'LOW'), readiness: str(b.readiness, 60), notes: str(b.notes, 1500) } };
    },
    decorate: (it) => ({ box: nineBox(it.performance, it.potential) }),
  },
  kpi: {
    kind: 'kpi', read: 'manage',
    build: (b, c, prev) => {
      const scope = oneOf(b.scope, ['EMPLOYEE', 'DEPARTMENT'] as const, 'EMPLOYEE');
      let owner: Record<string, any> = {};
      if (scope === 'EMPLOYEE') {
        const r = requirePerson(c, b.employeeUid);
        if (!r.p) return { error: r.error };
        owner = { employeeUid: r.p.uid, employeeName: r.p.name, department: r.p.department };
      } else {
        const d = str(b.department, 80);
        if (!d) return { error: 'Choose a department.' };
        owner = { employeeUid: '', employeeName: '', department: d };
      }
      const name = str(b.name, 120);
      const target = num(b.target);
      if (!name) return { error: 'Name the KPI.' };
      if (target === null || target <= 0) return { error: 'Target must be a number above zero.' };
      const actual = b.actual === undefined ? prev?.actual ?? null : num(b.actual);
      if (actual !== null && actual < 0) return { error: 'Actual cannot be negative.' };
      const period = str(b.period, 10) || quarterOf();
      return { value: { scope, ...owner, name, unit: str(b.unit, 20), direction: oneOf(b.direction, ['HIGHER', 'LOWER'] as const, 'HIGHER'), target, actual, period, updatedAt: nowIso() } };
    },
    decorate: (it) => { const a = kpiAttainment(it.target, it.actual, it.direction); return { attainment: a, status: kpiStatus(a) }; },
  },
  need: {
    kind: 'trainingNeed', read: 'manage',
    build: (b, c) => {
      const r = requirePerson(c, b.employeeUid);
      if (!r.p) return { error: r.error };
      const skill = str(b.skill, 120);
      if (!skill) return { error: 'Name the skill or topic.' };
      return { value: { employeeUid: r.p.uid, employeeName: r.p.name, skill, source: oneOf(b.source, ['REVIEW', 'MANAGER', 'SELF', 'PIP', 'OTHER'] as const, 'MANAGER'), priority: oneOf(b.priority, ['LOW', 'MEDIUM', 'HIGH'] as const, 'MEDIUM'), status: oneOf(b.status, ['OPEN', 'PLANNED', 'DONE'] as const, 'OPEN'), notes: str(b.notes, 500) } };
    },
  },
  path: {
    kind: 'learningPath', read: 'any',
    build: (b) => {
      const name = str(b.name, 120);
      if (!name) return { error: 'Name the learning path.' };
      const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 20).map((s: any) => ({ title: str(s?.title, 120), type: oneOf(s?.type, ['COURSE', 'READING', 'PROJECT', 'CERTIFICATION'] as const, 'COURSE'), hours: Math.max(0, Math.min(500, num(s?.hours) ?? 0)) }));
      if (!steps.length || steps.some((s: any) => !s.title)) return { error: 'Add at least one step, and give every step a title.' };
      return { value: { name, role: str(b.role, 80), steps } };
    },
  },
  cert: {
    kind: 'cert', read: 'manage',
    build: (b, c) => {
      const r = requirePerson(c, b.employeeUid);
      if (!r.p) return { error: r.error };
      const name = str(b.name, 120);
      if (!name) return { error: 'Name the certificate or compliance item.' };
      const issuedOn = str(b.issuedOn, 10), expiresOn = str(b.expiresOn, 10);
      if ((issuedOn && !isDate(issuedOn)) || (expiresOn && !isDate(expiresOn))) return { error: 'Dates must look like 2026-12-31.' };
      if (issuedOn && expiresOn && expiresOn < issuedOn) return { error: 'The expiry date is before the issue date.' };
      return { value: { employeeUid: r.p.uid, employeeName: r.p.name, name, issuer: str(b.issuer, 120), issuedOn, expiresOn, mandatory: b.mandatory === true || b.mandatory === 'true' } };
    },
    decorate: (it) => ({ status: certStatus(it.expiresOn, today()) }),
  },
  retention: {
    kind: 'retention', unique: (v) => v.employeeUid, read: 'manage',
    build: (b, c) => {
      const r = requirePerson(c, b.employeeUid);
      if (!r.p) return { error: r.error };
      const owner = b.ownerUid ? person(c, b.ownerUid) : null;
      const review = str(b.reviewOn, 10);
      if (review && !isDate(review)) return { error: 'Review date must look like 2026-12-31.' };
      return { value: { employeeUid: r.p.uid, employeeName: r.p.name, risk: oneOf(b.risk, ['LOW', 'MEDIUM', 'HIGH'] as const, 'MEDIUM'), reasons: str(b.reasons, 800), actions: str(b.actions, 1500), ownerUid: owner?.uid || '', ownerName: owner?.name || '', status: oneOf(b.status, ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'LEFT'] as const, 'OPEN'), reviewOn: review } };
    },
  },
  succ: {
    kind: 'succession', unique: (v) => v.role.toLowerCase(), read: 'manage',
    build: (b, c) => {
      const role = str(b.role, 100);
      if (!role) return { error: 'Name the role.' };
      const inc = b.incumbentUid ? person(c, b.incumbentUid) : null;
      const successors: { employeeUid: string; employeeName: string; readiness: Readiness }[] = [];
      for (const s of (Array.isArray(b.successors) ? b.successors : []).slice(0, 5)) {
        const p = person(c, s?.employeeUid);
        if (!p) return { error: 'Every successor must be an employee of your company.' };
        if (inc && p.uid === inc.uid) return { error: 'A person cannot be their own successor.' };
        if (successors.some((x) => x.employeeUid === p.uid)) return { error: `${p.name} is listed twice.` };
        successors.push({ employeeUid: p.uid, employeeName: p.name, readiness: oneOf(s?.readiness, ['READY_NOW', 'ONE_TO_TWO_YEARS', 'THREE_PLUS_YEARS'] as const, 'THREE_PLUS_YEARS') });
      }
      return { value: { role, incumbentUid: inc?.uid || '', incumbentName: inc?.name || '', critical: b.critical === true || b.critical === 'true', successors, notes: str(b.notes, 800) } };
    },
    decorate: (it) => ({ gap: successionGap({ critical: !!it.critical, successors: it.successors || [] }) }),
  },
  well: {
    kind: 'wellness', read: 'any',
    build: (b, _c, prev) => {
      const title = str(b.title, 120);
      if (!title) return { error: 'Give the program a title.' };
      const date = str(b.date, 10);
      if (date && !isDate(date)) return { error: 'Date must look like 2026-12-31.' };
      return { value: { title, type: oneOf(b.type, ['EVENT', 'PROGRAM', 'CHALLENGE'] as const, 'EVENT'), date, description: str(b.description, 800), active: b.active !== false, participants: prev?.participants || [] } };
    },
  },
};

async function genericList(spec: KindSpec, c: Ctx, q: any): Promise<Result> {
  let items = await listK(c.cid, spec.kind);
  if (q.employeeUid) { const p = person(c, q.employeeUid) || c.byKey.get(str(q.employeeUid, 100)); items = items.filter((i) => i.employeeUid === p?.uid); }
  if (q.quarter) items = items.filter((i) => i.quarter === String(q.quarter));
  const out = items.map((i) => ({ ...i, ...(spec.decorate ? spec.decorate(i, c) : {}) }));
  // Wellness: a person sees whether they joined, never who else did.
  if (spec.kind === 'wellness') {
    const m = canManage(c.ctx);
    return ok({ items: out.map(({ participants, ...r }: any) => ({ ...r, joined: (participants || []).includes(c.ctx.uid), participantCount: (participants || []).length, ...(m ? { participants } : {}) })) });
  }
  return ok({ items: out.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))) });
}

async function genericSave(spec: KindSpec, c: Ctx, b: any): Promise<Result> {
  const prev = b.id ? await getK(c.cid, str(b.id, 100), spec.kind) : null;
  if (b.id && !prev) return fail(404, 'Not found.');
  const built = spec.build(b, c, prev);
  if (!built.value) return fail(400, built.error || 'Not valid.');
  let existing = prev;
  if (!existing && spec.unique) {
    const key = spec.unique(built.value);
    existing = (await listK(c.cid, spec.kind)).find((i) => spec.unique!(i as any) === key) || null;
  }
  const it: Item = { ...(existing || {}), ...built.value, id: existing?.id || newId(), companyId: c.cid, kind: spec.kind, createdAt: existing?.createdAt || nowIso(), createdBy: existing?.createdBy || c.who, updatedAt: nowIso(), updatedBy: c.who };
  await putK(it);
  return ok({ item: { ...it, ...(spec.decorate ? spec.decorate(it, c) : {}) } });
}

async function genericDelete(spec: KindSpec, c: Ctx, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 100), spec.kind);
  if (!it) return fail(404, 'Not found.');
  await db().collection('hrbpItems').doc(it.id).delete();
  return ok();
}

// ------------------------------------------------------------------ PIP workflow

const PIP_NOTIFY = 'Performance improvement plan';

async function pipList(c: Ctx, q: any): Promise<Result> {
  let items = await listK(c.cid, 'pip');
  if (q.employeeUid) items = items.filter((i) => i.employeeUid === String(q.employeeUid));
  return ok({ items: items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
}

async function pipSave(c: Ctx, b: any): Promise<Result> {
  const prev = b.id ? await getK(c.cid, str(b.id, 100), 'pip') : null;
  if (b.id && !prev) return fail(404, 'Plan not found.');
  if (prev && prev.status !== 'DRAFT') return fail(409, 'Only a draft plan can be edited. Use check-ins and extensions for a running plan.');
  const p = prev ? person(c, prev.employeeUid) : person(c, b.employeeUid);
  if (!p) return fail(400, 'Choose an employee from your company.');
  const goals = (Array.isArray(b.goals) ? b.goals : []).map((g: any) => ({ text: str(g?.text, 300), dueOn: str(g?.dueOn, 10), done: false }));
  const plan = { startOn: str(b.startOn, 10), endOn: str(b.endOn, 10), reason: str(b.reason, 1500), goals };
  const err = validatePipPlan(plan);
  if (err) return fail(400, err);
  if (!prev && (await listK(c.cid, 'pip')).some((i) => i.employeeUid === p.uid && !PIP_FINAL.includes(i.status))) return fail(409, `${p.name} already has an open improvement plan.`);
  const mgr = (await loadProfiles(c.cid)).get(p.uid)?.managerUid || '';
  const it: Item = {
    ...(prev || {}), id: prev?.id || newId(), companyId: c.cid, kind: 'pip', employeeUid: p.uid, employeeName: p.name, managerUid: mgr, managerName: nameOf(c, mgr), ...plan,
    status: 'DRAFT', checkins: prev?.checkins || [], events: [...(prev?.events || []), { at: nowIso(), by: c.who, action: prev ? 'Edited draft' : 'Created draft' }],
    createdAt: prev?.createdAt || nowIso(), updatedAt: nowIso(),
  };
  await putK(it);
  return ok({ item: it });
}

async function pipAct(c: Ctx, b: any): Promise<Result> {
  const id = str(b.id, 100);
  const action = str(b.action, 20) as PipAction;
  const note = str(b.note, 1500);
  if (['fail', 'cancel', 'extend', 'complete'].includes(action) && !note) return fail(400, 'Add a note explaining the decision.');
  if (action === 'extend' && (!isDate(str(b.endOn, 10)))) return fail(400, 'Give the new end date.');
  const ref = db().collection('hrbpItems').doc(id);
  const res = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as Item) : null;
    if (!cur || cur.companyId !== c.cid || cur.kind !== 'pip') return { err: fail(404, 'Plan not found.') };
    const t = pipTransition(cur.status as PipStatus, action);
    if (!t.ok) return { err: fail(409, t.error || 'Not allowed.') };
    const next: Item = { ...cur, events: [...cur.events, { at: nowIso(), by: c.who, action, note }], updatedAt: nowIso() };
    if (t.to) next.status = t.to;
    if (action === 'checkin') {
      const rating = num(b.rating);
      if (rating !== null && (rating < 1 || rating > 5)) return { err: fail(400, 'Rating must be 1 to 5.') };
      if (!note) return { err: fail(400, 'Add a note for the check-in.') };
      const doneIdx: number[] = Array.isArray(b.goalsDone) ? b.goalsDone.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < cur.goals.length) : [];
      next.goals = cur.goals.map((g: any, i: number) => ({ ...g, done: doneIdx.includes(i) ? true : g.done }));
      next.checkins = [...cur.checkins, { at: nowIso(), by: c.who, note, rating }];
    }
    if (action === 'extend') {
      if (str(b.endOn, 10) <= cur.endOn) return { err: fail(400, 'The new end date must be after the current one.') };
      if ((new Date(str(b.endOn, 10)).getTime() - new Date(cur.startOn).getTime()) / 86400000 > 180) return { err: fail(400, 'A plan cannot run beyond 180 days in total.') };
      next.endOn = str(b.endOn, 10);
    }
    if (action === 'complete' && next.goals.some((g: any) => !g.done) && !b.confirmIncomplete) return { err: fail(409, 'Some goals are not marked done. Confirm to complete anyway.', { needsConfirm: true }) };
    tx.set(ref, clean(next));
    return { next };
  });
  if ('err' in res && res.err) return res.err;
  const next = (res as { next: Item }).next;
  if (action === 'start') {
    const emp = c.byKey.get(next.employeeUid);
    const mgr = c.byKey.get(next.managerUid);
    await notify(c.cid, [emp?.email || '', mgr?.email || ''], `${PIP_NOTIFY} started`, `Hello,\n\nA performance improvement plan has started for ${next.employeeName} (${next.startOn} to ${next.endOn}).\nReason: ${next.reason}\n\nGoals:\n${next.goals.map((g: any) => `- ${g.text}${g.dueOn ? ` (by ${g.dueOn})` : ''}`).join('\n')}\n\nThe plan is a support structure with regular check-ins. Please speak to your HR business partner with any questions.`);
  }
  return ok({ item: next });
}

// ------------------------------------------------------------------ surveys (anonymous)

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

async function surveyList(c: Ctx): Promise<Result> {
  const surveys = await listK(c.cid, 'survey');
  const mine = new Set((await db().collection('hrbpItems').where('companyId', '==', c.cid).where('kind', '==', 'surveyDone').get()).docs.filter((d) => d.get('uidHash') === hash(`${c.cid}:${c.ctx.uid}`)).map((d) => d.get('surveyId')));
  const manage = canManage(c.ctx);
  const rows = surveys.filter((s) => manage || s.status === 'OPEN').map((s) => ({ id: s.id, title: s.title, status: s.status, questions: s.questions, closesOn: s.closesOn || '', createdAt: s.createdAt, answered: mine.has(s.id) }));
  return ok({ items: rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
}

async function surveySave(c: Ctx, b: any): Promise<Result> {
  const title = str(b.title, 120);
  if (!title) return fail(400, 'Give the survey a title.');
  const qs: SurveyQuestion[] = (Array.isArray(b.questions) ? b.questions : []).slice(0, 15).map((q: any, i: number) => ({ id: `q${i + 1}`, text: str(q?.text, 200), type: q?.type === 'text' ? 'text' : 'scale' }));
  if (!qs.length || qs.some((q) => !q.text)) return fail(400, 'Add at least one question, and write every question.');
  const closesOn = str(b.closesOn, 10);
  if (closesOn && !isDate(closesOn)) return fail(400, 'Closing date must look like 2026-12-31.');
  const it: Item = { id: newId(), companyId: c.cid, kind: 'survey', title, questions: qs, closesOn, status: 'OPEN', createdAt: nowIso(), createdBy: c.who };
  await putK(it);
  return ok({ item: it });
}

async function surveyClose(c: Ctx, b: any): Promise<Result> {
  const s = await getK(c.cid, str(b.id, 100), 'survey');
  if (!s) return fail(404, 'Survey not found.');
  await putK({ ...s, status: 'CLOSED', closedAt: nowIso() });
  return ok();
}

async function surveyRespond(c: Ctx, b: any): Promise<Result> {
  const s = await getK(c.cid, str(b.surveyId, 100), 'survey');
  if (!s || s.status !== 'OPEN') return fail(404, 'This survey is not open.');
  if (s.closesOn && s.closesOn < today()) return fail(409, 'This survey has closed.');
  const answers: Record<string, any> = {};
  for (const q of s.questions as SurveyQuestion[]) {
    const v = b.answers?.[q.id];
    if (q.type === 'scale') {
      const n = Number(v);
      if (v === undefined || v === '' || !Number.isInteger(n) || n < 1 || n > 5) return fail(400, `Answer "${q.text}" from 1 to 5.`);
      answers[q.id] = n;
    } else answers[q.id] = str(v, 1000);
  }
  // The marker says "this person answered"; the response itself carries no identity and only the day, not the time.
  const markerRef = db().collection('hrbpItems').doc(`${c.cid}__done__${s.id}__${hash(`${c.cid}:${c.ctx.uid}`)}`);
  const respRef = db().collection('hrbpItems').doc();
  const res = await db().runTransaction(async (tx: any) => {
    const m = await tx.get(markerRef);
    if (m.exists) return false;
    tx.set(markerRef, { id: markerRef.id, companyId: c.cid, kind: 'surveyDone', surveyId: s.id, uidHash: hash(`${c.cid}:${c.ctx.uid}`) });
    tx.set(respRef, { id: respRef.id, companyId: c.cid, kind: 'surveyResponse', surveyId: s.id, answers, day: today() });
    return true;
  });
  return res ? ok() : fail(409, 'You have already answered this survey.');
}

async function surveyResults(c: Ctx, q: any): Promise<Result> {
  const s = await getK(c.cid, str(q.surveyId, 100), 'survey');
  if (!s) return fail(404, 'Survey not found.');
  const snap = await db().collection('hrbpItems').where('companyId', '==', c.cid).where('kind', '==', 'surveyResponse').get();
  const responses = snap.docs.map((d) => d.data() as Item).filter((r) => r.surveyId === s.id).map((r) => ({ answers: r.answers }));
  const people = c.people.filter((p) => p.active).length;
  return ok({ survey: { id: s.id, title: s.title, status: s.status }, participation: { responses: responses.length, people, percent: people ? Math.round((responses.length / people) * 100) : 0 }, results: surveyAggregate(s.questions, responses) });
}

// ------------------------------------------------------------------ recognition and wellness

export const VALUES = ['Ownership', 'Teamwork', 'Customer first', 'Innovation', 'Integrity'] as const;

async function recogList(c: Ctx): Promise<Result> {
  const items = (await listK(c.cid, 'recognition')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60);
  return ok({ items, values: VALUES });
}

async function recogGive(c: Ctx, b: any): Promise<Result> {
  const to = person(c, b.toUid);
  if (!to) return fail(400, 'Choose a colleague.');
  if (to.uid === c.ctx.uid) return fail(400, 'You cannot recognise yourself.');
  const value = oneOf(b.value, VALUES, 'Teamwork');
  const message = str(b.message, 500);
  if (message.length < 10) return fail(400, 'Say what they did, in at least a sentence.');
  const day = today();
  const mine = (await listK(c.cid, 'recognition')).filter((r) => r.fromUid === c.ctx.uid && String(r.createdAt).slice(0, 10) === day);
  if (mine.length >= 5) return fail(429, 'You have given five recognitions today. Come back tomorrow.');
  const it: Item = { id: newId(), companyId: c.cid, kind: 'recognition', fromUid: c.ctx.uid, fromName: c.who, toUid: to.uid, toName: to.name, value, message, createdAt: nowIso() };
  await putK(it);
  await notify(c.cid, [to.email], `${c.who} recognised you`, `Hello ${to.name},\n\n${c.who} recognised you for "${value}":\n\n${message}\n\nWell done!`);
  return ok({ item: it });
}

async function wellJoin(c: Ctx, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 100), 'wellness');
  if (!it || !it.active) return fail(404, 'Program not found.');
  const set = new Set<string>(it.participants || []);
  if (b.leave) set.delete(c.ctx.uid); else set.add(c.ctx.uid);
  await putK({ ...it, participants: [...set] });
  return ok({ joined: set.has(c.ctx.uid) });
}

// ------------------------------------------------------------------ learning assignments

async function assignList(c: Ctx, q: any): Promise<Result> {
  let items = await listK(c.cid, 'learningAssign');
  if (!canManage(c.ctx)) items = items.filter((i) => i.employeeUid === c.ctx.uid);
  else if (q.employeeUid) items = items.filter((i) => i.employeeUid === String(q.employeeUid));
  const paths = new Map((await listK(c.cid, 'learningPath')).map((p) => [p.id, p]));
  return ok({ items: items.map((i) => { const p = paths.get(i.pathId); return { ...i, pathName: p?.name || '(removed)', steps: p?.steps || [], percent: p?.steps?.length ? Math.round(((i.done || []).length / p.steps.length) * 100) : 0 }; }) });
}

async function pathAssign(c: Ctx, b: any): Promise<Result> {
  const path = await getK(c.cid, str(b.pathId, 100), 'learningPath');
  if (!path) return fail(404, 'Learning path not found.');
  const ids: string[] = Array.isArray(b.employeeUids) ? b.employeeUids : [];
  if (!ids.length) return fail(400, 'Choose at least one employee.');
  const dueOn = str(b.dueOn, 10);
  if (dueOn && !isDate(dueOn)) return fail(400, 'Due date must look like 2026-12-31.');
  const existing = await listK(c.cid, 'learningAssign');
  const made: Item[] = [];
  for (const id of new Set(ids)) {
    const p = person(c, id);
    if (!p) return fail(400, 'One of the employees was not found in your company.');
    if (existing.some((e) => e.pathId === path.id && e.employeeUid === p.uid)) continue;
    const it: Item = { id: newId(), companyId: c.cid, kind: 'learningAssign', pathId: path.id, employeeUid: p.uid, employeeName: p.name, done: [], dueOn, assignedAt: nowIso(), assignedBy: c.who };
    await putK(it);
    made.push(it);
  }
  if (made.length) await notify(c.cid, made.map((m) => c.byKey.get(m.employeeUid)?.email || ''), `New learning path: ${path.name}`, `Hello,\n\nYou have been assigned the learning path "${path.name}" (${path.steps.length} steps).${dueOn ? `\nPlease complete it by ${dueOn}.` : ''}\n\nOpen HR Business Partner > My development to see the steps and tick them off.`);
  return ok({ assigned: made.length, skipped: ids.length - made.length });
}

async function pathProgress(c: Ctx, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 100), 'learningAssign');
  if (!it) return fail(404, 'Not found.');
  if (it.employeeUid !== c.ctx.uid && !canManage(c.ctx)) return fail(403, 'This is not your learning path.');
  const path = await getK(c.cid, it.pathId, 'learningPath');
  const step = Number(b.step);
  if (!path || !Number.isInteger(step) || step < 0 || step >= path.steps.length) return fail(400, 'Step not found.');
  const done = new Set<number>(it.done || []);
  if (b.done === false) done.delete(step); else done.add(step);
  await putK({ ...it, done: [...done].sort((a, b2) => a - b2), updatedAt: nowIso() });
  return ok({ percent: Math.round((done.size / path.steps.length) * 100) });
}

// ------------------------------------------------------------------ computed views

async function mappingsByUid(cid: string) { return new Map((await listK(cid, 'mapping')).map((m) => [m.employeeUid as string, m])); }

async function orgView(c: Ctx): Promise<Result> {
  const [maps, units, profiles] = await Promise.all([mappingsByUid(c.cid), listK(c.cid, 'businessUnit'), loadProfiles(c.cid)]);
  const active = c.people.filter((p) => p.active && profiles.get(p.uid)?.hidden !== true);
  const bu = new Map<string, { name: string; head: string; people: number; billable: number; departments: Record<string, number>; hrbps: Set<string> }>();
  const slot = (name: string) => { if (!bu.has(name)) bu.set(name, { name, head: '', people: 0, billable: 0, departments: {}, hrbps: new Set() }); return bu.get(name)!; };
  units.forEach((u) => { slot(u.name).head = u.headName || ''; });
  let unmapped = 0;
  for (const p of active) {
    const m = maps.get(p.uid);
    if (!m) { unmapped++; continue; }
    const s = slot(m.businessUnit || 'No business unit');
    s.people++;
    if (m.billable) s.billable++;
    s.departments[p.department || 'No department'] = (s.departments[p.department || 'No department'] || 0) + 1;
    if (m.hrbpName) s.hrbps.add(m.hrbpName);
  }
  const hrbpLoad: Record<string, number> = {};
  maps.forEach((m) => { if (m.hrbpName) hrbpLoad[m.hrbpName] = (hrbpLoad[m.hrbpName] || 0) + 1; });
  return ok({ units: [...bu.values()].map((u) => ({ ...u, hrbps: [...u.hrbps] })), unmapped, total: active.length, hrbpLoad });
}

async function headcountView(c: Ctx): Promise<Result> {
  const [maps, budgets, reqs, profiles] = await Promise.all([
    mappingsByUid(c.cid),
    db().collection('hiringBudgets').where('companyId', '==', c.cid).get(),
    db().collection('requisitions').where('companyId', '==', c.cid).get(),
    loadProfiles(c.cid),
  ]);
  const active = c.people.filter((p) => p.active && profiles.get(p.uid)?.hidden !== true);
  const rows = new Map<string, { department: string; headcount: number; billable: number; approved: number | null; openVacancies: number }>();
  const slot = (d: string) => { const k = d || 'No department'; if (!rows.has(k)) rows.set(k, { department: k, headcount: 0, billable: 0, approved: null, openVacancies: 0 }); return rows.get(k)!; };
  for (const p of active) { const s = slot(p.department); s.headcount++; if (maps.get(p.uid)?.billable) s.billable++; }
  budgets.docs.forEach((d) => { const s = slot(String(d.get('departmentName'))); s.approved = d.get('approvedHeadcount') ?? null; });
  reqs.docs.forEach((d) => { if (['JD_DRAFT', 'JOB_OPEN'].includes(d.get('status'))) slot(String(d.get('departmentName'))).openVacancies += Number(d.get('vacancies')) || 0; });
  const out = [...rows.values()].map((r) => ({ ...r, gap: r.approved === null ? null : r.approved - r.headcount - r.openVacancies })).sort((a, b) => a.department.localeCompare(b.department));
  return ok({ rows: out, total: { headcount: out.reduce((a, r) => a + r.headcount, 0), billable: out.reduce((a, r) => a + r.billable, 0), openVacancies: out.reduce((a, r) => a + r.openVacancies, 0) } });
}

async function resourceView(c: Ctx): Promise<Result> {
  const maps = await listK(c.cid, 'mapping');
  const clients = new Map<string, number>();
  const people = maps.filter((m) => c.byKey.get(m.employeeUid)?.active).map((m) => {
    const s = allocationSummary(m.clientAllocation || [], !!m.billable);
    (m.clientAllocation || []).forEach((a: any) => clients.set(a.client, (clients.get(a.client) || 0) + a.percent / 100));
    return { employeeUid: m.employeeUid, name: m.employeeName, businessUnit: m.businessUnit, total: s.total, state: s.state, clients: (m.clientAllocation || []).map((a: any) => `${a.client} ${a.percent}%`) };
  });
  const count = (st: string) => people.filter((p) => p.state === st).length;
  return ok({ people, bench: people.filter((p) => p.state === 'BENCH'), over: people.filter((p) => p.state === 'OVER'), summary: { over: count('OVER'), full: count('FULL'), partial: count('PARTIAL'), bench: count('BENCH'), nonBillable: count('NON_BILLABLE') }, clients: [...clients].map(([client, fte]) => ({ client, fte: Math.round(fte * 100) / 100 })).sort((a, b) => b.fte - a.fte) });
}

async function dashboard(c: Ctx): Promise<Result> {
  const [org, head, res, kpis, pips, talent, retention, succ, certs, surveys, recog] = await Promise.all([
    orgView(c), headcountView(c), resourceView(c), listK(c.cid, 'kpi'), listK(c.cid, 'pip'), listK(c.cid, 'talentReview'), listK(c.cid, 'retention'), listK(c.cid, 'succession'), listK(c.cid, 'cert'), listK(c.cid, 'survey'), listK(c.cid, 'recognition'),
  ]);
  const quarter = quarterOf();
  const qTalent = talent.filter((t) => t.quarter === quarter);
  const kpiStatuses = kpis.filter((k) => k.period === quarter).map((k) => kpiStatus(kpiAttainment(k.target, k.actual, k.direction)));
  const latestSurvey = surveys.filter((s) => s.status === 'CLOSED' || s.status === 'OPEN').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  let pulse: any = null;
  if (latestSurvey) { const r = (await surveyResults(c, { surveyId: latestSurvey.id })).json; pulse = { title: latestSurvey.title, participation: r.participation, overall: r.results?.visible ? r.results.overall : null, hidden: !r.results?.visible }; }
  const critical = succ.filter((s) => s.critical);
  return ok({
    quarter,
    headcount: head.json.total, org: { unmapped: org.json.unmapped, units: org.json.units.length },
    resource: res.json.summary,
    talent: { reviewed: qTalent.length, highRisk: qTalent.filter((t) => t.flightRisk === 'HIGH').length, stars: qTalent.filter((t) => t.performance === 3 && t.potential === 3).length },
    kpi: { green: kpiStatuses.filter((s) => s === 'GREEN').length, amber: kpiStatuses.filter((s) => s === 'AMBER').length, red: kpiStatuses.filter((s) => s === 'RED').length },
    pip: { active: pips.filter((p) => p.status === 'ACTIVE' || p.status === 'EXTENDED').length, draft: pips.filter((p) => p.status === 'DRAFT').length },
    retention: { open: retention.filter((r) => r.status === 'OPEN' || r.status === 'IN_PROGRESS').length, highRisk: retention.filter((r) => r.risk === 'HIGH' && r.status !== 'RESOLVED' && r.status !== 'LEFT').length },
    succession: { criticalRoles: critical.length, withoutSuccessor: critical.filter((s) => successionGap({ critical: true, successors: s.successors || [] }) === 'NO_SUCCESSOR').length },
    certs: { expired: certs.filter((x) => certStatus(x.expiresOn, today()) === 'EXPIRED').length, expiring: certs.filter((x) => certStatus(x.expiresOn, today()) === 'EXPIRING').length },
    pulse, recognitionLast30: recog.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 30 * 86400000).length,
    attention: [
      ...(org.json.unmapped ? [`${org.json.unmapped} employee(s) have no business mapping or HRBP yet`] : []),
      ...(res.json.summary.over ? [`${res.json.summary.over} person(s) are allocated above 100 percent`] : []),
      ...(critical.filter((s) => successionGap({ critical: true, successors: s.successors || [] }) === 'NO_SUCCESSOR').length ? ['Critical roles without a ready successor'] : []),
      ...(certs.some((x) => certStatus(x.expiresOn, today()) === 'EXPIRED') ? ['Expired certificates need renewal'] : []),
    ],
  });
}

async function me(c: Ctx): Promise<Result> {
  const uid = c.ctx.uid;
  const [map, pips, certs, needs] = await Promise.all([listK(c.cid, 'mapping'), listK(c.cid, 'pip'), listK(c.cid, 'cert'), listK(c.cid, 'trainingNeed')]);
  const m = map.find((x) => x.employeeUid === uid);
  const pip = pips.find((p) => p.employeeUid === uid && (p.status === 'ACTIVE' || p.status === 'EXTENDED'));
  return ok({
    canManage: canManage(c.ctx), canView: canView(c.ctx),
    mapping: m ? { businessUnit: m.businessUnit, hrbpName: m.hrbpName, costCentre: m.costCentre } : null,
    pip: pip ? { id: pip.id, startOn: pip.startOn, endOn: pip.endOn, reason: pip.reason, goals: pip.goals, status: pip.status, checkins: pip.checkins.map((k: any) => ({ at: k.at, note: k.note, rating: k.rating })) } : null,
    certs: certs.filter((x) => x.employeeUid === uid).map((x) => ({ ...x, status: certStatus(x.expiresOn, today()) })),
    needs: needs.filter((x) => x.employeeUid === uid),
    myHrbp: m?.hrbpName || '',
  });
}

// ------------------------------------------------------------------ router

type Who = 'any' | 'manage' | 'view';
const ROUTES: Record<string, { method: 'GET' | 'POST'; who: Who }> = {
  me: { method: 'GET', who: 'any' },
  org: { method: 'GET', who: 'view' }, headcount: { method: 'GET', who: 'view' }, resource: { method: 'GET', who: 'view' }, dash: { method: 'GET', who: 'view' },
  'pip-list': { method: 'GET', who: 'manage' }, 'pip-save': { method: 'POST', who: 'manage' }, 'pip-act': { method: 'POST', who: 'manage' },
  'survey-list': { method: 'GET', who: 'any' }, 'survey-save': { method: 'POST', who: 'manage' }, 'survey-close': { method: 'POST', who: 'manage' }, 'survey-respond': { method: 'POST', who: 'any' }, 'survey-results': { method: 'GET', who: 'manage' },
  'recog-list': { method: 'GET', who: 'any' }, 'recog-give': { method: 'POST', who: 'any' },
  'well-join': { method: 'POST', who: 'any' },
  'assign-list': { method: 'GET', who: 'any' }, 'path-assign': { method: 'POST', who: 'manage' }, 'path-progress': { method: 'POST', who: 'any' },
};
for (const [prefix, spec] of Object.entries(SPECS)) {
  const readWho: Who = spec.read === 'any' ? 'any' : prefix === 'bu' ? 'view' : 'manage';
  ROUTES[`${prefix}-list`] = { method: 'GET', who: readWho };
  ROUTES[`${prefix}-save`] = { method: 'POST', who: 'manage' };
  ROUTES[`${prefix}-delete`] = { method: 'POST', who: 'manage' };
}

export async function routeHrbp(r: HrbpRequest): Promise<Result> {
  // Probation, OKRs, promotions and the quarterly review round live in talentCycleApi.ts.
  const cycle = await routeCycle(r);
  if (cycle) return cycle;
  const route = ROUTES[r.action];
  if (!route) return fail(404, 'Unknown HR Business Partner action.');
  try {
    if (r.method !== route.method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (route.who === 'manage' && !canManage(ctx)) return fail(403, 'You do not have permission to do this.');
    if (route.who === 'view' && !canView(ctx)) return fail(403, 'You do not have permission to do this.');
    const c = await load(ctx);
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const [prefix, verb] = [r.action.slice(0, r.action.lastIndexOf('-')), r.action.slice(r.action.lastIndexOf('-') + 1)];
    const spec = SPECS[prefix];
    if (spec && (verb === 'list' || verb === 'save' || verb === 'delete')) {
      return verb === 'list' ? await genericList(spec, c, r.query) : verb === 'save' ? await genericSave(spec, c, b) : await genericDelete(spec, c, b);
    }
    switch (r.action) {
      case 'me': return await me(c);
      case 'org': return await orgView(c);
      case 'headcount': return await headcountView(c);
      case 'resource': return await resourceView(c);
      case 'dash': return await dashboard(c);
      case 'pip-list': return await pipList(c, r.query);
      case 'pip-save': return await pipSave(c, b);
      case 'pip-act': return await pipAct(c, b);
      case 'survey-list': return await surveyList(c);
      case 'survey-save': return await surveySave(c, b);
      case 'survey-close': return await surveyClose(c, b);
      case 'survey-respond': return await surveyRespond(c, b);
      case 'survey-results': return await surveyResults(c, r.query);
      case 'recog-list': return await recogList(c);
      case 'recog-give': return await recogGive(c, b);
      case 'well-join': return await wellJoin(c, b);
      case 'assign-list': return await assignList(c, r.query);
      case 'path-assign': return await pathAssign(c, b);
      default: return await pathProgress(c, b);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[HRBP] error:', err);
    return fail(500, err?.message || 'HR Business Partner request failed.');
  }
}
