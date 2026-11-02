/**
 * From accepted offer to first day (reached through hiringRouter.ts as /api/recruitment/<action>):
 *
 *   joining-board                         everyone who accepted an offer: documents, emergency contact, welcome kit, accounts, assets
 *   asset-list / asset-save               the asset register (tag, type, serial, status)
 *   asset-issue / asset-return            give an asset to a person (new joiner or employee) and take it back
 *   kit-get / kit-save / kit-tick         the welcome kit checklist (company wording) and ticking it off per joiner
 *   it-set                                IT / system setup per joiner: official email, Microsoft 365, Google, Teams, ClickUp, attendance, payroll
 *
 * The onboarding record itself (employee ID, document request, review, credentials) stays in onboarding.ts; this file adds
 * the register and the checklists around it. Assets and kit settings live in hiringItems and carry a companyId.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { ONBOARDING_DOCUMENTS } from './onboarding.js';
import { MANAGE_PERMS, getItem, listItems, newId, putItem, whoIs, type Item, type PipeRequest } from './pipelineApi.js';

type Result = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const HR_PERMS = [...MANAGE_PERMS, 'onboarding.manage', 'lifecycle.manage'];
const isHr = (ctx: AuthContext) => ctx.isCompanyAdmin || HR_PERMS.some((p) => ctx.perms.includes(p));

// ------------------------------------------------------------------ welcome kit

export const DEFAULT_KIT = {
  items: ['Laptop and charger', 'Employee ID card', 'Welcome note from the founder', 'Company merchandise', 'Who-to-ask list and org chart', 'First-week plan'],
  message: 'Please report to your reporting manager on your first day. Bring a photo ID and the originals of the documents you uploaded. Your laptop, accounts and ID card will be ready, and your manager will walk you through your first week.',
};

export async function welcomeKitFor(cid: string): Promise<{ items: string[]; message: string }> {
  const it = (await listItems(cid, 'kitTemplate'))[0];
  return it ? { items: (it.items as string[]) || DEFAULT_KIT.items, message: String(it.message || DEFAULT_KIT.message) } : DEFAULT_KIT;
}

async function kitGet(cid: string): Promise<Result> {
  return ok({ kit: await welcomeKitFor(cid) });
}

async function kitSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const items = (Array.isArray(b.items) ? b.items : []).map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 20);
  if (!items.length) return fail(400, 'Add at least one item to the welcome kit.');
  const prior = (await listItems(cid, 'kitTemplate'))[0];
  await putItem({ id: prior?.id || newId(), companyId: cid, kind: 'kitTemplate', items, message: str(b.message, 1500) || DEFAULT_KIT.message, updatedAt: nowIso(), updatedBy: await whoIs(ctx) });
  return ok({});
}

// ------------------------------------------------------------------ onboarding record access (company-checked)

async function onboardingOf(cid: string, id: string): Promise<Record<string, any> | null> {
  if (!id) return null;
  const s = await db().collection('onboardings').doc(id).get();
  const d = s.exists ? (s.data() as Record<string, any>) : null;
  return d && d.companyId === cid ? { ...d, id } : null;
}

async function kitTick(ctx: AuthContext, b: any): Promise<Result> {
  const rec = await onboardingOf(ctx.companyId!, str(b.onboardingId, 100));
  if (!rec) return fail(404, 'Joiner not found.');
  const kit = await welcomeKitFor(ctx.companyId!);
  const item = str(b.item, 80);
  if (!kit.items.includes(item)) return fail(400, 'That item is not in the welcome kit.');
  const next = { ...(rec.kit || {}), [item]: b.done !== false };
  await db().collection('onboardings').doc(rec.id).set({ kit: next, updatedAt: nowIso() }, { merge: true });
  return ok({ kit: next });
}

// ------------------------------------------------------------------ IT / system setup

export const IT_KEYS = [
  { key: 'email', label: 'Official email' }, { key: 'm365', label: 'Microsoft 365' }, { key: 'google', label: 'Google Workspace (if used)' },
  { key: 'teams', label: 'Teams' }, { key: 'clickup', label: 'ClickUp' }, { key: 'attendance', label: 'Attendance profile' }, { key: 'payroll', label: 'Payroll profile' },
] as const;
const IT_STATUS = ['PENDING', 'DONE', 'NOT_NEEDED'] as const;

async function itSet(ctx: AuthContext, b: any): Promise<Result> {
  const rec = await onboardingOf(ctx.companyId!, str(b.onboardingId, 100));
  if (!rec) return fail(404, 'Joiner not found.');
  const key = str(b.key, 20);
  if (!IT_KEYS.some((k) => k.key === key)) return fail(400, 'Unknown setup item.');
  const status = str(b.status, 20);
  if (!(IT_STATUS as readonly string[]).includes(status)) return fail(400, 'Choose Pending, Done or Not needed.');
  const itAccounts = { ...(rec.itAccounts || {}), [key]: { status, note: str(b.note, 200), by: await whoIs(ctx), at: nowIso() } };
  await db().collection('onboardings').doc(rec.id).set({ itAccounts, updatedAt: nowIso() }, { merge: true });
  return ok({ itAccounts });
}

// ------------------------------------------------------------------ asset register

export const ASSET_TYPES = ['LAPTOP', 'DESKTOP', 'MONITOR', 'PHONE', 'ACCESSORY', 'ID_CARD', 'SOFTWARE_LICENSE', 'OTHER'] as const;

async function assetList(cid: string, q: any): Promise<Result> {
  let items = await listItems(cid, 'asset');
  if (q.status) items = items.filter((a) => a.status === str(q.status, 20));
  if (q.uid) items = items.filter((a) => a.holderUid === str(q.uid, 128) && a.status === 'ISSUED');
  return ok({ items: items.sort((a, b) => String(a.tag).localeCompare(String(b.tag))), types: ASSET_TYPES });
}

async function assetSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const tag = str(b.tag, 40).toUpperCase();
  if (!tag) return fail(400, 'Give the asset a tag, for example LAP-014.');
  const type = str(b.type, 30);
  if (!(ASSET_TYPES as readonly string[]).includes(type)) return fail(400, 'Choose the asset type.');
  const all = await listItems(cid, 'asset');
  const prior = b.id ? all.find((a) => a.id === str(b.id, 100)) : undefined;
  if (b.id && !prior) return fail(404, 'Asset not found.');
  if (all.some((a) => a.tag === tag && a.id !== prior?.id)) return fail(409, `An asset with the tag ${tag} already exists.`);
  const status = prior ? (str(b.status, 20) === 'RETIRED' && prior.status !== 'ISSUED' ? 'RETIRED' : prior.status === 'RETIRED' && str(b.status, 20) === 'IN_STOCK' ? 'IN_STOCK' : prior.status) : 'IN_STOCK';
  const it: Item = {
    ...(prior || {}), id: prior?.id || newId(), companyId: cid, kind: 'asset', tag, type, description: str(b.description, 200), serial: str(b.serial, 80), purchasedOn: isDay(str(b.purchasedOn, 10)) ? str(b.purchasedOn, 10) : '',
    status, history: prior?.history || [], updatedAt: nowIso(),
  };
  await putItem(it);
  return ok({ item: it });
}

/** Who can hold an asset: a joiner on the board (onboardingId) or an employee in this company (uid). */
async function holderFrom(cid: string, b: any): Promise<{ holderName: string; holderUid: string; holderOnboardingId: string; holderEmpId: string } | { error: string; status: number }> {
  const onboardingId = str(b.onboardingId, 100);
  if (onboardingId) {
    const rec = await onboardingOf(cid, onboardingId);
    if (!rec) return { error: 'Joiner not found.', status: 404 };
    return { holderName: str(rec.name, 100), holderUid: '', holderOnboardingId: rec.id, holderEmpId: str(rec.employeeId, 40) };
  }
  const uid = str(b.uid, 128);
  if (uid) {
    const s = await db().collection('employees').where('companyId', '==', cid).get();
    const d = s.docs.find((x: any) => String(x.get('authUid') || x.id) === uid);
    if (!d) return { error: 'Employee not found.', status: 404 };
    return { holderName: str(d.get('name'), 100), holderUid: uid, holderOnboardingId: '', holderEmpId: str(d.get('empId') || d.get('employeeId'), 40) };
  }
  return { error: 'Choose who the asset is for.', status: 400 };
}

