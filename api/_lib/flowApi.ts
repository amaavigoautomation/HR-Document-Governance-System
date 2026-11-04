/**
 * Hiring Flow (reached through hiringRouter.ts as /api/recruitment/flow-<action>).
 *
 * A company builds ONE flow (versioned) that every new applicant walks through. The flow engine does not replace the
 * screening, interview, offer and joining screens: it WATCHES them. When the person finishes the work in the existing
 * screen, the applicant moves on; automatic steps (score, email, wait, choose a path, reject) are done by the engine.
 * Steps a person must do become tasks in "My tasks".
 *
 *   flow-state            the live flow, the draft, old versions, people who can own steps
 *   flow-start-standard   draft = how hiring works today
 *   flow-edit             draft = copy of the live flow
 *   flow-save             save the draft (can be unfinished)
 *   flow-discard          throw the draft away
 *   flow-activate         publish the draft as the next version (only when every check passes)
 *   flow-runs / flow-run  applicants in the flow, one applicant's history
 *   flow-enroll           put existing applicants into the flow
 *   flow-check-now        move everybody forward right now
 *   flow-run-action       HR fixes a stuck applicant: retry, skip step, reject, stop
 *   flow-my-tasks         tasks for the signed-in person
 *   flow-task-decide      answer a Yes/No task
 *
 * Records live in hiringItems: kind flow, flowRun (one per applicant, id flowrun_<applicationId>), flowTask.
 * Every move is written once and re-checked inside a transaction, so running the engine twice never does a step twice.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getApplication, listApplications, updateApplication, type ApplicationDoc } from './recruitmentData.js';
import { MANAGE_PERMS, getItem, listItems, putItem, scoreFor, whoIs, type Item } from './pipelineApi.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { summarise, type Scorecard } from '../../shared/interviewEngine.js';
import {
  STEP_INFO, evalCondition, interviewRound, makeStep, nextTarget, renderText, standardSteps, stepInfo, validateFlow,
  type Facts, type FlowDoc, type FlowStep, type Result as StepResult,
} from '../../shared/flowEngine.js';

export interface FlowRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any>; origin?: string }
type Res = { status: number; json: any };

const db = () => adminDb();
let nowFn = () => new Date();
/** Tests move the clock to check waiting and late tasks. */
export const __setNow = (fn: (() => Date) | null) => { nowFn = fn || (() => new Date()); };
const nowIso = () => nowFn().toISOString();
const today = () => nowIso().slice(0, 10);
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const ok = (extra: Record<string, any> = {}): Res => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Res => ({ status, json: { success: false, error, ...extra } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let mailer: (p: { to: string; name: string; fromName: string; subject: string; body: string }) => Promise<{ ok: boolean; error?: string }> = async (p) => {
  try {
    const r = await dispatchLiveEmail({ to: p.to, recipientName: p.name, fromName: p.fromName, subject: p.subject, body: p.body });
    return { ok: !!r.success, error: r.success ? undefined : r.error || r.note || 'The email service did not accept the message.' };
  } catch (e: any) { return { ok: false, error: e?.message || 'The email could not be sent.' }; }
};
/** Tests swap the mailer so nothing leaves the machine. */
export const __setMailer = (fn: typeof mailer | null) => { mailer = fn || mailer; };

const canManage = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));

// ------------------------------------------------------------------ records

export interface RunDoc extends Item {
  kind: 'flowRun';
  applicationId: string;
  candidateName: string;
  designation: string;
  flowId: string;
  flowVersion: number;
  stepId: string;
  status: 'RUNNING' | 'WAITING' | 'STUCK' | 'HIRED' | 'REJECTED' | 'STOPPED';
  stuckReason: string;
  enteredAt: string;
  waitUntil: string;
  decisions: Record<string, { result?: 'yes' | 'no'; by?: string; at?: string; note?: string; email?: 'SENDING' | 'SENT' }>;
  history: { at: string; stepId: string; text: string; by: string }[];
  createdAt: string;
  updatedAt: string;
}

const FINAL = ['HIRED', 'REJECTED', 'STOPPED'];
const runId = (applicationId: string) => `flowrun_${applicationId}`;
const taskId = (rid: string, stepId: string) => `ftask_${rid}_${stepId}`;

