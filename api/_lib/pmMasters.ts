/**
 * Performance Management masters: HR-PM-001 (framework and cycles), HR-PM-003 (competencies, roles) and the SOP library of HR-PM-004.
 * Assigning these to people, and the review itself, live in pmPlans.ts and pmReviews.ts.
 */
import {
  CORE_COMPETENCIES, ROLE_SPECIFIC_COMPETENCIES, EMPLOYEE_CATEGORIES, REVIEW_TYPES, DEFAULT_WEIGHTS, validateWeights, isDate, addDays,
  type CompetencyCategory, type EmployeeCategory,
} from '../../shared/pmEngine.js';
import {
  audit, clean, db, fail, getK, groupBy, lc, listK, newId, nowIso, num, ok, oneOf, person, putK, raise, clearException, str, strList, tell, today,
  type C, type Item, type Route, type Result,
} from './pmCore.js';

const COMPETENCY_CATEGORIES: CompetencyCategory[] = ['CORE', 'MANAGER', 'BUSINESS_DEVELOPMENT', 'TECHNICAL', 'CREATIVE'];
const CRITICALITY = ['NORMAL', 'CRITICAL'] as const;

// ------------------------------------------------------------------ HR-PM-001 Performance Framework Master

const sortFw = (a: Item, b: Item) => String(a.name).localeCompare(String(b.name)) || (b.version || 0) - (a.version || 0);

/** The approved framework in force on a date for someone of this category and role family. Nothing is silently defaulted. */
export function pickFramework(frameworks: Item[], category: string, roleFamily: string, on = today()): Item | null {
  const live = frameworks.filter((f) => f.status === 'APPROVED' && f.effectiveFrom <= on && (!f.effectiveTo || f.effectiveTo >= on));
  const fam = lc(roleFamily);
  return live.find((f) => f.employeeCategory === category && fam && lc(f.roleFamily) === fam)
    || live.find((f) => f.employeeCategory === category && !f.roleFamily)
    || live.find((f) => !f.employeeCategory && !f.roleFamily)
    || null;
}

async function fwList(c: C): Promise<Result> {
  const all = (await listK(c.cid, 'framework')).sort(sortFw);
  // People who are not HR only see what applies: the approved frameworks (weights are not secret, they are the rules everyone is judged by).
  return ok({ items: c.isHr || c.isApprover ? all : all.filter((f) => f.status === 'APPROVED') });
}

async function fwSave(c: C, b: any): Promise<Result> {
  const w = validateWeights(b.kraWeight, b.behaviourWeight, b.sopWeight);
  if (!w.ok) return fail(400, w.error!);
  const name = str(b.name, 120);
  if (!name) return fail(400, 'Give the framework a name.');
  const category = oneOf(b.employeeCategory, EMPLOYEE_CATEGORIES, 'INDIVIDUAL_CONTRIBUTOR');
  const effectiveFrom = str(b.effectiveFrom, 10) || today();
  const effectiveTo = str(b.effectiveTo, 10);
  if (!isDate(effectiveFrom) || (effectiveTo && !isDate(effectiveTo))) return fail(400, 'Use valid dates.');
  if (effectiveTo && effectiveTo < effectiveFrom) return fail(400, 'The end date is before the start date.');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'framework') : null;
  if (b.id && !prev) return fail(404, 'That framework was not found.');
  const base = { employeeCategory: category, roleFamily: str(b.roleFamily, 80), kraWeight: w.weights!.kra, behaviourWeight: w.weights!.behaviour, sopWeight: w.weights!.sop,
    reviewFrequency: oneOf(b.reviewFrequency, REVIEW_TYPES, 'QUARTERLY'), ratingScaleId: 'FIVE_POINT', effectiveFrom, effectiveTo, name, notes: str(b.notes, 500) };
  // An approved framework is never edited in place: changing it makes a new draft version, and the old one stays on record.
  if (prev && prev.status === 'APPROVED') {
    const all = await listK(c.cid, 'framework');
    const version = Math.max(...all.filter((f) => f.frameworkKey === prev.frameworkKey).map((f) => f.version || 1)) + 1;
    const item: Item = { id: newId(), companyId: c.cid, kind: 'framework', frameworkKey: prev.frameworkKey, version, status: 'DRAFT', approvedBy: '', approvedAt: '', createdBy: c.who, ...base };
    await putK(item);
    await audit(c, 'framework', item.id, 'NEW_VERSION', { version: prev.version }, { version });
    return ok({ item, newVersion: true });
  }
  const id = prev?.id || newId();
  const item: Item = { ...(prev || {}), id, companyId: c.cid, kind: 'framework', frameworkKey: prev?.frameworkKey || id, version: prev?.version || 1, status: prev?.status || 'DRAFT', approvedBy: '', approvedAt: '', createdBy: prev?.createdBy || c.who, ...base };
  await putK(item);
  await audit(c, 'framework', id, prev ? 'UPDATED' : 'CREATED', prev ? { weights: [prev.kraWeight, prev.behaviourWeight, prev.sopWeight] } : null, { weights: [base.kraWeight, base.behaviourWeight, base.sopWeight] });
  return ok({ item });
}

