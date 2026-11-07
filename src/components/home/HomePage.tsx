import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Settings2 } from 'lucide-react';
import type { WidgetId, WidgetTarget } from '../../../shared/dashboard';
import { dashboardService } from '../../services/dashboardService';
import { homeService } from '../../services/homeService';
import { Notice, btnGhost, niceDate } from '../leave/ui';
import { WidgetCard } from './HomeDashboard';
import { useLoad } from './useLoad';
import { ManageHome } from './ManageHome';
import { ProfileCard } from './cards/ProfileCard';
import { MoodCard } from './cards/MoodCard';
import { CalendarCard } from './cards/CalendarCard';
import { AttendanceCard } from './cards/AttendanceCard';
import { QuickLinksCard, QuickReportsCard } from './cards/QuickCards';
import { OnLeaveCard } from './cards/OnLeaveCard';
import { CelebrationsCard } from './cards/CelebrationsCard';
import { AnnouncementsCard } from './cards/AnnouncementsCard';
import { LoginSummaryCard } from './cards/LoginSummaryCard';
import { AcksCard } from './cards/AcksCard';
import { MyTasks } from './HomeOverview';
import { Greeting, LeaveBalanceCard, PipelineChart, QuickActionsGrid, TeamAttendanceCard, TopTiles, UpcomingCard } from './HomeBlocks';

interface Props { fallbackName?: string; onOpen: (target: WidgetTarget) => void }

// These dashboard widgets have their own full card on Home now.
const REPLACED: WidgetId[] = ['attendance', 'acknowledgements', 'latest-payslip'];
// Leave balance is a personal, low-urgency item and sits beside the profile.
const LEFT_WIDGETS: WidgetId[] = ['leave-balance'];

export const HomePage: React.FC<Props> = ({ fallbackName, onOpen }) => {
  const [tick, setTick] = useState(0);
  const [manage, setManage] = useState(false);
  const layout = useLoad(() => homeService.layout(), [tick]);
  const dash = useLoad(() => dashboardService.me(), [tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Count one sign-in per browser tab session, not per visit to Home.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('home-login-logged')) return;
      sessionStorage.setItem('home-login-logged', '1');
    } catch { /* storage blocked: count it once per page load */ }
    void homeService.loginEvent().catch(() => undefined);
  }, []);

  const L = layout.data;
  const hidden = new Set(L?.hiddenCards || []);
  const show = (id: string) => !hidden.has(id);
  const can = L?.can;
  const widgets = (dash.data?.widgets || []).filter((w) => !REPLACED.includes(w.id));
  const left = widgets.filter((w) => LEFT_WIDGETS.includes(w.id));
  const name = dash.data?.name || fallbackName || '';
  const first = name.split(' ')[0];
  const canManage = !!can && (can.announce || can.manageHome || can.people);
  const today = L?.today ? niceDate(L.today) : '';

  return (
    <div className="w-full h-full overflow-y-auto bg-[#F7F8FA]">
      <div className="max-w-[1440px] mx-auto p-4 sm:p-6 xl:p-8 space-y-5">
        <Greeting first={first} today={today} actions={<>
          {canManage && (
            <button type="button" className={btnGhost} onClick={() => setManage(true)}>
              <Settings2 className="w-3.5 h-3.5" />Customize
            </button>
          )}
          <button type="button" className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#F36B21] text-white hover:bg-[#df5d18] disabled:opacity-50 transition-colors shadow-sm" onClick={refresh} disabled={layout.loading || dash.loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${layout.loading || dash.loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </>} />

        {layout.error && <Notice tone="error">{layout.error} <button type="button" className="underline font-bold" onClick={refresh}>Try again</button></Notice>}

        <TopTiles widgets={dash.data?.widgets || []} refreshKey={tick} onOpen={onOpen} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
          <div className="space-y-4 min-w-0">
            <PipelineChart refreshKey={tick} onOpen={onOpen} />
            <UpcomingCard refreshKey={tick} onOpen={onOpen} />
          </div>
          <div className="space-y-4 min-w-0">
            <QuickActionsGrid onOpen={onOpen} />
            <MyTasks widgets={dash.data?.widgets || []} onOpen={onOpen} />
            <LeaveBalanceCard refreshKey={tick} onOpen={onOpen} />
            <TeamAttendanceCard refreshKey={tick} onOpen={onOpen} />
          </div>
        </div>

        <h2 id="home-more" className="pt-4 text-xl font-bold text-slate-950">More for you</h2>

        {/* Main dashboard: personal workspace on the left, company updates on the right. */}
        {L && <>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(380px,0.92fr)] items-start">
          <div className="space-y-4 min-w-0">
            <ProfileCard fallbackName={fallbackName || ''} refreshKey={tick} />
            {show('attendance') && <AttendanceCard refreshKey={tick} onChanged={refresh} />}
            {show('calendar') && <CalendarCard refreshKey={tick} />}
            {show('mood') && <MoodCard showSummary={!!can?.moodSummary} />}
            {show('quick-links') && <QuickLinksCard links={L?.quickLinks || []} onOpen={onOpen} />}
            {show('quick-reports') && <QuickReportsCard reports={L?.quickReports || []} onOpen={onOpen} />}
            {left.map((w) => <WidgetCard key={w.id} w={w} onOpen={onOpen} />)}
          </div>

          <div className="space-y-4 min-w-0">
            {show('celebrations') && <CelebrationsCard refreshKey={tick} />}
            {show('ceo-speak') && <AnnouncementsCard kind="CEO_SPEAK" canManage={!!can?.announce} onManage={() => setManage(true)} refreshKey={tick} />}
            {show('announcements') && <AnnouncementsCard kind="ANNOUNCEMENT" canManage={!!can?.announce} onManage={() => setManage(true)} refreshKey={tick} />}
            {show('login-summary') && can?.loginSummary && <LoginSummaryCard refreshKey={tick} />}
            {show('acknowledgements') && can?.acknowledge && <AcksCard onOpen={onOpen} refreshKey={tick} />}
          </div>
        </div>

        {/* Company-wide availability is a useful scan across the full page width. */}
        {show('on-leave') && <OnLeaveCard refreshKey={tick} />}
        </>}

        {can && <ManageHome open={manage} onClose={() => setManage(false)} can={can} onChanged={refresh} />}
      </div>
    </div>
  );
};

export default HomePage;
