/**
 * Performance Management: SOP library and assignments (HR-PM-002), KRA/KPI plans (HR-PM-003) and KPI evidence (HR-PM-004).
 */
import { addDays, istToday, isIsoDate } from '../../shared/leaveEngine.js';
import type { Competency, Evidence, EvidenceSource, Framework, KpiDef, KraTemplate, Plan, PerfSettings, Sop, SopAssignment, SopCheckpoint } from '../../shared/performance.js';
import {
  cleanKras, isMaterialRevision, kpiQualityFlags, pickFramework, planIdOf, resolveRoleFamily, safeId, sopAssignmentIdOf, validateKpiWeights,
} from '../../shared/performanceEngine.js';
import { C, PerfError, audit, db, getOne, list, loadDirectory, loadSettings, nowIso, num, numOrNull, ok, peopleWithPerm, put, raise, str, tell, type Directory, type Result } from './perfCore.js';
import { needHrOrApprover, needManage, relationTo, slug, templateId, type Who } from './perfSetup.js';

const dayOf = (v: unknown) => String(v || '').slice(0, 10);

// ------------------------------------------------------------------ SOP library

/** Published versions in Document Governance that can be linked as an SOP. */
export async function sopSources(w: Who): Promise<Result> {
  needManage(w);
  const [vers, docs] = await Promise.all([
    db().collection('versions').where('companyId', '==', w.cid).where('status', '==', 'PUBLISHED').get(),
    db().collection('documents').where('companyId', '==', w.cid).get(),
  ]);
  const master = new Map<string, any>(docs.docs.map((d: any) => [d.id, d.data()]));
  const items = vers.docs.map((d: any) => {
    const v = d.data();
    const m = master.get(String(v.documentMasterId)) || {};
    return {
      versionId: d.id, documentMasterId: String(v.documentMasterId || ''), documentId: String(v.documentId || ''), title: String(v.documentTitle || m.title || ''),
      versionNumber: String(v.versionNumber || ''), category: String(m.category || ''), departmentName: String(m.departmentName || ''),
    };
  }).filter((x) => x.title);
  return ok({ items: items.sort((a, b) => a.title.localeCompare(b.title)) });
}

function cleanCheckpoints(input: unknown): SopCheckpoint[] {
  const used = new Set<string>();
  return (Array.isArray(input) ? input.slice(0, 40) : []).map((c: any, i: number) => {
    let id = slug(str(c?.id, 40)) || `cp-${i + 1}`;
    while (used.has(id)) id += '-x';
    used.add(id);
    return { id, text: str(c?.text, 300), critical: c?.critical === true };
  }).filter((c) => c.text);
}

export async function getSops(w: Who): Promise<Result> {
  const sops = await list<Sop>(C.sops, w.cid);
  if (w.canManage || w.canApprove || w.canView) return ok({ items: sops.sort((a, b) => a.title.localeCompare(b.title)) });
  const mine = new Set((await list<SopAssignment>(C.assignments, w.cid, { uid: w.uid, status: 'ACTIVE' })).map((a) => a.sopId));
  return ok({ items: sops.filter((s) => mine.has(s.id)) });
}

export async function saveSop(w: Who, body: any): Promise<Result> {
  needManage(w);
  const settings = await loadSettings(w.cid);
  const dir = await loadDirectory(w.cid);
  const existing = body.id ? await getOne<Sop>(C.sops, str(body.id, 128), w.cid) : null;
  if (body.id && !existing) throw new PerfError(404, 'SOP not found.');
  const title = str(body.title, 160);
  if (!title) throw new PerfError(400, 'Give the SOP a title.');
  const families = (Array.isArray(body.roleFamilyIds) ? body.roleFamilyIds : []).map(String).filter((id: string) => settings.roleFamilies.some((f) => f.id === id));
  // A link to Document Governance supplies the version; the number is read from the published version, never typed.
  let link = { documentMasterId: str(body.documentMasterId, 128), documentId: str(body.documentId, 128), versionId: str(body.versionId, 128), versionNumber: str(body.versionNumber, 20) };
  if (link.versionId) {
    const v = await db().collection('versions').doc(link.versionId).get();
    const d: any = v.data();
    if (!v.exists || d.companyId !== w.cid) throw new PerfError(400, 'That document version was not found.');
    link = { documentMasterId: String(d.documentMasterId || ''), documentId: String(d.documentId || ''), versionId: v.id, versionNumber: String(d.versionNumber || '') };
  }
  const owner = body.processOwnerUid ? dir.byUid.get(str(body.processOwnerUid, 128)) : null;
  const now = nowIso();
  const id = existing?.id || db().collection(C.sops).doc().id;
  const doc: Sop = {
    id, companyId: w.cid, title, departmentName: str(body.departmentName, 80), roleFamilyIds: families, ...link,
    processOwnerUid: owner?.uid || '', processOwnerName: owner?.name || '',
    criticality: body.criticality === 'CRITICAL' ? 'CRITICAL' : 'NORMAL', mandatory: body.mandatory !== false,
    trainingRequired: body.trainingRequired === true, acknowledgementRequired: body.acknowledgementRequired !== false,
    checkpoints: cleanCheckpoints(body.checkpoints), effectiveFrom: dayOf(body.effectiveFrom) || istToday(), reviewDate: dayOf(body.reviewDate),
    active: body.active !== false, createdAt: existing?.createdAt || now, updatedAt: now,
  };
  await put(C.sops, id, doc);
  await audit(w.cid, 'SOP', id, existing ? 'SOP_EDITED' : 'SOP_CREATED', w, existing ? { version: existing.versionNumber, active: existing.active } : null, { version: doc.versionNumber, active: doc.active });
  const sync = await syncSops(w.cid);
  return ok({ item: doc, sync });
}