/** Workflow PM-001 "Framework Sync": publishing makes it the active framework and retires the one it replaces. */
async function fwApprove(c: C, b: any): Promise<Result> {
  const f = await getK(c.cid, str(b.id, 80), 'framework');
  if (!f) return fail(404, 'That framework was not found.');
  if (f.status !== 'DRAFT') return fail(409, 'Only a draft can be approved.');
  const w = validateWeights(f.kraWeight, f.behaviourWeight, f.sopWeight);
  if (!w.ok) return fail(400, w.error!);
  const all = await listK(c.cid, 'framework');
  for (const o of all) {
    if (o.id !== f.id && o.frameworkKey === f.frameworkKey && o.status === 'APPROVED') {
      await putK({ ...o, status: 'RETIRED', effectiveTo: o.effectiveTo && o.effectiveTo < addDays(f.effectiveFrom, -1) ? o.effectiveTo : addDays(f.effectiveFrom, -1) });
      await audit(c, 'framework', o.id, 'RETIRED', { status: 'APPROVED' }, { status: 'RETIRED' });
    }
  }
  const next = { ...f, status: 'APPROVED', approvedBy: c.who, approvedByUid: c.ctx.uid, approvedAt: nowIso() };
  await putK(next);
  await audit(c, 'framework', f.id, 'APPROVED', { status: 'DRAFT' }, { status: 'APPROVED', version: f.version });
  // Anything that was waiting only for a framework can now go ahead (see pmPlans.syncPlans, run by the HR "Check for changes" button and the daily job).
  return ok({ item: next, message: 'Framework approved. It is now the active one for the people it covers.' });
}

async function fwRetire(c: C, b: any): Promise<Result> {
  const f = await getK(c.cid, str(b.id, 80), 'framework');
  if (!f) return fail(404, 'That framework was not found.');
  if (f.status === 'DRAFT') { await db().collection('pmItems').doc(f.id).delete(); await audit(c, 'framework', f.id, 'DRAFT_DELETED', { name: f.name }, null); return ok({ deleted: true }); }
  const next = { ...f, status: 'RETIRED', effectiveTo: f.effectiveTo || today() };
  await putK(next);
  await audit(c, 'framework', f.id, 'RETIRED', { status: f.status }, { status: 'RETIRED' });
  return ok({ item: next });
}

// ------------------------------------------------------------------ cycles

async function cycleList(c: C): Promise<Result> {
  const items = (await listK(c.cid, 'cycle')).sort((a, b) => String(b.periodStart).localeCompare(String(a.periodStart)));
  return ok({ items });
}

