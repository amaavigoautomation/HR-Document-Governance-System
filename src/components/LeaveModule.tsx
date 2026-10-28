import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, CalendarDays, ChevronRight, ClipboardList, Settings, Users, Wallet } from 'lucide-react';
import { User } from '../types';
import { hasPerm } from '../../shared/permissions';
import { leaveService } from '../services/leaveService';
import { AttendanceTab, FixDayDrawer } from './leave/AttendanceTab';
import { AttendanceReportsPage } from './leave/AttendanceReportsPage';
import { AttendanceApplicationPage } from './leave/AttendanceApplicationPage';
import { RegularizationPage } from './leave/RegularizationPage';
import { ApprovalsTab, TeamCalendar } from './leave/ApprovalsTab';
import { ApplyLeaveDrawer } from './leave/ApplyLeaveDrawer';
import { HrBalances, HrPeople, HrReports, HrRequests } from './leave/HrOps';
import { HrSetup } from './leave/HrSetup';
import { LeaveSubNav } from './leave/LeaveSubNav';
import { leaveNav, leaveNavItems, LeaveSection, resolveSection, useLeaveNav } from './leave/leaveNav';
import { MyLeave } from './leave/MyLeave';
import { Today } from './leave/Today';
import { Card, EmptyState, Notice, Skeleton, ToastProvider } from './leave/ui';

type Admin = 'requests' | 'people' | 'balances' | 'reports' | 'setup';
const ADMIN_KEY = 'amaavigo_leave_admin_tab';
const readKey = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const writeKey = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Leave & attendance for every role.
 * Sections: Today · My leave · Attendance · Team calendar · Approvals (managers) · Manage (HR).
 * The section menu is shown in the app sidebar under "Leave & Attendance". Screens without a sidebar (the employee portal)
 * pass `inlineNav` to show the same menu as pills at the top of the page.
 */
export const LeaveModule: React.FC<{ currentUser: User; inlineNav?: boolean }> = (props) => (
  <ToastProvider><LeaveScreens {...props} /></ToastProvider>
);

const LeaveScreens: React.FC<{ currentUser: User; inlineNav?: boolean }> = ({ currentUser, inlineNav }) => {
  const [me, setMe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { section, items } = useLeaveNav();
  const [admin, setAdminState] = useState<Admin>(() => (readKey(ADMIN_KEY) as Admin) || 'requests');
  const [apply, setApply] = useState<{ open: boolean; typeId?: string }>({ open: false });
  const [fixOpen, setFixOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const setAdmin = (t: Admin) => { setAdminState(t); writeKey(ADMIN_KEY, t); };
  const reload = useCallback(() => leaveService.me().then((r) => { setMe(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);
  const bump = () => { setRefreshKey((k) => k + 1); reload(); };

  // Tell the menu (sidebar or pills) which sections this person may open.
  useEffect(() => { leaveNav.publish(leaveNavItems(me)); }, [me]);
  useEffect(() => () => leaveNav.publish([]), []);

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 max-w-5xl mx-auto"><Skeleton rows={5} /></div>;
  if (me.found === false) return <div className="p-6"><Notice tone="error">Your employee record was not found. Ask your administrator.</Notice></div>;

  const ok = me.configured;
  const navItems = leaveNavItems(me); // same list the menu shows, computed here so the first paint never lags the store
  const active: LeaveSection = resolveSection(section, navItems.length ? navItems : items);
  const activeLabel = navItems.find((i) => i.key === active)?.label || '';

  const admins: { key: Admin; label: string; icon: React.FC<{ className?: string }>; show: boolean }[] = [
    { key: 'requests', label: 'All requests', icon: ClipboardList, show: me.canManage && ok },
    { key: 'people', label: 'People', icon: Users, show: me.canManage && ok },
    { key: 'balances', label: 'Balances', icon: Wallet, show: me.canManage && ok },
    { key: 'reports', label: 'Reports', icon: BarChart3, show: me.canReport && ok },
    { key: 'setup', label: 'Settings', icon: Settings, show: me.canManage },
  ];
  const visibleAdmin = admins.filter((t) => t.show);
  const activeAdmin: Admin = !ok && me.canManage ? 'setup' : visibleAdmin.some((t) => t.key === admin) ? admin : (visibleAdmin[0]?.key || 'setup');

  if (!ok && !me.canManage) {
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <Card><EmptyState icon={CalendarDays} title="Leave is not set up yet" text="Your HR team has not switched on leave and attendance. Please ask them." /></Card>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/60">
      <div className="max-w-7xl mx-auto w-full p-3 sm:p-4 md:p-6 space-y-4">
        {inlineNav ? (
          <LeaveSubNav variant="pills" />
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400" aria-label="You are here">
            <span>Leave &amp; Attendance</span><ChevronRight className="w-3.5 h-3.5" /><span className="text-slate-700">{activeLabel}</span>
          </div>
        )}

        {!ok && me.canManage && <Notice tone="warn">Leave is not set up yet. Pick a template below to start. Everyone else will see the leave screens once you save.</Notice>}

        {active === 'today' && <Today me={me} reload={reload} refreshKey={refreshKey} onApply={(typeId) => setApply({ open: true, typeId })} onFix={() => setFixOpen(true)} onOpen={(t) => leaveNav.setSection(t as LeaveSection)} />}
        {active === 'my' && <MyLeave me={me} reload={reload} refreshKey={refreshKey} onApply={(typeId) => setApply({ open: true, typeId })} />}
        {active === 'attendance' && <AttendanceTab me={me} reload={reload} />}
        {active === 'regularization' && <RegularizationPage me={me} onChanged={reload} />}
        {active === 'application' && <AttendanceApplicationPage me={me} onChanged={reload} />}
        {active === 'reports' && <AttendanceReportsPage me={me} />}
        {active === 'team' && <TeamCalendar />}
        {active === 'approvals' && <ApprovalsTab reload={reload} />}
        {active === 'manage' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200">
              {visibleAdmin.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setAdmin(key)}
                  className={`inline-flex items-center gap-1.5 pb-2 text-xs font-bold border-b-2 -mb-px ${activeAdmin === key ? 'border-[#FA7014] text-[#FA7014]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            {activeAdmin === 'setup' && <HrSetup onChanged={reload} />}
            {activeAdmin === 'people' && <HrPeople currentUser={currentUser} canAddPeople={hasPerm(currentUser.perms, 'users.manage')} />}
            {activeAdmin === 'balances' && <HrBalances />}
            {activeAdmin === 'requests' && <HrRequests me={me} />}
            {activeAdmin === 'reports' && <HrReports canManage={me.canManage} />}
          </div>
        )}
      </div>

      {ok && (
        <>
          <ApplyLeaveDrawer key={apply.typeId || 'any'} me={me} open={apply.open} initialType={apply.typeId} onClose={() => setApply({ open: false })} onSent={bump} />
          <FixDayDrawer me={me} day={null} open={fixOpen} onClose={() => setFixOpen(false)} onSent={bump} />
        </>
      )}
    </div>
  );
};