export async function deleteSop(w: Who, body: any): Promise<Result> {
  needManage(w);
  const s = await getOne<Sop>(C.sops, str(body.id, 128), w.cid);
  if (!s) throw new PerfError(404, 'SOP not found.');
  await put(C.sops, s.id, { ...s, active: false, updatedAt: nowIso() });
  await audit(w.cid, 'SOP', s.id, 'SOP_RETIRED', w);
  await syncSops(w.cid);
  return ok({});
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Brings SOP assignments in line with the SOP library, the people and the linked document versions. Safe to run
 * any number of times: assignment ids are built from person, SOP and version.
 *  - an SOP linked to Document Governance follows its latest published version
 *  - a minor revision keeps the earlier acknowledgement; a major one needs it again
 *  - assignments that no longer apply are superseded, never deleted
 */
export async function syncSops(cid: string, dir?: Directory): Promise<{ created: number; superseded: number; retrain: number; gaps: number }> {
  dir = dir || (await loadDirectory(cid));
  const settings = await loadSettings(cid);
  const [sops, assignments] = await Promise.all([list<Sop>(C.sops, cid), list<SopAssignment>(C.assignments, cid)]);
  const out = { created: 0, superseded: 0, retrain: 0, gaps: 0 };
  const now = nowIso();

  // follow the linked document's current published version
  for (const s of sops) {
    if (!s.documentMasterId || !s.active) continue;
    const snap = await db().collection('versions').where('companyId', '==', cid).where('documentMasterId', '==', s.documentMasterId).where('status', '==', 'PUBLISHED').get();
    const latest = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => String(b.publishedAt || b.createdAt || '').localeCompare(String(a.publishedAt || a.createdAt || '')))[0] as any;
    if (latest && latest.id !== s.versionId) {
      const old = s.versionNumber;
      s.versionId = latest.id;
      s.versionNumber = String(latest.versionNumber || '');
      s.updatedAt = now;
      await put(C.sops, s.id, s);
      await raise(cid, { category: 'SOP_VERSION_CHANGED', severity: 'LOW', message: `${s.title} moved from v${old || '?'} to v${s.versionNumber}.`, refId: s.id, key: `${s.id}__${s.versionId}` });
    }
  }

  const familyOf = new Map(dir.active.map((p) => [p.uid, resolveRoleFamily(settings.roleFamilies, p.department, p.title)?.id || '']));
  const wanted = new Map<string, Sop>(); // assignment id -> sop
  for (const s of sops) {
    if (!s.active || !s.mandatory) continue;
    for (const p of dir.active) {
      if (s.departmentName && norm(s.departmentName) !== norm(p.department)) continue;
      if (s.roleFamilyIds.length && !s.roleFamilyIds.includes(familyOf.get(p.uid) || '')) continue;
      wanted.set(sopAssignmentIdOf(cid, p.uid, s.id, s.versionId), s);
    }
  }
  const byKey = new Map<string, SopAssignment[]>();
  for (const a of assignments) byKey.set(`${a.uid}__${a.sopId}`, [...(byKey.get(`${a.uid}__${a.sopId}`) || []), a]);
  const sopById = new Map(sops.map((s) => [s.id, s]));

  for (const [aid, s] of wanted) {
    if (assignments.some((a) => a.id === aid)) continue;
    const uid = [...dir.active].find((p) => sopAssignmentIdOf(cid, p.uid, s.id, s.versionId) === aid)!.uid;
    const prev = (byKey.get(`${uid}__${s.id}`) || []).filter((a) => a.status === 'ACTIVE').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const carry = !!prev && prev.ackStatus === 'ACKNOWLEDGED' && !isMaterialRevision(prev.versionNumber, s.versionNumber);
    const retrain = !!prev && !carry;
    const doc: SopAssignment = {
      id: aid, companyId: cid, uid, sopId: s.id, sopTitle: s.title, versionId: s.versionId, versionNumber: s.versionNumber, assignedAt: now,
      ackStatus: !s.acknowledgementRequired || carry ? 'ACKNOWLEDGED' : 'PENDING', ackAt: carry ? prev!.ackAt : !s.acknowledgementRequired ? now : '',
      retrainRequired: retrain, trainingStatus: s.trainingRequired ? (carry && prev!.trainingStatus === 'DONE' ? 'DONE' : 'PENDING') : 'NOT_REQUIRED',
      verifiedBy: '', verifiedAt: '', status: 'ACTIVE', reminderAt: '', createdAt: now, updatedAt: now,
    };
    await put(C.assignments, aid, doc);
    out.created++;
    if (retrain) out.retrain++;
    if (prev) {
      await put(C.assignments, prev.id, { ...prev, status: 'SUPERSEDED', updatedAt: now });
      out.superseded++;
    }
    if (doc.ackStatus === 'PENDING') {
      await tell(cid, [uid], 'SOP to read and acknowledge', `${s.title}${s.versionNumber ? ` (v${s.versionNumber})` : ''} is assigned to you.`, 'performance:sops', `sop__${aid}`, dir);
    }
  }
  for (const a of assignments) {
    if (a.status !== 'ACTIVE') continue;
    const s = sopById.get(a.sopId);
    const stillWanted = wanted.has(a.id) || (!!s && s.active && wanted.has(sopAssignmentIdOf(cid, a.uid, s.id, s.versionId)));
    if (!stillWanted) {
      await put(C.assignments, a.id, { ...a, status: 'SUPERSEDED', updatedAt: now });
      out.superseded++;
    }
  }

  // departments with people but no SOP at all
  const covered = new Set(sops.filter((s) => s.active).map((s) => norm(s.departmentName)));
  const anyAll = sops.some((s) => s.active && !s.departmentName);
  for (const dept of [...new Set(dir.active.map((p) => p.department).filter(Boolean))]) {
    if (anyAll || covered.has(norm(dept))) continue;
    out.gaps++;
    await raise(cid, { category: 'SOP_GAP', severity: 'MEDIUM', message: `No SOP is mapped to ${dept}. SOP compliance cannot be assessed for these people.`, key: norm(dept) });
  }
  return out;
}

