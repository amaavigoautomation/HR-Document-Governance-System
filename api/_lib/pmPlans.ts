/**
 * Plans: what each person is expected to deliver (KPIs with targets), the behaviours they are rated on, and the SOPs they follow.
 *
 * A plan is created automatically (join, role change, setup finished) from the template for the person's designation.
 *   ON_HOLD      something is missing (setup, manager, template); HR sees exactly what, and it starts by itself once fixed
 *   SET_TARGETS  the manager fills in the targets (and may adjust weights; they must still total 100)
 *   HR_CHECK     HR approves or sends it back with a note
 *   ACTIVE       in force; the employee acknowledges it and each SOP
 *   CLOSED       replaced after a department/designation change; kept with its evidence for history
 */
import { MANAGER_EXTRAS, kpiProblem, type Competency, type KpiDef } from '../../shared/pmEngine.js';
import { publishedDocs, templateId } from './pmSetup.js';
import {
  active, audit, bad, canSee, clear, db, denied, get, hasReports, hrUids, isManagerOf, list, lc, managerOf, nameOf, newId, notFound, num, ok, put, raise,
  remindNow, settingsOf, slug, str, tell, today,
  type C, type Doc, type Result, type Route, type Settings,
} from './pmCore.js';
import type { Person } from './leaveCore.js';

