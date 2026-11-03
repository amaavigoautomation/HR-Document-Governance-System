/**
 * Performance Management: HR-PM-002 (KRA/KPI templates and each person's plan), HR-PM-003 (competency assignment) and the
 * assignment, acknowledgement and checking side of HR-PM-004 (department SOPs).
 *
 * Workflow PM-002 "KRA/KPI Assignment": joining, role change or new cycle -> a plan for the person.
 * Workflow PM-003 "Competency Assignment": the competencies a person is assessed on are fixed into their plan.
 * Workflow PM-004 "SOP Assignment": joining, transfer, SOP publication -> SOP training and acknowledgement.
 */
import {
  KPI_FREQUENCIES, EVIDENCE_SOURCES, SOP_RESULTS, validateKpiWeights, addDays, isDate, type SopResult,
} from '../../shared/pmEngine.js';
import {
  anyPerson, audit, clean, clearException, db, fail, getK, groupBy, isManagerCtx, isMyReport, lc, listK, managerOf, newId, nameOf, nowIso, num, ok, oneOf, person, putK, raise, reportsOf, str, tell, today,
  type C, type Item, type Route, type Result,
} from './pmCore.js';
import { pickFramework } from './pmMasters.js';
import type { Person } from './leaveCore.js';

const FREQ = KPI_FREQUENCIES;
const SRC = EVIDENCE_SOURCES;

// ------------------------------------------------------------------ KRA/KPI templates (Role_KRA_Template)

interface TemplateRow { kraName: string; kpiName: string; description: string; measurement: string; targetHint: string; weightage: number; frequency: string; evidenceSource: string; sopId: string }

function cleanRows(v: unknown): TemplateRow[] {
  return (Array.isArray(v) ? v : []).slice(0, 60).map((x: any) => ({
    kraName: str(x?.kraName, 120), kpiName: str(x?.kpiName, 160), description: str(x?.description, 400), measurement: str(x?.measurement, 300), targetHint: str(x?.targetHint, 200),
    weightage: num(x?.weightage) ?? 0, frequency: oneOf(x?.frequency, FREQ, 'MONTHLY'), evidenceSource: oneOf(x?.evidenceSource, SRC, 'TASK_SYSTEM'), sopId: str(x?.sopId, 80),
  })).filter((r) => r.kraName || r.kpiName);
}

async function tplList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  let items = (await listK(c.cid, 'roleTemplate')).sort((a, b) => String(a.roleName).localeCompare(String(b.roleName)) || (b.version || 0) - (a.version || 0));
  if (q.roleId) items = items.filter((t) => t.roleId === str(q.roleId, 80));
  return ok({ items });
}

async function tplSave(c: C, b: any): Promise<Result> {
  const role = await getK(c.cid, str(b.roleId, 80), 'role');
  if (!role) return fail(404, 'Choose a role first.');
  const rows = cleanRows(b.items);
  if (rows.some((r) => !r.kraName || !r.kpiName)) return fail(400, 'Every line needs a KRA (the responsibility area) and a KPI (how it is measured).');
  const w = validateKpiWeights(rows);
  if (!w.ok) return fail(400, `${w.error} (Exception: weights invalid, so the template was not saved.)`);
  const sops = await listK(c.cid, 'sop');
  for (const r of rows) if (r.sopId && !sops.some((s) => s.id === r.sopId)) return fail(400, 'One of the linked SOPs was not found.');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'roleTemplate') : null;
  if (b.id && !prev) return fail(404, 'That template was not found.');
  const all = await listK(c.cid, 'roleTemplate');
  const forRole = all.filter((t) => t.roleId === role.id);
  // An approved template is never rewritten: changes become a new draft version, and people's plans keep the version they were built from.
  const reuse = prev && prev.status === 'DRAFT' ? prev : forRole.find((t) => t.status === 'DRAFT') || null;
  const version = reuse ? reuse.version : Math.max(0, ...forRole.map((t) => t.version || 0)) + 1;
  const id = reuse?.id || newId();
  const item: Item = { ...(reuse || {}), id, companyId: c.cid, kind: 'roleTemplate', roleId: role.id, roleName: role.name, department: role.department, version, status: 'DRAFT', items: rows, approvedBy: '', approvedAt: '' };
  await putK(item);
  // KRA_Master and KPI_Master are kept in step so the same wording is reused across roles.
  const [kras, kpis] = await Promise.all([listK(c.cid, 'kraMaster'), listK(c.cid, 'kpiMaster')]);
  for (const r of rows) {
    let kra = kras.find((k) => lc(k.name) === lc(r.kraName));
    if (!kra) { kra = { id: newId(), companyId: c.cid, kind: 'kraMaster', name: r.kraName, description: '' }; await putK(kra); kras.push(kra); }
    if (!kpis.some((k) => k.kraId === kra!.id && lc(k.name) === lc(r.kpiName))) { const kp = { id: newId(), companyId: c.cid, kind: 'kpiMaster', kraId: kra.id, name: r.kpiName, description: r.description, measurement: r.measurement, frequency: r.frequency, evidenceSource: r.evidenceSource }; await putK(kp); kpis.push(kp); }
  }
  await audit(c, 'template', id, reuse ? 'UPDATED' : 'CREATED', reuse ? { rows: reuse.items?.length } : null, { rows: rows.length, version });
  return ok({ item });
}

async function tplApprove(c: C, b: any): Promise<Result> {
  const t = await getK(c.cid, str(b.id, 80), 'roleTemplate');
  if (!t) return fail(404, 'That template was not found.');
  if (t.status !== 'DRAFT') return fail(409, 'Only a draft can be approved.');
  const w = validateKpiWeights(t.items);
  if (!w.ok) return fail(400, w.error!);
  for (const o of (await listK(c.cid, 'roleTemplate')).filter((x) => x.roleId === t.roleId && x.status === 'APPROVED')) await putK({ ...o, status: 'RETIRED' });
  const next = { ...t, status: 'APPROVED', approvedBy: c.who, approvedAt: nowIso() };
  await putK(next);
  await audit(c, 'template', t.id, 'APPROVED', { status: 'DRAFT' }, { status: 'APPROVED', version: t.version });
  return ok({ item: next, message: 'Template approved. New plans for this role will use it.' });
}