const toFlow = (it: Item | null): FlowDoc | null => (it && it.kind === 'flow' ? (it as unknown as FlowDoc) : null);
async function flows(cid: string): Promise<FlowDoc[]> {
  return (await listItems(cid, 'flow')).map((i) => i as unknown as FlowDoc).sort((a, b) => b.version - a.version || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
const activeFlow = (all: FlowDoc[]) => all.find((f) => f.status === 'ACTIVE') || null;
const draftFlow = (all: FlowDoc[]) => all.find((f) => f.status === 'DRAFT') || null;

async function people(cid: string): Promise<{ uid: string; name: string; title: string; email: string }[]> {
  const snap = await db().collection('employees').where('companyId', '==', cid).get();
  return snap.docs.map((d) => d.data() as any).filter((e) => e.authUid && e.active !== false)
    .map((e) => ({ uid: String(e.authUid), name: String(e.name || e.email || ''), title: String(e.title || e.designation || ''), email: String(e.email || '') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function companyName(cid: string): Promise<string> {
  try { const s = await db().collection('companies').doc(cid).get(); return String(s.get('name') || 'Our company'); } catch { return 'Our company'; }
}

// ------------------------------------------------------------------ draft handling

function cleanSteps(raw: unknown, staff: { uid: string; name: string }[]): FlowStep[] {
  const out: FlowStep[] = [];
  const list = Array.isArray(raw) ? raw.slice(0, 60) : [];
  const nameOf = (uid: string) => staff.find((p) => p.uid === uid)?.name || '';
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const type = str((r as any).type, 20);
    const info = stepInfo(type);
    if (!info) continue;
    let id = str((r as any).id, 20);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(id) || out.some((s) => s.id === id)) id = makeStep(info.type, out).id;
    const settings: Record<string, any> = {};
    const src = (r as any).settings && typeof (r as any).settings === 'object' ? (r as any).settings : {};
    const keys = type === 'condition' ? ['field', 'op', 'value', 'ifUnknown'] : info.fields.map((f) => f.key);
    for (const k of keys) {
      const f = info.fields.find((x) => x.key === k);
      const v = src[k];
      settings[k] = f?.kind === 'bool' ? !!v : f?.kind === 'number' || k === 'value' ? (v === '' || v === null || v === undefined ? '' : Number.isFinite(Number(v)) && String(v).trim() !== '' && type !== 'condition' ? Number(v) : v) : str(v, f?.kind === 'longtext' ? 4000 : 300);
    }
    if (type === 'condition') {
      if (!['PASS', 'HOLD', 'FAIL'].includes(String(settings.value))) settings.value = settings.value === '' ? '' : Number(settings.value);
      if (!['ask', 'yes', 'no'].includes(String(settings.ifUnknown))) settings.ifUnknown = 'ask';
    }
    const ownerUid = str((r as any).ownerUid, 128);
    const dl = Number((r as any).deadlineDays);
    out.push({
      id, type: info.type, title: str((r as any).title, 100), settings,
      ...(ownerUid ? { ownerUid, ownerName: nameOf(ownerUid) || str((r as any).ownerName, 100) } : {}),
      ...(info.manual && Number.isFinite(dl) && dl > 0 ? { deadlineDays: Math.min(90, Math.round(dl)) } : {}),
      ...(info.canFail ? { onFail: str((r as any).onFail, 20) || 'reject' } : {}),
      ...(type === 'condition' ? { ifYes: str((r as any).ifYes, 20) || 'next', ifNo: str((r as any).ifNo, 20) || 'next' } : {}),
    });
  }
  return out;
}

async function stateRoute(ctx: AuthContext): Promise<Res> {
  const cid = ctx.companyId!;
  const all = await flows(cid);
  const staff = await people(cid);
  const mgr = canManage(ctx);
  const pub = (f: FlowDoc | null) => (f ? clean(f) : null);
  const runs = mgr ? (await listItems(cid, 'flowRun')) as RunDoc[] : [];
  const counts: Record<string, number> = {};
  for (const r of runs) counts[r.status] = (counts[r.status] || 0) + 1;
  const myOpen = (await listItems(cid, 'flowTask')).filter((t) => t.ownerUid === ctx.uid && t.status === 'OPEN').length;
  return ok({
    canManage: mgr, active: pub(activeFlow(all)), draft: mgr ? pub(draftFlow(all)) : null,
    versions: all.filter((f) => f.status !== 'DRAFT').map((f) => ({ id: f.id, version: f.version, status: f.status, name: f.name, activatedAt: f.activatedAt || '', activatedBy: f.activatedBy || '', note: f.note || '', steps: f.steps.length })),
    people: mgr ? staff.map(({ uid, name, title }) => ({ uid, name, title })) : [], counts, myOpen,
    me: { uid: ctx.uid, name: staff.find((p) => p.uid === ctx.uid)?.name || ctx.email },
  });
}

async function saveDraft(ctx: AuthContext, name: string, steps: FlowStep[], extra: Partial<FlowDoc> = {}): Promise<FlowDoc> {
  const cid = ctx.companyId!;
  const all = await flows(cid);
  const d = draftFlow(all);
  const live = activeFlow(all);
  const doc: FlowDoc = {
    id: d?.id || db().collection('hiringItems').doc().id, companyId: cid, kind: 'flow', name, version: 0, status: 'DRAFT', steps,
    basedOn: d?.basedOn ?? live?.version ?? 0, createdAt: d?.createdAt || nowIso(), updatedAt: nowIso(), createdBy: d?.createdBy || await whoIs(ctx), ...extra,
  };
  await putItem(doc as unknown as Item);
  return doc;
}

async function startStandard(ctx: AuthContext): Promise<Res> {
  const staff = await people(ctx.companyId!);
  const me = staff.find((p) => p.uid === ctx.uid);
  const draft = await saveDraft(ctx, 'Our hiring flow', standardSteps(ctx.uid, me?.name || ctx.email), { basedOn: 0 });
  return ok({ draft });
}

async function editLive(ctx: AuthContext): Promise<Res> {
  const all = await flows(ctx.companyId!);
  const d = draftFlow(all);
  if (d) return ok({ draft: d });
  const live = activeFlow(all);
  if (!live) return fail(404, 'There is no live flow to edit. Press "Start from the standard process" instead.');
  return ok({ draft: await saveDraft(ctx, live.name, clean(live.steps), { basedOn: live.version }) });
}

async function saveRoute(ctx: AuthContext, b: any): Promise<Res> {
  const staff = await people(ctx.companyId!);
  const steps = cleanSteps(b.steps, staff);
  const draft = await saveDraft(ctx, str(b.name, 100), steps, { note: str(b.note, 300) });
  return ok({ draft, problems: validateFlow(draft) });
}

async function discard(ctx: AuthContext): Promise<Res> {
  const d = draftFlow(await flows(ctx.companyId!));
  if (d) await db().collection('hiringItems').doc(d.id).delete();
  return ok();
}

async function activate(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const all = await flows(cid);
  const d = draftFlow(all);
  if (!d) return fail(404, 'There is no draft to publish.');
  const staff = await people(cid);
  const problems = validateFlow(d);
  for (const s of d.steps) {
    if (s.ownerUid && !staff.some((p) => p.uid === s.ownerUid)) problems.push({ stepId: s.id, message: `Step ${d.steps.indexOf(s) + 1} (${s.title}): ${s.ownerName || 'the chosen person'} is no longer an active employee. Choose someone else.` });
  }
  if (problems.length) return fail(400, 'Fix these first, then publish again.', { problems });
  const version = Math.max(0, ...all.map((f) => f.version)) + 1;
  const who = await whoIs(ctx);
  const live = activeFlow(all);
  const next: FlowDoc = { ...d, status: 'ACTIVE', version, note: str(b.note, 300) || d.note || '', activatedAt: nowIso(), activatedBy: who, updatedAt: nowIso() };
  await putItem(next as unknown as Item);
  // New version first, then retire the old one: at no moment is there no live flow.
  if (live) await putItem({ ...live, status: 'ARCHIVED', updatedAt: nowIso() } as unknown as Item);
  return ok({ version, active: next });
}

// ------------------------------------------------------------------ running applicants

const log = (run: RunDoc, stepId: string, text: string, by = 'Automation') => { run.history = [...(run.history || []), { at: nowIso(), stepId, text: text.slice(0, 400), by }].slice(-200); };

async function loadRun(cid: string, id: string): Promise<RunDoc | null> {
  const it = await getItem(cid, id, 'flowRun');
  return (it as RunDoc) || null;
}

async function enroll(cid: string, a: ApplicationDoc, flow: FlowDoc): Promise<{ run: RunDoc; created: boolean }> {
  const id = runId(a.id);
  const ref = db().collection('hiringItems').doc(id);
  let created = false;
  const out = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.data() as RunDoc;
    created = true;
    const first = flow.steps[0];
    const run: RunDoc = {
      id, companyId: cid, kind: 'flowRun', applicationId: a.id, candidateName: a.name, designation: a.designation, flowId: flow.id, flowVersion: flow.version,
      stepId: first.id, status: 'RUNNING', stuckReason: '', enteredAt: nowIso(), waitUntil: '', decisions: {}, createdAt: nowIso(), updatedAt: nowIso(),
      history: [{ at: nowIso(), stepId: first.id, text: `Applicant entered the flow (version ${flow.version}).`, by: 'Automation' }],
    };
    tx.set(ref, clean(run));
    return run;
  });
  return { run: out as RunDoc, created };
}

const OFFER_BAD = ['DECLINED', 'GHOSTED', 'EXPIRED', 'REJECTED', 'WITHDRAWN'];
const OFFER_GOOD = ['ACCEPTED', 'JOINED'];

type Seen = { kind: 'wait'; why: string } | { kind: 'move'; result: StepResult; note: string } | { kind: 'stuck'; reason: string };

async function gatherFacts(cid: string, a: ApplicationDoc, run: RunDoc): Promise<Facts> {
  const facts: Facts = { expectedCtcLpa: a.expectedCtcLpa ?? null };
  try { const s = await scoreFor(cid, a); facts.aiScore = s.score?.normalised ?? null; facts.experienceYears = s.years ?? null; } catch { /* unknown */ }
  const scr = (await listItems(cid, 'screening')).find((s) => s.applicationId === a.id);
  facts.screeningOutcome = scr?.outcome || null;
  const ints = (await listItems(cid, 'interview')).filter((i) => i.applicationId === a.id && i.status === 'COMPLETED').sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
  if (ints[0]?.scorecards?.length) facts.interviewAverage = summarise(ints[0].scorecards as Scorecard[]).average;
  return facts;
}

async function sendTemplate(cid: string, a: ApplicationDoc, s: FlowStep, hr: string): Promise<{ ok: boolean; error?: string }> {
  if (!EMAIL_RE.test(a.email || '')) return { ok: false, error: `${a.name} has no valid email address.` };
  const company = await companyName(cid);
  const vars = { name: a.name, position: a.designation, company, hrName: hr };
  return mailer({ to: a.email, name: a.name, fromName: company, subject: renderText(String(s.settings.subject || ''), vars), body: renderText(String(s.settings.body || ''), vars) });
}

async function observe(cid: string, run: RunDoc, flow: FlowDoc, step: FlowStep, a: ApplicationDoc): Promise<Seen> {
  switch (step.type) {
    case 'ai_score': return { kind: 'move', result: 'done', note: 'Resume scored.' };
    case 'condition': {
      const facts = await gatherFacts(cid, a, run);
      const r = evalCondition(step.settings, facts);
      if (r === null && (step.settings.ifUnknown === 'yes' || step.settings.ifUnknown === 'no')) return { kind: 'move', result: step.settings.ifUnknown, note: `Not enough information, so it was treated as ${step.settings.ifUnknown === 'yes' ? 'Yes' : 'No'}, as the flow says.` };
      if (r === null) return { kind: 'stuck', reason: 'The app does not have the information needed for this choice yet (for example no resume score or no interview result). Fill it in, then press Retry.' };
      return { kind: 'move', result: r ? 'yes' : 'no', note: r ? 'Answer: yes.' : 'Answer: no.' };
    }
    case 'wait': {
      const until = run.waitUntil || new Date(Date.parse(run.enteredAt) + Number(step.settings.days || 1) * 86400000).toISOString();
      return nowFn().toISOString() >= until ? { kind: 'move', result: 'done', note: 'Waiting time is over.' } : { kind: 'wait', why: `Waiting until ${until.slice(0, 10)}.` };
    }
    case 'email': {
      const r = await sendOnce(cid, run, step, a);
      return r || { kind: 'move', result: 'done', note: `Email sent to ${a.email}.` };
    }
    case 'reject': {
      if (step.settings.sendEmail) { const r = await sendOnce(cid, run, step, a); if (r) return r; }
      return { kind: 'move', result: 'done', note: step.settings.sendEmail ? `Rejected. Email sent to ${a.email}.` : 'Rejected.' };
    }
    case 'screen': {
      const s = (await listItems(cid, 'screening')).find((x) => x.applicationId === a.id);
      if (!s) return { kind: 'wait', why: 'Waiting for the phone screening result.' };
      if (s.outcome === 'PASS') return { kind: 'move', result: 'done', note: 'Phone screening passed.' };
      if (s.outcome === 'FAIL') return { kind: 'move', result: 'fail', note: 'Phone screening failed.' };
      return { kind: 'wait', why: 'Phone screening result is "On hold". Waiting for a final result.' };
    }
    case 'test': {
      const t = (await listItems(cid, 'assessment')).filter((x) => x.applicationId === a.id).sort((x, y) => String(y.assignedAt).localeCompare(String(x.assignedAt)))[0];
      if (!t || t.status !== 'SCORED') return { kind: 'wait', why: t ? 'Waiting for the test to be scored.' : 'Waiting for a test to be given.' };
      return t.result === 'PASS' ? { kind: 'move', result: 'done', note: `Test passed (${t.score}).` } : { kind: 'move', result: 'fail', note: `Test not passed (${t.score}).` };
    }
    case 'interview': {
      const k = interviewRound(flow, step.id);
      const list = (await listItems(cid, 'interview')).filter((x) => x.applicationId === a.id && x.status !== 'CANCELLED').sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
      const it = list[k - 1];
      if (!it) return { kind: 'wait', why: `Waiting for interview round ${k} to be scheduled.` };
      if (it.status !== 'COMPLETED') return { kind: 'wait', why: `Waiting for the panel's feedback on round ${k}.` };
      const avg = summarise(it.scorecards as Scorecard[]).average;
      const min = Number(step.settings.minAverage ?? 3);
      return avg >= min ? { kind: 'move', result: 'done', note: `Interview average ${avg} (needed ${min}).` } : { kind: 'move', result: 'fail', note: `Interview average ${avg} is below ${min}.` };
    }
    case 'review':
    case 'approval': {
      const d = run.decisions[step.id];
      if (!d?.result) return { kind: 'wait', why: 'Waiting for an answer.' };
      return d.result === 'yes' ? { kind: 'move', result: 'done', note: `${d.by || 'Someone'} said yes.` } : { kind: 'move', result: 'fail', note: `${d.by || 'Someone'} said no${d.note ? `: ${d.note}` : ''}.` };
    }
    case 'offer': {
      const o = latestOffer(await listItems(cid, 'offer'), a.id);
      if (!o) return { kind: 'wait', why: 'Waiting for HR to make the offer.' };
      if (OFFER_GOOD.includes(o.status)) return { kind: 'move', result: 'done', note: 'Candidate accepted the offer.' };
      if (OFFER_BAD.includes(o.status)) return { kind: 'move', result: 'fail', note: `Offer ended: ${String(o.status).toLowerCase()}.` };
      return { kind: 'wait', why: 'Waiting for the offer to be approved, sent and answered.' };
    }
    case 'onboard': {
      const o = latestOffer(await listItems(cid, 'offer'), a.id);
      if (o && (o.onboardingId || o.status === 'JOINED')) return { kind: 'move', result: 'done', note: 'Joining has started.' };
      return { kind: 'wait', why: 'Waiting for joining to start.' };
    }
    default: return { kind: 'stuck', reason: 'This step type is not known.' };
  }
}

/** Changes the stored run inside a transaction, on the newest copy (so two engines never overwrite each other). */
async function mutateRun(id: string, fn: (fresh: RunDoc) => boolean | void): Promise<RunDoc | null> {
  const ref = db().collection('hiringItems').doc(id);
  let out: RunDoc | null = null;
  await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const fresh = snap.data() as RunDoc;
    if (fn(fresh) === false) { out = fresh; return; }
    fresh.updatedAt = nowIso();
    tx.set(ref, clean(fresh));
    out = fresh;
  });
  return out;
}