export const OPEN_PLAN = ['ON_HOLD', 'SET_TARGETS', 'HR_CHECK', 'ACTIVE'];
export const openPlanOf = (plans: Doc[], uid: string) => plans.filter((p) => p.uid === uid && OPEN_PLAN.includes(p.status)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;

type Docs = Awaited<ReturnType<typeof publishedDocs>>;

export function competenciesFor(c: C, s: Settings, p: Person, tpl: Doc | null): Competency[] {
  const out: Competency[] = s.competencies.map((x) => ({ ...x }));
  if (s.managerExtras && hasReports(c, p.uid)) out.push(...MANAGER_EXTRAS.map((x) => ({ ...x })));
  for (const n of (tpl?.extraCompetencies || []) as string[]) if (!out.some((x) => lc(x.name) === lc(n))) out.push({ id: `x_${slug(n)}`, name: n, standard: '' });
  return out;
}

/** SOPs that apply to this person, with the current published version. An acknowledgement survives only while the version is the same. */
export function sopsFor(s: Settings, p: Person, docs: Docs, prev: any[] = []) {
  return s.sops
    .filter((x) => (x.departments.length === 0 || x.departments.includes(p.department)) && (x.designations.length === 0 || x.designations.some((d) => lc(d) === lc(p.title))))
    .map((x) => {
      const d = docs.get(x.documentId);
      const old = prev.find((o) => o.documentId === x.documentId);
      const versionId = d?.versionId || old?.versionId || '';
      const same = !!old && old.versionId === versionId;
      return {
        documentId: x.documentId, title: d?.title || x.title, versionId, versionNumber: d?.versionNumber || old?.versionNumber || '', critical: x.critical,
        assignedOn: same ? old.assignedOn : today(), openedAt: same ? old.openedAt || '' : '', ackAt: same ? old.ackAt || '' : '', changed: !!old && !same,
      };
    });
}

function holdsFor(c: C, s: Settings, p: Person, tpl: Doc | null): { code: string; text: string }[] {
  const h: { code: string; text: string }[] = [];
  if (!s.setupDone) h.push({ code: 'SETUP_UNFINISHED', text: 'HR has not finished Performance setup yet.' });
  if (!managerOf(c, p.uid)) h.push({ code: 'NO_MANAGER', text: `${p.name} has no reporting manager. Set one in People.` });
  if (!tpl) h.push({ code: 'NO_TEMPLATE', text: `There is no KRA/KPI template for "${p.title || 'no designation'}". Add one in Setup → KRA/KPI templates.` });
  return h;
}

async function raiseHolds(c: C, p: Person, holds: { code: string; text: string }[], hr: string[]) {
  for (const h of holds) if (h.code !== 'SETUP_UNFINISHED') await raise(c, h.code, `plan_${p.uid}`, { subjectUid: p.uid, text: h.text, notify: hr });
}
async function clearHolds(c: C, p: Person) {
  for (const code of ['NO_MANAGER', 'NO_TEMPLATE']) await clear(c, code, `plan_${p.uid}`, 'Fixed; the plan has started.');
}

async function startTargets(c: C, plan: Doc) {
  await tell(c, [plan.managerUid], `Set targets for ${plan.name}`, `${plan.name} (${plan.designation}) needs targets for their KPIs. It takes about 5 minutes: open My team, fill one box per KPI and press "Send to HR".`);
}

/** Builds a new plan for one person. Safe to call repeatedly: the caller checks there is no open plan first. */
export async function buildPlan(c: C, s: Settings, p: Person, tpl: Doc | null, docs: Docs, reason: string, hr: string[]): Promise<Doc> {
  const holds = holdsFor(c, s, p, tpl);
  const plan: Doc = {
    id: newId('plans'), companyId: c.cid, uid: p.uid, name: p.name, department: p.department, designation: p.title,
    managerUid: managerOf(c, p.uid), managerName: nameOf(c, managerOf(c, p.uid)),
    status: holds.length ? 'ON_HOLD' : 'SET_TARGETS', holds: holds.map((h) => h.text), reason,
    templateId: tpl?.id || '', templateVersion: tpl?.version || 0,
    kpis: (tpl?.kpis || []).map((k: KpiDef) => ({ ...k, target: '' })), competencies: competenciesFor(c, s, p, tpl), sops: sopsFor(s, p, docs),
    effectiveFrom: '', effectiveTo: '', ackAt: '', targetsTouched: false, hrNote: '', sentOn: '', statusOn: today(),
  };
  await put('plans', plan);
  await audit(c, plan.id, 'PLAN_CREATED', `${reason}. ${holds.length ? `On hold: ${holds.map((h) => h.text).join(' ')}` : 'Manager to set targets.'}`, p.uid);
  if (holds.length) await raiseHolds(c, p, holds, hr);
  else await startTargets(c, plan);
  return plan;
}

/**
 * Keeps every person's plan in line with who they are today. Runs after setup changes, after a template is saved, and every day.
 * Never duplicates: one open plan per person.
 */
export async function syncPlans(c: C): Promise<{ stats: Record<string, number> }> {
  const s = await settingsOf(c.cid);
  const stats = { created: 0, released: 0, closed: 0, moved: 0, managerChanged: 0, sopUpdates: 0 };
  if (!s.setupDone) return { stats };
  const [plans, templates, docs] = await Promise.all([list(c.cid, 'plans'), list(c.cid, 'templates'), publishedDocs(c.cid)]);
  const hr = await hrUids(c);
  const tplFor = (title: string) => templates.find((t) => t.id === templateId(c.cid, title)) || templates.find((t) => lc(t.designation) === lc(title)) || null;

  for (const p of c.people) {
    let cur = openPlanOf(plans, p.uid);
    if (!p.active) {
      if (cur) { await put('plans', { ...cur, status: 'CLOSED', effectiveTo: today(), closedReason: 'Left the company' }); await audit(c, cur.id, 'PLAN_CLOSED', 'Person is no longer active.', p.uid); stats.closed++; }
      continue;
    }
    const tpl = tplFor(p.title);
    if (!cur) { const np = await buildPlan(c, s, p, tpl, docs, 'New plan', hr); plans.push(np); stats.created++; continue; }

    // Department or designation changed: keep the old plan and its evidence, start a new one from today.
    if (cur.department !== p.department || lc(cur.designation) !== lc(p.title)) {
      await put('plans', { ...cur, status: 'CLOSED', effectiveTo: today(), closedReason: `Moved to ${p.department || 'no department'} / ${p.title || 'no designation'}` });
      await raise(c, 'ROLE_CHANGED', `${p.uid}_${today()}`, { subjectUid: p.uid, text: `${p.name} moved from ${cur.department || 'no department'} / ${cur.designation || '-'} to ${p.department || 'no department'} / ${p.title || '-'}. The old plan and its evidence are kept; a new plan starts today.` });
      const np = await buildPlan(c, s, p, tpl, docs, `Role change from ${cur.designation || '-'}`, hr);
      plans.push(np); stats.moved++; continue;
    }

    let changed = false;
    const mgr = managerOf(c, p.uid);
    if (cur.managerUid !== mgr) {
      if (cur.managerUid && mgr) await raise(c, 'MANAGER_CHANGED', `${p.uid}_${today()}`, { subjectUid: p.uid, text: `${p.name}'s manager changed from ${cur.managerName || 'nobody'} to ${nameOf(c, mgr) || 'nobody'}. Applied from today; past records stay as they were.` });
      cur = { ...cur, managerUid: mgr, managerName: nameOf(c, mgr) }; changed = true; stats.managerChanged++;
    }

    if (cur.status === 'ON_HOLD') {
      const holds = holdsFor(c, s, p, tpl);
      if (!holds.length) {
        cur = { ...cur, status: 'SET_TARGETS', holds: [], templateId: tpl!.id, templateVersion: tpl!.version, kpis: tpl!.kpis.map((k: KpiDef) => ({ ...k, target: '' })), competencies: competenciesFor(c, s, p, tpl), statusOn: today() };
        await put('plans', cur); await audit(c, cur.id, 'PLAN_RELEASED', 'Setup is complete for this person; the manager can set targets.', p.uid);
        await clearHolds(c, p); await startTargets(c, cur); stats.released++; continue;
      }
      const texts = holds.map((h) => h.text);
      if (JSON.stringify(texts) !== JSON.stringify(cur.holds)) { cur = { ...cur, holds: texts }; changed = true; await raiseHolds(c, p, holds, hr); }
    } else if (cur.status === 'SET_TARGETS' && tpl && tpl.version !== cur.templateVersion && !cur.targetsTouched) {
      cur = { ...cur, templateId: tpl.id, templateVersion: tpl.version, kpis: tpl.kpis.map((k: KpiDef) => ({ ...k, target: '' })) }; changed = true;
    }
    if (cur.status !== 'ACTIVE') {
      const comps = competenciesFor(c, s, p, tpl);
      if (JSON.stringify(comps) !== JSON.stringify(cur.competencies)) { cur = { ...cur, competencies: comps }; changed = true; }
    }

    // SOPs: new ones are added, removed ones dropped, and a new published version asks for a fresh acknowledgement.
    const sops = sopsFor(s, p, docs, cur.sops || []);
    const strip = (l: any[]) => JSON.stringify(l.map(({ changed: _x, ...r }) => r));
    if (strip(sops) !== strip(cur.sops || [])) {
      for (const x of sops.filter((y) => y.changed)) {
        await raise(c, 'SOP_VERSION_CHANGED', `${x.documentId}_${x.versionId}`, { text: `${x.title} has a new published version (${x.versionNumber}). Everyone it applies to has been asked to read and acknowledge it again.` });
        await tell(c, [p.uid], `Please re-read: ${x.title}`, `${x.title} has a new version (${x.versionNumber}). Open My performance, read it and press "I have read and understood".`);
      }
      cur = { ...cur, sops: sops.map(({ changed: _x, ...r }) => r) }; changed = true; stats.sopUpdates++;
    }
    if (changed) { await put('plans', cur); const i = plans.findIndex((x) => x.id === cur!.id); if (i >= 0) plans[i] = cur; }
  }
  return { stats };
}

// ------------------------------------------------------------------ reminders (daily job)

export async function planReminders(c: C): Promise<{ reminded: number; escalated: number }> {
  const s = await settingsOf(c.cid);
  const plans = (await list(c.cid, 'plans')).filter((p) => OPEN_PLAN.includes(p.status));
  const hr = await hrUids(c);
  const t = today(); const { remindEvery, escalateAfter } = s.timing;
  const age = (d: string) => (d ? Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000) : 0);
  let reminded = 0; let escalated = 0;
  for (const p of plans) {
    let dirty = false;
    if (p.status === 'SET_TARGETS' && p.managerUid && age(p.statusOn) >= remindEvery && remindNow(p, 'targets', remindEvery)) {
      dirty = true; reminded++;
      await tell(c, [p.managerUid], `Reminder: set targets for ${p.name}`, `${p.name}'s targets are still waiting for you (${age(p.statusOn)} days).`);
      if (age(p.statusOn) >= escalateAfter && await raise(c, 'TARGETS_LATE', p.id, { subjectUid: p.uid, text: `${p.managerName} has not set ${p.name}'s targets for ${age(p.statusOn)} days.`, notify: hr })) escalated++;
    }
    if (p.status === 'HR_CHECK' && age(p.statusOn) >= remindEvery && remindNow(p, 'hr', remindEvery)) {
      dirty = true; reminded++;
      await tell(c, hr, `Reminder: approve ${p.name}'s targets`, `${p.name}'s targets are waiting for HR approval (${age(p.statusOn)} days).`);
    }
    if (p.status === 'ACTIVE') {
      if (!p.ackAt && age(p.effectiveFrom) >= remindEvery && remindNow(p, 'ack', remindEvery)) {
        dirty = true; reminded++;
        await tell(c, [p.uid], 'Please acknowledge your targets', 'Your targets were approved. Open My performance and press "I have read my targets".');
        if (age(p.effectiveFrom) >= escalateAfter) await raise(c, 'PLAN_ACK_LATE', p.id, { subjectUid: p.uid, text: `${p.name} has not acknowledged their targets for ${age(p.effectiveFrom)} days.`, notify: p.managerUid ? [p.managerUid] : [] });
      }
      const late = (p.sops || []).filter((x: any) => !x.ackAt && age(x.assignedOn) >= remindEvery);
      if (late.length && remindNow(p, 'sop', remindEvery)) {
        dirty = true; reminded++;
        await tell(c, [p.uid], 'Please read and acknowledge your SOPs', `Waiting: ${late.map((x: any) => x.title).join(', ')}. Open My performance.`);
        for (const x of late.filter((y: any) => age(y.assignedOn) >= escalateAfter)) await raise(c, 'SOP_ACK_LATE', `${p.id}_${x.documentId}_${x.versionId}`, { subjectUid: p.uid, text: `${p.name} has not acknowledged ${x.title} (v${x.versionNumber}) since ${x.assignedOn}.`, notify: p.managerUid ? [p.managerUid] : [] });
      }
    }
    if (dirty) await put('plans', p);
  }
  return { reminded, escalated };
}