async function tplDelete(c: C, b: any): Promise<Result> {
  const t = await getK(c.cid, str(b.id, 80), 'roleTemplate');
  if (!t) return fail(404, 'That template was not found.');
  if (t.status !== 'DRAFT') return fail(409, 'Only a draft can be deleted. Approved templates are kept for history.');
  await db().collection('pmItems').doc(t.id).delete();
  await audit(c, 'template', t.id, 'DELETED', { role: t.roleName }, null);
  return ok({});
}

// ------------------------------------------------------------------ roles and competencies of a person

export function roleOfPerson(roles: Item[], p: Person): Item | null {
  if (!p.title) return null;
  const exact = roles.find((r) => lc(r.name) === lc(p.title) && lc(r.department) === lc(p.department));
  if (exact) return exact;
  const byTitle = roles.filter((r) => lc(r.name) === lc(p.title));
  return byTitle.length === 1 ? byTitle[0] : null;
}

/** PM-003: every active core competency, plus the ones HR mapped to the role. Frozen into the plan so later edits never rewrite history. */
export function competenciesFor(comps: Item[], maps: Item[], role: Item) {
  const mine = new Map(maps.filter((m) => m.roleId === role.id).map((m) => [m.competencyId, m]));
  return comps.filter((x) => x.active !== false && (x.category === 'CORE' || mine.has(x.id))).map((x) => ({
    competencyId: x.id, name: x.name, expectedBehaviour: x.standard || x.definition || '', exampleEvidence: x.exampleEvidence || '', category: x.category, version: x.version || 1,
    expectedLevel: mine.get(x.id)?.expectedLevel ?? 3, weight: mine.get(x.id)?.weight ?? 1,
  }));
}

// ------------------------------------------------------------------ building a person's plan (workflow PM-002)

type PlanTrigger = 'JOINING' | 'CONFIRMATION' | 'TRANSFER' | 'ROLE_CHANGE' | 'NEW_CYCLE' | 'MANUAL' | 'MANAGER_CHANGE';

async function bundle(c: C) {
  const [roles, frameworks, templates, comps, compMaps, plans] = await Promise.all([
    listK(c.cid, 'role'), listK(c.cid, 'framework'), listK(c.cid, 'roleTemplate'), listK(c.cid, 'competency'), listK(c.cid, 'roleCompetency'), listK(c.cid, 'plan'),
  ]);
  return { roles, frameworks, templates, comps, compMaps, plans };
}
type Bundle = Awaited<ReturnType<typeof bundle>>;

const latestPlan = (plans: Item[], uid: string): Item | null => plans.filter((p) => p.uid === uid && p.status !== 'SUPERSEDED').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;

/** Why a plan cannot be built yet. The specification: never silently assign a default score or approver. */
function configIssues(c: C, p: Person, bd: Bundle) {
  const issues: { code: string; text: string }[] = [];
  const role = roleOfPerson(bd.roles, p);
  if (!p.title) issues.push({ code: 'NO_JOB_TITLE', text: `${p.name} has no job title, so no role can be found. Add the job title on their employee record.` });
  else if (!role) issues.push({ code: 'NO_ROLE', text: `No role exists for "${p.title}" in ${p.department || 'their department'}. Create it in Roles (the "Create roles from my employees" button does it for everyone).` });
  const mgr = managerOf(c, p.uid);
  if (!mgr) issues.push({ code: 'NO_MANAGER', text: `${p.name} has no reporting manager. Set one under Leave & Attendance > Manage > People.` });
  const fw = role ? pickFramework(bd.frameworks, role.employeeCategory, role.roleFamily) : null;
  if (role && !fw) issues.push({ code: 'NO_FRAMEWORK', text: `No approved framework covers the role "${role.name}" (${role.employeeCategory.replace(/_/g, ' ').toLowerCase()}). Approve one in Framework.` });
  const tpl = role ? bd.templates.filter((t) => t.roleId === role.id && t.status === 'APPROVED').sort((a, b) => b.version - a.version)[0] : null;
  if (role && !tpl) issues.push({ code: 'NO_TEMPLATE', text: `The role "${role.name}" has no approved KRA/KPI template. Write and approve one in KRA/KPI templates.` });
  return { issues, role, mgr, fw, tpl };
}

async function writePlanBody(c: C, plan: Item, tpl: Item): Promise<void> {
  const kraIds = new Map<string, string>();
  const rows: TemplateRow[] = tpl.items;
  const [kras, kpis] = await Promise.all([listK(c.cid, 'kraMaster'), listK(c.cid, 'kpiMaster')]);
  for (const r of rows) {
    const kra = kras.find((k) => lc(k.name) === lc(r.kraName));
    const kpi = kpis.find((k) => k.kraId === kra?.id && lc(k.name) === lc(r.kpiName));
    let assignId = kraIds.get(r.kraName);
    if (!assignId) { assignId = newId(); kraIds.set(r.kraName, assignId); await putK({ id: assignId, companyId: c.cid, kind: 'kraAssign', planId: plan.id, uid: plan.uid, kraId: kra?.id || '', kraName: r.kraName, weight: 0, effectiveFrom: plan.effectiveFrom }); }
    await putK({
      id: newId(), companyId: c.cid, kind: 'kpiTarget', planId: plan.id, uid: plan.uid, kraAssignId: assignId, kraName: r.kraName, kpiId: kpi?.id || '', kpiName: r.kpiName, description: r.description, measurement: r.measurement,
      targetHint: r.targetHint, target: '', weightage: r.weightage, frequency: r.frequency, evidenceSource: r.evidenceSource, sopRef: r.sopId, owner: 'Employee', reviewerUid: plan.managerUid, effectiveFrom: plan.effectiveFrom,
    });
  }
  await refreshKraWeights(c, plan.id);
}

async function refreshKraWeights(c: C, planId: string): Promise<void> {
  const [kras, kpis] = await Promise.all([listK(c.cid, 'kraAssign'), listK(c.cid, 'kpiTarget')]);
  for (const k of kras.filter((x) => x.planId === planId)) {
    const w = kpis.filter((t) => t.planId === planId && t.kraAssignId === k.id).reduce((s, t) => s + (Number(t.weightage) || 0), 0);
    if (w !== k.weight) await putK({ ...k, weight: w });
  }
}