async function cycleSave(c: C, b: any): Promise<Result> {
  const name = str(b.name, 120);
  const periodStart = str(b.periodStart, 10); const periodEnd = str(b.periodEnd, 10);
  if (!name) return fail(400, 'Give the review cycle a name, like "Q4 2026 review".');
  if (!isDate(periodStart) || !isDate(periodEnd)) return fail(400, 'Choose the period start and end dates.');
  if (periodEnd < periodStart) return fail(400, 'The period ends before it starts.');
  const self = str(b.selfReviewDeadline, 10); const mgr = str(b.managerDeadline, 10); const hr = str(b.hrDeadline, 10);
  for (const d of [self, mgr, hr]) if (d && !isDate(d)) return fail(400, 'Use valid deadline dates.');
  if ((self && mgr && self > mgr) || (mgr && hr && mgr > hr) || (self && hr && self > hr)) return fail(400, 'Deadlines must go in order: self-review, then manager, then HR.');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'cycle') : null;
  if (b.id && !prev) return fail(404, 'That cycle was not found.');
  if (prev && prev.lockStatus === 'LOCKED') return fail(409, 'This cycle is locked. Nothing can be changed.');
  if (prev && prev.openedAt && (prev.periodStart !== periodStart || prev.periodEnd !== periodEnd)) return fail(409, 'This cycle is already open, so its period cannot change. Deadlines still can.');
  const scope = oneOf(b.scope, ['ALL', 'DEPARTMENT', 'SELECTED'] as const, 'ALL');
  const departments = strList(b.departments, 40, 80);
  const employeeUids = strList(b.employeeUids, 400, 120).filter((u) => !!person(c, u));
  if (scope === 'DEPARTMENT' && departments.length === 0) return fail(400, 'Choose at least one department.');
  if (scope === 'SELECTED' && employeeUids.length === 0) return fail(400, 'Choose at least one employee.');
  const id = prev?.id || newId();
  const item: Item = { ...(prev || {}), id, companyId: c.cid, kind: 'cycle', name, reviewType: oneOf(b.reviewType, REVIEW_TYPES, 'QUARTERLY'), periodStart, periodEnd,
    selfReviewDeadline: self, managerDeadline: mgr, hrDeadline: hr, scope, departments, employeeUids, lockStatus: prev?.lockStatus || 'OPEN', openedAt: prev?.openedAt || '' };
  await putK(item);
  await audit(c, 'cycle', id, prev ? 'UPDATED' : 'CREATED', prev ? { periodStart: prev.periodStart, periodEnd: prev.periodEnd } : null, { periodStart, periodEnd });
  return ok({ item });
}

async function cycleDelete(c: C, b: any): Promise<Result> {
  const cy = await getK(c.cid, str(b.id, 80), 'cycle');
  if (!cy) return fail(404, 'That cycle was not found.');
  if (cy.openedAt) return fail(409, 'This cycle has been opened and has reviews, so it cannot be deleted. Lock it instead.');
  await db().collection('pmItems').doc(cy.id).delete();
  await audit(c, 'cycle', cy.id, 'DELETED', { name: cy.name }, null);
  return ok({});
}

// ------------------------------------------------------------------ HR-PM-003 competencies, roles

