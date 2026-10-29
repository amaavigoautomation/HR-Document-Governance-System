/**
 * Numbers for the sidebar badges: GET /api/leave/badges.
 *
 * One call returns what is waiting for the signed-in person in each module, by asking the modules' own endpoints
 * (so the rules about who may see what stay in one place). A module that fails or that the person has no access to
 * counts as nothing; one slow or broken module never blanks the others. Results are kept for a few seconds per
 * person so a busy browser tab cannot hammer the database.
 */
import { routeHome } from './homeApi.js';
import { routeLeave } from './leaveApi.js';
import { routeLifecycle } from './lifecycleApi.js';
import { routePayroll } from './payrollApi.js';

export interface Badges {
  leave: { today: number; my: number; approvals: number };
  payroll: { approvals: number };
  people: { tasks: number };
  employee: { acknowledgement: number };
}

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; value: Badges }>();

const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export async function computeBadges(headers: Record<string, any>, ip?: string): Promise<Badges> {
  const base = { method: 'GET', query: {} as Record<string, any>, body: {}, headers };
  const pick = async <T>(run: () => Promise<{ status: number; json: any }>, read: (j: any) => T, empty: T): Promise<T> => {
    try {
      const r = await run();
      return r.status === 200 ? read(r.json) : empty;
    } catch {
      return empty;
    }
  };
  const [inbox, mine, notes, claims, lifecycle, acks] = await Promise.all([
    pick(() => routeLeave({ ...base, action: 'inbox', ip }), (j) => count((j.leaves || []).length + (j.regularizations || []).length), 0),
    pick(() => routeLeave({ ...base, action: 'my-requests', ip }), (j) => count((j.items || []).filter((r: any) => r.status === 'INFO_REQUESTED').length), 0),
    pick(() => routeLeave({ ...base, action: 'notifications', ip }), (j) => count(j.unread), 0),
    pick(() => routePayroll({ ...base, action: 'claims', query: { status: 'SUBMITTED' } }), (j) => count((j.items || []).length), 0),
    pick(() => routeLifecycle({ ...base, action: 'me' }), (j) => count(j.openTasks), 0),
    pick(() => routeHome({ ...base, action: 'acks' }), (j) => count(j.active?.count), 0),
  ]);
  return {
    leave: { today: notes, my: mine, approvals: inbox },
    payroll: { approvals: claims },
    people: { tasks: lifecycle },
    employee: { acknowledgement: acks },
  };
}

export async function badges(headers: Record<string, any>, ip?: string, fresh = false): Promise<Badges> {
  const key = String(headers?.authorization || headers?.Authorization || '').slice(-80);
  const hit = key ? cache.get(key) : undefined;
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await computeBadges(headers, ip);
  if (key) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), value });
  }
  return value;
}

/** Forgets the saved numbers (after someone decides something, so their own badge drops straight away). */
export const clearBadgeCache = () => cache.clear();
