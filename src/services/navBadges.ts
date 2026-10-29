import { useEffect, useSyncExternalStore } from 'react';
import { auth } from './firebase';
import { apiJson } from './apiClient';

/**
 * Counts of things waiting for the signed-in person, shown as small badges in the sidebar.
 * One request returns every module's numbers; they are refreshed about every minute, when the tab comes back into view,
 * and shortly after the person changes something (any save made through apiClient raises "badges:refresh").
 */
export interface NavCounts {
  leave: { today: number; my: number; approvals: number };
  payroll: { approvals: number };
  people: { tasks: number };
  employee: { acknowledgement: number };
}

const EMPTY: NavCounts = { leave: { today: 0, my: 0, approvals: 0 }, payroll: { approvals: 0 }, people: { tasks: 0 }, employee: { acknowledgement: 0 } };
const POLL_MS = 60_000;

let state: NavCounts = EMPTY;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let inflight = false;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Fetches the counts now. Never throws: a failed read keeps what is already shown. */
export async function refreshNavBadges(fresh = false): Promise<void> {
  if (inflight || !auth.currentUser) return;
  inflight = true;
  try {
    const r = await apiJson<{ badges?: Partial<NavCounts> }>(`/api/leave/badges${fresh ? '?fresh=1' : ''}`);
    const b: any = r?.badges || {};
    const next: NavCounts = {
      leave: { today: n(b.leave?.today), my: n(b.leave?.my), approvals: n(b.leave?.approvals) },
      payroll: { approvals: n(b.payroll?.approvals) },
      people: { tasks: n(b.people?.tasks) },
      employee: { acknowledgement: n(b.employee?.acknowledgement) },
    };
    if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; emit(); }
  } catch {
    /* keep the numbers already on screen */
  } finally {
    inflight = false;
  }
}

export const sumOf = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** Starts the refreshing while the sidebar is on screen and returns the latest counts. */
export function useNavBadges(enabled = true): NavCounts {
  useEffect(() => {
    if (!enabled) return undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const tick = () => { if (visible()) void refreshNavBadges(); };
    const soon = () => { clearTimeout(debounce); debounce = setTimeout(() => void refreshNavBadges(true), 700); };
    tick();
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener('badges:refresh', soon);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); clearTimeout(debounce); window.removeEventListener('badges:refresh', soon); document.removeEventListener('visibilitychange', tick); };
  }, [enabled]);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}