// ------------------------------------------------------------------ actions

async function planOr404(c: C, id: unknown): Promise<Doc | null> { return get(c.cid, 'plans', str(id, 80)); }

export async function planView(c: C, plan: Doc) {
  const ev = (await list(c.cid, 'evidence', { uid: plan.uid })).filter((e) => e.planId === plan.id);
  return {
    ...plan,
    kpis: plan.kpis.map((k: any) => ({ ...k, evidence: ev.filter((e) => e.kpiId === k.id && e.status === 'VERIFIED').length, pending: ev.filter((e) => e.kpiId === k.id && e.status === 'PENDING').length })),
    sopsToAck: (plan.sops || []).filter((x: any) => !x.ackAt).length,
  };
}

async function planGet(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const plan = await planOr404(c, q.id);
  if (!plan || !canSee(c, plan.uid)) return notFound('The plan');
  return ok({ plan: await planView(c, plan), canSetTargets: plan.status === 'SET_TARGETS' && (isManagerOf(c, plan.uid) || c.isHr) && plan.uid !== c.ctx.uid, canApprove: plan.status === 'HR_CHECK' && c.isHr && plan.uid !== c.ctx.uid });
}

/** The manager fills in targets (and may adjust weights). "Send to HR" only works when every KPI has a target and weights total 100. */
async function planTargets(c: C, b: any): Promise<Result> {
  const plan = await planOr404(c, b.id);
  if (!plan) return notFound('The plan');
  if (plan.uid === c.ctx.uid) return denied('You cannot set your own targets. Your manager does this.');
  if (!isManagerOf(c, plan.uid) && !c.isHr) return denied('Only this person\'s manager (or HR) can set their targets.');
  if (plan.status !== 'SET_TARGETS') return bad(plan.status === 'HR_CHECK' ? 'These targets are already with HR.' : 'Targets can only be set while the plan is waiting for them.');
  const input = new Map<string, any>((Array.isArray(b.kpis) ? b.kpis : []).map((k: any) => [str(k?.id, 40), k]));
  const kpis = plan.kpis.map((k: any) => {
    const x = input.get(k.id);
    return x ? { ...k, target: str(x.target, 200), weight: num(x.weight) ?? k.weight } : k;
  });
  const p = kpiProblem(kpis); if (p) return bad(p);
  const send = b.send === true;
  if (send) {
    const empty = kpis.filter((k: any) => !k.target);
    if (empty.length) return bad(`Fill in a target for every KPI before sending. Missing: ${empty.map((k: any) => k.kpi).join('; ')}.`);
  }
  const next = { ...plan, kpis, targetsTouched: true, ...(send ? { status: 'HR_CHECK', sentOn: today(), statusOn: today(), hrNote: '' } : {}) };
  await put('plans', next);
  await audit(c, plan.id, send ? 'TARGETS_SENT_TO_HR' : 'TARGETS_SAVED', kpis.map((k: any) => `${k.kpi}: ${k.target || '-'} (${k.weight}%)`).join('; '), plan.uid);
  if (send) { await clear(c, 'TARGETS_LATE', plan.id, 'Targets sent to HR.'); await tell(c, await hrUids(c), `Approve targets for ${plan.name}`, `${c.who} set ${plan.name}'s targets. Open Performance → Plans to approve.`); }
  return ok({ plan: next, message: send ? 'Sent to HR for approval.' : 'Saved. Press "Send to HR" when every KPI has a target.' });
}

