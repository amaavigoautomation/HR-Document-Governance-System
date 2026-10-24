import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { User } from '../types';
import { payrollService } from '../services/payrollService';
import { Notice } from './leave/ui';
import { AdjustmentsTab } from './payroll/AdjustmentsTab';
import { ClaimApprovals, MyClaims } from './payroll/ClaimsTab';
import { RevisionsTab } from './payroll/RevisionsTab';
import { SettlementsTab } from './payroll/SettlementsTab';
import { MyTax, TaxAdmin } from './payroll/TaxTab';
import { InputsTab } from './payroll/InputsTab';
import { MyPayslips } from './payroll/MyPayslips';
import { PayrollSetup } from './payroll/PayrollSetup';
import { RunTab } from './payroll/RunTab';
import { Salaries } from './payroll/Salaries';
import { ModuleSubNav } from './moduleNav';
import { payrollNav, payrollNavItems } from './payroll/payrollNav';

/**
 * Payroll for every role: everyone sees their payslips; people with payroll access get the rest.
 * The section menu is shown in the app sidebar under "Payroll". Screens without a sidebar (the employee portal)
 * pass `inlineNav` to show the same menu as pills at the top of the page.
 */
export const PayrollModule: React.FC<{ currentUser: User; inlineNav?: boolean }> = ({ inlineNav }) => {
  const [me, setMe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { section, items } = payrollNav.useNav();

  const reload = useCallback(() => payrollService.me().then((r) => { setMe(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);

  // Tell the menu (sidebar or pills) which sections this person may open.
  useEffect(() => { payrollNav.publish(payrollNavItems(me)); }, [me]);
  useEffect(() => () => payrollNav.publish([]), []);

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const navItems = payrollNavItems(me); // same list the menu shows, computed here so the first paint never lags the store
  const active = payrollNav.resolve(section, navItems.length ? navItems : items);
  const activeLabel = navItems.find((i) => i.key === active)?.label || '';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        {inlineNav ? (
          <div>
            <h2 className="text-lg font-bold text-slate-900">Payroll</h2>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400" aria-label="You are here">
            <span>Payroll</span><ChevronRight className="w-3.5 h-3.5" /><span className="text-slate-700">{activeLabel}</span>
          </div>
        )}
        <p className="text-xs text-slate-500 -mt-2">{me.canManage ? 'You can run payroll.' : me.canView ? 'You can view payroll (read-only).' : 'Your payslips appear here once a month is finalised.'}</p>
        {inlineNav && navItems.length > 1 && <ModuleSubNav nav={payrollNav} label="Payroll sections" variant="pills" />}
        {me.canView && !me.configured && !me.canManage && <Notice>Payroll has not been set up yet.</Notice>}
        {active === 'payslips' && <MyPayslips />}
        {active === 'claims' && <MyClaims />}
        {active === 'tax' && <MyTax />}
        {active === 'run' && <RunTab canManage={me.canManage} />}
        {active === 'inputs' && <InputsTab />}
        {active === 'adjustments' && <AdjustmentsTab canManage={me.canManage} />}
        {active === 'salaries' && <Salaries canManage={me.canManage} />}
        {active === 'revisions' && <RevisionsTab canManage={me.canManage} />}
        {active === 'approvals' && <ClaimApprovals canManage={me.canManage} />}
        {active === 'settlements' && <SettlementsTab canManage={me.canManage} />}
        {active === 'taxadmin' && <TaxAdmin canManage={me.canManage} />}
        {active === 'setup' && <PayrollSetup canManage={me.canManage} onChanged={reload} />}
      </div>
    </div>
  );
};
