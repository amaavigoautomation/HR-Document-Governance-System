/**
 * MongoDB behind the Firestore Admin API.
 *
 * Every server module talks to the database through `adminDb()` using the same small slice of the Firestore
 * Admin API (collection / doc / where / limit / get / set / update / delete / batch / runTransaction).
 * This file implements that slice on top of MongoDB, so switching databases is one environment variable
 * (MONGODB_URI) and none of the ~45 business-logic modules had to change.
 *
 * Storage model: one MongoDB collection per Firestore collection, one MongoDB document per Firestore document,
 * with the Firestore document id stored as `_id` (a string). All fields keep their names, so a Firestore export
 * can be copied across as-is (see scripts/migrate-firestore-to-mongo.ts).
 *
 * Semantics kept from Firestore, because the code relies on them:
 *  - `undefined` fields are skipped instead of rejected (the app leaves optional fields undefined everywhere)
 *  - `update()` on a missing document fails with NOT_FOUND; `set()` creates it; `set(.., {merge:true})` deep-merges maps
 *  - `FieldValue.increment / arrayUnion / arrayRemove / delete / serverTimestamp`
 *  - `runTransaction` re-runs the function on conflict; writes are applied together when it finishes
 *
 * Transactions need a replica set (MongoDB Atlas always is one). On a standalone mongod the adapter notices
 * and falls back to "check that nothing you read has changed, then apply the writes", which is safe for a
 * single app server but not atomic across several writers.
 */
import { randomBytes } from 'node:crypto';
import { MongoClient, type ClientSession, type Collection, type Db, type Document } from 'mongodb';

type Doc = Record<string, any>;

// --------------------------------------------------------------------------------------------------------
// FieldValue sentinels
// --------------------------------------------------------------------------------------------------------

export class MongoFieldValue {
  constructor(readonly kind: 'arrayUnion' | 'arrayRemove' | 'increment' | 'delete' | 'serverTimestamp', readonly arg?: any) {}
}

export const MongoFieldValues = {
  arrayUnion: (...items: any[]) => new MongoFieldValue('arrayUnion', items),
  arrayRemove: (...items: any[]) => new MongoFieldValue('arrayRemove', items),
  increment: (n: number) => new MongoFieldValue('increment', n),
  delete: () => new MongoFieldValue('delete'),
  serverTimestamp: () => new MongoFieldValue('serverTimestamp'),
};

// --------------------------------------------------------------------------------------------------------
// Connection (cached across serverless invocations and dev reloads)
// --------------------------------------------------------------------------------------------------------

export function isMongoConfigured(): boolean {
  return !!(process.env.MONGODB_URI || '').trim();
}

interface Handle {
  client?: Promise<MongoClient>;
  indexed: Set<string>;
}
const G = globalThis as unknown as { __mongoFirestore?: Handle };
const handle: Handle = (G.__mongoFirestore ||= { indexed: new Set() });

function databaseName(uri: string): string {
  const explicit = (process.env.MONGODB_DB || '').trim();
  if (explicit) return explicit;
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : 'hr_governance';
}

async function getDb(): Promise<Db> {
  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not set. Add your MongoDB connection string to the environment.');
  if (!handle.client) {
    handle.client = new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 }).connect().catch((err) => {
      handle.client = undefined; // let the next request try again instead of caching the failure
      throw err;
    });
  }
  return (await handle.client).db(databaseName(uri));
}

async function getClient(): Promise<MongoClient> {
  await getDb();
  return handle.client!;
}

/** Every record carries a companyId and nearly every query filters on it, so index it the first time a collection is used. */
function ensureIndexes(col: Collection<Document>, name: string) {
  if (handle.indexed.has(name)) return;
  handle.indexed.add(name);
  Promise.resolve()
    .then(() => (col as any).createIndex?.({ companyId: 1 }, { name: 'companyId_1' }))
    .catch(() => {
      /* an index is a speed-up, never a reason to fail a request */
    });
}