export async function runSopSync(w: Who): Promise<Result> {
  needManage(w);
  const r = await syncSops(w.cid);
  await audit(w.cid, 'SOP', w.cid, 'SOP_SYNC', w, null, r);
  return ok({ sync: r });
}

export async function getAssignments(w: Who, q: any): Promise<Result> {
  const uid = str(q.uid, 128);
  if (uid && uid !== w.uid) {
    const dir = await loadDirectory(w.cid);
    if (relationTo(w, dir, uid) === 'NONE') throw new PerfError(403, 'You can only see your own SOPs or those of people who report to you.');
    return ok({ items: await list<SopAssignment>(C.assignments, w.cid, { uid, status: 'ACTIVE' }) });
  }
  if (q.scope === 'all') {
    needHrOrApprover(w);
    const dir = await loadDirectory(w.cid);
    const items = (await list<SopAssignment>(C.assignments, w.cid, { status: 'ACTIVE' })).map((a) => ({ ...a, employeeName: dir.nameOf(a.uid) }));
    return ok({ items });
  }
  return ok({ items: await list<SopAssignment>(C.assignments, w.cid, { uid: w.uid, status: 'ACTIVE' }) });
}

export async function ackSop(w: Who, body: any): Promise<Result> {
  const a = await getOne<SopAssignment>(C.assignments, str(body.id, 200), w.cid);
  if (!a || a.uid !== w.uid) throw new PerfError(404, 'Assignment not found.');
  if (a.status !== 'ACTIVE') throw new PerfError(400, 'This version has been replaced. Open the current one.');
  if (a.ackStatus === 'ACKNOWLEDGED') return ok({ item: a });
  const doc: SopAssignment = { ...a, ackStatus: 'ACKNOWLEDGED', ackAt: nowIso(), trainingStatus: a.trainingStatus === 'PENDING' ? 'DONE' : a.trainingStatus, updatedAt: nowIso() };
  await put(C.assignments, a.id, doc);
  await audit(w.cid, 'SOP_ASSIGNMENT', a.id, 'SOP_ACKNOWLEDGED', w, { ackStatus: a.ackStatus }, { ackStatus: 'ACKNOWLEDGED' });
  return ok({ item: doc });
}

