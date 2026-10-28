import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Settings2, Sparkles } from 'lucide-react';
import type { WidgetId, WidgetTarget } from '../../../shared/dashboard';
import { dashboardService } from '../../services/dashboardService';
import { homeService } from '../../services/homeService';
import { Notice, btnGhost, btnPrimary, niceDate } from '../leave/ui';
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
import { FilesCard } from './cards/FilesCard';
import { AnnouncementsCard } from './cards/AnnouncementsCard';
import { LoginSummaryCard } from './cards/LoginSummaryCard';
import { AcksCard } from './cards/AcksCard';

interface Props { fallbackName?: string; onOpen: (target: WidgetTarget) => void }

// These dashboard widgets have their own full card on Home now.
const REPLACED: WidgetId[] = ['attendance', 'acknowledgements'];
// These stay beside the profile; everything else urgent goes in the strip on top.
const LEFT_WIDGETS: WidgetId[] = ['leave-balance', 'latest-payslip'];

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
  const attention = widgets.filter((w) => !LEFT_WIDGETS.includes(w.id));
  const left = widgets.filter((w) => LEFT_WIDGETS.includes(w.id));
  const name = dash.data?.name || fallbackName || '';
  const first = name.split(' ')[0];
  const canManage = !!can && (can.announce || can.manageHome || can.people);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">{first ? `Hello, ${first}` : 'Hello'}</h1>
          <p className="text-xs text-slate-500">{L?.today ? niceDate(L.today) : ' '}</p>
        </div>
        <div className="flex gap-2">
          {canManage && <button type="button" className={btnGhost} onClick={() => setManage(true)}><Settings2 className="w-3.5 h-3.5" />Manage</button>}
          <button type="button" className={btnGhost} onClick={refresh} disabled={layout.loading || dash.loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${layout.loading || dash.loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>

      {layout.error && <Notice tone="error">{layout.error} <button type="button" className="underline font-bold" onClick={refresh}>Try again</button></Notice>}

      {attention.length > 0 && (
        <section aria-label="Needs your attention">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" />Needs your attention</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attention.map((w) => <WidgetCard key={w.id} w={w} onOpen={onOpen} />)}
          </div>
        </section>
      )}

      {L && (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <div className="space-y-4 min-w-0">
            <ProfileCard fallbackName={fallbackName || ''} refreshKey={tick} />
            {show('mood') && <MoodCard showSummary={!!can?.moodSummary} />}
            {show('calendar') && <CalendarCard refreshKey={tick} />}
            {show('attendance') && <AttendanceCard refreshKey={tick} onChanged={refresh} />}
            {show('quick-links') && <QuickLinksCard links={L.quickLinks} onOpen={onOpen} />}
            {show('quick-reports') && <QuickReportsCard reports={L.quickReports} onOpen={onOpen} />}
            {left.map((w) => <WidgetCard key={w.id} w={w} onOpen={onOpen} />)}
            {show('on-leave') && <OnLeaveCard refreshKey={tick} />}
          </div>
          <div className="space-y-4 min-w-0">
            {show('celebrations') && <CelebrationsCard refreshKey={tick} />}
            {show('files') && <FilesCard onOpen={onOpen} refreshKey={tick} />}
            {show('ceo-speak') && <AnnouncementsCard kind="CEO_SPEAK" canManage={!!can?.announce} onManage={() => setManage(true)} refreshKey={tick} />}
            {show('announcements') && <AnnouncementsCard kind="ANNOUNCEMENT" canManage={!!can?.announce} onManage={() => setManage(true)} refreshKey={tick} />}
            {show('login-summary') && can?.loginSummary && <LoginSummaryCard refreshKey={tick} />}
            {show('acknowledgements') && can?.acknowledge && <AcksCard onOpen={onOpen} refreshKey={tick} />}
          </div>
        </div>
      )}

      {can && <ManageHome open={manage} onClose={() => setManage(false)} can={can} onChanged={refresh} />}
    </div>
  );
};

export default HomePage;