/**
 * Sends the step's email at most once, even if two engines run at the same moment: the first to claim it sends it, the other waits.
 * Returns null when the email is (now) sent, otherwise what the caller should do instead.
 */
async function sendOnce(cid: string, run: RunDoc, step: FlowStep, a: ApplicationDoc): Promise<Seen | null> {
  const got = { claim: 'won' as 'won' | 'SENT' | 'SENDING', claimedAt: '' };
  await mutateRun(run.id, (fresh) => {
    const cur = fresh.decisions[step.id];
    if (cur?.email === 'SENT') { got.claim = 'SENT'; return false; }
    if (cur?.email === 'SENDING') { got.claim = 'SENDING'; got.claimedAt = cur.at || ''; return false; }
    fresh.decisions[step.id] = { ...(cur || {}), email: 'SENDING', at: nowIso() };
  });
  if (got.claim === 'SENT') return null;
  if (got.claim === 'SENDING') {
    if (got.claimedAt && nowFn().getTime() - Date.parse(got.claimedAt) < 120000) return { kind: 'wait', why: 'The email is being sent.' };
    return { kind: 'stuck', reason: 'The app was sending this email when something went wrong, so it cannot tell if it arrived. Check, then press "Skip step" (it arrived) or "Retry" (send again).' };
  }
  const r = await sendTemplate(cid, a, step, await hrNameFor(cid, run));
  await mutateRun(run.id, (fresh) => { if (r.ok) fresh.decisions[step.id] = { ...(fresh.decisions[step.id] || {}), email: 'SENT', at: nowIso() }; else delete fresh.decisions[step.id]?.email; });
  if (!r.ok) return { kind: 'stuck', reason: `${step.type === 'reject' ? 'Rejection email' : 'Email'} not sent: ${r.error}` };
  return null;
}