/** A manager or HR confirms training/understanding. Acknowledging a document is not proof of following it. */
export async function verifySop(w: Who, body: any): Promise<Result> {
  const a = await getOne<SopAssignment>(C.assignments, str(body.id, 200), w.cid);
  if (!a) throw new PerfError(404, 'Assignment not found.');
  const dir = await loadDirectory(w.cid);
  const rel = relationTo(w, dir, a.uid);
  if (rel !== 'MANAGER' && rel !== 'HR') throw new PerfError(403, 'Only the manager or HR can verify.');
  const doc: SopAssignment = { ...a, verifiedBy: w.name, verifiedAt: nowIso(), trainingStatus: a.trainingStatus === 'PENDING' ? 'DONE' : a.trainingStatus, updatedAt: nowIso() };
  await put(C.assignments, a.id, doc);
  await audit(w.cid, 'SOP_ASSIGNMENT', a.id, 'SOP_VERIFIED', w);
  return ok({ item: doc });
}

// ------------------------------------------------------------------ plans

const competenciesFor = (settings: PerfSettings, familyIds: string[]) => {
  const pick = (c: Competency) => c.active && (c.group === 'CORE' || familyIds.includes(c.id));
  return settings.competencies.filter(pick).map((c) => ({ competencyId: c.id, name: c.name, standard: c.standard, weight: 1 }));
};

export interface PlanContext {
  settings: PerfSettings;
  frameworks: Framework[];
  templates: KraTemplate[];
  plans: Plan[];
  dir: Directory;
}

export async function planContext(cid: string, dir?: Directory): Promise<PlanContext> {
  const [settings, frameworks, templates, plans, d] = await Promise.all([
    loadSettings(cid), list<Framework>(C.frameworks, cid), list<KraTemplate>(C.templates, cid), list<Plan>(C.plans, cid), dir ? Promise.resolve(dir) : loadDirectory(cid),
  ]);
  return { settings, frameworks, templates, plans, dir: d };
}

export const currentPlan = (plans: Plan[], uid: string): Plan | null =>
  plans.filter((p) => p.uid === uid && p.status !== 'SUPERSEDED').sort((a, b) => b.version - a.version)[0] || null;

/**
 * Builds (or leaves alone) a person's plan. Never guesses: with no role family, framework, approved template or
 * manager, the plan is held as CONFIGURATION_PENDING with the reason, and an exception is raised for HR.
 * Idempotent: if the role family, manager and department have not changed, the existing plan is returned.
 */
