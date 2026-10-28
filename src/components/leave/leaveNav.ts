import { useSyncExternalStore } from 'react';

/**
 * Tiny shared store so the app sidebar (outside the leave page) and the leave page agree on which section is open.
 * The leave page publishes which sections the signed-in person may see; the sidebar reads them and sets the section.
 */
export type LeaveSection = 'today' | 'my' | 'attendance' | 'regularization' | 'application' | 'team' | 'approvals' | 'manage';
export interface LeaveNavItem { key: LeaveSection; label: string; badge?: number }

const STORAGE_KEY = 'amaavigo_leave_tab';
const VALID: LeaveSection[] = ['today', 'my', 'attendance', 'regularization', 'application', 'team', 'approvals', 'manage'];

const read = (): LeaveSection => {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as LeaveSection | null;
    if (v && VALID.includes(v)) return v;
  } catch { /* private mode */ }
  return 'today';
};

let state: { section: LeaveSection; items: LeaveNavItem[] } = { section: read(), items: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const leaveNav = {
  getState: () => state,
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  setSection(section: LeaveSection) {
    if (state.section === section) return;
    state = { ...state, section };
    try { localStorage.setItem(STORAGE_KEY, section); } catch { /* private mode */ }
    emit();
  },
  publish(items: LeaveNavItem[]) {
    if (JSON.stringify(items) === JSON.stringify(state.items)) return;
    state = { ...state, items };
    emit();
  },
};

export const useLeaveNav = () => useSyncExternalStore(leaveNav.subscribe, leaveNav.getState, leaveNav.getState);

/** The section to show: the chosen one if this person may see it, otherwise the first they may see. */
export const resolveSection = (section: LeaveSection, items: LeaveNavItem[]): LeaveSection =>
  items.some((i) => i.key === section) ? section : (items[0]?.key ?? 'manage');

/** Which sections this person gets. `me` is the response of GET /api/leave/me. */
export function leaveNavItems(me: any | null): LeaveNavItem[] {
  if (!me || me.found === false) return [];
  const ok = !!me.configured;
  const canApprove = ok && (me.isManager || me.isDelegate || me.canManage || me.approvals > 0);
  const canAdmin = !!(me.canManage || me.canReport);
  const all: (LeaveNavItem & { show: boolean })[] = [
    { key: 'today', label: 'Today', show: ok },
    { key: 'my', label: 'My leave', show: ok },
    { key: 'attendance', label: 'Attendance', show: ok },
    { key: 'regularization', label: 'Regularization', show: ok },
    { key: 'application', label: 'Attendance application', show: ok },
    { key: 'team', label: 'Team calendar', show: ok },
    { key: 'approvals', label: 'Approvals', badge: me.approvals || undefined, show: canApprove },
    { key: 'manage', label: 'Manage', show: canAdmin },
  ];
  return all.filter((i) => i.show).map(({ show: _s, ...i }) => i);
}