const latestOffer = (offers: Item[], applicationId: string) => offers.filter((o) => o.applicationId === applicationId).sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')))[0];

async function hrNameFor(cid: string, run: RunDoc): Promise<string> {
  const flow = toFlow(await getItem(cid, run.flowId, 'flow'));
  const owner = flow?.steps.find((s) => s.ownerName)?.ownerName;
  return owner || 'The HR team';
}

/** Saves status changes, but never over a run another engine has already moved on or finished. */
async function persist(run: RunDoc) {
  await mutateRun(run.id, (fresh) => {
    if (fresh.stepId !== run.stepId || FINAL.includes(fresh.status) && !FINAL.includes(run.status)) return false;
    fresh.status = run.status; fresh.stuckReason = run.stuckReason; fresh.waitUntil = run.waitUntil; fresh.history = run.history;
    fresh.decisions = { ...fresh.decisions, ...Object.fromEntries(Object.entries(run.decisions).filter(([k, v]) => !(fresh.decisions[k]?.email) || v?.result || k === '__rejectedByFlow')) };
    if (run.flowId !== fresh.flowId) fresh.flowId = run.flowId;
  });
}

async function openTasks(cid: string, rid: string): Promise<Item[]> {
  return (await listItems(cid, 'flowTask')).filter((t) => t.runId === rid && t.status === 'OPEN');
}