export async function generatePlan(cid: string, uid: string, ctx: PlanContext, by: { name: string; uid: string }): Promise<{ plan: Plan | null; created: boolean }> {
  const person = ctx.dir.byUid.get(uid);
  if (!person || !person.active) return { plan: null, created: false };
  const today = istToday();
  const family = resolveRoleFamily(ctx.settings.roleFamilies, person.department, person.title);
  const managerUid = ctx.dir.managerOf(uid);
  const cur = currentPlan(ctx.plans, uid);

  if (cur && cur.status !== 'CONFIGURATION_PENDING') {
    const same = cur.roleFamilyId === (family?.id || '') && cur.managerUid === managerUid && cur.department === person.department;
    if (same) return { plan: cur, created: false };
  }

  const reasons: string[] = [];
  const framework = family ? pickFramework(ctx.frameworks, family.category, family.id, today) : null;
  const template = family ? ctx.templates.find((t) => t.id === templateId(cid, family.id) && t.status === 'APPROVED') : null;
  if (!family) { reasons.push('No role family matches this department and designation.'); await raise(cid, { category: 'NO_ROLE_FAMILY', message: `${person.name} (${person.department || 'no department'}, ${person.title || 'no title'}) matches no role family.`, uid }); }
  else {
    if (!framework) { reasons.push('No approved performance framework applies.'); await raise(cid, { category: 'NO_FRAMEWORK', message: `No approved framework for ${family.name}.`, key: family.id }); }
    if (!template || template.kras.length === 0) { reasons.push('No approved KRA/KPI template for this role family.'); await raise(cid, { category: 'NO_KRA', message: `No approved KRA/KPI template for ${family.name}.`, key: family.id }); }
  }
  if (!managerUid) { reasons.push('No reporting manager is set in the leave profile.'); await raise(cid, { category: 'NO_MANAGER', message: `${person.name} has no reporting manager.`, uid }); }

  const now = nowIso();
  // A person still waiting on configuration keeps one plan record that is rebuilt in place.
  const pendingBefore = cur && cur.status === 'CONFIGURATION_PENDING' ? cur : null;
  const version = pendingBefore ? pendingBefore.version : (ctx.plans.filter((p) => p.uid === uid).reduce((m, p) => Math.max(m, p.version), 0) + 1);
  const ready = reasons.length === 0 && !!family && !!framework && !!template;
  const plan: Plan = {
    id: pendingBefore ? pendingBefore.id : planIdOf(cid, uid, version), companyId: cid, uid, employeeName: person.name, department: person.department, designation: person.title,
    roleFamilyId: family?.id || '', roleFamilyName: family?.name || '', managerUid, frameworkId: framework?.id || '', frameworkVersion: framework?.version || 0,
    templateId: template?.id || '', templateVersion: template?.version || 0, kras: ready ? template!.kras.map((k) => ({ ...k, kpis: k.kpis.map((p) => ({ ...p, target: '' })) })) : [],
    competencies: family ? competenciesFor(ctx.settings, family.competencyIds) : [], competencyVersion: ctx.settings.competencyVersion,
    effectiveFrom: today, effectiveTo: '', status: ready ? 'DRAFT' : 'CONFIGURATION_PENDING', pendingReason: reasons.join(' '),
    approvals: [], version, createdAt: pendingBefore?.createdAt || now, updatedAt: now,
  };
  await put(C.plans, plan.id, plan);
  ctx.plans.push(plan);

  if (cur && !pendingBefore) {
    if (cur.managerUid !== managerUid) await raise(cid, { category: 'MANAGER_CHANGED', severity: 'LOW', message: `${person.name}'s manager changed. A new effective-dated plan was started; earlier reviews keep the earlier manager.`, uid, key: `${uid}__${plan.id}` });
    if (cur.department !== person.department) await raise(cid, { category: 'DEPARTMENT_TRANSFER', severity: 'LOW', message: `${person.name} moved from ${cur.department || '?'} to ${person.department || '?'}. A new plan was started.`, uid, key: `${uid}__${plan.id}` });
  }
  await audit(cid, 'PLAN', plan.id, 'PLAN_GENERATED', by, cur ? { planId: cur.id } : null, { status: plan.status, reason: plan.pendingReason });
  if (plan.status === 'DRAFT' && managerUid) {
    await tell(cid, [managerUid], 'Set KPI targets for your team member', `${person.name}'s KRA/KPI plan is ready for you to set targets.`, 'performance:team', `plan__${plan.id}`, ctx.dir);
  }
  return { plan, created: true };
}

export async function runGenerate(w: Who, body: any): Promise<Result> {
  needManage(w);
  const ctx = await planContext(w.cid);
  const targets = body.uid ? [str(body.uid, 128)] : ctx.dir.active.map((p) => p.uid);
  let created = 0;
  let pending = 0;
  for (const uid of targets) {
    const r = await generatePlan(w.cid, uid, ctx, w);
    if (r.created) created++;
    if (r.plan?.status === 'CONFIGURATION_PENDING') pending++;
  }
  return ok({ created, pending, total: targets.length });
}

export async function getPlans(w: Who, q: any): Promise<Result> {
  const ctx = await planContext(w.cid);
  const dir = ctx.dir;
  const scope = str(q.scope, 20);
  let rows = ctx.plans.filter((p) => p.status !== 'SUPERSEDED' || q.history === '1');
  if (scope === 'all') {
    needHrOrApprover(w);
  } else if (scope === 'team') {
    const reports = new Set(dir.reportsOf(w.uid));
    rows = rows.filter((p) => reports.has(p.uid));
  } else {
    rows = rows.filter((p) => p.uid === w.uid);
  }
  const items = rows.map((p) => ({ ...p, managerName: dir.nameOf(p.managerUid) })).sort((a, b) => a.employeeName.localeCompare(b.employeeName) || b.version - a.version);
  return ok({ items });
}