// --------------------------------------------------------------------------------------------------------
// Value helpers
// --------------------------------------------------------------------------------------------------------

const isPlain = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof MongoFieldValue) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

/** Drops `undefined` everywhere (Firestore's ignoreUndefinedProperties) and leaves sentinels alone. */
function clean(v: any): any {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean);
  if (isPlain(v)) {
    const out: Doc = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x);
    return out;
  }
  return v;
}

const getPath = (obj: any, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const safeKey = (k: string) => k.length > 0 && !k.includes('.') && !k.startsWith('$');

interface Ops {
  $set?: Doc;
  $unset?: Doc;
  $inc?: Doc;
  $addToSet?: Doc;
  $pull?: Doc;
}

function addOp(ops: Ops, path: string, value: any) {
  if (value instanceof MongoFieldValue) {
    switch (value.kind) {
      case 'delete': (ops.$unset ||= {})[path] = ''; return;
      case 'increment': (ops.$inc ||= {})[path] = value.arg; return;
      case 'arrayUnion': (ops.$addToSet ||= {})[path] = { $each: value.arg }; return;
      case 'arrayRemove': (ops.$pull ||= {})[path] = { $in: value.arg }; return;
      case 'serverTimestamp': (ops.$set ||= {})[path] = new Date(); return;
    }
  }
  (ops.$set ||= {})[path] = value;
}

/** `update()`: keys are field paths and a map value replaces the whole field. */
function updateOps(data: Doc): Ops {
  const ops: Ops = {};
  for (const [path, value] of Object.entries(clean(data))) addOp(ops, path, value);
  return ops;
}

/** `set(.., {merge:true})`: maps merge key by key, everything else (arrays, scalars) replaces the field. */
function mergeOps(data: Doc): Ops {
  const ops: Ops = {};
  const walk = (obj: Doc, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (isPlain(v) && Object.keys(v).length > 0 && Object.keys(v).every(safeKey) && safeKey(k)) walk(v, path);
      else addOp(ops, path, v);
    }
  };
  walk(clean(data), '');
  return ops;
}

/** `set()` without merge replaces the document, so sentinels are resolved against an empty document. */
function resolveForReplace(data: Doc): Doc {
  const out: Doc = {};
  const walk = (src: Doc, dst: Doc) => {
    for (const [k, v] of Object.entries(src)) {
      if (v instanceof MongoFieldValue) {
        if (v.kind === 'delete') continue;
        if (v.kind === 'increment') dst[k] = v.arg;
        else if (v.kind === 'arrayUnion') dst[k] = [...v.arg];
        else if (v.kind === 'arrayRemove') dst[k] = [];
        else dst[k] = new Date();
      } else if (isPlain(v)) {
        dst[k] = {};
        walk(v, dst[k]);
      } else dst[k] = v;
    }
  };
  walk(clean(data), out);
  return out;
}

function notFound(): Error {
  return Object.assign(new Error('5 NOT_FOUND: No document to update.'), { code: 5 });
}

// --------------------------------------------------------------------------------------------------------
// Snapshots and references
// --------------------------------------------------------------------------------------------------------

export class MongoDocSnapshot {
  constructor(readonly id: string, private d: Doc | undefined, readonly ref: MongoDocRef) {}
  get exists(): boolean { return this.d !== undefined; }
  data(): Doc | undefined { return this.d === undefined ? undefined : structuredClone(this.d); }
  get(field: string): any { return this.d === undefined ? undefined : getPath(this.d, field); }
}

export class MongoQuerySnapshot {
  readonly docs: MongoDocSnapshot[];
  constructor(docs: MongoDocSnapshot[]) { this.docs = docs; }
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
  forEach(fn: (s: MongoDocSnapshot) => void) { this.docs.forEach(fn); }
}

const toDoc = (raw: Document | null | undefined): Doc | undefined => {
  if (!raw) return undefined;
  const { _id, ...rest } = raw as Doc;
  return rest;
};

