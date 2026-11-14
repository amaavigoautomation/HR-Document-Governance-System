/**
 * Browser data gateway.
 *
 * With Firestore the browser read and wrote a handful of collections directly, protected by firestore.rules.
 * MongoDB must never be reachable from a browser, so those same reads and writes go through the server here
 * (POST /api/tenant/data-get | data-list | data-set | data-update | data-delete). This file is the port of the
 * client-facing part of firestore.rules, and the checks are the same:
 *
 *   - the caller's company, status and permissions come from the verified ID token, never from the request
 *   - every record is read and written only inside the caller's own company (companyId is forced server-side)
 *   - which permission each collection needs, whether a record can be created / updated / deleted, that a record
 *     cannot change company or id, that an audit log is write-once, and that an acknowledgment cannot go back
 *     from ACKNOWLEDGED to PENDING
 *
 * Not ported: the field-by-field shape validators in firestore.rules (isValidEmployee, isValidDocument ...).
 * Those only stop a signed-in person who already holds the right permission from saving a malformed record.
 * Here that is limited to a valid id, a size cap and the checks above.
 */
import { adminDb } from './firebaseAdmin.js';
import { AuthError, authenticate, authErrorResponse, type AuthContext } from './authContext.js';

export interface DataRequest {
  method: string;
  action: string;
  body: any;
  headers: Record<string, any>;
}
export interface DataResult {
  status: number;
  json: any;
}

const ok = (json: any = {}): DataResult => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): DataResult => ({ status, json: { success: false, error } });

const ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const MAX_BYTES = 400_000;
const MAX_DOCS = 20_000;

type Action = 'create' | 'update' | 'delete';
interface Policy {
  /** Who may read a record of this collection (company membership is always required). */
  read?: string[]; // permission keys, any one of; omitted means any active member
  create?: string[] | 'member' | false;
  update?: string[] | 'member' | false;
  delete?: string[] | 'member' | false;
  /** Fields that must keep their value on update. */
  immutable?: string[];
}

const POLICIES: Record<string, Policy> = {
  documents: { create: ['doc.create'], update: ['doc.create', 'doc.review', 'doc.publish'], delete: ['doc.delete'], immutable: ['id'] },
  versions: { create: ['doc.create'], update: ['doc.create', 'doc.review', 'doc.publish'], delete: ['doc.delete', 'doc.create'], immutable: ['id'] },
  auditLogs: { create: 'member', update: false, delete: false },
  acknowledgments: {
    create: ['doc.acknowledge', 'doc.create', 'doc.publish', 'doc.review'],
    update: ['doc.acknowledge', 'doc.create', 'doc.publish', 'doc.review'],
    delete: ['doc.delete', 'doc.create'],
  },
  notifications: { create: 'member', update: 'member', delete: 'member' },
  documentSuggestions: { create: ['doc.suggest'], update: ['doc.review', 'doc.create', 'doc.publish'], delete: ['doc.review', 'doc.create', 'doc.delete'] },
  requisitions: {
    read: ['req.create', 'req.view_all', 'req.assign', 'req.hr_decide', 'req.founder_decide', 'req.manage_jd'],
    create: ['req.create'],
    update: ['req.create', 'req.assign', 'req.hr_decide', 'req.founder_decide', 'req.manage_jd'],
    delete: false,
    immutable: ['id'],
  },
  // Read-only for the browser: the server writes these (users, departments, roles).
  employees: { create: false, update: false, delete: false },
  departments: { create: false, update: false, delete: false },
  roles: { create: false, update: false, delete: false },
};
// `companies` is handled separately: a member reads their own company, a platform admin any, nobody writes.

const isActive = (c: AuthContext) => !!c.companyId && c.companyStatus === 'ACTIVE';
const holdsAny = (c: AuthContext, perms: string[]) => isActive(c) && perms.some((p) => c.perms.includes(p));

function allowed(c: AuthContext, rule: string[] | 'member' | false | undefined): boolean {
  if (rule === undefined || rule === 'member') return isActive(c);
  if (rule === false) return false;
  return holdsAny(c, rule);
}

const deny = (what: string) => new AuthError(403, `Not permitted: ${what}`);

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new AuthError(400, `${name} is required.`);
  return v;
}

function policyFor(collection: string): Policy {
  const p = POLICIES[collection];
  if (!p) throw new AuthError(403, `The "${collection}" collection is not available from the browser.`);
  return p;
}

function checkPayload(data: unknown): Record<string, any> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AuthError(400, 'data must be an object.');
  if (JSON.stringify(data).length > MAX_BYTES) throw new AuthError(413, 'That record is too large.');
  return data as Record<string, any>;
}

const inMyCompany = (c: AuthContext, rec: Record<string, any> | undefined) => !!rec && isActive(c) && rec.companyId === c.companyId;

// ----------------------------------------------------------------------------------------------------------------