async function planFor(w: Who, id: string): Promise<{ plan: Plan; rel: ReturnType<typeof relationTo>; dir: Directory }> {
  const plan = await getOne<Plan>(C.plans, id, w.cid);
  if (!plan) throw new PerfError(404, 'Plan not found.');
  const dir = await loadDirectory(w.cid);
  const rel = plan.managerUid === w.uid ? 'MANAGER' : relationTo(w, dir, plan.uid);
  if (rel === 'NONE' && !w.canView) throw new PerfError(403, 'You cannot open this plan.');
  return { plan, rel, dir };
}

export async function getPlan(w: Who, q: any): Promise<Result> {
  const { plan, dir } = await planFor(w, str(q.id, 200));
  const flags = plan.kras.flatMap((k) => k.kpis.map((p) => ({ kpiId: p.id, flags: kpiQualityFlags(p) }))).filter((f) => f.flags.length);
  return ok({ item: { ...plan, managerName: dir.nameOf(plan.managerUid) }, flags, weightProblem: validateKpiWeights(plan.kras) });
}

/** The manager (or HR) sets targets and may adjust weights while the plan is in draft. */
export async function savePlan(w: Who, body: any): Promise<Result> {
  const { plan, rel } = await planFor(w, str(body.id, 200));
  if (rel !== 'MANAGER' && !w.canManage) throw new PerfError(403, 'Only the reporting manager or HR can edit the plan.');
  if (plan.status !== 'DRAFT') throw new PerfError(400, 'The plan can only be edited while it is a draft.');
  const kras = cleanKras(body.kras);
  if (kras.length === 0) throw new PerfError(400, 'A plan needs at least one KRA with a KPI.');
  const doc: Plan = { ...plan, kras, updatedAt: nowIso() };
  await put(C.plans, plan.id, doc);
  await audit(w.cid, 'PLAN', plan.id, 'PLAN_EDITED', w, { kras: plan.kras.length }, { kras: kras.length });
  return ok({ item: doc, weightProblem: validateKpiWeights(kras), flags: kras.flatMap((k) => k.kpis.map((p) => ({ kpiId: p.id, flags: kpiQualityFlags(p) }))).filter((f) => f.flags.length) });
}

export async function submitPlan(w: Who, body: any): Promise<Result> {
  const { plan, rel, dir } = await planFor(w, str(body.id, 200));
  if (rel !== 'MANAGER' && !w.canManage) throw new PerfError(403, 'Only the reporting manager or HR can submit the plan.');
  if (plan.status !== 'DRAFT') throw new PerfError(400, 'Only a draft can be submitted.');
  const weight = validateKpiWeights(plan.kras);
  if (weight) throw new PerfError(400, weight);
  const blank = plan.kras.flatMap((k) => k.kpis).filter((p) => !p.target.trim());
  if (blank.length) throw new PerfError(400, `Set a measurable target for every KPI first (${blank.length} still blank). Targets are agreed by people, never filled in automatically.`);
  const doc: Plan = { ...plan, status: 'SUBMITTED', approvals: [...plan.approvals, { by: w.name, byUid: w.uid, at: nowIso(), decision: 'SUBMITTED', note: str(body.note, 300) }], updatedAt: nowIso() };
  await put(C.plans, plan.id, doc);
  await audit(w.cid, 'PLAN', plan.id, 'PLAN_SUBMITTED', w);
  await tell(w.cid, await peopleWithPerm(w.cid, 'perf.manage', 'perf.approve'), 'KRA/KPI plan to approve', `${plan.employeeName}'s plan was submitted by ${w.name}.`, 'performance:setup', `plansub__${plan.id}`, dir);
  return ok({ item: doc });
}

export async function decidePlan(w: Who, body: any): Promise<Result> {
  needHrOrApprover(w);
  const { plan, dir } = await planFor(w, str(body.id, 200));
  if (plan.status !== 'SUBMITTED') throw new PerfError(400, 'This plan is not waiting for approval.');
  if (w.uid === plan.uid) throw new PerfError(403, 'You cannot approve your own plan.');
  if (w.uid === plan.managerUid && !w.canManage) throw new PerfError(403, 'The reporting manager cannot approve the plan they submitted.');
  const approve = body.decision === 'APPROVE';
  const note = str(body.note, 300);
  if (!approve && !note) throw new PerfError(400, 'Say what needs to change.');
  const weight = approve ? validateKpiWeights(plan.kras) : null;
  if (weight) throw new PerfError(400, weight);
  const doc: Plan = {
    ...plan, status: approve ? 'PENDING_ACK' : 'DRAFT',
    approvals: [...plan.approvals, { by: w.name, byUid: w.uid, at: nowIso(), decision: approve ? 'APPROVED' : 'RETURNED', note }], updatedAt: nowIso(),
  };
  await put(C.plans, plan.id, doc);
  await audit(w.cid, 'PLAN', plan.id, approve ? 'PLAN_APPROVED' : 'PLAN_RETURNED', w, { status: plan.status }, { status: doc.status });
  if (approve) await tell(w.cid, [plan.uid], 'Your KRA/KPI plan is ready', 'Please read your goals and targets and confirm them.', 'performance:me', `planack__${plan.id}`, dir);
  else await tell(w.cid, [plan.managerUid], 'Plan returned', `${plan.employeeName}'s plan needs changes: ${note}`, 'performance:team', `planret__${plan.id}__${doc.approvals.length}`, dir);
  return ok({ item: doc });
}

