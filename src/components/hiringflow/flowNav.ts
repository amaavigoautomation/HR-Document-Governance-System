import { createModuleNav, NavItem } from '../moduleNav';

export type FlowSection = 'tasks' | 'flow' | 'runs';

/** Sidebar sections of "Hiring Automation". Everyone gets My tasks; the people who manage hiring also build the flow and watch applicants. */
export const flowNav = createModuleNav('amaavigo_flow_tab', ['tasks', 'flow', 'runs'], 'tasks', {});

export const flowNavItems = (manage: boolean, badges: { tasks?: number; stuck?: number } = {}): NavItem[] => [
  { key: 'tasks', label: 'My tasks', group: 'Hiring Automation', ...(badges.tasks ? { badge: badges.tasks } : {}) },
  ...(manage ? [
    { key: 'flow', label: 'Hiring flow', group: 'Hiring Automation' },
    { key: 'runs', label: 'Who is where', group: 'Hiring Automation', ...(badges.stuck ? { badge: badges.stuck } : {}) },
  ] : []),
];