/** Builds (or rebuilds, if it was waiting for configuration) the plan for one person. */
export async function buildPlan(c: C, p: Person, trigger: PlanTrigger, bd: Bundle, replaceId = ''): Promise<{ plan: Item; created: boolean }> {
  const cfg = configIssues(c, p, bd);
  const existing = replaceId ? bd.plans.find((x) => x.id === replaceId) || null : null;
  const prev = latestPlan(bd.plans, p.uid);
  const id = existing?.id || newId();
  const blocked = cfg.issues.length > 0;
  const from = today();
  const plan: Item = {
    ...(existing || {}), id, companyId: c.cid, kind: 'plan', uid: p.uid, employeeName: p.name, department: p.department, title: p.title,
    roleId: cfg.role?.id || '', roleName: cfg.role?.name || '', managerUid: cfg.mgr || '', managerName: nameOf(c, cfg.mgr),
    frameworkId: cfg.fw?.id || '', frameworkName: cfg.fw?.name || '', frameworkVersion: cfg.fw?.version || 0,
    weights: cfg.fw ? { kra: cfg.fw.kraWeight, behaviour: cfg.fw.behaviourWeight, sop: cfg.fw.sopWeight } : null,
    templateId: cfg.tpl?.id || '', templateVersion: cfg.tpl?.version || 0, trigger, status: blocked ? 'CONFIGURATION_PENDING' : 'GENERATED', configIssues: cfg.issues,
    effectiveFrom: existing?.effectiveFrom || from, effectiveTo: '', competencies: cfg.role ? competenciesFor(bd.comps, bd.compMaps, cfg.role) : [],
    history: [...(existing?.history || []), { at: nowIso(), by: 'System', action: blocked ? 'CONFIGURATION_PENDING' : 'GENERATED', note: blocked ? cfg.issues.map((i) => i.code).join(', ') : `Trigger: ${trigger}` }],
    supersedes: existing?.supersedes || (prev && prev.id !== id ? prev.id : ''),
  };
  // The previous plan stays on record; the new one takes over from today.
  if (!existing && prev && !blocked) {
    await putK({ ...prev, status: 'SUPERSEDED', effectiveTo: addDays(from, -1) < prev.effectiveFrom ? prev.effectiveFrom : addDays(from, -1), supersededBy: id });
    await audit(c, 'plan', prev.id, 'SUPERSEDED', { status: prev.status }, { by: id, trigger }, p.uid);
  }
  await putK(plan);
  if (!existing) bd.plans.push(plan); else Object.assign(existing, plan);
  if (blocked) {
    await raise(c, 'CONFIGURATION_PENDING', { refId: `plan_${p.uid}`, subjectUid: p.uid, refLabel: p.name, detail: cfg.issues.map((i) => i.text).join(' '), ownerUid: cfg.mgr || '' });
    if (cfg.issues.some((i) => i.code === 'NO_TEMPLATE')) await raise(c, 'NO_KRA_KPI', { refId: `plan_${p.uid}`, subjectUid: p.uid, refLabel: p.name, ownerUid: cfg.mgr || '', detail: `${p.name} has no KRA/KPI yet. Their final review is blocked until one is approved.` });
  } else {
    if (!existing || existing.status === 'CONFIGURATION_PENDING') {
      await writePlanBody(c, plan, cfg.tpl!);
      await clearException(c, 'CONFIGURATION_PENDING', `plan_${p.uid}`, 'The plan could be built.');
      await tell(c, [cfg.mgr!], `Set targets for ${p.name}`, `${p.name}'s performance plan (${plan.roleName}) is ready. Open Performance > My team and set the targets, then send it for HR validation.`);
    }
    await assignSopsFor(c, p, cfg.role!);
  }
  await audit(c, 'plan', id, existing ? 'REBUILT' : 'GENERATED', null, { status: plan.status, trigger }, p.uid);
  return { plan, created: !existing };
}

// ------------------------------------------------------------------ SOP assignment (workflow PM-004)

/** Which SOPs apply: active, in the person's department, and (if HR mapped it to roles) mapped to their role. */
export async function applicableSops(c: C, p: Person, role: Item | null) {
  const [sops, maps] = await Promise.all([listK(c.cid, 'sop'), listK(c.cid, 'roleSop')]);
  const on = today();
  return sops.filter((s) => {
    if (s.status !== 'ACTIVE' || lc(s.department) !== lc(p.department) || s.effectiveFrom > on) return false;
    const mapped = maps.filter((m) => m.sopId === s.id);
    return mapped.length === 0 || (!!role && mapped.some((m) => m.roleId === role.id));
  });
}