async function assetIssue(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getItem(cid, str(b.id, 100), 'asset');
  if (!a) return fail(404, 'Asset not found.');
  if (a.status !== 'IN_STOCK') return fail(409, a.status === 'ISSUED' ? `This asset is already with ${a.holderName}.` : 'This asset is retired.');
  const h = await holderFrom(cid, b);
  if ('error' in h) return fail(h.status, h.error);
  const on = str(b.issuedOn, 10) || todayIst();
  if (!isDay(on)) return fail(400, 'Enter a valid date.');
  const who = await whoIs(ctx);
  const next: Item = { ...a, ...h, status: 'ISSUED', issuedOn: on, issueNote: str(b.note, 200), updatedAt: nowIso(), history: [...(a.history || []), { at: nowIso(), by: who, action: 'issued', to: h.holderName, on }].slice(-30) };
  // Re-read inside a transaction so two people cannot hand out the same laptop at once.
  const ref = db().collection('hiringItems').doc(a.id);
  const res = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as Item) : null;
    if (!cur || cur.status !== 'IN_STOCK') return false;
    tx.set(ref, JSON.parse(JSON.stringify(next)));
    return true;
  });
  return res ? ok({ item: next }) : fail(409, 'Someone else just issued this asset.');
}

async function assetReturn(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getItem(cid, str(b.id, 100), 'asset');
  if (!a) return fail(404, 'Asset not found.');
  if (a.status !== 'ISSUED') return fail(409, 'This asset is not issued to anyone.');
  const on = str(b.returnedOn, 10) || todayIst();
  if (!isDay(on)) return fail(400, 'Enter a valid date.');
  const condition = ['GOOD', 'DAMAGED', 'LOST'].includes(str(b.condition, 10)) ? str(b.condition, 10) : 'GOOD';
  const who = await whoIs(ctx);
  const next: Item = {
    ...a, status: condition === 'LOST' ? 'RETIRED' : 'IN_STOCK', holderName: '', holderUid: '', holderOnboardingId: '', holderEmpId: '', issuedOn: '', lastCondition: condition,
    updatedAt: nowIso(), history: [...(a.history || []), { at: nowIso(), by: who, action: 'returned', from: a.holderName, on, condition, note: str(b.note, 200) }].slice(-30),
  };
  await putItem(next);
  return ok({ item: next });
}

