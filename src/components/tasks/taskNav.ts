import { createModuleNav, NavItem } from '../moduleNav';

export type Section = 'mine' | 'board' | 'dashboard' | 'projects';
const ALL: Section[] = ['mine', 'board', 'dashboard', 'projects'];
export const taskNav = createModuleNav('amaavigo_tasks_tab', ALL, 'mine', {});

/** Everyone gets the same four places; what is inside each follows who they are (manager, admin). */
export const taskNavItems = (badge = 0): NavItem[] => [
  { key: 'mine', label: 'My tasks', badge: badge || undefined },
  { key: 'board', label: 'Boards' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'projects', label: 'Projects' },
];