export async function assignSopsFor(c: C, p: Person, role: Item | null): Promise<{ created: number; gap: boolean }> {
  const [applicable, existing] = await Promise.all([applicableSops(c, p, role), listK(c.cid, 'sopAssign')]);
  const mine = existing.filter((a) => a.uid === p.uid);
  let created = 0;
  for (const s of applicable) {
    if (mine.some((a) => a.sopId === s.id && a.versionId === s.versionId && !['SUPERSEDED', 'ENDED'].includes(a.status))) continue;
    await putK({
      id: `sa_${p.uid}_${s.id}_${s.versionId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150), companyId: c.cid, kind: 'sopAssign', uid: p.uid, employeeName: p.name, sopId: s.id, title: s.title, department: s.department,
      versionId: s.versionId, versionNumber: s.versionNumber, mandatory: true, criticality: s.criticality, assignedDate: today(), status: 'ASSIGNED', readAt: '', acknowledgedAt: '', acknowledgementRequired: s.acknowledgementRequired !== false,
      training: s.trainingRequired ? 'PENDING' : 'NOT_REQUIRED', trainingDoneAt: '', managerVerification: s.managerVerificationRequired ? 'PENDING' : 'NOT_REQUIRED', verifiedBy: '', verifiedAt: '',
    });
    created++;
  }
  // Assignments that no longer apply (for example after a department transfer) are ended, never deleted.
  for (const a of mine) {
    if (['SUPERSEDED', 'ENDED'].includes(a.status)) continue;
    if (!applicable.some((s) => s.id === a.sopId)) { await putK({ ...a, status: 'ENDED', endedAt: nowIso() }); await audit(c, 'sopAssign', a.id, 'ENDED', { status: a.status }, { status: 'ENDED' }, p.uid); }
  }
  const gap = applicable.length === 0 && !!p.department;
  if (gap) await raise(c, 'SOP_MISSING', { refId: `dept_${lc(p.department)}`, refLabel: p.department, detail: `No SOP applies to ${p.department}${role ? ` / ${role.name}` : ''}. SOP assignment gap: people there have nothing to follow or acknowledge.`, notifyUids: [] });
  if (created) await audit(c, 'sopAssign', p.uid, 'ASSIGNED', null, { created }, p.uid);
  return { created, gap };
}

async function sopAssignList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10) || 'mine';
  let items = await listK(c.cid, 'sopAssign');
  if (scope === 'mine') items = items.filter((a) => a.uid === c.ctx.uid);
  else if (scope === 'team') items = items.filter((a) => isMyReport(c, a.uid));
  else if (!c.isHr && !c.isApprover) return fail(403, 'You do not have permission to see everyone\'s SOP assignments.');
  if (q.employeeUid) items = items.filter((a) => a.uid === str(q.employeeUid, 120));
  items = items.filter((a) => !['SUPERSEDED', 'ENDED'].includes(a.status));
  const sops = await listK(c.cid, 'sop');
  return ok({ items: items.sort((a, b) => String(a.title).localeCompare(String(b.title))).map((a) => ({ ...a, checkpoints: scope === 'mine' || scope === 'team' || c.isHr ? sops.find((s) => s.id === a.sopId)?.checkpoints || [] : undefined, docTitle: sops.find((s) => s.id === a.sopId)?.docTitle || '', documentId: sops.find((s) => s.id === a.sopId)?.documentId || '' })) });
}

async function ownAssignment(c: C, id: string): Promise<Item | null> { const a = await getK(c.cid, id, 'sopAssign'); return a && a.uid === c.ctx.uid ? a : null; }

/** Reading, acknowledging and following an SOP are three different events and are recorded separately. */
async function sopRead(c: C, b: any): Promise<Result> {
  const a = await ownAssignment(c, str(b.id, 150));
  if (!a) return fail(404, 'That SOP assignment was not found.');
  if (a.readAt) return ok({ item: a });
  const next = { ...a, readAt: nowIso() };
  await putK(next); await audit(c, 'sopAssign', a.id, 'READ', null, { readAt: next.readAt }, a.uid);
  return ok({ item: next });
}
async function sopAck(c: C, b: any): Promise<Result> {
  const a = await ownAssignment(c, str(b.id, 150));
  if (!a) return fail(404, 'That SOP assignment was not found.');
  if (a.acknowledgedAt) return ok({ item: a });
  if (!a.readAt) return fail(409, 'Open and read the SOP first. Reading and acknowledging are recorded separately.');
  const next = { ...a, acknowledgedAt: nowIso(), status: 'ACKNOWLEDGED' };
  await putK(next); await audit(c, 'sopAssign', a.id, 'ACKNOWLEDGED', null, { acknowledgedAt: next.acknowledgedAt }, a.uid);
  await clearException(c, 'SOP_NOT_ACKNOWLEDGED', a.id, 'The employee acknowledged the SOP.');
  return ok({ item: next });
}
async function sopTrain(c: C, b: any): Promise<Result> {
  const a = await getK(c.cid, str(b.id, 150), 'sopAssign');
  if (!a || (a.uid !== c.ctx.uid && !isMyReport(c, a.uid) && !c.isHr)) return fail(404, 'That SOP assignment was not found.');
  if (a.training === 'NOT_REQUIRED') return fail(409, 'This SOP does not require training.');
  const next = { ...a, training: 'DONE', trainingDoneAt: nowIso(), trainingRecordedBy: c.who };
  await putK(next); await audit(c, 'sopAssign', a.id, 'TRAINING_DONE', null, { by: c.who }, a.uid);
  return ok({ item: next });
}
async function sopVerify(c: C, b: any): Promise<Result> {
  const a = await getK(c.cid, str(b.id, 150), 'sopAssign');
  if (!a || (!isMyReport(c, a.uid) && !c.isHr)) return fail(403, 'Only the reporting manager or HR can verify.');
  if (a.managerVerification === 'NOT_REQUIRED') return fail(409, 'This SOP does not need manager verification.');
  const next = { ...a, managerVerification: 'VERIFIED', verifiedBy: c.who, verifiedAt: nowIso() };
  await putK(next); await audit(c, 'sopAssign', a.id, 'VERIFIED', null, { by: c.who }, a.uid);
  return ok({ item: next });
}

/** HR's decision on a new published version: material = everyone re-acknowledges (and retrains); not material = nothing is asked of anyone. */
async function sopRevision(c: C, b: any): Promise<Result> {
  const s = await getK(c.cid, str(b.id, 80), 'sop');
  if (!s || !s.pendingRevision) return fail(404, 'That SOP has no new version waiting for a decision.');
  const rev = s.pendingRevision;
  const material = b.material === true;
  const note = str(b.note, 400);
  if (material && !note) return fail(400, 'Say briefly what changed, so people know why they are asked again.');
  const assigns = (await listK(c.cid, 'sopAssign')).filter((a) => a.sopId === s.id && !['SUPERSEDED', 'ENDED'].includes(a.status));
  let reassigned = 0; let carried = 0;
  for (const a of assigns) {
    if (material) {
      await putK({ ...a, status: 'SUPERSEDED', supersededByVersion: rev.versionNumber });
      await putK({ ...a, id: `sa_${a.uid}_${s.id}_${rev.versionId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150), versionId: rev.versionId, versionNumber: rev.versionNumber, assignedDate: today(), status: 'ASSIGNED', readAt: '', acknowledgedAt: '',
        training: s.trainingRequired ? 'PENDING' : 'NOT_REQUIRED', trainingDoneAt: '', managerVerification: s.managerVerificationRequired ? 'PENDING' : 'NOT_REQUIRED', verifiedBy: '', verifiedAt: '', revisionNote: note });
      reassigned++;
    } else {
      await putK({ ...a, versionId: rev.versionId, versionNumber: rev.versionNumber, carriedFromVersion: s.versionNumber }); carried++;
    }
  }
  await putK({ ...s, versionId: rev.versionId, versionNumber: rev.versionNumber, pendingRevision: null, lastRevisionNote: note });
  await clearException(c, 'SOP_VERSION_CHANGED', s.id, material ? 'Material change: people were asked to re-acknowledge.' : 'Not a material change: nothing was asked of anyone.');
  await audit(c, 'sop', s.id, material ? 'REVISION_MATERIAL' : 'REVISION_MINOR', { version: s.versionNumber }, { version: rev.versionNumber, reassigned, carried });
  if (material) await tell(c, assigns.map((a) => a.uid), `Please re-read ${s.title}`, `${s.title} has a new version (${rev.versionNumber}). What changed: ${note}\n\nOpen Performance > My SOPs, read it and acknowledge it.`);
  return ok({ reassigned, carried, message: material ? `${reassigned} people were asked to re-acknowledge.` : 'Updated. Nobody was asked to do anything again.' });
}

