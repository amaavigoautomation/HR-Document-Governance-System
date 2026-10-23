/** Small in-memory stand-in for the parts of the Firestore Admin API the leave code uses. */
type Doc = Record<string, any>;

/** Real Firestore refuses undefined values anywhere in a document; the fake does too so such bugs show up in tests. */
function rejectUndefined(v: any, path = ''): void {
  if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
  if (Array.isArray(v)) v.forEach((x, i) => rejectUndefined(x, `${path}[${i}]`));
  else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) Object.entries(v).forEach(([k, x]) => rejectUndefined(x, path ? `${path}.${k}` : k));
}

class Snap {
  constructor(public id: string, private d: Doc | undefined, public ref: DocRef) {}
  get exists() { return this.d !== undefined; }
  data() { return this.d === undefined ? undefined : structuredClone(this.d); }
  get(f: string) { return this.d?.[f]; }
}

class DocRef {
  constructor(private store: Map<string, Doc>, public id: string) {}
  async get() { return new Snap(this.id, this.store.get(this.id), this); }
  async set(data: Doc, opts?: { merge?: boolean }) {
    rejectUndefined(data);
    this.store.set(this.id, opts?.merge ? { ...(this.store.get(this.id) || {}), ...structuredClone(data) } : structuredClone(data));
  }
  async update(data: Doc) {
    rejectUndefined(data);
    if (!this.store.has(this.id)) throw new Error('NOT_FOUND');
    this.store.set(this.id, { ...this.store.get(this.id)!, ...structuredClone(data) });
  }
  async delete() { this.store.delete(this.id); }
}

class Query {
  constructor(private store: Map<string, Doc>, private filters: ((d: Doc) => boolean)[] = [], private max = Infinity) {}
  where(field: string, op: string, value: any) {
    const f = (d: Doc) => (op === '==' ? d[field] === value : op === 'in' ? value.includes(d[field]) : op === '<=' ? d[field] <= value : false);
    return new Query(this.store, [...this.filters, f], this.max);
  }
  limit(n: number) { return new Query(this.store, this.filters, n); }
  async get() {
    const docs = [...this.store.entries()].filter(([, d]) => this.filters.every((f) => f(d))).slice(0, this.max)
      .map(([id, d]) => new Snap(id, d, new DocRef(this.store, id)));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: (s: Snap) => void) => docs.forEach(fn) };
  }
}

class Collection extends Query {
  private n = 0;
  constructor(private s: Map<string, Doc>) { super(s); }
  doc(id?: string) { return new DocRef(this.s, id ?? `auto${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${this.n++}`); }
}

export class FakeFirestore {
  stores = new Map<string, Map<string, Doc>>();
  private store(name: string) { if (!this.stores.has(name)) this.stores.set(name, new Map()); return this.stores.get(name)!; }
  collection(name: string) { return new Collection(this.store(name)); }
  batch() {
    const ops: (() => Promise<void>)[] = [];
    return {
      set: (r: DocRef, d: Doc, o?: any) => { ops.push(() => r.set(d, o)); },
      update: (r: DocRef, d: Doc) => { ops.push(() => r.update(d)); },
      delete: (r: DocRef) => { ops.push(() => r.delete()); },
      commit: async () => { for (const op of ops) await op(); },
    };
  }
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const writes: (() => Promise<void>)[] = [];
    const tx = {
      get: (r: DocRef) => r.get(),
      set: (r: DocRef, d: Doc, o?: any) => { writes.push(() => r.set(d, o)); },
      update: (r: DocRef, d: Doc) => { writes.push(() => r.update(d)); },
    };
    const out = await fn(tx);
    for (const w of writes) await w();
    return out;
  }
  seed(name: string, id: string, data: Doc) { this.store(name).set(id, structuredClone(data)); }
  all(name: string): Record<string, any>[] { return [...this.store(name).entries()].map(([id, d]) => ({ id, ...d })); }
}
