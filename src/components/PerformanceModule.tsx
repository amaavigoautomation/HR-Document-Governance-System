import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { User } from '../types';
import { perfService } from '../services/perfService';
import { Notice } from './leave/ui';
import { ModuleSubNav } from './moduleNav';
import { perfNav, perfNavItems } from './perf/perfNav';
import { MyGoals } from './perf/MyGoals';
import { ReviewsTab } from './perf/ReviewsTab';
import { MySops, SopAdmin } from './perf/SopsTab';
import { DevTab, TeamDev } from './perf/DevTab';
import { TeamTab } from './perf/TeamTab';
import { PlansAdmin } from './perf/PlansAdmin';
import { Dashboard } from './perf/Dashboard';
import { SetupTab } from './perf/SetupTab';
import { Governance } from './perf/Governance';
import { MoodTab } from './perf/MoodTab';
import { useLoad } from './perf/shared';

const TeamReviews: React.FC<{ me: any; onChanged: () => void }> = ({ me, onChanged }) => {
  const r = useLoad(() => perfService.reviews('team'), []);
  return (
    <div className="space-y-4">
      <ReviewsTab scope="team" me={me} onChanged={() => { r.reload(); onChanged(); }} />
      <TeamDev scope="team" reviews={r.data?.items || []} />
    </div>
  );
};

/**
 * Performance management for every role: everyone sees their own goals, reviews and SOPs; managers get their team;
 * HR and approvers get setup, plans, all reviews and governance. The section menu shows in the app sidebar
 * (or as pills on screens without one).
 */
export const PerformanceModule: React.FC<{ currentUser: User; inlineNav?: boolean }> = ({ inlineNav }) => {
  const [me, setMe] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { section, items } = perfNav.useNav();

  const reload = useCallback(() => perfService.me().then((r) => { setMe(r); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { perfNav.publish(perfNavItems(me)); }, [me]);
  useEffect(() => () => perfNav.publish([]), []);

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const navItems = perfNavItems(me);
  const active = perfNav.resolve(section, navItems.length ? navItems : items);
  const activeLabel = navItems.find((i) => i.key === active)?.label || '';
  const t = me.todo || {};
  const todos = [
    t.planToAcknowledge && 'confirm your goals', t.sopsToAcknowledge && `${t.sopsToAcknowledge} SOP(s) to acknowledge`, t.selfReviewsDue && 'a self-assessment is due',
    t.reviewsToAcknowledge && 'a review is waiting for your response', t.teamPlansToCustomise && `${t.teamPlansToCustomise} team plan(s) need targets`,
    t.teamReviewsDue && `${t.teamReviewsDue} team review(s) due`, t.plansToApprove && `${t.plansToApprove} plan(s) to approve`, t.reviewsToApprove && `${t.reviewsToApprove} review(s) to approve`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        {inlineNav ? <h2 className="text-lg font-bold text-slate-900">Performance</h2> : (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400" aria-label="You are here">
            <span>Performance</span><ChevronRight className="w-3.5 h-3.5" /><span className="text-slate-700">{activeLabel}</span>
          </div>
        )}
        {inlineNav && navItems.length > 1 && <ModuleSubNav nav={perfNav} label="Performance sections" variant="pills" />}
        {todos.length > 0 && <Notice tone="warn">Waiting for you: {todos.join(' · ')}.</Notice>}
        {me.canManage && !me.configured && active !== 'setup' && <Notice>Performance management has not been set up yet. Open <strong>Setup</strong> to get started.</Notice>}
        {active === 'me' && <MyGoals onChanged={reload} />}
        {active === 'myreviews' && <ReviewsTab scope="me" me={me} onChanged={reload} />}
        {active === 'sops' && <MySops onChanged={reload} />}
        {active === 'dev' && <DevTab />}
        {active === 'mood' && <MoodTab me={me} />}
        {active === 'team' && <TeamTab me={me} onChanged={reload} />}
        {active === 'teamreviews' && <TeamReviews me={me} onChanged={reload} />}
        {active === 'plans' && <PlansAdmin me={me} onChanged={reload} />}
        {active === 'allreviews' && <ReviewsTab scope="all" me={me} onChanged={reload} />}
        {active === 'dashboard' && <Dashboard me={me} />}
        {active === 'sopadmin' && <SopAdmin />}
        {active === 'setup' && <SetupTab me={me} onChanged={reload} />}
        {active === 'governance' && <Governance me={me} />}
      </div>
    </div>
  );
};
