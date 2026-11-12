/** Who may see and act on which kind of flag. Kept free of other imports so leave and payroll code can share it. */
import type { AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';

export interface FlagAccess {
  leaveManage: boolean;
  leaveReport: boolean;
  payrollView: boolean;
  payrollManage: boolean;
}

export function flagAccess(ctx: AuthContext): FlagAccess {
  const leaveManage = ctx.isCompanyAdmin || hasPerm(ctx.perms, 'leave.manage');
  const payrollManage = ctx.isCompanyAdmin || hasPerm(ctx.perms, 'payroll.manage');
  return {
    leaveManage, leaveReport: leaveManage || hasPerm(ctx.perms, 'leave.report'),
    payrollManage, payrollView: payrollManage || hasPerm(ctx.perms, 'payroll.view'),
  };
}

/** Payroll flags carry pay figures: only people who can already see payroll. Leave and late flags: leave reports. Older exceptions: leave managers. */
export const canSee = (a: FlagAccess, category: string) =>
  category === 'FLAG_PAYROLL' ? a.payrollView : category === 'FLAG_LATE' || category === 'FLAG_LEAVE' ? a.leaveReport : a.leaveManage;

export const canAct = (a: FlagAccess, category: string) =>
  category === 'FLAG_PAYROLL' ? a.payrollManage : a.leaveManage;

export const canAnyFlag = (a: FlagAccess) => a.leaveReport || a.payrollView;