async function closeTasks(cid: string, rid: string, status: 'DONE' | 'CANCELLED', stepId?: string, resolution = 'auto') {
  for (const t of await openTasks(cid, rid)) {
    if (stepId && t.stepId !== stepId) continue;
    await putItem({ ...t, status, resolution, doneAt: nowIso() });
  }
}

const LINK: Record<string, string> = { screen: 'candidates', test: 'candidates', interview: 'interviews', offer: 'offers', onboard: 'joining' };
const TASK_WORDS: Record<string, string> = {
  screen: 'Phone the candidate and record the screening result.', test: 'Give the candidate the test and enter the score.', interview: 'Schedule the interview and make sure the panel gives feedback.',
  offer: 'Prepare and send the offer.', onboard: 'Start joining and onboarding.', review: 'Look at the candidate and answer Yes or No.', approval: 'Approve or do not approve.',
};

async function createOnce(it: Item): Promise<boolean> {
  const ref = db().collection('hiringItems').doc(it.id);
  let created = false;
  await db().runTransaction(async (tx: any) => { const snap = await tx.get(ref); if (snap.exists) { created = false; return; } created = true; tx.set(ref, clean(it)); });
  return created;
}

async function ensureTask(cid: string, run: RunDoc, flow: FlowDoc, step: FlowStep, staff: Awaited<ReturnType<typeof people>>): Promise<string | null> {
  const info = STEP_INFO[step.type];
  if (!info.manual) return null;
  const id = taskId(run.id, step.id);
  if (await getItem(cid, id, 'flowTask')) return null;
  const owner = staff.find((p) => p.uid === step.ownerUid);
  if (!owner) return `${step.ownerName || 'The person chosen for this step'} is no longer an active employee. Press "Choose someone else" to reassign.`;
  const due = new Date(Date.parse(run.enteredAt) + (step.deadlineDays || 3) * 86400000).toISOString().slice(0, 10);
  const decide = step.type === 'review' || step.type === 'approval';
  const created = await createOnce({
    id, companyId: cid, kind: 'flowTask', runId: run.id, applicationId: run.applicationId, candidateName: run.candidateName, designation: run.designation,
    stepId: step.id, stepType: step.type, stepTitle: step.title, ownerUid: owner.uid, ownerName: owner.name,
    instruction: String(step.settings.instruction || TASK_WORDS[step.type] || ''), question: decide ? String(step.settings.question || '') : '',
    decide, link: decide ? '' : LINK[step.type] || '', dueOn: due, status: 'OPEN', createdAt: nowIso(),
  });
  if (!created) return null;   // another engine created it a moment ago
  log(run, step.id, `Task created for ${owner.name}: ${step.title} (due ${due}).`);
  if (EMAIL_RE.test(owner.email)) {
    const company = await companyName(cid);
    mailer({ to: owner.email, name: owner.name, fromName: company, subject: `Hiring task: ${step.title} for ${run.candidateName}`,
      body: `Hi ${owner.name},\n\nYou have a new hiring task.\n\nCandidate: ${run.candidateName} (${run.designation})\nTask: ${step.title}\n${decide ? `Question: ${step.settings.question}\n` : ''}Please finish it by ${due}. Open Hiring > My tasks to do it.\n` }).catch(() => undefined);
  }
  return null;
}

async function applyMove(cid: string, run: RunDoc, flow: FlowDoc, step: FlowStep, result: StepResult, note: string): Promise<boolean> {
  const t = nextTarget(flow, step.id, result);
  const ref = db().collection('hiringItems').doc(run.id);
  let moved = false;
  await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as RunDoc) : null;
    if (!cur || cur.stepId !== step.id || FINAL.includes(cur.status)) return;   // someone else already moved it
    cur.decisions = run.decisions;
    log(cur, step.id, `${step.title}: ${note}`);
    cur.stuckReason = ''; cur.waitUntil = '';
    if ('to' in t) {
      const nxt = flow.steps.find((s) => s.id === t.to)!;
      cur.stepId = nxt.id; cur.status = 'RUNNING'; cur.enteredAt = nowIso();
      log(cur, nxt.id, `Moved to step ${flow.steps.indexOf(nxt) + 1}: ${nxt.title}.`);
    } else if (t.end === 'HIRED') { cur.status = 'HIRED'; log(cur, step.id, 'Applicant hired. The flow is finished.'); }
    else if (t.end === 'REJECTED') { cur.status = 'REJECTED'; log(cur, step.id, 'Applicant rejected. The flow is finished.'); }
    else if (t.end === 'HOLD') { cur.status = 'STUCK'; cur.stuckReason = `${step.title} did not work out and the flow says to wait for HR. Choose what to do with this applicant.`; }
    else { cur.status = 'STUCK'; cur.stuckReason = 'The flow ran out of steps without ending in a hire or a rejection. Ask whoever built the flow to fix it.'; }
    cur.updatedAt = nowIso();
    tx.set(ref, clean(cur));
    Object.assign(run, cur);
    moved = true;
  });
  return moved;
}

