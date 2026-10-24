import { ClipboardList, DoorOpen, FileCheck, FileText, HandCoins, PlayCircle, Receipt, Percent, Settings, TrendingUp, Inbox, Wallet } from 'lucide-react';
import { createModuleNav, NavItem } from '../moduleNav';

export const PAYROLL_SECTIONS = ['payslips', 'claims', 'tax', 'run', 'inputs', 'adjustments', 'salaries', 'revisions', 'approvals', 'settlements', 'taxadmin', 'setup'] as const;
export type PayrollSection = (typeof PAYROLL_SECTIONS)[number];

export const payrollNav = createModuleNav('amaavigo_payroll_tab', [...PAYROLL_SECTIONS], 'payslips', {
  payslips: FileText, claims: Receipt, tax: Percent, run: PlayCircle, inputs: ClipboardList, adjustments: HandCoins,
  salaries: Wallet, revisions: TrendingUp, approvals: Inbox, settlements: DoorOpen, taxadmin: FileCheck, setup: Settings,
});

/** Which sections this person gets. `me` is the response of payrollService.me(). */
export function payrollNavItems(me: any | null): NavItem[] {
  if (!me) return [];
  const all: (NavItem & { show: boolean })[] = [
    { key: 'payslips', label: 'My payslips', group: 'My pay', show: true },
    { key: 'claims', label: 'My claims', group: 'My pay', show: true },
    { key: 'tax', label: 'My tax', group: 'My pay', show: true },
    { key: 'run', label: 'Payroll run', group: 'Manage payroll', show: !!me.canView },
    { key: 'inputs', label: 'Attendance inputs', group: 'Manage payroll', show: !!me.canView },
    { key: 'adjustments', label: 'Adjustments & loans', group: 'Manage payroll', show: !!me.canView },
    { key: 'salaries', label: 'Salaries', group: 'Manage payroll', show: !!me.canView },
    { key: 'revisions', label: 'Revisions', group: 'Manage payroll', show: !!me.canView },
    { key: 'approvals', label: 'Claim approvals', group: 'Manage payroll', show: !!(me.canView || me.isManager) },
    { key: 'settlements', label: 'Full & final', group: 'Manage payroll', show: !!me.canView },
    { key: 'taxadmin', label: 'Tax declarations', group: 'Manage payroll', show: !!me.canView },
    { key: 'setup', label: 'Setup', group: 'Manage payroll', show: !!me.canView },
  ];
  return all.filter((i) => i.show).map(({ show: _s, ...i }) => i);
}