/** Set while a transaction is running so nested reads and writes join it. */
type Sess = ClientSession | undefined;

export class MongoDocRef {
  constructor(readonly fs: MongoFirestore, readonly collectionName: string, readonly id: string) {}

  async get(): Promise<MongoDocSnapshot> { return this.getIn(undefined); }

  async getIn(session: Sess): Promise<MongoDocSnapshot> {
    const col = await this.fs.col(this.collectionName);
    const raw = await col.findOne({ _id: this.id as any }, { session });
    return new MongoDocSnapshot(this.id, toDoc(raw), this);
  }

  async set(data: Doc, opts?: { merge?: boolean }) { await this.setIn(undefined, data, opts); }
  async update(data: Doc) { await this.updateIn(undefined, data); }
  async create(data: Doc) { await this.createIn(undefined, data); }
  async delete() { await this.deleteIn(undefined); }

  async setIn(session: Sess, data: Doc, opts?: { merge?: boolean }) {
    const col = await this.fs.col(this.collectionName);
    if (opts?.merge) {
      const ops = mergeOps(data);
      if (!Object.keys(ops).length) await col.updateOne({ _id: this.id as any }, { $setOnInsert: {} }, { upsert: true, session });
      else await col.updateOne({ _id: this.id as any }, ops as Document, { upsert: true, session });
    } else {
      await col.replaceOne({ _id: this.id as any }, resolveForReplace(data), { upsert: true, session });
    }
  }

  async updateIn(session: Sess, data: Doc) {
    const col = await this.fs.col(this.collectionName);
    const ops = updateOps(data);
    if (!Object.keys(ops).length) {
      if ((await col.countDocuments({ _id: this.id as any }, { session, limit: 1 })) === 0) throw notFound();
      return;
    }
    const res = await col.updateOne({ _id: this.id as any }, ops as Document, { session });
    if (res.matchedCount === 0) throw notFound();
  }

  async createIn(session: Sess, data: Doc) {
    const col = await this.fs.col(this.collectionName);
    try {
      await col.insertOne({ _id: this.id as any, ...resolveForReplace(data) }, { session });
    } catch (err: any) {
      if (err?.code === 11000) throw Object.assign(new Error('6 ALREADY_EXISTS: Document already exists.'), { code: 6 });
      throw err;
    }
  }

  async deleteIn(session: Sess) {
    const col = await this.fs.col(this.collectionName);
    await col.deleteOne({ _id: this.id as any }, { session });
  }
}

// --------------------------------------------------------------------------------------------------------
// Queries
// --------------------------------------------------------------------------------------------------------

type Cond = Doc;

function condition(field: string, op: string, value: any): Cond {
  const f = field === '__name__' ? '_id' : field;
  switch (op) {
    case '==': return { [f]: value };
    case '!=': return { [f]: { $ne: value, $exists: true } };
    case '<': return { [f]: { $lt: value } };
    case '<=': return { [f]: { $lte: value } };
    case '>': return { [f]: { $gt: value } };
    case '>=': return { [f]: { $gte: value } };
    case 'in': return { [f]: { $in: Array.isArray(value) ? value : [value] } };
    case 'not-in': return { [f]: { $nin: Array.isArray(value) ? value : [value], $exists: true } };
    case 'array-contains': return { [f]: value };
    case 'array-contains-any': return { [f]: { $in: Array.isArray(value) ? value : [value] } };
    default: throw new Error(`Unsupported query operator "${op}".`);
  }
}

export class MongoQuery {
  constructor(
    protected fs: MongoFirestore,
    protected name: string,
    protected conds: Cond[] = [],
    protected sorts: [string, 1 | -1][] = [],
    protected max?: number,
    protected skip?: number,
    protected fields?: string[]
  ) {}

