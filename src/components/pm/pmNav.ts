import { createModuleNav, NavItem } from '../moduleNav';

export type Section = 'home' | 'mine' | 'team' | 'setup' | 'plans' | 'reviews' | 'exceptions' | 'reports';

type Entry = { key: Section; label: string };
const ALL: Section[] = ['home', 'mine', 'team', 'setup', 'plans', 'reviews', 'exceptions', 'reports'];
export const pmNav = createModuleNav('amaavigo_pm2_tab', ALL, 'home', {});

export interface Who { hr: boolean; approver: boolean; manager: boolean; reports: boolean }
/** Each person sees only what they need. Everyone starts on "To do". */
export const pmNavItems = (w: Who, badge = 0): NavItem[] => {
  const tag = (group: string, list: Entry[]): NavItem[] => list.map((e) => ({ key: e.key, label: e.label, group }));
  return [
    ...tag('For you', [{ key: 'home', label: 'To do' }, { key: 'mine', label: 'My performance' }]).map((i) => (i.key === 'home' && badge ? { ...i, badge } : i)),
    ...(w.manager ? tag('For managers', [{ key: 'team', label: 'My team' }]) : []),
    ...(w.hr ? tag('HR', [{ key: 'setup', label: 'Setup' }, { key: 'plans', label: 'Targets (plans)' }, { key: 'reviews', label: 'Reviews' }, { key: 'exceptions', label: 'Needs attention' }])
      : w.approver ? tag('Approvals', [{ key: 'reviews', label: 'Reviews' }]) : []),
    ...(w.reports ? tag('Reports', [{ key: 'reports', label: 'Reports' }]) : []),
  ];
};
