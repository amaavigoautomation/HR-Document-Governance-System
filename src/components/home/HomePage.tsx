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
      <div className="max-w-[1440px] mx-auto p-3 sm:p-4 xl:p-5 space-y-3">
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

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
          <div className="space-y-3 min-w-0">
            <PipelineChart refreshKey={tick} onOpen={onOpen} />
            <UpcomingCard refreshKey={tick} onOpen={onOpen} />
          </div>
          <div className="space-y-3 min-w-0">
            <QuickActionsGrid onOpen={onOpen} />
            <MyTasks widgets={dash.data?.widgets || []} onOpen={onOpen} />
            <LeaveBalanceCard refreshKey={tick} onOpen={onOpen} />
            <TeamAttendanceCard refreshKey={tick} onOpen={onOpen} />
          </div>
        </div>

        <h2 id="home-more" className="pt-2 text-base font-bold text-slate-950">More for you</h2>

        {/* Masonry: cards flow into two balanced columns on wide screens (CSS columns, so every card keeps its place in one parent and nothing remounts); one column below xl. */}
        {L && <>
        <div className="xl:columns-2 xl:gap-4">
          {[
            <ProfileCard key="profile" fallbackName={fallbackName || ''} refreshKey={tick} />,
            show('attendance') && <AttendanceCard key="attendance" refreshKey={tick} onChanged={refresh} />,
            show('celebrations') && <CelebrationsCard key="celebrations" refreshKey={tick} />,
            show('ceo-speak') && <AnnouncementsCard key="ceo-speak" kind="CEO_SPEAK" canManage={!!can?.announce} onManage={() => setManage(true)} refreshKey={tick} />,
            show('announcements') && <AnnouncementsCard key="announcements" kind="ANNOUNCEMENT" canManage={!!can?.announce} onManage={() => setManage(true)} refreshKey={tick} />,
            show('calendar') && <CalendarCard key="calendar" refreshKey={tick} />,
            show('mood') && <MoodCard key="mood" showSummary={!!can?.moodSummary} />,
            show('login-summary') && can?.loginSummary && <LoginSummaryCard key="login-summary" refreshKey={tick} />,
            show('acknowledgements') && can?.acknowledge && <AcksCard key="acknowledgements" onOpen={onOpen} refreshKey={tick} />,
            show('quick-links') && <QuickLinksCard key="quick-links" links={L?.quickLinks || []} onOpen={onOpen} />,
            show('quick-reports') && <QuickReportsCard key="quick-reports" reports={L?.quickReports || []} onOpen={onOpen} />,
            ...left.map((w) => <WidgetCard key={w.id} w={w} onOpen={onOpen} />),
          ].filter(Boolean).map((card, i) => (
            <div key={(card as React.ReactElement).key ?? i} className="mb-4 break-inside-avoid">{card}</div>
          ))}
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