/** Moves one applicant as far forward as it can go. Safe to call any number of times. */
export async function advanceRun(cid: string, id: string): Promise<RunDoc | null> {
  let staff: Awaited<ReturnType<typeof people>> | null = null;
  for (let guard = 0; guard < 30; guard++) {
    const run = await loadRun(cid, id);
    if (!run || FINAL.includes(run.status)) return run;
    const flow = toFlow(await getItem(cid, run.flowId, 'flow'));
    const step = flow?.steps.find((s) => s.id === run.stepId);
    if (!flow || !step) { run.status = 'STUCK'; run.stuckReason = 'The step this applicant is on no longer exists in the flow.'; await persist(run); return run; }
    const app = await getApplication(cid, run.applicationId);
    if (!app) { run.status = 'STOPPED'; log(run, step.id, 'The application was deleted, so the flow stopped.'); await persist(run); await closeTasks(cid, run.id, 'CANCELLED'); return run; }
    const seen = await observe(cid, run, flow, step, app);
    // Someone rejected the applicant by hand in the Candidates screen while the flow was just waiting: the flow stops, with a note.
    if (seen.kind === 'wait' && app.status === 'Rejected' && !run.decisions.__rejectedByFlow) {
      run.status = 'REJECTED'; log(run, step.id, 'The application was marked Rejected outside the flow, so the flow stopped.', 'HR'); await persist(run); await closeTasks(cid, run.id, 'CANCELLED'); return run;
    }
    if (seen.kind === 'stuck') {
      if (run.status !== 'STUCK' || run.stuckReason !== seen.reason) { run.status = 'STUCK'; run.stuckReason = seen.reason; log(run, step.id, `Stuck: ${seen.reason}`); await persist(run); }
      return run;
    }
    if (seen.kind === 'wait') {
      staff = staff || await people(cid);
      const problem = await ensureTask(cid, run, flow, step, staff);
      if (problem) { run.status = 'STUCK'; run.stuckReason = problem; await persist(run); return run; }
      const until = step.type === 'wait' ? (run.waitUntil || new Date(Date.parse(run.enteredAt) + Number(step.settings.days || 1) * 86400000).toISOString()) : '';
      if (run.status !== 'WAITING' || run.stuckReason || run.waitUntil !== until) { run.status = 'WAITING'; run.stuckReason = ''; run.waitUntil = until; await persist(run); }
      else if (run.history.length) await persist(run);
      return run;
    }
    if (step.type === 'reject' || (nextTarget(flow, step.id, seen.result) as any).end === 'REJECTED') {
      run.decisions.__rejectedByFlow = { at: nowIso() };
      try { await updateApplication(cid, run.applicationId, { status: 'Rejected' }); } catch { /* the move below still ends the run */ }
    }
    const moved = await applyMove(cid, run, flow, step, seen.result, seen.note);
    await closeTasks(cid, run.id, 'DONE', step.id);
    if (!moved) continue;
    const after = await loadRun(cid, id);
    if (after && FINAL.includes(after.status)) await closeTasks(cid, run.id, 'CANCELLED');
  }
  return loadRun(cid, id);
}

// ------------------------------------------------------------------ hooks used by the rest of hiring (never throw)

export async function flowStartHook(cid: string, applicationId: string): Promise<void> {
  try {
    const live = activeFlow(await flows(cid));
    if (!live || !live.steps.length) return;
    const a = await getApplication(cid, applicationId);
    if (!a || (live.activatedAt && a.createdAt < live.activatedAt)) return;   // applicants from before the flow was published are not pulled in by surprise
    await enroll(cid, a, live);
    await advanceRun(cid, runId(a.id));
  } catch (e: any) { console.warn('[Flow] start hook failed:', e?.message || e); }
}

export async function flowAdvanceHook(cid: string, applicationId: string): Promise<void> {
  try {
    if (await getItem(cid, runId(applicationId), 'flowRun')) await advanceRun(cid, runId(applicationId));
  } catch (e: any) { console.warn('[Flow] advance hook failed:', e?.message || e); }
}

/** The daily job: pull in new applicants the hook missed, move everyone forward, and nudge late tasks once. */
export async function sweepFlows(): Promise<Record<string, any>> {
  const out: Record<string, any> = { companies: 0, advanced: 0, enrolled: 0, lateReminders: 0 };
  const snap = await db().collection('companies').where('status', '==', 'ACTIVE').get();
  for (const c of snap.docs) {
    const cid = c.id;
    try {
      const all = await flows(cid);
      const live = activeFlow(all);
      const runs = (await listItems(cid, 'flowRun')) as RunDoc[];
      if (!live && !runs.length) continue;
      out.companies++;
      if (live) {
        const have = new Set(runs.map((r) => r.applicationId));
        for (const a of await listApplications(cid)) {
          if (have.has(a.id) || (live.activatedAt && a.createdAt < live.activatedAt) || a.status === 'Rejected') continue;
          await enroll(cid, a, live); out.enrolled++;
        }
      }
      for (const r of (await listItems(cid, 'flowRun')) as RunDoc[]) {
        if (FINAL.includes(r.status)) continue;
        await advanceRun(cid, r.id); out.advanced++;
      }
      const staff = await people(cid);
      const company = await companyName(cid);
      for (const t of await listItems(cid, 'flowTask')) {
        if (t.status !== 'OPEN' || t.dueOn >= today() || t.lateNotified === today()) continue;
        const o = staff.find((p) => p.uid === t.ownerUid);
        if (o && EMAIL_RE.test(o.email)) {
          await mailer({ to: o.email, name: o.name, fromName: company, subject: `Late: ${t.stepTitle} for ${t.candidateName}`, body: `Hi ${o.name},\n\nThis hiring task was due on ${t.dueOn} and is still open:\n${t.stepTitle} for ${t.candidateName}.\n\nPlease open Hiring > My tasks.` });
          await putItem({ ...t, lateNotified: today() }); out.lateReminders++;
        }
      }
    } catch (e: any) { out[cid] = { error: e?.message || 'failed' }; }
  }
  return out;
}