async function compList(c: C): Promise<Result> {
  const items = (await listK(c.cid, 'competency')).sort((a, b) => (a.category === 'CORE' ? 0 : 1) - (b.category === 'CORE' ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
  return ok({ items });
}

async function compSave(c: C, b: any): Promise<Result> {
  const name = str(b.name, 120);
  if (!name) return fail(400, 'Give the competency a name.');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'competency') : null;
  if (b.id && !prev) return fail(404, 'That competency was not found.');
  const all = await listK(c.cid, 'competency');
  if (all.some((x) => x.id !== prev?.id && lc(x.name) === lc(name))) return fail(409, 'There is already a competency with that name.');
  const id = prev?.id || newId();
  const standard = str(b.standard, 400);
  const item: Item = { ...(prev || {}), id, companyId: c.cid, kind: 'competency', name, category: oneOf(b.category, COMPETENCY_CATEGORIES, 'CORE'), definition: str(b.definition, 500),
    standard, exampleEvidence: str(b.exampleEvidence, 300), active: b.active === false ? false : true, version: (prev?.version || 0) + 1 };
  await putK(item);
  await audit(c, 'competency', id, prev ? 'UPDATED' : 'CREATED', prev ? { standard: prev.standard } : null, { standard });
  return ok({ item });
}

async function compDelete(c: C, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 80), 'competency');
  if (!it) return fail(404, 'That competency was not found.');
  const used = (await listK(c.cid, 'compAssess')).some((a) => a.competencyId === it.id);
  if (used) { await putK({ ...it, active: false }); await audit(c, 'competency', it.id, 'DEACTIVATED', { active: true }, { active: false }); return ok({ deactivated: true, message: 'It has been used in reviews, so it was switched off instead of deleted. Past reviews keep it.' }); }
  await db().collection('pmItems').doc(it.id).delete();
  const maps = (await listK(c.cid, 'roleCompetency')).filter((m) => m.competencyId === it.id);
  for (const m of maps) await db().collection('pmItems').doc(m.id).delete();
  await audit(c, 'competency', it.id, 'DELETED', { name: it.name }, null);
  return ok({ deleted: true });
}

async function roleList(c: C): Promise<Result> {
  const [roles, maps, sopMaps, templates] = await Promise.all([listK(c.cid, 'role'), listK(c.cid, 'roleCompetency'), listK(c.cid, 'roleSop'), listK(c.cid, 'roleTemplate')]);
  const people = c.people.filter((p) => p.active);
  const items = roles.sort((a, b) => String(a.department).localeCompare(String(b.department)) || String(a.name).localeCompare(String(b.name))).map((r) => ({
    ...r,
    competencyIds: maps.filter((m) => m.roleId === r.id).map((m) => ({ competencyId: m.competencyId, expectedLevel: m.expectedLevel, weight: m.weight })),
    sopCount: sopMaps.filter((m) => m.roleId === r.id).length,
    hasTemplate: templates.some((t) => t.roleId === r.id && t.status === 'APPROVED'),
    people: people.filter((p) => lc(p.title) === lc(r.name) && lc(p.department) === lc(r.department)).length,
  }));
  return ok({ items });
}

async function roleSave(c: C, b: any): Promise<Result> {
  const name = str(b.name, 120); const department = str(b.department, 80);
  if (!name) return fail(400, 'Give the role a name (the job title).');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'role') : null;
  if (b.id && !prev) return fail(404, 'That role was not found.');
  const roles = await listK(c.cid, 'role');
  if (roles.some((r) => r.id !== prev?.id && lc(r.name) === lc(name) && lc(r.department) === lc(department))) return fail(409, 'That role already exists in that department.');
  const id = prev?.id || newId();
  const item: Item = { ...(prev || {}), id, companyId: c.cid, kind: 'role', name, department, roleFamily: str(b.roleFamily, 80), employeeCategory: oneOf(b.employeeCategory, EMPLOYEE_CATEGORIES, 'INDIVIDUAL_CONTRIBUTOR') as EmployeeCategory };
  await putK(item);
  await audit(c, 'role', id, prev ? 'UPDATED' : 'CREATED', prev ? { name: prev.name, department: prev.department } : null, { name, department });
  return ok({ item });
}

async function roleDelete(c: C, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 80), 'role');
  if (!it) return fail(404, 'That role was not found.');
  const inUse = (await listK(c.cid, 'plan')).some((p) => p.roleId === it.id);
  if (inUse) return fail(409, 'Someone has a performance plan under this role, so it cannot be deleted.');
  for (const kind of ['roleCompetency', 'roleSop', 'roleTemplate']) for (const m of (await listK(c.cid, kind)).filter((x) => x.roleId === it.id)) await db().collection('pmItems').doc(m.id).delete();
  await db().collection('pmItems').doc(it.id).delete();
  await audit(c, 'role', it.id, 'DELETED', { name: it.name }, null);
  return ok({});
}