async function planApprove(c: C, b: any): Promise<Result> {
  const plan = await planOr404(c, b.id);
  if (!plan) return notFound('The plan');
  if (plan.uid === c.ctx.uid) return denied('You cannot approve your own targets. Another HR person must do it.');
  if (plan.status !== 'HR_CHECK') return bad('Only targets that are waiting for HR can be approved.');
  const next = { ...plan, status: 'ACTIVE', effectiveFrom: today(), statusOn: today(), approvedBy: c.who, approvedAt: new Date().toISOString() };
  await put('plans', next);
  await audit(c, plan.id, 'PLAN_APPROVED', '', plan.uid);
  await tell(c, [plan.uid], 'Your targets are ready', 'Your targets for this period were approved. Open My performance, read them and press "I have read my targets". Please also read and acknowledge your SOPs there.');
  return ok({ plan: next, message: `Approved. ${plan.name} has been asked to acknowledge.` });
}

async function planReturn(c: C, b: any): Promise<Result> {
  const plan = await planOr404(c, b.id);
  if (!plan) return notFound('The plan');
  const note = str(b.note, 500);
  if (note.length < 5) return bad('Write a short note so the manager knows what to change.');
  if (plan.status !== 'HR_CHECK') return bad('Only targets that are waiting for HR can be sent back.');
  const next = { ...plan, status: 'SET_TARGETS', hrNote: note, statusOn: today() };
  await put('plans', next);
  await audit(c, plan.id, 'PLAN_RETURNED', note, plan.uid);
  await tell(c, [plan.managerUid], `Please change ${plan.name}'s targets`, `HR sent ${plan.name}'s targets back: "${note}"`);
  return ok({ plan: next, message: 'Sent back to the manager with your note.' });
}

