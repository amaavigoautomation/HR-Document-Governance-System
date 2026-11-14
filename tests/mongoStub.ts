/**
 * A small in-memory stand-in for the slice of the `mongodb` driver that api/_lib/mongoFirestore.ts uses
 * (find / findOne / replaceOne / updateOne / insertOne / deleteOne / countDocuments with the query and update
 * operators the adapter produces). It lets the adapter be tested without a MongoDB server.
 * It is NOT a MongoDB: transactions and real index behaviour are not covered by it.
 */
type Doc = Record<string, any>;

const getPath = (o: any, p: string) => p.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
function setPath(o: Doc, p: string, val: any) {
  const ks = p.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[ks[ks.length - 1]] = val;
}
function unsetPath(o: Doc, p: string) {
  const ks = p.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) return;
    cur = cur[k];
  }
  delete cur[ks[ks.length - 1]];
}
const deepEq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const isOps = (c: any) => c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length > 0 && Object.keys(c).every((k) => k.startsWith('$'));
const sameType = (a: any, b: any) => typeof a === typeof b && a !== null && b !== null;

function matchField(value: any, cond: any): boolean {
  if (!isOps(cond)) return Array.isArray(value) ? value.some((x) => deepEq(x, cond)) || deepEq(value, cond) : deepEq(value, cond);
  for (const [op, arg] of Object.entries<any>(cond)) {
    switch (op) {
      case '$ne': if (Array.isArray(value) ? value.some((x) => deepEq(x, arg)) : deepEq(value, arg)) return false; break;
      case '$exists': if ((value !== undefined) !== !!arg) return false; break;
      case '$lt': if (!(sameType(value, arg) && value < arg)) return false; break;
      case '$lte': if (!(sameType(value, arg) && value <= arg)) return false; break;
      case '$gt': if (!(sameType(value, arg) && value > arg)) return false; break;
      case '$gte': if (!(sameType(value, arg) && value >= arg)) return false; break;
      case '$in': if (!(Array.isArray(value) ? value.some((x) => arg.some((y: any) => deepEq(x, y))) : arg.some((y: any) => deepEq(value, y)))) return false; break;
      case '$nin': if (Array.isArray(value) ? value.some((x) => arg.some((y: any) => deepEq(x, y))) : arg.some((y: any) => deepEq(value, y))) return false; break;
      default: throw new Error(`stub: unsupported operator ${op}`);
    }
  }
  return true;
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) =>
    k === '$and' ? (cond as Doc[]).every((f) => matches(doc, f)) : matchField(getPath(doc, k), cond)
  );
}

function applyOps(doc: Doc, ops: Doc, inserting: boolean) {
  for (const [op, spec] of Object.entries<any>(ops)) {
    for (const [path, arg] of Object.entries<any>(spec)) {
      if (op === '$set') setPath(doc, path, structuredClone(arg));
      else if (op === '$unset') unsetPath(doc, path);
      else if (op === '$inc') setPath(doc, path, (Number(getPath(doc, path)) || 0) + arg);
      else if (op === '$addToSet') {
        const arr: any[] = Array.isArray(getPath(doc, path)) ? getPath(doc, path) : [];
        for (const item of arg.$each) if (!arr.some((x) => deepEq(x, item))) arr.push(structuredClone(item));
        setPath(doc, path, arr);
      } else if (op === '$pull') {
        const arr: any[] = Array.isArray(getPath(doc, path)) ? getPath(doc, path) : [];
        setPath(doc, path, arr.filter((x) => !arg.$in.some((y: any) => deepEq(x, y))));
      } else if (op === '$setOnInsert') {
        if (inserting) setPath(doc, path, arg);
      } else throw new Error(`stub: unsupported update ${op}`);
    }
  }
}

class Cursor {
  private sorts: [string, number][] = [];
  private n = 0;
  private max?: number;
  private proj?: Doc;
  constructor(private rows: Doc[]) {}
  sort(s: [string, number][]) { this.sorts = s; return this; }
  skip(n: number) { this.n = n; return this; }
  limit(n: number) { this.max = n; return this; }
  project(p: Doc) { this.proj = p; return this; }
  async toArray() {
    let rows = [...this.rows];
    for (const [f, dir] of [...this.sorts].reverse()) rows.sort((a, b) => (getPath(a, f) < getPath(b, f) ? -1 : getPath(a, f) > getPath(b, f) ? 1 : 0) * dir);
    rows = rows.slice(this.n, this.max === undefined ? undefined : this.n + this.max);
    return rows.map((r) => {
      if (!this.proj) return structuredClone(r);
      const out: Doc = { _id: r._id };
      for (const k of Object.keys(this.proj)) if (r[k] !== undefined) out[k] = structuredClone(r[k]);
      return out;
    });
  }
}

class StubCollection {
  rows = new Map<string, Doc>();
  async createIndex() { return 'ok'; }
  async findOne(filter: Doc) { const r = [...this.rows.values()].find((d) => matches(d, filter)); return r ? structuredClone(r) : null; }
  find(filter: Doc) { return new Cursor([...this.rows.values()].filter((d) => matches(d, filter))); }
  async countDocuments(filter: Doc) { return [...this.rows.values()].filter((d) => matches(d, filter)).length; }
  async replaceOne(filter: Doc, doc: Doc, opts: { upsert?: boolean } = {}) {
    const hit = [...this.rows.values()].find((d) => matches(d, filter));
    const id = hit ? hit._id : filter._id;
    if (!hit && !opts.upsert) return { matchedCount: 0 };
    this.rows.set(id, { _id: id, ...structuredClone(doc) });
    return { matchedCount: hit ? 1 : 0 };
  }
  async updateOne(filter: Doc, ops: Doc, opts: { upsert?: boolean } = {}) {
    const hit = [...this.rows.values()].find((d) => matches(d, filter));
    if (hit) { applyOps(hit, ops, false); return { matchedCount: 1 }; }
    if (!opts.upsert) return { matchedCount: 0 };
    const fresh: Doc = { _id: filter._id };
    applyOps(fresh, ops, true);
    this.rows.set(fresh._id, fresh);
    return { matchedCount: 0, upsertedCount: 1 };
  }
  async insertOne(doc: Doc) {
    if (this.rows.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    this.rows.set(doc._id, structuredClone(doc));
    return { acknowledged: true };
  }
  async deleteOne(filter: Doc) {
    const hit = [...this.rows.values()].find((d) => matches(d, filter));
    if (hit) this.rows.delete(hit._id);
    return { deletedCount: hit ? 1 : 0 };
  }
}

export class StubMongoDb {
  cols = new Map<string, StubCollection>();
  collection(name: string) {
    if (!this.cols.has(name)) this.cols.set(name, new StubCollection());
    return this.cols.get(name)!;
  }
  listCollections() { return { toArray: async () => [...this.cols.keys()].map((name) => ({ name })) }; }
}
