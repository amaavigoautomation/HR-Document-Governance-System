import { BookUser, CheckSquare, ClipboardCheck, Contact, FileBarChart, GraduationCap, IdCard, LayoutList, LogOut, UserSearch, Users } from 'lucide-react';
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
  { key: 'all360', label: 'Employee 360', hint: 'All details and documents of every employee (HR and admin)', group: 'Reports' },
  { key: 'weekoff', label: 'Weekoff Holiday Report', hint: 'Employee wise Weekoff Holiday Report', group: 'Reports' },
  { key: 'exitclearance', label: 'Exit Clearance Report', hint: 'Exit Clearance Report', group: 'Reports' },
];

export const EMPLOYEE_SECTIONS = ['overview', ...EMPLOYEE_ENTRIES.map((e) => e.key)];

export const employeeNav = createModuleNav('amaavigo_employee_tab', EMPLOYEE_SECTIONS, 'overview', {
  overview: LayoutList, master: BookUser, acknowledgement: CheckSquare, identity: IdCard, personal: Contact, family: Users,
  qualification: GraduationCap, all360: UserSearch, separation: LogOut, weekoff: FileBarChart, exitclearance: ClipboardCheck,
});

/** Employee 360 is only for people who may open anyone's profile. */
export const employeeNavItems = (canPick = false): NavItem[] => [
  { key: 'overview', label: 'Overview' },
  ...EMPLOYEE_ENTRIES.filter((e) => canPick || e.key !== 'all360').map((e) => ({ key: e.key, label: e.label, group: e.group })),
];
