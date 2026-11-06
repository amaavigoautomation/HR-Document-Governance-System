import { createModuleNav, NavItem } from '../moduleNav';

export type Section =
  | 'today' | 'mine' | 'checkins' | 'development'
  | 'team' | 'teamPlans' | 'evidence'
  | 'approvals'
  | 'start' | 'framework' | 'cycles' | 'comps' | 'sops' | 'templates' | 'plans' | 'reviews' | 'autopilot'
  | 'dashboard' | 'governance';

type Entry = { key: Section; label: string };
const EVERYONE: Entry[] = [{ key: 'today', label: 'Today: what to do' }, { key: 'mine', label: 'My performance' }, { key: 'checkins', label: 'My check-ins' }, { key: 'development', label: 'My development' }];
const MANAGER: Entry[] = [{ key: 'team', label: 'My team: reviews' }, { key: 'teamPlans', label: 'My team: targets' }, { key: 'evidence', label: 'Work evidence' }];
const APPROVE: Entry[] = [{ key: 'approvals', label: 'Approvals' }];
const SETUP: Entry[] = [
  { key: 'start', label: 'Start here' }, { key: 'framework', label: 'Scoring rules' }, { key: 'comps', label: 'Behaviours & roles' }, { key: 'sops', label: 'Processes (SOPs)' },
  { key: 'templates', label: 'KRA/KPI by role' }, { key: 'plans', label: 'Everyone\'s targets' }, { key: 'cycles', label: 'Review cycles' }, { key: 'reviews', label: 'All reviews' }, { key: 'autopilot', label: 'Autopilot' },
];
const REPORTS: Entry[] = [{ key: 'dashboard', label: 'Dashboards' }, { key: 'governance', label: 'Audit, exceptions & AI' }];

const ALL: string[] = [...EVERYONE, ...MANAGER, ...APPROVE, ...SETUP, ...REPORTS].map((e) => e.key);
export const pmNav = createModuleNav('amaavigo_pm_tab', ALL, 'today', {});

export interface Who { manage: boolean; approve: boolean; aggregate: boolean; manager: boolean }
export const pmNavItems = (w: Who): NavItem[] => {
  const tag = (group: string, list: Entry[]): NavItem[] => list.map((e) => ({ key: e.key, label: e.label, group }));
  return [
    ...tag('For everyone', EVERYONE),
    ...(w.manager || w.manage ? tag('For managers', MANAGER) : []),
    ...(w.approve ? tag('Approvals', APPROVE) : []),
    ...(w.manage ? tag('HR setup (do in order)', SETUP) : []),
    ...(w.manage || w.aggregate ? tag('Reports', w.manage ? REPORTS : [REPORTS[0]]) : []),
  ];
};