// ------------------------------------------------------------------ applicants and tasks

const stepWords = (flow: FlowDoc | null, id: string) => {
  const i = flow ? flow.steps.findIndex((s) => s.id === id) : -1;
  return i < 0 ? { n: 0, title: '' } : { n: i + 1, title: flow!.steps[i].title };
};

async function runsRoute(ctx: AuthContext, q: any): Promise<Res> {
  const cid = ctx.companyId!;
  const flowCache = new Map<string, FlowDoc | null>();
  const getFlow = async (id: string) => { if (!flowCache.has(id)) flowCache.set(id, toFlow(await getItem(cid, id, 'flow'))); return flowCache.get(id)!; };
  const tasks = await listItems(cid, 'flowTask');
  let runs = (await listItems(cid, 'flowRun')) as RunDoc[];
  const want = str(q.status, 20);
  if (want) runs = runs.filter((r) => r.status === want);
  runs.sort((a, b) => (a.status === 'STUCK' ? -1 : 0) - (b.status === 'STUCK' ? -1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const items = [];
  for (const r of runs.slice(0, 500)) {
    const f = await getFlow(r.flowId);
    const w = stepWords(f, r.stepId);
    const t = tasks.find((x) => x.runId === r.id && x.status === 'OPEN');
    items.push({ id: r.id, applicationId: r.applicationId, candidateName: r.candidateName, designation: r.designation, status: r.status, stuckReason: r.stuckReason, flowVersion: r.flowVersion,
      stepId: r.stepId, stepNumber: w.n, stepTitle: w.title, since: r.enteredAt, waitUntil: r.waitUntil, owner: t?.ownerName || '', dueOn: t?.dueOn || '', late: !!t && t.dueOn < today(), updatedAt: r.updatedAt });
  }
  return ok({ items });
}

async function runRoute(ctx: AuthContext, q: any): Promise<Res> {
  const r = await loadRun(ctx.companyId!, str(q.id, 200) || runId(str(q.applicationId, 200)));
  if (!r) return fail(404, 'This applicant is not in the flow.');
  const f = toFlow(await getItem(ctx.companyId!, r.flowId, 'flow'));
  return ok({ run: { ...r, decisions: undefined }, flow: f ? { id: f.id, version: f.version, name: f.name, steps: f.steps } : null });
}

async function enrollRoute(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const live = activeFlow(await flows(cid));
  if (!live) return fail(409, 'Publish a flow first, then add applicants to it.');
  const ids: string[] = Array.isArray(b.applicationIds) ? b.applicationIds.map((x: any) => str(x, 200)).filter(Boolean).slice(0, 200) : [];
  if (!ids.length) return fail(400, 'Choose at least one applicant.');
  let added = 0; let already = 0; let skipped = 0;
  for (const id of ids) {
    const a = await getApplication(cid, id);
    if (!a || a.status === 'Rejected') { skipped++; continue; }
    const r = await enroll(cid, a, live);
    if (r.created) { added++; await advanceRun(cid, r.run.id); } else already++;
  }
  return ok({ added, already, skipped });
}

async function checkNow(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const one = str(b.runId, 200);
  const runs = one ? [await loadRun(cid, one)].filter(Boolean) as RunDoc[] : (await listItems(cid, 'flowRun')) as RunDoc[];
  let n = 0;
  for (const r of runs) { if (FINAL.includes(r.status)) continue; await advanceRun(cid, r.id); n++; }
  return ok({ checked: n });
}

async function runAction(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const run = await loadRun(cid, str(b.runId, 200));
  if (!run) return fail(404, 'Applicant not found in the flow.');
  const flow = toFlow(await getItem(cid, run.flowId, 'flow'));
  const step = flow?.steps.find((s) => s.id === run.stepId);
  const action = str(b.action, 20);
  const who = await whoIs(ctx);
  const note = str(b.note, 300);
  if (FINAL.includes(run.status) && action !== 'restart') return fail(409, 'This applicant has already finished the flow.');
  if (!flow || !step) return fail(409, 'The flow step is missing.');
  if (action === 'retry') {
    await mutateRun(run.id, (f) => { if (f.decisions[step.id]?.email === 'SENDING') delete f.decisions[step.id].email; f.status = 'RUNNING'; f.stuckReason = ''; log(f, step.id, `HR pressed Retry.${note ? ` ${note}` : ''}`, who); });
  }
  else if (action === 'skip') {
    if (!note) return fail(400, 'Write a short reason for skipping, so there is a record.');
    log(run, step.id, `HR skipped this step: ${note}`, who);
    run.decisions[step.id] = { ...(run.decisions[step.id] || {}), email: run.decisions[step.id]?.email || undefined };
    if (!(await applyMove(cid, run, flow, step, step.type === 'condition' ? 'yes' : 'done', `skipped by ${who}`))) return fail(409, 'The applicant already moved on.');
    await closeTasks(cid, run.id, 'DONE', step.id, 'skipped');
  } else if (action === 'reject') {
    if (!note) return fail(400, 'Write a short reason for rejecting, so there is a record.');
    run.decisions.__rejectedByFlow = { at: nowIso() };
    await updateApplication(cid, run.applicationId, { status: 'Rejected' });
    run.status = 'REJECTED'; run.stuckReason = ''; log(run, step.id, `HR rejected the applicant: ${note}`, who); await persist(run); await closeTasks(cid, run.id, 'CANCELLED');
  } else if (action === 'stop') {
    if (!note) return fail(400, 'Write a short reason for stopping, so there is a record.');
    run.status = 'STOPPED'; run.stuckReason = ''; log(run, step.id, `HR took this applicant out of the flow: ${note}`, who); await persist(run); await closeTasks(cid, run.id, 'CANCELLED');
  } else if (action === 'reassign') {
    const uid = str(b.ownerUid, 128);
    const p = (await people(cid)).find((x) => x.uid === uid);
    if (!p) return fail(400, 'Choose an active employee.');
    await closeTasks(cid, run.id, 'CANCELLED', step.id, 'reassigned');
    const old = await getItem(cid, taskId(run.id, step.id), 'flowTask');
    if (old) await db().collection('hiringItems').doc(old.id).delete();
    // Only this applicant changes: the published flow itself stays as it is.
    const patched = { ...flow, steps: flow.steps.map((s) => (s.id === step.id ? { ...s, ownerUid: p.uid, ownerName: p.name } : s)) };
    const custom = { ...patched, id: `${flow.id}__${run.id}`, status: 'ARCHIVED' as const, name: `${flow.name} (adjusted for ${run.candidateName})` };
    await putItem(custom as unknown as Item);
    run.flowId = custom.id; run.status = 'RUNNING'; run.stuckReason = ''; log(run, step.id, `HR gave this step to ${p.name}.`, who); await persist(run);
  } else return fail(400, 'Unknown action.');
  const after = await advanceRun(cid, run.id);
  return ok({ run: after && { ...after, decisions: undefined } });
}

async function myTasks(ctx: AuthContext, q: any): Promise<Res> {
  const cid = ctx.companyId!;
  const all = str(q.all, 1) === '1' && canManage(ctx);
  const items = (await listItems(cid, 'flowTask')).filter((t) => all || t.ownerUid === ctx.uid);
  const open = items.filter((t) => t.status === 'OPEN').sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)));
  const recent = items.filter((t) => t.status !== 'OPEN').sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt))).slice(0, 15);
  const mark = (t: Item) => ({ ...t, late: t.status === 'OPEN' && t.dueOn < today() });
  return ok({ open: open.map(mark), recent: recent.map(mark) });
}