async function planAck(c: C, b: any): Promise<Result> {
  const plan = await planOr404(c, b.id);
  if (!plan || plan.uid !== c.ctx.uid) return notFound('Your plan');
  if (plan.status !== 'ACTIVE') return bad('Your targets are not approved yet.');
  if (plan.ackAt) return ok({ plan, message: 'Already acknowledged.' });
  const next = { ...plan, ackAt: new Date().toISOString() };
  await put('plans', next);
  await audit(c, plan.id, 'PLAN_ACKNOWLEDGED', '', plan.uid);
  await clear(c, 'PLAN_ACK_LATE', plan.id, 'Acknowledged.');
  return ok({ plan: next, message: 'Thank you. Your targets are acknowledged.' });
}

/** Reading and acknowledging are separate events: "I have read and understood" only works after the document was opened. */
async function sopStep(c: C, b: any, step: 'open' | 'ack'): Promise<Result> {
  const plan = await planOr404(c, b.planId);
  if (!plan || plan.uid !== c.ctx.uid) return notFound('Your plan');
  const sops = (plan.sops || []).map((x: any) => ({ ...x }));
  const x = sops.find((y: any) => y.documentId === str(b.documentId, 80));
  if (!x) return notFound('That SOP');
  if (step === 'open') { if (!x.openedAt) x.openedAt = new Date().toISOString(); }
  else {
    if (!x.openedAt) return bad('Open and read the SOP first.');
    if (x.ackAt) return ok({ plan, message: 'Already acknowledged.' });
    x.ackAt = new Date().toISOString();
  }
  const next = { ...plan, sops };
  await put('plans', next);
  await audit(c, plan.id, step === 'open' ? 'SOP_OPENED' : 'SOP_ACKNOWLEDGED', `${x.title} v${x.versionNumber}`, plan.uid);
  if (step === 'ack') await clear(c, 'SOP_ACK_LATE', `${plan.id}_${x.documentId}_${x.versionId}`, 'Acknowledged.');
  // Opening returns the published file (a link) or, when the file is stored inline, its text to show in the app.
  let url = ''; let text = '';
  if (step === 'open' && x.versionId) {
    const v = await db().collection('versions').doc(x.versionId).get();
    const d = v.exists ? (v.data() as any) : null;
    if (d && (!d.companyId || d.companyId === c.cid)) {
      const u = String(d.fileUrl || d.originalFileUrl || '');
      if (/^https?:\/\//i.test(u)) url = u;
      text = String(d.rawContent || '').slice(0, 200_000);
    }
  }
  return ok({ plan: next, url, text, message: step === 'ack' ? `${x.title}: acknowledged.` : '' });
}

async function planList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const plans = await list(c.cid, 'plans');
  const scope = str(q.scope, 10);
  const rows = plans.filter((p) => (scope === 'closed' ? p.status === 'CLOSED' : OPEN_PLAN.includes(p.status)));
  const order: Record<string, number> = { HR_CHECK: 0, ON_HOLD: 1, SET_TARGETS: 2, ACTIVE: 3, CLOSED: 4 };
  rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.name).localeCompare(String(b.name)));
  const noPlan = active(c).filter((p) => !openPlanOf(plans, p.uid)).map((p) => ({ uid: p.uid, name: p.name }));
  return ok({ items: rows.map((p) => ({ ...p, sopsToAck: (p.sops || []).filter((x: any) => !x.ackAt).length })), noPlan });
}

async function planRefresh(c: C): Promise<Result> {
  const r = await syncPlans(c);
  return ok({ stats: r.stats, message: `Checked everyone. Started ${r.stats.created + r.stats.released}, moved ${r.stats.moved}, closed ${r.stats.closed}.` });
}

export const PLAN_ROUTES: Record<string, Route> = {
  plan: { method: 'GET', who: 'any', run: (c, b, q) => planGet(c, b, q) },
  'plan-targets': { method: 'POST', who: 'any', run: (c, b) => planTargets(c, b) },
  'plan-approve': { method: 'POST', who: 'hr', run: (c, b) => planApprove(c, b) },
  'plan-return': { method: 'POST', who: 'hr', run: (c, b) => planReturn(c, b) },
  'plan-ack': { method: 'POST', who: 'any', run: (c, b) => planAck(c, b) },
  'sop-open': { method: 'POST', who: 'any', run: (c, b) => sopStep(c, b, 'open') },
  'sop-ack': { method: 'POST', who: 'any', run: (c, b) => sopStep(c, b, 'ack') },
  plans: { method: 'GET', who: 'hr', run: (c, b, q) => planList(c, b, q) },
  'plans-refresh': { method: 'POST', who: 'hr', run: (c) => planRefresh(c) },
};
