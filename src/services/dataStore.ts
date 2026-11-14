/**
 * Browser data access for the MongoDB version.
 *
 * The app used to import `collection / doc / query / where / getDoc / getDocs / setDoc / updateDoc / deleteDoc /
 * onSnapshot` from `firebase/firestore`. MongoDB cannot be reached from a browser, so this module offers the same
 * functions with the same shapes, and each one calls the server (/api/tenant/data-*, see api/_lib/dataApi.ts), which
 * checks the signed-in user's company and permissions exactly as firestore.rules did.
 *
 * Live updates: Firestore pushed changes to every open screen. MongoDB does not, so `onSnapshot` here re-reads on a
 * timer (POLL_MS), when the tab becomes visible again, and straight after this browser writes something, and only
 * calls back when the data actually changed. Identical reads made at the same moment share one request.
 */
import { apiJson } from './apiClient';

/** How often an open screen re-checks for changes made by other people. Raise it to save requests, lower it for fresher screens. */
export const POLL_MS = 20_000;

type Filter = { field: string; op: '=='; value: string | number | boolean | null };
type Collection = { kind: 'collection'; name: string };
type DocRef = { kind: 'doc'; collection: string; id: string };
type Query = { kind: 'query'; name: string; filters: Filter[]; sorts: [string, 'asc' | 'desc'][] };
type Constraint = { type: 'where'; filter: Filter } | { type: 'orderBy'; field: string; dir: 'asc' | 'desc' };

// The first argument of the Firestore functions was the database handle; it is accepted and ignored.
export function collection(_db: unknown, name: string): Collection {
  return { kind: 'collection', name };
}
export function doc(_db: unknown, collectionName: string, id: string): DocRef {
  return { kind: 'doc', collection: collectionName, id };
}
export function where(field: string, op: string, value: any): Constraint {
  if (op !== '==') throw new Error(`Only "==" filters are supported (got "${op}").`);
  return { type: 'where', filter: { field, op, value } };
}
export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Constraint {
  return { type: 'orderBy', field, dir };
}
export function query(base: Collection | Query, ...constraints: Constraint[]): Query {
  const q: Query =
    base.kind === 'collection'
      ? { kind: 'query', name: base.name, filters: [], sorts: [] }
      : { kind: 'query', name: base.name, filters: [...base.filters], sorts: [...base.sorts] };
  for (const c of constraints) {
    if (c.type === 'where') q.filters.push(c.filter);
    else q.sorts.push([c.field, c.dir]);
  }
  return q;
}

export interface DocSnap {
  id: string;
  exists(): boolean;
  data(): any;
}
export interface QuerySnap {
  docs: DocSnap[];
  empty: boolean;
  size: number;
  forEach(fn: (d: DocSnap) => void): void;
}

const snapOf = (id: string, data: any | undefined): DocSnap => ({
  id,
  exists: () => data !== undefined,
  data: () => (data === undefined ? undefined : structuredClone(data)),
});

const changed = () => {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('data:changed'));
  } catch {
    /* no window (tests) */
  }
};

const inflight = new Map<string, Promise<any>>();
function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const post = (action: string, body: unknown) => apiJson<any>(`/api/tenant/${action}`, body);

export async function getDoc(ref: DocRef): Promise<DocSnap> {
  const res = await shared(`get|${ref.collection}|${ref.id}`, () => post('data-get', { collection: ref.collection, id: ref.id }));
  return snapOf(ref.id, res.exists ? res.data : undefined);
}

function sortRows(rows: { id: string; data: any }[], sorts: [string, 'asc' | 'desc'][]) {
  if (!sorts.length) return rows;
  const get = (o: any, path: string) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
  return [...rows].sort((a, b) => {
    for (const [field, dir] of sorts) {
      const x = get(a.data, field);
      const y = get(b.data, field);
      if (x === y) continue;
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

export async function getDocs(q: Query | Collection): Promise<QuerySnap> {
  const query_ = q.kind === 'collection' ? query(q) : q;
  const key = `list|${query_.name}|${JSON.stringify(query_.filters)}`;
  const res = await shared(key, () => post('data-list', { collection: query_.name, filters: query_.filters }));
  const rows = sortRows(res.docs as { id: string; data: any }[], query_.sorts);
  const docs = rows.map((r) => snapOf(r.id, r.data));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

export async function setDoc(ref: DocRef, data: any, options?: { merge?: boolean }): Promise<void> {
  await post('data-set', { collection: ref.collection, id: ref.id, data, merge: !!options?.merge });
  changed();
}

export async function updateDoc(ref: DocRef, data: any): Promise<void> {
  await post('data-update', { collection: ref.collection, id: ref.id, data });
  changed();
}

export async function deleteDoc(ref: DocRef): Promise<void> {
  await post('data-delete', { collection: ref.collection, id: ref.id });
  changed();
}

/** Same call shape as Firestore's onSnapshot for queries, collections and single documents. Returns the unsubscribe function. */
export function onSnapshot(target: Query | Collection, onNext: (snap: QuerySnap) => void, onError?: (err: any) => void): () => void;
export function onSnapshot(target: DocRef, onNext: (snap: DocSnap) => void, onError?: (err: any) => void): () => void;
export function onSnapshot(target: any, onNext: (snap: any) => void, onError?: (err: any) => void): () => void {
  let stopped = false;
  let last: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    if (stopped) return;
    try {
      const snap: DocSnap | QuerySnap = target.kind === 'doc' ? await getDoc(target) : await getDocs(target);
      if (stopped) return;
      const fingerprint = JSON.stringify('docs' in snap ? snap.docs.map((d) => [d.id, d.data()]) : snap.data() ?? null);
      if (fingerprint !== last) {
        last = fingerprint;
        onNext(snap);
      }
    } catch (err) {
      if (!stopped) onError?.(err);
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      // A hidden tab does not need fresh data; it refreshes when it comes back (see onVisible).
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') await run();
      schedule();
    }, POLL_MS);
  };

  const refresh = () => {
    void run();
  };
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') refresh();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('data:changed', refresh);
    document.addEventListener('visibilitychange', onVisible);
  }
  void run().then(schedule);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('data:changed', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}