async function taskDecide(ctx: AuthContext, b: any): Promise<Res> {
  const cid = ctx.companyId!;
  const t = await getItem(cid, str(b.taskId, 200), 'flowTask');
  if (!t) return fail(404, 'Task not found.');
  if (!t.decide) return fail(400, 'This task finishes by itself when the work is done in the hiring screens.');
  if (t.status !== 'OPEN') return fail(409, 'This task is already finished.');
  if (t.ownerUid !== ctx.uid && !canManage(ctx)) return fail(403, 'This task belongs to someone else.');
  const decision = str(b.decision, 3);
  if (decision !== 'yes' && decision !== 'no') return fail(400, 'Choose Yes or No.');
  const note = str(b.note, 300);
  if (decision === 'no' && !note) return fail(400, 'Write a short reason for saying no.');
  const run = await loadRun(cid, t.runId);
  if (!run || run.stepId !== t.stepId) return fail(409, 'The applicant has already moved on.');
  const who = await whoIs(ctx);
  run.decisions[t.stepId] = { result: decision, by: who, at: nowIso(), note };
  await persist(run);
  const after = await advanceRun(cid, run.id);
  return ok({ run: after && { ...after, decisions: undefined } });
}

// ------------------------------------------------------------------ router

type Route = { method: 'GET' | 'POST'; who: 'manage' | 'anyone'; run: (ctx: AuthContext, body: any, q: any) => Promise<Res> };
const ROUTES: Record<string, Route> = {
  'flow-state': { method: 'GET', who: 'anyone', run: (c) => stateRoute(c) },
  'flow-start-standard': { method: 'POST', who: 'manage', run: (c) => startStandard(c) },
  'flow-edit': { method: 'POST', who: 'manage', run: (c) => editLive(c) },
  'flow-save': { method: 'POST', who: 'manage', run: (c, b) => saveRoute(c, b) },
  'flow-discard': { method: 'POST', who: 'manage', run: (c) => discard(c) },
  'flow-activate': { method: 'POST', who: 'manage', run: (c, b) => activate(c, b) },
  'flow-runs': { method: 'GET', who: 'manage', run: (c, _b, q) => runsRoute(c, q) },
  'flow-run': { method: 'GET', who: 'manage', run: (c, _b, q) => runRoute(c, q) },
  'flow-enroll': { method: 'POST', who: 'manage', run: (c, b) => enrollRoute(c, b) },
  'flow-check-now': { method: 'POST', who: 'manage', run: (c, b) => checkNow(c, b) },
  'flow-run-action': { method: 'POST', who: 'manage', run: (c, b) => runAction(c, b) },
  'flow-my-tasks': { method: 'GET', who: 'anyone', run: (c, _b, q) => myTasks(c, q) },
  'flow-task-decide': { method: 'POST', who: 'anyone', run: (c, b) => taskDecide(c, b) },
};

export async function routeFlow(r: FlowRequest): Promise<Res | null> {
  const route = ROUTES[r.action];
  if (!route) return null;
  try {
    if (r.method !== route.method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (route.who === 'manage' && !canManage(ctx)) return fail(403, 'Only the people who manage hiring can change the hiring flow.');
    return await route.run(ctx, r.body && typeof r.body === 'object' ? r.body : {}, r.query || {});
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Flow] error:', err);
    return fail(500, err?.message || 'The hiring flow request failed.');
  }
}