/** One click: a role for every distinct department + job title among the active employees. */
async function roleAuto(c: C): Promise<Result> {
  const roles = await listK(c.cid, 'role');
  let created = 0;
  for (const p of c.people.filter((x) => x.active && x.title)) {
    if (roles.some((r) => lc(r.name) === lc(p.title) && lc(r.department) === lc(p.department))) continue;
    const item: Item = { id: newId(), companyId: c.cid, kind: 'role', name: p.title, department: p.department, roleFamily: '', employeeCategory: 'INDIVIDUAL_CONTRIBUTOR' };
    await putK(item); roles.push(item); created++;
  }
  if (created) await audit(c, 'role', 'auto', 'AUTO_CREATED', null, { created });
  const noTitle = c.people.filter((p) => p.active && !p.title).length;
  return ok({ created, noTitle, message: created ? `Created ${created} role${created > 1 ? 's' : ''} from your employees' job titles.` : 'Every job title already has a role.' });
}

/** Role -> competencies. The core ones apply to everyone automatically; this adds the role-specific ones. */
async function roleCompSave(c: C, b: any): Promise<Result> {
  const role = await getK(c.cid, str(b.roleId, 80), 'role');
  if (!role) return fail(404, 'That role was not found.');
  const comps = await listK(c.cid, 'competency');
  const rows: { competencyId: string; expectedLevel: number; weight: number }[] = [];
  for (const r of Array.isArray(b.competencies) ? b.competencies.slice(0, 60) : []) {
    const comp = comps.find((x) => x.id === str(r?.competencyId, 80));
    if (!comp) return fail(400, 'One of the competencies was not found.');
    const level = num(r?.expectedLevel) ?? 3; const weight = num(r?.weight) ?? 1;
    if (level < 1 || level > 5) return fail(400, 'Expected level is from 1 to 5.');
    if (weight <= 0) return fail(400, 'Each competency weight must be above 0.');
    rows.push({ competencyId: comp.id, expectedLevel: level, weight });
  }
  const old = (await listK(c.cid, 'roleCompetency')).filter((m) => m.roleId === role.id);
  for (const o of old) await db().collection('pmItems').doc(o.id).delete();
  for (const r of rows) await putK({ id: newId(), companyId: c.cid, kind: 'roleCompetency', roleId: role.id, ...r });
  await audit(c, 'role', role.id, 'COMPETENCIES_SET', { count: old.length }, { count: rows.length });
  return ok({ saved: rows.length });
}

// ------------------------------------------------------------------ HR-PM-004 Department SOP library

async function sopDocs(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const snap = await db().collection('documents').where('companyId', '==', c.cid).get();
  const showAll = str(q.all, 3) === '1';
  const items = snap.docs.map((d: any) => ({ docId: d.id, ...(d.data() as any) }))
    .filter((d: any) => d.currentPublishedVersionId && (showAll || String(d.category) === 'SOP'))
    .map((d: any) => ({ documentId: str(d.documentId, 60), title: str(d.title, 200), department: str(d.departmentName, 80), category: str(d.category, 40), versionId: str(d.currentPublishedVersionId, 80), versionNumber: str(d.currentPublishedVersionNumber, 20) }))
    .sort((a: any, b: any) => a.title.localeCompare(b.title));
  return ok({ items });
}