/** The employee confirms they have seen their goals. The plan becomes active and replaces the one before. */
export async function ackPlan(w: Who, body: any): Promise<Result> {
  const plan = await getOne<Plan>(C.plans, str(body.id, 200), w.cid);
  if (!plan || plan.uid !== w.uid) throw new PerfError(404, 'Plan not found.');
  if (plan.status !== 'PENDING_ACK') throw new PerfError(400, 'This plan is not waiting for you.');
  const now = nowIso();
  const today = istToday();
  const doc: Plan = { ...plan, status: 'ACTIVE', effectiveFrom: today, approvals: [...plan.approvals, { by: w.name, byUid: w.uid, at: now, decision: 'ACKNOWLEDGED', note: str(body.note, 300) }], updatedAt: now };
  await put(C.plans, plan.id, doc);
  for (const o of await list<Plan>(C.plans, w.cid, { uid: plan.uid })) {
    if (o.id !== plan.id && o.status === 'ACTIVE') await put(C.plans, o.id, { ...o, status: 'SUPERSEDED', effectiveTo: addDays(today, -1) < o.effectiveFrom ? o.effectiveFrom : addDays(today, -1), updatedAt: now });
  }
  await audit(w.cid, 'PLAN', plan.id, 'PLAN_ACKNOWLEDGED', w);
  return ok({ item: doc });
}

// ------------------------------------------------------------------ evidence

export const kpiOf = (plan: Plan, kpiId: string): KpiDef | undefined => plan.kras.flatMap((k) => k.kpis).find((p) => p.id === kpiId);

export async function addEvidence(w: Who, body: any): Promise<Result> {
  const uid = str(body.uid, 128) || w.uid;
  const dir = await loadDirectory(w.cid);
  const rel = relationTo(w, dir, uid);
  if (rel === 'NONE') throw new PerfError(403, 'You can add evidence for yourself or for people who report to you.');
  const plan = currentPlan(await list<Plan>(C.plans, w.cid, { uid }), uid);
  if (!plan || plan.status === 'CONFIGURATION_PENDING' || plan.status === 'SUPERSEDED') throw new PerfError(400, 'There is no plan to attach evidence to yet.');
  const kpi = kpiOf(plan, str(body.kpiId, 80));
  if (!kpi) throw new PerfError(400, 'Choose a KPI from the plan.');
  const description = str(body.description, 500);
  const reference = str(body.reference, 400);
  if (!description && !reference) throw new PerfError(400, 'Describe the evidence or add a link to it.');
  const id = db().collection(C.evidence).doc().id;
  const ev: Evidence = {
    id, companyId: w.cid, uid, planId: plan.id, kpiId: kpi.id, source: 'MANUAL', reference, description, value: numOrNull(body.value),
    occurredAt: isIsoDate(dayOf(body.occurredAt)) ? dayOf(body.occurredAt) : istToday(), externalId: '',
    status: rel === 'MANAGER' || rel === 'HR' ? 'VERIFIED' : 'PENDING', verifiedBy: rel === 'MANAGER' || rel === 'HR' ? w.name : '', verifiedAt: rel === 'MANAGER' || rel === 'HR' ? nowIso() : '',
    note: '', createdBy: w.name, createdAt: nowIso(),
  };
  await put(C.evidence, id, ev);
  await audit(w.cid, 'EVIDENCE', id, 'EVIDENCE_ADDED', w, null, { kpi: kpi.code, uid });
  if (uid === w.uid && plan.managerUid) await tell(w.cid, [plan.managerUid], 'Evidence to verify', `${plan.employeeName} added evidence for ${kpi.code || kpi.description}.`, 'performance:team', '', dir);
  return ok({ item: ev });
}