/** Assets still held by someone: used by exit clearance screens. */
export async function assetsHeldBy(cid: string, uid: string): Promise<Item[]> {
  return (await listItems(cid, 'asset')).filter((a) => a.status === 'ISSUED' && a.holderUid === uid);
}

// ------------------------------------------------------------------ joining board

async function joiningBoard(cid: string): Promise<Result> {
  const [offers, assets, kit] = await Promise.all([listItems(cid, 'offer'), listItems(cid, 'asset'), welcomeKitFor(cid)]);
  const snap = await db().collection('onboardings').where('companyId', '==', cid).get();
  const recs = new Map<string, any>(snap.docs.map((d: any) => [d.id, { ...d.data(), id: d.id }]));
  const rows = offers
    .filter((o) => ['ACCEPTED', 'JOINED'].includes(o.status) || o.onboardingId)
    .map((o) => {
      const rec = o.onboardingId ? recs.get(o.onboardingId) : null;
      const required = ONBOARDING_DOCUMENTS.filter((d) => d.required);
      const uploaded = rec ? required.filter((d) => rec.docs?.[d.key]).length : 0;
      const kitDone = rec ? kit.items.filter((i) => rec.kit?.[i]).length : 0;
      return {
        offerId: o.id, onboardingId: o.onboardingId || '', candidateName: o.candidateName, designation: o.designation, department: o.department, joiningDate: o.joiningDate,
        ctcLpa: o.approvedCtcLpa, offerStatus: o.status, onboardingError: o.onboardingError || '', employeeId: rec?.employeeId || o.employeeId || '',
        onboardingStatus: rec?.status || '', docsUploaded: uploaded, docsRequired: required.length, emergency: !!rec?.emergency?.name,
        kit: { done: kitDone, total: kit.items.length, ticks: rec?.kit || {} }, itAccounts: rec?.itAccounts || {},
        assets: assets.filter((a) => a.status === 'ISSUED' && rec && a.holderOnboardingId === rec.id).map((a) => ({ id: a.id, tag: a.tag, type: a.type })),
      };
    })
    .sort((a, b) => String(a.joiningDate).localeCompare(String(b.joiningDate)));
  return ok({ rows, kit, itKeys: IT_KEYS, today: todayIst() });
}

// ------------------------------------------------------------------ routing

const ACTIONS: Record<string, 'GET' | 'POST'> = {
  'joining-board': 'GET', 'asset-list': 'GET', 'asset-save': 'POST', 'asset-issue': 'POST', 'asset-return': 'POST',
  'kit-get': 'GET', 'kit-save': 'POST', 'kit-tick': 'POST', 'it-set': 'POST',
};

export async function routeJoining(r: PipeRequest): Promise<Result | null> {
  const method = ACTIONS[r.action];
  if (!method) return null;
  try {
    if (r.method !== method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (!isHr(ctx)) return fail(403, 'You do not have permission to do this.');
    const cid = ctx.companyId;
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'joining-board': return await joiningBoard(cid);
      case 'asset-list': return await assetList(cid, r.query);
      case 'asset-save': return await assetSave(ctx, b);
      case 'asset-issue': return await assetIssue(ctx, b);
      case 'asset-return': return await assetReturn(ctx, b);
      case 'kit-get': return await kitGet(cid);
      case 'kit-save': return await kitSave(ctx, b);
      case 'kit-tick': return await kitTick(ctx, b);
      default: return await itSet(ctx, b);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Joining] error:', err);
    return fail(500, err?.message || 'Joining request failed.');
  }
}