  protected next(patch: Partial<{ conds: Cond[]; sorts: [string, 1 | -1][]; max: number; skip: number; fields: string[] }>): MongoQuery {
    return new MongoQuery(this.fs, this.name, patch.conds ?? this.conds, patch.sorts ?? this.sorts, patch.max ?? this.max, patch.skip ?? this.skip, patch.fields ?? this.fields);
  }

  where(field: string, op: string, value: any) { return this.next({ conds: [...this.conds, condition(field, op, value)] }); }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') { return this.next({ sorts: [...this.sorts, [field === '__name__' ? '_id' : field, dir === 'desc' ? -1 : 1]] }); }
  limit(n: number) { return this.next({ max: n }); }
  offset(n: number) { return this.next({ skip: n }); }
  select(...fields: string[]) { return this.next({ fields }); }

  private filter(): Doc { return this.conds.length === 0 ? {} : this.conds.length === 1 ? this.conds[0] : { $and: this.conds }; }

  async get(): Promise<MongoQuerySnapshot> { return this.getIn(undefined); }

  async getIn(session: Sess): Promise<MongoQuerySnapshot> {
    const col = await this.fs.col(this.name);
    let cur = col.find(this.filter(), { session });
    if (this.sorts.length) cur = cur.sort(this.sorts as any);
    if (this.skip) cur = cur.skip(this.skip);
    if (this.max !== undefined) cur = cur.limit(this.max);
    if (this.fields) cur = cur.project(this.fields.length ? Object.fromEntries(this.fields.map((f) => [f, 1])) : { _id: 1 });
    const rows = await cur.toArray();
    return new MongoQuerySnapshot(rows.map((r) => new MongoDocSnapshot(String(r._id), toDoc(r), new MongoDocRef(this.fs, this.name, String(r._id)))));
  }

  count() {
    return {
      get: async () => {
        const col = await this.fs.col(this.name);
        const n = await col.countDocuments(this.filter());
        return { data: () => ({ count: n }) };
      },
    };
  }
}

export class MongoCollection extends MongoQuery {
  constructor(fs: MongoFirestore, name: string) { super(fs, name); }
  get id() { return this.name; }
  doc(id?: string) { return new MongoDocRef(this.fs, this.name, id || autoId()); }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function autoId(): string {
  let s = '';
  for (const b of randomBytes(20)) s += ALPHABET[b % ALPHABET.length];
  return s;
}

// --------------------------------------------------------------------------------------------------------
// The database, batches and transactions
// --------------------------------------------------------------------------------------------------------

/** MongoDB refuses transactions on a standalone server; we remember that and stop asking. */
let transactionsSupported: boolean | undefined;
const looksUnsupported = (err: any) =>
  err?.code === 20 || /Transaction numbers are only allowed|replica set member|does not support transactions|not supported/i.test(String(err?.message || ''));

export class MongoFirestore {
  private cache = new Map<string, Promise<Collection<Document>>>();

  /** `testDb` lets tests run the adapter against an in-memory stand-in for the MongoDB driver (no transactions there). */
  constructor(private testDb?: Db) {}

  private database(): Promise<Db> { return this.testDb ? Promise.resolve(this.testDb) : getDb(); }
  private client(): Promise<MongoClient | null> { return this.testDb ? Promise.resolve(null) : getClient(); }

  col(name: string): Promise<Collection<Document>> {
    let p = this.cache.get(name);
    if (!p) {
      p = this.database().then((db) => {
        const c = db.collection(name);
        if (!this.testDb) ensureIndexes(c, name);
        return c;
      });
      p.catch(() => this.cache.delete(name));
      this.cache.set(name, p);
    }
    return p;
  }

  collection(name: string) { return new MongoCollection(this, name); }

  async listCollections() {
    const db = await this.database();
    return (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => ({ id: c.name }));
  }