/** Employees who have had an SOP for over a week without acknowledging: a reminder, and the manager is told. */
export async function sopReminders(c: C): Promise<{ reminded: number }> {
  const assigns = (await listK(c.cid, 'sopAssign')).filter((a) => a.status === 'ASSIGNED' && a.acknowledgementRequired !== false && a.assignedDate <= addDays(today(), -7));
  let reminded = 0;
  for (const a of assigns) {
    if (a.remindedOn === today()) continue;
    await putK({ ...a, remindedOn: today() });
    const mgr = managerOf(c, a.uid);
    await tell(c, [a.uid], `Reminder: acknowledge ${a.title}`, `You were given ${a.title} on ${a.assignedDate}. Please open Performance > My SOPs, read it and acknowledge it.`);
    await raise(c, 'SOP_NOT_ACKNOWLEDGED', { refId: a.id, refLabel: a.title, subjectUid: a.uid, ownerUid: mgr, detail: `${a.employeeName} has not acknowledged ${a.title} since ${a.assignedDate}.`, notifyUids: mgr ? [mgr] : [] });
    reminded++;
  }
  return { reminded };
}

// ------------------------------------------------------------------ SOP compliance assessment (SOP_Compliance_Assessment)

async function sopCheckList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const uid = str(q.employeeUid, 120);
  if (uid && !(c.ctx.uid === uid || isMyReport(c, uid) || c.isHr || c.isApprover)) return fail(403, 'You do not have permission to see that.');
  let items = await listK(c.cid, 'sopCheck');
  items = uid ? items.filter((x) => x.uid === uid) : c.isHr || c.isApprover ? items : items.filter((x) => x.uid === c.ctx.uid || isMyReport(c, x.uid));
  if (q.cycleId) items = items.filter((x) => x.cycleId === str(q.cycleId, 80));
  return ok({ items });
}