async function findDoc(cid: string, documentId: string): Promise<{ versionId: string; versionNumber: string; title: string; department: string } | null> {
  const snap = await db().collection('documents').where('companyId', '==', cid).get();
  const d = snap.docs.map((x: any) => x.data() as any).find((x: any) => str(x.documentId, 60) === documentId);
  if (!d || !d.currentPublishedVersionId) return null;
  return { versionId: str(d.currentPublishedVersionId, 80), versionNumber: str(d.currentPublishedVersionNumber, 20), title: str(d.title, 200), department: str(d.departmentName, 80) };
}

const cleanCheckpoints = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 40).map((x: any, i: number) => ({
  id: str(x?.id, 40) || `cp${Date.now().toString(36)}${i}`, control: str(x?.control, 300), critical: x?.critical === true, weight: Math.max(1, num(x?.weight) ?? 1),
})).filter((x) => x.control);

async function sopList(c: C): Promise<Result> {
  const [sops, maps, assigns] = await Promise.all([listK(c.cid, 'sop'), listK(c.cid, 'roleSop'), listK(c.cid, 'sopAssign')]);
  const items = sops.sort((a, b) => String(a.department).localeCompare(String(b.department)) || String(a.title).localeCompare(String(b.title))).map((s) => {
    const mine = assigns.filter((a) => a.sopId === s.id && a.status !== 'SUPERSEDED');
    return { ...s, roleIds: maps.filter((m) => m.sopId === s.id).map((m) => m.roleId), assigned: mine.length, acknowledged: mine.filter((a) => a.acknowledgedAt).length };
  });
  return ok({ items });
}

async function sopSave(c: C, b: any): Promise<Result> {
  const title = str(b.title, 160); const department = str(b.department, 80);
  if (!title) return fail(400, 'Give the SOP a title.');
  if (!department) return fail(400, 'Choose the department this SOP belongs to.');
  const prev = b.id ? await getK(c.cid, str(b.id, 80), 'sop') : null;
  if (b.id && !prev) return fail(404, 'That SOP was not found.');
  const documentId = str(b.documentId, 60);
  let doc = null as Awaited<ReturnType<typeof findDoc>>;
  if (documentId) {
    doc = await findDoc(c.cid, documentId);
    if (!doc) return fail(400, `The document ${documentId} has no published version in Document Governance yet. Publish it there first, or leave the link empty.`);
  }
  const owner = b.processOwnerUid ? person(c, b.processOwnerUid) : null;
  if (b.processOwnerUid && !owner) return fail(400, 'The process owner must be an active person in this company.');
  const checkpoints = cleanCheckpoints(b.checkpoints);
  if (checkpoints.length === 0) return fail(400, 'Add at least one checkpoint: a control that can be checked, like "Budget approved before launch".');
  const id = prev?.id || newId();
  const versionChanged = !!prev && !!doc && prev.versionId && prev.versionId !== doc.versionId;
  const item: Item = { ...(prev || {}), id, companyId: c.cid, kind: 'sop', department, title, documentId, docTitle: doc?.title || '',
    versionId: doc?.versionId || prev?.versionId || 'manual-1', versionNumber: doc?.versionNumber || prev?.versionNumber || '1', processOwnerUid: owner?.uid || '', processOwnerName: owner?.name || '',
    criticality: oneOf(b.criticality, CRITICALITY, 'NORMAL'), trainingRequired: b.trainingRequired === true, acknowledgementRequired: b.acknowledgementRequired !== false,
    managerVerificationRequired: b.managerVerificationRequired === true, effectiveFrom: str(b.effectiveFrom, 10) || today(), reviewDate: str(b.reviewDate, 10), checkpoints, status: prev?.status === 'RETIRED' ? 'RETIRED' : 'ACTIVE',
    pendingRevision: versionChanged ? null : prev?.pendingRevision || null };
  await putK(item);
  // Role_SOP_Map: which roles must follow it. No roles chosen = the whole department.
  const roles = await listK(c.cid, 'role');
  const wanted = strList(b.roleIds, 60, 80).filter((r) => roles.some((x) => x.id === r));
  const old = (await listK(c.cid, 'roleSop')).filter((m) => m.sopId === id);
  for (const o of old) await db().collection('pmItems').doc(o.id).delete();
  for (const roleId of wanted) await putK({ id: newId(), companyId: c.cid, kind: 'roleSop', roleId, sopId: id, mandatory: true, criticality: item.criticality });
  await audit(c, 'sop', id, prev ? 'UPDATED' : 'CREATED', prev ? { version: prev.versionNumber } : null, { version: item.versionNumber, roles: wanted.length });
  await clearException(c, 'SOP_MISSING', `dept_${lc(department)}`, 'A SOP now exists for this department.');
  return ok({ item });
}

