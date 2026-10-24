import { DoorOpen, FileText, ListChecks, LogOut, Mail, Network, Settings, UserPlus } from 'lucide-react';
import { createModuleNav, NavItem } from '../moduleNav';

export const PEOPLE_SECTIONS = ['directory', 'tasks', 'exit', 'myletters', 'onboarding', 'exits', 'letters', 'setup'] as const;
export type PeopleSection = (typeof PEOPLE_SECTIONS)[number];

export const peopleNav = createModuleNav('amaavigo_people_tab', [...PEOPLE_SECTIONS], 'directory', {
  directory: Network, tasks: ListChecks, exit: LogOut, myletters: Mail, onboarding: UserPlus, exits: DoorOpen, letters: FileText, setup: Settings,
});

/** Which sections this person gets. `me` is the response of lifecycleService.me(). */
export function peopleNavItems(me: any | null): NavItem[] {
  if (!me) return [];
  const all: (NavItem & { show: boolean })[] = [
    { key: 'directory', label: 'Directory & org chart', group: 'Me', show: true },
    { key: 'tasks', label: 'My tasks', badge: me.openTasks || undefined, group: 'Me', show: true },
    { key: 'exit', label: 'My exit', group: 'Me', show: true },
    { key: 'myletters', label: 'My letters', group: 'Me', show: true },
    { key: 'onboarding', label: 'Onboarding', group: 'Manage people', show: !!me.canManage },
    { key: 'exits', label: 'Exits', group: 'Manage people', show: !!(me.canManage || me.isManager) },
    { key: 'letters', label: 'Letters', group: 'Manage people', show: !!me.canManage },
    { key: 'setup', label: 'Setup', group: 'Manage people', show: !!me.canManage },
  ];
  return all.filter((i) => i.show).map(({ show: _s, ...i }) => i);
}
