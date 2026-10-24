import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, CalendarCheck, CalendarDays, Home, Inbox, Palmtree, Settings, Users, Wallet, ClipboardList, Briefcase } from 'lucide-react';
import { User } from '../types';
import { leaveService } from '../services/leaveService';
import { AttendanceTab, FixDayDrawer } from './leave/AttendanceTab';
import { ApprovalsTab, TeamCalendar } from './leave/ApprovalsTab';
import { ApplyLeaveDrawer } from './leave/ApplyLeaveDrawer';
import { HrBalances, HrPeople, HrReports, HrRequests } from './leave/HrOps';
import { HrSetup } from './leave/HrSetup';
import { MyLeave } from './leave/MyLeave';
import { Today } from './leave/Today';
import { Card, EmptyState, Notice, Skeleton, ToastProvider } from './leave/ui';

type Main = 'today' | 'my' | 'attendance' | 'team' | 'approvals' | 'manage';
type Admin = 'requests' | 'people' | 'balances' | 'reports' | 'setup';
const TAB_KEY = 'amaavigo_leave_tab';
const ADMIN_KEY = 'amaavigo_leave_admin_tab';
const readKey = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const writeKey = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Leave & attendance for every role.
 * Everyone: Today (check in, balance, apply) · My leave · Attendance · Team.
 * Managers: + Approvals. HR: + Manage (requests, people, balances, reports, settings) kept apart from personal screens.
 */
export const LeaveModule: React.FC<{ currentUser: User }> = (props) => (
  <ToastProvider><LeaveScreens {...props} /></ToastProvider>
);

const LeaveScreens: React.FC<{ currentUser: User }> = () => {
  const [me, setMe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<Main>(() => (readKey(TAB_KEY) as Main) || 'today');
  const [admin, setAdminState] = useState<Admin>(() => (readKey(ADMIN_KEY) as Admin) || 'requests');
  const [apply, setApply] = useState<{ open: boolean; typeId?: string }>({ open: false });
  const [fixOpen, setFixOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const setTab = (t: Main) => { setTabState(t); writeKey(TAB_KEY, t); };
  const setAdmin = (t: Admin) => { setAdminState(t); writeKey(ADMIN_KEY, t); };
  const reload = useCallback(() => leaveService.me().then((r) => { setMe(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);
  const bump = () => { setRefreshKey((k) => k + 1); reload(); };

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 max-w-5xl mx-auto"><Skeleton rows={5} /></div>;
  if (me.found === false) return <div className="p-6"><Notice tone="error">Your employee record was not found. Ask your administrator.</Notice></div>;

  const ok = me.configured;
  const canApprove = ok && (me.isManager || me.canManage || me.approvals > 0);
  const canAdmin = me.canManage || me.canReport;

  const mains: { key: Main; label: string; icon: React.FC<{ className?: string }>; badge?: number; show: boolean }[] = [
    { key: 'today', label: 'Today', icon: Home, show: ok },
    { key: 'my', label: 'My leave', icon: Palmtree, show: ok },
    { key: 'attendance', label: 'Attendance', icon: CalendarCheck, show: ok },
    { key: 'team', label: 'Team calendar', icon: CalendarDays, show: ok },
    { key: 'approvals', label: 'Approvals', icon: Inbox, badge: me.approvals, show: canApprove },
    { key: 'manage', label: 'Manage', icon: Briefcase, show: canAdmin },
  ];
  const admins: { key: Admin; label: string; icon: React.FC<{ className?: string }>; show: boolean }[] = [
    { key: 'requests', label: 'All requests', icon: ClipboardList, show: me.canManage && ok },
    { key: 'people', label: 'People', icon: Users, show: me.canManage && ok },
    { key: 'balances', label: 'Balances', icon: Wallet, show: me.canManage && ok },
    { key: 'reports', label: 'Reports', icon: BarChart3, show: me.canReport && ok },
    { key: 'setup', label: 'Settings', icon: Settings, show: me.canManage },
  ];
  const visible = mains.filter((t) => t.show);
  const visibleAdmin = admins.filter((t) => t.show);
  const active: Main = visible.some((t) => t.key === tab) ? tab : (visible[0]?.key || 'manage');
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
        <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Leave and attendance">
          {visible.map(({ key, label, icon: Icon, badge }) => (
            <button key={key} onClick={() => setTab(key)} aria-current={active === key ? 'page' : undefined}
              ref={active === key ? (el) => el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${active === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}>
              <Icon className="w-4 h-4" />{label}
              {badge ? <span className="ml-0.5 bg-[#FA7014] text-white rounded-full px-1.5 py-0.5 text-[10px] leading-none">{badge}</span> : null}
            </button>
          ))}
        </nav>

        {!ok && me.canManage && <Notice tone="warn">Leave is not set up yet. Pick a template below to start. Everyone else will see the leave screens once you save.</Notice>}

        {active === 'today' && <Today me={me} reload={reload} refreshKey={refreshKey} onApply={(typeId) => setApply({ open: true, typeId })} onFix={() => setFixOpen(true)} onOpen={(t) => setTab(t as Main)} />}
        {active === 'my' && <MyLeave me={me} reload={reload} refreshKey={refreshKey} onApply={(typeId) => setApply({ open: true, typeId })} />}
        {active === 'attendance' && <AttendanceTab me={me} reload={reload} />}
        {active === 'team' && <TeamCalendar />}
        {active === 'approvals' && <ApprovalsTab reload={reload} />}
        {active === 'manage' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200">
              <h2 className="text-sm font-black text-slate-900 pb-2 mr-2">HR</h2>
              {visibleAdmin.map(({ key, label, icon: Icon }) => (
                <button key={key} onClick={() => setAdmin(key)}
                  className={`inline-flex items-center gap-1.5 pb-2 text-xs font-bold border-b-2 -mb-px ${activeAdmin === key ? 'border-[#FA7014] text-[#FA7014]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            {activeAdmin === 'setup' && <HrSetup onChanged={reload} />}
            {activeAdmin === 'people' && <HrPeople />}
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