export async function listEvidence(w: Who, q: any): Promise<Result> {
  const uid = str(q.uid, 128) || w.uid;
  const dir = await loadDirectory(w.cid);
  if (relationTo(w, dir, uid) === 'NONE' && !w.canView) throw new PerfError(403, 'You cannot see this person\'s evidence.');
  let rows = await list<Evidence>(C.evidence, w.cid, { uid });
  const from = dayOf(q.from);
  const to = dayOf(q.to);
  if (from) rows = rows.filter((e) => e.occurredAt >= from);
  if (to) rows = rows.filter((e) => e.occurredAt <= to);
  return ok({ items: rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) });
}

export async function verifyEvidence(w: Who, body: any): Promise<Result> {
  const ev = await getOne<Evidence>(C.evidence, str(body.id, 200), w.cid);
  if (!ev) throw new PerfError(404, 'Evidence not found.');
  const dir = await loadDirectory(w.cid);
  const rel = relationTo(w, dir, ev.uid);
  if (rel !== 'MANAGER' && rel !== 'HR') throw new PerfError(403, 'Only the manager or HR can verify evidence.');
  const status = body.decision === 'REJECT' ? 'REJECTED' : 'VERIFIED';
  const doc: Evidence = { ...ev, status, verifiedBy: w.name, verifiedAt: nowIso(), note: str(body.note, 300) };
  await put(C.evidence, ev.id, doc);
  await audit(w.cid, 'EVIDENCE', ev.id, status === 'VERIFIED' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_REJECTED', w);
  return ok({ item: doc });
}

/**
 * Inbound evidence from a task tool. Public route: the company is found from a secret key. It only ever records
 * evidence for a person's KPI; it never scores anything. Duplicate deliveries (same externalId) are ignored.
 */
export async function evidenceHook(headers: Record<string, any>, body: any, query: any): Promise<Result> {
  const key = str(headers['x-webhook-key'] || body?.key || query?.key, 80);
  if (!key || key.length < 16) return { status: 401, json: { success: false, error: 'Missing key.' } };
  const found = await db().collection(C.settings).where('webhookKey', '==', key).limit(1).get();
  if (found.empty) return { status: 401, json: { success: false, error: 'Unknown key.' } };
  const cid = String((found.docs[0].data() as any).companyId);
  const externalId = str(body?.externalId, 120);
  if (!externalId) return { status: 400, json: { success: false, error: 'externalId is required so a repeated delivery is ignored.' } };
  const id = safeId(`${cid}__ext__${externalId}`);
  if ((await db().collection(C.evidence).doc(id).get()).exists) {
    await raise(cid, { category: 'DUPLICATE_EXECUTION', severity: 'LOW', message: `Duplicate evidence delivery ignored (${externalId}).`, key: externalId });
    return { status: 200, json: { success: true, duplicate: true } };
  }
  const dir = await loadDirectory(cid);
  const email = str(body?.employeeEmail, 160).toLowerCase();
  const empId = str(body?.employeeId, 40);
  const person = dir.active.find((p) => (email && p.email === email) || (empId && p.empId === empId));
  const plan = person ? currentPlan(await list<Plan>(C.plans, cid, { uid: person.uid }), person.uid) : null;
  const code = str(body?.kpiCode, 40).toLowerCase();
  const kpi = plan ? plan.kras.flatMap((k) => k.kpis).find((p) => p.code.toLowerCase() === code) : undefined;
  if (!person || !plan || plan.status === 'CONFIGURATION_PENDING' || !kpi) {
    await raise(cid, { category: 'EVIDENCE_UNMAPPED', severity: 'LOW', message: `Task evidence ${externalId} could not be matched to a person and KPI (${email || empId || 'no person'}, ${code || 'no KPI code'}).`, key: externalId });
    return { status: 202, json: { success: true, mapped: false } };
  }
  const ev: Evidence = {
    id, companyId: cid, uid: person.uid, planId: plan.id, kpiId: kpi.id, source: 'WEBHOOK' as EvidenceSource, reference: str(body?.reference, 400), description: str(body?.description, 500),
    value: numOrNull(body?.value), occurredAt: isIsoDate(dayOf(body?.occurredAt)) ? dayOf(body.occurredAt) : istToday(), externalId, status: 'PENDING', verifiedBy: '', verifiedAt: '', note: '',
    createdBy: 'Task tool', createdAt: nowIso(),
  };
  await put(C.evidence, id, ev);
  return { status: 200, json: { success: true, mapped: true } };
}

export { num };