async function sopDelete(c: C, b: any): Promise<Result> {
  const s = await getK(c.cid, str(b.id, 80), 'sop');
  if (!s) return fail(404, 'That SOP was not found.');
  const assigns = (await listK(c.cid, 'sopAssign')).filter((a) => a.sopId === s.id);
  if (assigns.length) { await putK({ ...s, status: 'RETIRED' }); await audit(c, 'sop', s.id, 'RETIRED', { status: s.status }, { status: 'RETIRED' }); return ok({ retired: true, message: 'People have already been assigned this SOP, so it was retired instead of deleted. History is kept.' }); }
  for (const m of (await listK(c.cid, 'roleSop')).filter((x) => x.sopId === s.id)) await db().collection('pmItems').doc(m.id).delete();
  await db().collection('pmItems').doc(s.id).delete();
  await audit(c, 'sop', s.id, 'DELETED', { title: s.title }, null);
  return ok({ deleted: true });
}

/**
 * Checks every SOP against the published version of its controlled document. A new published version does NOT silently change
 * what people were assigned: it becomes a pending revision, and HR says whether it is material (retrain / re-acknowledge) or not.
 */
export async function sopSync(c: C): Promise<Result> {
  const sops = (await listK(c.cid, 'sop')).filter((s) => s.documentId && s.status === 'ACTIVE');
  const found: { id: string; title: string; from: string; to: string }[] = [];
  for (const s of sops) {
    const doc = await findDoc(c.cid, s.documentId);
    if (!doc || doc.versionId === s.versionId) continue;
    if (s.pendingRevision?.versionId === doc.versionId) continue;
    await putK({ ...s, pendingRevision: { versionId: doc.versionId, versionNumber: doc.versionNumber, detectedAt: nowIso() } });
    await audit(c, 'sop', s.id, 'NEW_DOCUMENT_VERSION', { version: s.versionNumber }, { version: doc.versionNumber });
    const hr = c.people.filter((p) => p.active && p.uid === s.processOwnerUid).map((p) => p.uid);
    await raise(c, 'SOP_VERSION_CHANGED', { refId: s.id, refLabel: s.title, ownerUid: s.processOwnerUid, detail: `${s.title}: version ${s.versionNumber} is now ${doc.versionNumber} in Document Governance. Decide whether people must re-acknowledge or retrain.`, notifyUids: hr });
    found.push({ id: s.id, title: s.title, from: s.versionNumber, to: doc.versionNumber });
  }
  return ok({ changed: found, message: found.length ? `${found.length} SOP${found.length > 1 ? 's have' : ' has'} a new published version waiting for your decision.` : 'All SOPs match their published documents.' });
}

// ------------------------------------------------------------------ one-click start

