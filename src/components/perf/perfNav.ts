import { BarChart3, ClipboardCheck, FileText, Gauge, GraduationCap, Settings, ShieldCheck, Target, Users, UserCheck, ListChecks, Smile } from 'lucide-react';
import { createModuleNav, NavItem } from '../moduleNav';

export const PERF_SECTIONS = ['me', 'myreviews', 'sops', 'dev', 'mood', 'team', 'teamreviews', 'plans', 'allreviews', 'dashboard', 'sopadmin', 'setup', 'governance'] as const;
export type PerfSection = (typeof PERF_SECTIONS)[number];

export const perfNav = createModuleNav('amaavigo_perf_tab', [...PERF_SECTIONS], 'me', {
  me: Target, myreviews: ClipboardCheck, sops: FileText, dev: GraduationCap, mood: Smile, team: Users, teamreviews: UserCheck, plans: ListChecks,
  allreviews: Gauge, dashboard: BarChart3, sopadmin: FileText, setup: Settings, governance: ShieldCheck,
});

/** Which sections this person gets. `me` is the response of perfService.me(). */
export function perfNavItems(me: any | null): NavItem[] {
  if (!me) return [];
  const hr = !!(me.canManage || me.canApprove);
  const all: (NavItem & { show: boolean })[] = [
    { key: 'me', label: 'My goals', group: 'My performance', show: true },
    { key: 'myreviews', label: 'My reviews', group: 'My performance', show: true },
    { key: 'sops', label: 'My SOPs', group: 'My performance', show: true },
    { key: 'dev', label: 'Check-ins & growth', group: 'My performance', show: true },
    { key: 'mood', label: 'Moodometer', group: 'My performance', show: true },
    { key: 'team', label: 'My team', group: 'My team', show: !!me.isManager, badge: me.todo?.teamPlansToCustomise || undefined },
    { key: 'teamreviews', label: 'Team reviews', group: 'My team', show: !!me.isManager, badge: me.todo?.teamReviewsDue || undefined },
    { key: 'plans', label: 'KRA/KPI plans', group: 'Manage performance', show: hr, badge: me.todo?.plansToApprove || undefined },
    { key: 'allreviews', label: 'All reviews', group: 'Manage performance', show: hr, badge: me.todo?.reviewsToApprove || undefined },
    { key: 'dashboard', label: 'Dashboard', group: 'Manage performance', show: hr || !!me.canView },
    { key: 'sopadmin', label: 'SOP mapping', group: 'Manage performance', show: !!me.canManage },
    { key: 'setup', label: 'Setup', group: 'Manage performance', show: !!me.canManage },
    { key: 'governance', label: 'Exceptions & audit', group: 'Manage performance', show: hr },
  ];
  return all.filter((i) => i.show).map(({ show: _s, ...i }) => i);
}
