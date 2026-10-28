import { BookUser, CheckSquare, ClipboardCheck, Contact, FileBarChart, GraduationCap, IdCard, LayoutList, LogOut, Bot, Users } from 'lucide-react';
import { createModuleNav, NavItem } from '../moduleNav';

/** One entry per screen under the Employee module. `group` becomes a collapsible dropdown in the sidebar. */
export interface EmployeeEntry { key: string; label: string; hint: string; group: 'Transaction' | 'Reports' }

export const EMPLOYEE_ENTRIES: EmployeeEntry[] = [
  { key: 'master', label: 'Employee Master', hint: 'Employee creation and basic information', group: 'Transaction' },
  { key: 'acknowledgement', label: 'Acknowledgement', hint: 'View Active and Completed Acknowledgements', group: 'Transaction' },
  { key: 'identity', label: 'Employee Identity', hint: 'Employee Identity like Rationcard, Passport', group: 'Transaction' },
  { key: 'personal', label: 'Personal Information', hint: 'Employee Personal Details', group: 'Transaction' },
  { key: 'family', label: 'Family Details', hint: 'Employee Family Details', group: 'Transaction' },
  { key: 'qualification', label: 'Qualification Details', hint: 'Employee Qualification Details', group: 'Transaction' },
  { key: 'separation', label: 'Separation', hint: 'Declare Separation of employee', group: 'Transaction' },
  { key: 'factobot', label: 'FactoBot Document', hint: 'Upload documents to use in factoBot', group: 'Transaction' },
  { key: 'weekoff', label: 'Weekoff Holiday Report', hint: 'Employee wise Weekoff Holiday Report', group: 'Reports' },
  { key: 'exitclearance', label: 'Exit Clearance Report', hint: 'Exit Clearance Report', group: 'Reports' },
];

export const EMPLOYEE_SECTIONS = ['overview', ...EMPLOYEE_ENTRIES.map((e) => e.key)];

export const employeeNav = createModuleNav('amaavigo_employee_tab', EMPLOYEE_SECTIONS, 'overview', {
  overview: LayoutList, master: BookUser, acknowledgement: CheckSquare, identity: IdCard, personal: Contact, family: Users,
  qualification: GraduationCap, separation: LogOut, factobot: Bot, weekoff: FileBarChart, exitclearance: ClipboardCheck,
});

export const employeeNavItems = (): NavItem[] => [
  { key: 'overview', label: 'Overview' },
  ...EMPLOYEE_ENTRIES.map((e) => ({ key: e.key, label: e.label, group: e.group })),
];