/** Loads the specification's standard set. Safe to press twice: it only adds what is missing. */
async function quickstart(c: C): Promise<Result> {
  const comps = await listK(c.cid, 'competency');
  let added = 0;
  const add = async (name: string, category: CompetencyCategory, standard: string, exampleEvidence: string) => {
    if (comps.some((x) => lc(x.name) === lc(name))) return;
    const item: Item = { id: newId(), companyId: c.cid, kind: 'competency', name, category, definition: '', standard, exampleEvidence, active: true, version: 1, needsDefinition: !standard };
    await putK(item); comps.push(item); added++;
  };
  for (const k of CORE_COMPETENCIES) await add(k.name, 'CORE', k.standard, k.evidence);
  for (const g of ROLE_SPECIFIC_COMPETENCIES) for (const n of g.names) await add(n, g.category, '', '');
  const fws = await listK(c.cid, 'framework');
  let framework = false;
  if (fws.length === 0) {
    const id = newId();
    await putK({ id, companyId: c.cid, kind: 'framework', frameworkKey: id, version: 1, status: 'DRAFT', name: 'Individual contributors', employeeCategory: 'INDIVIDUAL_CONTRIBUTOR', roleFamily: '',
      kraWeight: DEFAULT_WEIGHTS.kra, behaviourWeight: DEFAULT_WEIGHTS.behaviour, sopWeight: DEFAULT_WEIGHTS.sop, reviewFrequency: 'QUARTERLY', ratingScaleId: 'FIVE_POINT', effectiveFrom: today(), effectiveTo: '',
      notes: 'Starting weights from the specification. These are a recommendation, not company policy: change them if needed, then approve.', createdBy: c.who });
    framework = true;
  }
  const roles = await roleAuto(c);
  await audit(c, 'setup', 'quickstart', 'QUICKSTART', null, { competencies: added, framework, roles: roles.json.created });
  return ok({ competencies: added, framework, roles: roles.json.created, message: `Loaded ${added} competenc${added === 1 ? 'y' : 'ies'}${framework ? ', a starting framework (60 / 25 / 15) waiting for your approval' : ''} and ${roles.json.created} role${roles.json.created === 1 ? '' : 's'}.` });
}

export const MASTER_ROUTES: Record<string, Route> = {
  'fw-list': { method: 'GET', who: 'any', run: (c) => fwList(c) },
  'fw-save': { method: 'POST', who: 'hr', run: (c, b) => fwSave(c, b) },
  'fw-approve': { method: 'POST', who: 'approver', run: (c, b) => fwApprove(c, b) },
  'fw-retire': { method: 'POST', who: 'hr', run: (c, b) => fwRetire(c, b) },
  'cycle-list': { method: 'GET', who: 'any', run: (c) => cycleList(c) },
  'cycle-save': { method: 'POST', who: 'hr', run: (c, b) => cycleSave(c, b) },
  'cycle-delete': { method: 'POST', who: 'hr', run: (c, b) => cycleDelete(c, b) },
  'comp-list': { method: 'GET', who: 'any', run: (c) => compList(c) },
  'comp-save': { method: 'POST', who: 'hr', run: (c, b) => compSave(c, b) },
  'comp-delete': { method: 'POST', who: 'hr', run: (c, b) => compDelete(c, b) },
  'role-list': { method: 'GET', who: 'hr', run: (c) => roleList(c) },
  'role-save': { method: 'POST', who: 'hr', run: (c, b) => roleSave(c, b) },
  'role-delete': { method: 'POST', who: 'hr', run: (c, b) => roleDelete(c, b) },
  'role-auto': { method: 'POST', who: 'hr', run: (c) => roleAuto(c) },
  'rolecomp-save': { method: 'POST', who: 'hr', run: (c, b) => roleCompSave(c, b) },
  'sop-docs': { method: 'GET', who: 'hr', run: (c, b, q) => sopDocs(c, b, q) },
  'sop-list': { method: 'GET', who: 'hr', run: (c) => sopList(c) },
  'sop-save': { method: 'POST', who: 'hr', run: (c, b) => sopSave(c, b) },
  'sop-delete': { method: 'POST', who: 'hr', run: (c, b) => sopDelete(c, b) },
  'sop-sync': { method: 'POST', who: 'hr', run: (c) => sopSync(c) },
  quickstart: { method: 'POST', who: 'hr', run: (c) => quickstart(c) },
};

// referenced by other files
export { groupBy, tell, clean };