async function get(b: any, c: AuthContext): Promise<DataResult> {
  const collection = str(b.collection, 'collection');
  const id = str(b.id, 'id');
  if (!ID_RE.test(id)) return fail(400, 'Invalid id.');

  if (collection !== 'companies') policyFor(collection); // refuses anything the browser may not touch
  const snap = await adminDb().collection(collection).doc(id).get();
  const rec = snap.exists ? (snap.data() as Record<string, any>) : undefined;
  const hidden = ok({ exists: false, data: null });

  if (collection === 'companies') {
    if (!rec || !(c.companyId === id || c.isPlatformAdmin)) return hidden;
    return ok({ exists: true, id, data: rec });
  }
  if (collection === 'employees') {
    if (!rec) return hidden;
    if (c.uid === id || inMyCompany(c, rec)) return ok({ exists: true, id, data: rec });
    return hidden;
  }
  const policy = policyFor(collection);
  if (!inMyCompany(c, rec)) return hidden;
  if (policy.read && !holdsAny(c, policy.read)) throw deny(`reading ${collection}`);
  return ok({ exists: true, id, data: rec });
}

async function list(b: any, c: AuthContext): Promise<DataResult> {
  const collection = str(b.collection, 'collection');
  const policy = policyFor(collection);
  if (!isActive(c)) throw new AuthError(403, 'Your company is not active.');
  if (policy.read && !holdsAny(c, policy.read)) throw deny(`reading ${collection}`);

  let q: any = adminDb().collection(collection).where('companyId', '==', c.companyId);
  const filters = Array.isArray(b.filters) ? b.filters : [];
  for (const f of filters) {
    const field = String(f?.field || '');
    if (f?.op !== '==') return fail(400, 'Only equality filters are supported.');
    if (!FIELD_RE.test(field)) return fail(400, 'Invalid filter field.');
    const v = f.value;
    if (!(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null)) return fail(400, 'Invalid filter value.');
    if (field === 'companyId') {
      if (v !== c.companyId) throw deny('another company\'s records');
      continue;
    }
    q = q.where(field, '==', v);
  }
  const snap = await q.limit(MAX_DOCS).get();
  return ok({ docs: snap.docs.map((d: any) => ({ id: d.id, data: d.data() })) });
}

/** Writes: `set` creates or replaces (merge optional), `update` changes fields of an existing record. */
async function write(action: 'set' | 'update', b: any, c: AuthContext): Promise<DataResult> {
  const collection = str(b.collection, 'collection');
  const policy = policyFor(collection);
  const id = str(b.id, 'id');
  if (!ID_RE.test(id)) return fail(400, 'Invalid id.');
  const data = checkPayload(b.data);
  if (!isActive(c)) throw new AuthError(403, 'Your company is not active.');

  const ref = adminDb().collection(collection).doc(id);
  const before = await ref.get();
  const current = before.exists ? (before.data() as Record<string, any>) : undefined;

  if (current && !inMyCompany(c, current)) throw deny('this record belongs to another company');

  const kind: Action = current ? 'update' : 'create';
  if (action === 'update' && !current) return fail(404, 'No such record.');
  if (!allowed(c, policy[kind])) throw deny(`${kind === 'create' ? 'creating' : 'changing'} ${collection}`);

  if (data.companyId !== undefined && data.companyId !== c.companyId) throw deny('writing into another company');
  const merged = action === 'set' && !b.merge ? { ...data } : { ...(current || {}), ...data };
  merged.companyId = c.companyId;

  if (kind === 'update') {
    for (const f of policy.immutable || []) {
      if (merged[f] !== current![f]) throw deny(`changing ${f}`);
    }
    if (collection === 'auditLogs') throw deny('audit logs cannot be changed');
    if (collection === 'acknowledgments' && current!.status === 'ACKNOWLEDGED' && merged.status === 'PENDING') {
      throw deny('an acknowledgment cannot go back to pending');
    }
  } else if ((collection === 'documents' || collection === 'versions' || collection === 'requisitions') && merged.id !== undefined && merged.id !== id) {
    return fail(400, 'The record id must match its document id.');
  }

  if (action === 'update') {
    // `companyId` is stamped by the server and never moves.
    const { companyId: _c, ...fields } = data;
    await ref.update(fields);
  } else {
    await ref.set({ ...data, companyId: c.companyId }, b.merge ? { merge: true } : undefined);
  }
  return ok({ id });
}

async function remove(b: any, c: AuthContext): Promise<DataResult> {
  const collection = str(b.collection, 'collection');
  const policy = policyFor(collection);
  const id = str(b.id, 'id');
  if (!ID_RE.test(id)) return fail(400, 'Invalid id.');
  if (!allowed(c, policy.delete)) throw deny(`deleting from ${collection}`);

  const ref = adminDb().collection(collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return ok({ id });
  if (!inMyCompany(c, snap.data() as Record<string, any>)) throw deny('this record belongs to another company');
  await ref.delete();
  return ok({ id });
}

export async function routeData(r: DataRequest): Promise<DataResult> {
  try {
    if (r.method !== 'POST') return fail(405, 'Method not allowed.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const c = await authenticate(r.headers);
    switch (r.action) {
      case 'data-get': return await get(b, c);
      case 'data-list': return await list(b, c);
      case 'data-set': return await write('set', b, c);
      case 'data-update': return await write('update', b, c);
      case 'data-delete': return await remove(b, c);
      default: return fail(404, `Unknown data action "${r.action}".`);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[data] error:', err);
    return fail(500, err?.message || 'Request failed.');
  }
}
