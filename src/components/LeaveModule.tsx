import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { leaveService } from '../services/leaveService';
import { AttendanceTab } from './leave/AttendanceTab';
import { ApprovalsTab, TeamCalendar } from './leave/ApprovalsTab';
import { HrBalances, HrPeople, HrReports, HrRequests } from './leave/HrOps';
import { HrSetup } from './leave/HrSetup';
import { MyLeave } from './leave/MyLeave';
import { Card, Notice } from './leave/ui';

type Tab = 'my' | 'attendance' | 'approvals' | 'calendar' | 'setup' | 'people' | 'balances' | 'requests' | 'reports';

/** Leave & attendance for every role. Tabs shown depend on what the signed-in person can do. */
export const LeaveModule: React.FC<{ currentUser: User }> = () => {
  const [me, setMe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('my');

  const reload = useCallback(() => leaveService.me().then((r) => { setMe(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  if (me.found === false) return <div className="p-6"><Notice tone="error">Your employee record was not found. Ask your administrator.</Notice></div>;

  const tabs: { key: Tab; label: string; badge?: number; show: boolean }[] = [
    { key: 'my', label: 'My leave', show: me.configured },
    { key: 'attendance', label: 'Attendance', show: me.configured },
    { key: 'approvals', label: 'Approvals', badge: me.approvals, show: me.configured && (me.isManager || me.canManage || me.approvals > 0) },
    { key: 'calendar', label: 'Team calendar', show: me.configured },
    { key: 'setup', label: 'Setup', show: me.canManage },
    { key: 'people', label: 'People', show: me.canManage && me.configured },
    { key: 'balances', label: 'Balances', show: me.canManage && me.configured },
    { key: 'requests', label: 'All requests', show: me.canManage && me.configured },
    { key: 'reports', label: 'Reports', show: me.canReport && me.configured },
  ];
  const visible = tabs.filter((t) => t.show);
  const active: Tab = visible.some((t) => t.key === tab) ? tab : (visible[0]?.key || 'setup');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Leave &amp; Attendance</h2>
          <p className="text-xs text-slate-500">{me.person.name}{me.profile.location ? ` · ${me.profile.location}` : ''}</p>
        </div>
        {!me.configured && !me.canManage && <Card><div className="text-sm text-slate-600">Leave has not been set up for your company yet. Please ask HR.</div></Card>}
        {!me.configured && me.canManage && <Notice>Leave is not set up yet. Open Setup to start from a template.</Notice>}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {visible.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px ${active === t.key ? 'border-[#FA7014] text-[#FA7014]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {t.label}{t.badge ? <span className="ml-1.5 bg-[#FA7014] text-white rounded-full px-1.5 py-0.5 text-[10px]">{t.badge}</span> : null}
            </button>
          ))}
        </div>
        {active === 'my' && <MyLeave me={me} reload={reload} />}
        {active === 'attendance' && <AttendanceTab me={me} reload={reload} />}
        {active === 'approvals' && <ApprovalsTab reload={reload} />}
        {active === 'calendar' && <TeamCalendar />}
        {active === 'setup' && <HrSetup onChanged={reload} />}
        {active === 'people' && <HrPeople />}
        {active === 'balances' && <HrBalances />}
        {active === 'requests' && <HrRequests me={me} />}
        {active === 'reports' && <HrReports canManage={me.canManage} />}
      </div>
    </div>
  );
};