async function sopCheckSave(c: C, b: any): Promise<Result> {
  const p = anyPerson(c, b.employeeUid);
  if (!p || !p.active) return fail(400, 'Choose an employee of this company.');
  const sop = await getK(c.cid, str(b.sopId, 80), 'sop');
  if (!sop) return fail(404, 'That SOP was not found.');
  const mayCheck = isMyReport(c, p.uid) || c.isHr || sop.processOwnerUid === c.ctx.uid;
  if (!mayCheck) return fail(403, 'Only the reporting manager, the SOP owner or HR can assess SOP compliance.');
  if (p.uid === c.ctx.uid && !c.isHr) return fail(403, 'You cannot assess your own SOP compliance.');
  const cycleId = str(b.cycleId, 80);
  if (cycleId) { const cy = await getK(c.cid, cycleId, 'cycle'); if (!cy) return fail(404, 'That review cycle was not found.'); if (cy.lockStatus === 'LOCKED') return fail(409, 'That cycle is locked.'); }
  const cps: any[] = sop.checkpoints || [];
  const rows: any[] = [];
  for (const r of Array.isArray(b.rows) ? b.rows : []) {
    const cp = cps.find((x) => x.id === str(r?.checkpointId, 60));
    if (!cp) continue;
    const result = oneOf(r?.result, SOP_RESULTS, 'NOT_VERIFIED') as SopResult;
    const severity = oneOf(r?.severity, ['LOW', 'MEDIUM', 'HIGH'] as const, 'MEDIUM');
    const corrective = str(r?.correctiveAction, 300);
    if (result === 'NON_COMPLIANT' && !corrective) return fail(400, `"${cp.control}" is non-compliant. Write the corrective action so it can be followed up.`);
    rows.push({ checkpointId: cp.id, control: cp.control, critical: !!cp.critical, weight: cp.weight || 1, result, evidence: str(r?.evidence, 300), severity: result === 'NON_COMPLIANT' ? severity : '', correctiveAction: result === 'NON_COMPLIANT' ? corrective : '' });
  }
  if (rows.length === 0) return fail(400, 'Mark at least one checkpoint.');
  const id = `sc_${cycleId || 'adhoc'}_${p.uid}_${sop.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
  const prev = await getK(c.cid, id, 'sopCheck');
  const item: Item = { id, companyId: c.cid, kind: 'sopCheck', uid: p.uid, employeeName: p.name, sopId: sop.id, sopTitle: sop.title, versionId: sop.versionId, versionNumber: sop.versionNumber, cycleId, rows, reviewerUid: c.ctx.uid, reviewerName: c.who, reviewedOn: today() };
  await putK(item);
  await audit(c, 'sopCheck', id, prev ? 'UPDATED' : 'CREATED', prev ? { results: prev.rows.length } : null, { results: rows.length }, p.uid);
  return ok({ item });
}

// ------------------------------------------------------------------ plans

async function planView(c: C, plan: Item) {
  const [kras, kpis, acks] = await Promise.all([listK(c.cid, 'kraAssign'), listK(c.cid, 'kpiTarget'), listK(c.cid, 'kraAck')]);
  const myKras = kras.filter((k) => k.planId === plan.id);
  const myKpis = kpis.filter((k) => k.planId === plan.id);
  const check = validateKpiWeights(myKpis as any);
  return { ...plan, kras: myKras, kpis: myKpis, weightsOk: check.ok, weightsTotal: check.total, weightsError: check.error || '', acknowledgement: acks.find((a) => a.planId === plan.id) || null,
    missingTargets: myKpis.filter((k) => !str(k.target, 300)).length };
}

async function planList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10) || 'mine';
  let items = await listK(c.cid, 'plan');
  if (scope === 'mine') items = items.filter((p) => p.uid === c.ctx.uid);
  else if (scope === 'team') items = items.filter((p) => isMyReport(c, p.uid));
  else if (!c.isHr && !c.isApprover) return fail(403, 'You do not have permission to see everyone\'s plans.');
  if (q.employeeUid) items = items.filter((p) => p.uid === str(q.employeeUid, 120));
  if (q.history !== '1') items = items.filter((p) => p.status !== 'SUPERSEDED');
  items.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const [kpis] = await Promise.all([listK(c.cid, 'kpiTarget')]);
  return ok({ items: items.map((p) => { const mine = kpis.filter((k) => k.planId === p.id); const w = validateKpiWeights(mine as any); return { ...p, kpiCount: mine.length, missingTargets: mine.filter((k) => !str(k.target, 300)).length, weightsOk: w.ok, weightsTotal: w.total }; }) });
}

async function planGet(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const plan = await getK(c.cid, str(q.id, 80), 'plan');
  if (!plan || !(plan.uid === c.ctx.uid || isMyReport(c, plan.uid) || c.isHr || c.isApprover)) return fail(404, 'That plan was not found.');
  return ok({ item: await planView(c, plan) });
}

const EDITABLE = ['GENERATED', 'CUSTOMISED'];

/** Manager customisation: targets, measurement, weightage, frequency; add or remove a KPI. Weights are checked when the plan is sent on. */
async function planSave(c: C, b: any): Promise<Result> {
  const plan = await getK(c.cid, str(b.id, 80), 'plan');
  if (!plan) return fail(404, 'That plan was not found.');
  const isMgr = isMyReport(c, plan.uid);
  if (!isMgr && !c.isHr) return fail(403, 'Only the reporting manager or HR can change targets.');
  if (!EDITABLE.includes(plan.status)) return fail(409, plan.status === 'CONFIGURATION_PENDING' ? 'This plan cannot be edited until the missing setup is done.' : 'This plan has already been validated or approved, so it is locked. Use "Revise" to start a new version.');
  if (plan.status === 'CUSTOMISED' && !c.isHr) return fail(409, 'This plan is with HR for validation. Ask HR to return it if you need to change it.');
  const kpis = (await listK(c.cid, 'kpiTarget')).filter((k) => k.planId === plan.id);
  for (const t of Array.isArray(b.targets) ? b.targets : []) {
    const k = kpis.find((x) => x.id === str(t?.targetId, 80));
    if (!k) continue;
    if (t.remove === true) { await db().collection('pmItems').doc(k.id).delete(); continue; }
    const w = num(t.weightage);
    await putK({ ...k, target: t.target !== undefined ? str(t.target, 300) : k.target, measurement: t.measurement !== undefined ? str(t.measurement, 300) : k.measurement, description: t.description !== undefined ? str(t.description, 400) : k.description,
      weightage: w !== null && w >= 0 ? w : k.weightage, frequency: t.frequency !== undefined ? oneOf(t.frequency, FREQ, k.frequency) : k.frequency, evidenceSource: t.evidenceSource !== undefined ? oneOf(t.evidenceSource, SRC, k.evidenceSource) : k.evidenceSource });
  }
  const kras = (await listK(c.cid, 'kraAssign')).filter((k) => k.planId === plan.id);
  for (const a of Array.isArray(b.add) ? b.add.slice(0, 10) : []) {
    const kraName = str(a?.kraName, 120); const kpiName = str(a?.kpiName, 160);
    if (!kraName || !kpiName) return fail(400, 'A new KPI needs a KRA name and a KPI name.');
    let kra = kras.find((k) => lc(k.kraName) === lc(kraName));
    if (!kra) { kra = { id: newId(), companyId: c.cid, kind: 'kraAssign', planId: plan.id, uid: plan.uid, kraId: '', kraName, weight: 0, effectiveFrom: plan.effectiveFrom }; await putK(kra); kras.push(kra); }
    await putK({ id: newId(), companyId: c.cid, kind: 'kpiTarget', planId: plan.id, uid: plan.uid, kraAssignId: kra.id, kraName, kpiId: '', kpiName, description: str(a?.description, 400), measurement: str(a?.measurement, 300), targetHint: '', target: str(a?.target, 300),
      weightage: Math.max(0, num(a?.weightage) ?? 0), frequency: oneOf(a?.frequency, FREQ, 'MONTHLY'), evidenceSource: oneOf(a?.evidenceSource, SRC, 'TASK_SYSTEM'), sopRef: '', owner: 'Employee', reviewerUid: plan.managerUid, effectiveFrom: plan.effectiveFrom });
  }
  await refreshKraWeights(c, plan.id);
  for (const k of (await listK(c.cid, 'kraAssign')).filter((x) => x.planId === plan.id && x.weight === 0)) await db().collection('pmItems').doc(k.id).delete();
  await audit(c, 'plan', plan.id, 'TARGETS_EDITED', null, { by: c.who }, plan.uid);
  return ok({ item: await planView(c, plan) });
}

function problemsToSend(v: Awaited<ReturnType<typeof planView>>): string[] {
  const out: string[] = [];
  if (!v.weightsOk) out.push(v.weightsError || 'The KPI weights do not add up to 100.');
  if (v.missingTargets > 0) out.push(`${v.missingTargets} KPI${v.missingTargets > 1 ? 's have' : ' has'} no target yet. Targets must be agreed for this role, client portfolio, budget and period; they are never made up for you.`);
  return out;
}

async function planAct(c: C, b: any): Promise<Result> {
  const plan = await getK(c.cid, str(b.id, 80), 'plan');
  if (!plan) return fail(404, 'That plan was not found.');
  const action = str(b.action, 20);
  const note = str(b.note, 500);
  const isEmp = plan.uid === c.ctx.uid;
  const isMgr = isMyReport(c, plan.uid);
  const view = await planView(c, plan);
  const move = async (status: string, who: string, extra: Record<string, any> = {}) => {
    const next = { ...plan, ...extra, status, history: [...(plan.history || []), { at: nowIso(), by: c.who, action: action.toUpperCase(), note }] };
    await putK(next); await audit(c, 'plan', plan.id, action.toUpperCase(), { status: plan.status }, { status, note }, plan.uid);
    return ok({ item: await planView(c, next), message: who });
  };
  switch (action) {
    case 'submit': {
      if (!isMgr && !c.isHr) return fail(403, 'Only the reporting manager can send this to HR.');
      if (plan.status !== 'GENERATED') return fail(409, 'This plan is not waiting for the manager.');
      const p = problemsToSend(view); if (p.length) return fail(400, p.join(' '), { problems: p });
      return move('CUSTOMISED', 'Sent to HR for validation.', { customisedBy: c.who, customisedAt: nowIso() });
    }
    case 'validate': {
      if (!c.isHr) return fail(403, 'Only HR can validate a plan.');
      if (plan.status !== 'CUSTOMISED') return fail(409, 'This plan is not waiting for HR validation.');
      const p = problemsToSend(view); if (p.length) return fail(400, p.join(' '), { problems: p });
      return move('VALIDATED', 'Validated. Now it needs an authorized approver.', { validatedBy: c.who, validatedAt: nowIso() });
    }
    case 'approve': {
      if (!c.isApprover) return fail(403, 'Only an authorized approver can approve a plan.');
      if (isEmp) return fail(403, 'You cannot approve your own plan. It must be approved by someone else with approval rights.');
      if (plan.status !== 'VALIDATED') return fail(409, 'HR has not validated this plan yet.');
      const p = problemsToSend(view); if (p.length) return fail(400, p.join(' '), { problems: p });
      await tell(c, [plan.uid], 'Your performance expectations are ready', `Your KRA/KPI for ${plan.roleName} has been approved. Open Performance > My performance, read it and acknowledge it.`);
      return move('APPROVED', 'Approved. The employee has been asked to acknowledge it.', { approvedBy: c.who, approvedAt: nowIso() });
    }
    case 'acknowledge': {
      if (!isEmp) return fail(403, 'Only the employee can acknowledge their own expectations.');
      if (plan.status !== 'APPROVED') return fail(409, 'This plan is not waiting for your acknowledgement.');
      await putK({ id: newId(), companyId: c.cid, kind: 'kraAck', planId: plan.id, uid: plan.uid, employeeName: plan.employeeName, acknowledgedAt: nowIso(), note });
      await clearException(c, 'NO_KRA_KPI', `plan_${plan.uid}`, 'The KRA/KPI is approved and acknowledged.');
      // The old version, if this replaces one, ends today (it was kept until now so the person was never without expectations).
      return move('ACTIVE', 'Acknowledged. Tracking has started.', { acknowledgedAt: nowIso() });
    }
    case 'return': {
      if (!note) return fail(400, 'Say what should change, so the manager knows what to fix.');
      if (!(isEmp || c.isHr || c.isApprover || isMgr)) return fail(403, 'You cannot send this plan back.');
      if (!['CUSTOMISED', 'VALIDATED', 'APPROVED'].includes(plan.status)) return fail(409, 'This plan cannot be sent back from its current step.');
      if (isEmp && plan.status !== 'APPROVED') return fail(403, 'You can only query your plan once it has been approved.');
      if (plan.managerUid) await tell(c, [plan.managerUid], `Plan for ${plan.employeeName} sent back`, `${c.who} sent it back: ${note}`);
      return move('GENERATED', 'Sent back to the manager.');
    }
    default: return fail(400, 'Unknown action.');
  }
}

/** Starts a new version of an active plan (for example the targets changed mid-year). The old one stays in force until the new one is acknowledged. */
async function planRevise(c: C, b: any): Promise<Result> {
  const plan = await getK(c.cid, str(b.id, 80), 'plan');
  if (!plan || plan.status !== 'ACTIVE') return fail(409, 'Only an active plan can be revised.');
  if (!c.isHr && !isMyReport(c, plan.uid)) return fail(403, 'Only the reporting manager or HR can revise a plan.');
  const reason = str(b.reason, 300);
  if (!reason) return fail(400, 'Say why the plan is being revised.');
  const copy: Item = { ...plan, id: newId(), status: 'GENERATED', supersedes: plan.id, effectiveFrom: today(), effectiveTo: '', acknowledgedAt: '', approvedBy: '', validatedBy: '', customisedBy: '', history: [{ at: nowIso(), by: c.who, action: 'REVISION_STARTED', note: reason }] };
  await putK(copy);
  const [kras, kpis] = await Promise.all([listK(c.cid, 'kraAssign'), listK(c.cid, 'kpiTarget')]);
  const map = new Map<string, string>();
  for (const k of kras.filter((x) => x.planId === plan.id)) { const nid = newId(); map.set(k.id, nid); await putK({ ...k, id: nid, planId: copy.id, effectiveFrom: today() }); }
  for (const k of kpis.filter((x) => x.planId === plan.id)) await putK({ ...k, id: newId(), planId: copy.id, kraAssignId: map.get(k.kraAssignId) || '', effectiveFrom: today() });
  await audit(c, 'plan', copy.id, 'REVISION_STARTED', { from: plan.id }, { reason }, plan.uid);
  return ok({ item: await planView(c, copy) });
}

/** When a revised plan is acknowledged, the version it replaces ends (effective-dated; its evidence and history stay). */
export async function closeSuperseded(c: C, plan: Item): Promise<void> {
  if (!plan.supersedes) return;
  const old = await getK(c.cid, plan.supersedes, 'plan');
  if (old && old.status !== 'SUPERSEDED') { await putK({ ...old, status: 'SUPERSEDED', effectiveTo: addDays(plan.effectiveFrom, -1) < old.effectiveFrom ? old.effectiveFrom : addDays(plan.effectiveFrom, -1), supersededBy: plan.id }); await audit(c, 'plan', old.id, 'SUPERSEDED', null, { by: plan.id }, old.uid); }
}

// ------------------------------------------------------------------ the sync (what the n8n triggers did)

/**
 * Joining, confirmation, transfer, role or manager change, SOP publication: one pass that brings everyone up to date.
 * Safe to press repeatedly, and run daily. Old plans are kept; the new one starts today.
 */
export async function syncPlans(c: C): Promise<Result> {
  const bd = await bundle(c);
  const stats = { created: 0, rebuilt: 0, transfers: 0, managerChanges: 0, sopAssigned: 0, stillWaiting: 0 };
  for (const p of c.people.filter((x) => x.active)) {
    const cur = latestPlan(bd.plans, p.uid);
    const cfg = configIssues(c, p, bd);
    if (!cur) { const r = await buildPlan(c, p, p.createdDate >= addDays(today(), -45) ? 'JOINING' : 'NEW_CYCLE', bd); stats.created++; if (r.plan.status === 'CONFIGURATION_PENDING') stats.stillWaiting++; continue; }
    if (cur.status === 'CONFIGURATION_PENDING') { const r = await buildPlan(c, p, cur.trigger as PlanTrigger, bd, cur.id); if (r.plan.status === 'CONFIGURATION_PENDING') stats.stillWaiting++; else stats.rebuilt++; continue; }
    const moved = lc(cur.department) !== lc(p.department);
    const retitled = cfg.role && cur.roleId && cur.roleId !== cfg.role.id;
    if (moved || retitled) {
      await raise(c, 'DEPARTMENT_TRANSFER', { refId: `${p.uid}_${today()}`, subjectUid: p.uid, refLabel: p.name, detail: `${p.name} moved from ${cur.department || 'no department'} to ${p.department || 'no department'}. The old plan and records are kept; a new plan applies from today.` });
      await buildPlan(c, p, moved ? 'TRANSFER' : 'ROLE_CHANGE', bd); stats.transfers++;
      continue;
    }
    if (cfg.mgr && cur.managerUid !== cfg.mgr && cur.status !== 'SUPERSEDED') {
      // Manager changed: same expectations, new reviewer, effective from today. Evidence and acknowledgements carry over.
      await raise(c, 'MANAGER_CHANGED', { refId: `${p.uid}_${today()}`, subjectUid: p.uid, refLabel: p.name, detail: `${p.name}'s manager changed from ${cur.managerName || 'nobody'} to ${nameOf(c, cfg.mgr)}. Applied from today.` });
      const next = { ...cur, managerUid: cfg.mgr, managerName: nameOf(c, cfg.mgr), history: [...(cur.history || []), { at: nowIso(), by: 'System', action: 'MANAGER_CHANGED', note: `${cur.managerName || '-'} -> ${nameOf(c, cfg.mgr)} from ${today()}` }] };
      await putK(next); Object.assign(cur, next);
      for (const k of (await listK(c.cid, 'kpiTarget')).filter((x) => x.planId === cur.id)) await putK({ ...k, reviewerUid: cfg.mgr });
      await audit(c, 'plan', cur.id, 'MANAGER_CHANGED', { manager: cur.managerUid }, { manager: cfg.mgr }, p.uid);
      stats.managerChanges++;
    }
    if (cfg.role) stats.sopAssigned += (await assignSopsFor(c, p, cfg.role)).created;
  }
  const rem = await sopReminders(c);
  return ok({ ...stats, reminders: rem.reminded, message: `Checked ${c.people.filter((x) => x.active).length} people: ${stats.created} new plan${stats.created === 1 ? '' : 's'}, ${stats.rebuilt} finished set-up, ${stats.transfers} transfer${stats.transfers === 1 ? '' : 's'}, ${stats.managerChanges} manager change${stats.managerChanges === 1 ? '' : 's'}${stats.stillWaiting ? `, ${stats.stillWaiting} still waiting for setup (see the exceptions list)` : ''}.` });
}

