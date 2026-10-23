import React, { useCallback, useEffect, useState } from 'react';
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

type Tab = 'payslips' | 'claims' | 'tax' | 'run' | 'inputs' | 'adjustments' | 'salaries' | 'revisions' | 'approvals' | 'settlements' | 'taxadmin' | 'setup';

/** Payroll for every role: everyone sees their payslips; people with payroll access get the rest. */
export const PayrollModule: React.FC<{ currentUser: User }> = () => {
  const [me, setMe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('payslips');

  const reload = useCallback(() => payrollService.me().then((r) => { setMe(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'payslips', label: 'My payslips', show: true },
    { key: 'claims', label: 'My claims', show: true },
    { key: 'tax', label: 'My tax', show: true },
    { key: 'run', label: 'Payroll run', show: me.canView },
    { key: 'inputs', label: 'Attendance inputs', show: me.canView },
    { key: 'adjustments', label: 'Adjustments & loans', show: me.canView },
    { key: 'salaries', label: 'Salaries', show: me.canView },
    { key: 'revisions', label: 'Revisions', show: me.canView },
    { key: 'approvals', label: 'Claim approvals', show: me.canView || me.isManager },
    { key: 'settlements', label: 'Full & final', show: me.canView },
    { key: 'taxadmin', label: 'Tax declarations', show: me.canView },
    { key: 'setup', label: 'Setup', show: me.canView },
  ];
  const visible = tabs.filter((t) => t.show);
  const active: Tab = visible.some((t) => t.key === tab) ? tab : 'payslips';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Payroll</h2>
          <p className="text-xs text-slate-500">{me.canManage ? 'You can run payroll.' : me.canView ? 'You can view payroll (read-only).' : 'Your payslips appear here once a month is finalised.'}</p>
        </div>
        {me.canView && !me.configured && !me.canManage && <Notice>Payroll has not been set up yet.</Notice>}
        {visible.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
            {visible.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px ${active === t.key ? 'border-[#FA7014] text-[#FA7014]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
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