  /**
   * Without server-side transactions, writers inside this process take turns (one chain per database), so two requests
   * that read-then-write the same records cannot interleave. That covers one app server; several servers sharing a
   * standalone MongoDB would still need a replica set (use Atlas) to be safe.
   */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Runs `fn` inside a transaction when the server supports one, otherwise without (one at a time). */
  private async atomic<T>(fn: (session: Sess) => Promise<T>): Promise<T> {
    const client = await this.client();
    if (!client || transactionsSupported === false) return this.serial(() => fn(undefined));
    const session = client.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => { out = await fn(session); });
      transactionsSupported = true;
      return out;
    } catch (err) {
      if (looksUnsupported(err)) {
        transactionsSupported = false;
        return this.serial(() => fn(undefined));
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }

  batch() {
    const ops: ((s: Sess) => Promise<void>)[] = [];
    const api = {
      set: (r: MongoDocRef, d: Doc, o?: { merge?: boolean }) => { ops.push((s) => r.setIn(s, d, o)); return api; },
      update: (r: MongoDocRef, d: Doc) => { ops.push((s) => r.updateIn(s, d)); return api; },
      create: (r: MongoDocRef, d: Doc) => { ops.push((s) => r.createIn(s, d)); return api; },
      delete: (r: MongoDocRef) => { ops.push((s) => r.deleteIn(s)); return api; },
      commit: async () => { await this.atomic(async (s) => { for (const op of ops) await op(s); }); },
    };
    return api;
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>, _opts?: unknown): Promise<T> {
    const client = await this.client();
    if (client && transactionsSupported !== false) {
      try {
        return await this.transactionOnce(client, fn);
      } catch (err) {
        if (!looksUnsupported(err)) throw err;
        transactionsSupported = false;
      }
    }
    return this.serial(() => this.optimistic(fn));
  }

  private async transactionOnce<T>(client: MongoClient, fn: (tx: any) => Promise<T>): Promise<T> {
    const session = client.startSession();
    try {
      let out!: T;
      await session.withTransaction(async () => {
        const writes: ((s: Sess) => Promise<void>)[] = [];
        out = await fn(this.txApi(session, writes));
        for (const w of writes) await w(session);
      });
      transactionsSupported = true;
      return out;
    } finally {
      await session.endSession();
    }
  }

  private txApi(session: Sess, writes: ((s: Sess) => Promise<void>)[], onRead?: (r: MongoDocRef, snap: MongoDocSnapshot) => void) {
    const tx = {
      get: async (target: MongoDocRef | MongoQuery) => {
        if (target instanceof MongoDocRef) {
          const snap = await target.getIn(session);
          onRead?.(target, snap);
          return snap;
        }
        return target.getIn(session);
      },
      set: (r: MongoDocRef, d: Doc, o?: { merge?: boolean }) => { writes.push((s) => r.setIn(s, d, o)); return tx; },
      update: (r: MongoDocRef, d: Doc) => { writes.push((s) => r.updateIn(s, d)); return tx; },
      create: (r: MongoDocRef, d: Doc) => { writes.push((s) => r.createIn(s, d)); return tx; },
      delete: (r: MongoDocRef) => { writes.push((s) => r.deleteIn(s)); return tx; },
    };
    return tx;
  }

  /** No server-side transactions available: re-run the function if a document it read changed before it could write. */
  private async optimistic<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const writes: ((s: Sess) => Promise<void>)[] = [];
      const reads: [MongoDocRef, string][] = [];
      const out = await fn(this.txApi(undefined, writes, (r, snap) => reads.push([r, JSON.stringify(snap.data() ?? null)])));
      let changed = false;
      for (const [r, before] of reads) {
        if (JSON.stringify((await r.get()).data() ?? null) !== before) { changed = true; break; }
      }
      if (changed) continue;
      for (const w of writes) await w(undefined);
      return out;
    }
    throw new Error('transaction kept conflicting');
  }
}

let singleton: MongoFirestore | null = null;
export function mongoDb(): MongoFirestore {
  return (singleton ||= new MongoFirestore());
}