async function planRebuild(c: C, b: any): Promise<Result> {
  const p = person(c, b.employeeUid);
  if (!p) return fail(400, 'Choose an active employee of this company.');
  const bd = await bundle(c);
  const cur = latestPlan(bd.plans, p.uid);
  if (cur && cur.status !== 'CONFIGURATION_PENDING') return fail(409, 'This person already has a plan. Use "Revise" to change it.');
  const r = await buildPlan(c, p, 'MANUAL', bd, cur?.id || '');
  return ok({ item: await planView(c, r.plan) });
}

export const PLAN_ROUTES: Record<string, Route> = {
  'tpl-list': { method: 'GET', who: 'hr', run: (c, b, q) => tplList(c, b, q) },
  'tpl-save': { method: 'POST', who: 'hr', run: (c, b) => tplSave(c, b) },
  'tpl-approve': { method: 'POST', who: 'hr', run: (c, b) => tplApprove(c, b) },
  'tpl-delete': { method: 'POST', who: 'hr', run: (c, b) => tplDelete(c, b) },
  'plan-list': { method: 'GET', who: 'any', run: (c, b, q) => planList(c, b, q) },
  'plan-get': { method: 'GET', who: 'any', run: (c, b, q) => planGet(c, b, q) },
  'plan-save': { method: 'POST', who: 'any', run: (c, b) => planSave(c, b) },
  'plan-act': { method: 'POST', who: 'any', run: async (c, b) => { const r = await planAct(c, b); if (r.status === 200 && str(b.action, 20) === 'acknowledge') { const pl = await getK(c.cid, str(b.id, 80), 'plan'); if (pl) await closeSuperseded(c, pl); } return r; } },
  'plan-revise': { method: 'POST', who: 'any', run: (c, b) => planRevise(c, b) },
  'plan-rebuild': { method: 'POST', who: 'hr', run: (c, b) => planRebuild(c, b) },
  sync: { method: 'POST', who: 'hr', run: (c) => syncPlans(c) },
  'sopassign-list': { method: 'GET', who: 'any', run: (c, b, q) => sopAssignList(c, b, q) },
  'sop-read': { method: 'POST', who: 'any', run: (c, b) => sopRead(c, b) },
  'sop-ack': { method: 'POST', who: 'any', run: (c, b) => sopAck(c, b) },
  'sop-train': { method: 'POST', who: 'any', run: (c, b) => sopTrain(c, b) },
  'sop-verify': { method: 'POST', who: 'any', run: (c, b) => sopVerify(c, b) },
  'sop-revision': { method: 'POST', who: 'hr', run: (c, b) => sopRevision(c, b) },
  'sopcheck-list': { method: 'GET', who: 'any', run: (c, b, q) => sopCheckList(c, b, q) },
  'sopcheck-save': { method: 'POST', who: 'any', run: (c, b) => sopCheckSave(c, b) },
};

// kept for other modules
export { bundle, latestPlan, planView, groupBy, clean, reportsOf, isManagerCtx, isDate };
