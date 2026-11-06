import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { hasAnyPerm } from '../../shared/permissions';
import { pmService } from '../services/pmService';
import { pmNav, pmNavItems, type Section } from './pm/pmNav';
import { Today, MyPerformance, MyCheckins } from './pm/Today';
import { ReviewList, ReviewScreen } from './pm/ReviewScreen';
import { ApprovalsScreen, Development, Evidence, PlanList, TeamCheckins } from './pm/Team';
import { Cycles, Framework, StartHere } from './pm/Setup';
import { AllPlans, CompsRoles, Sops, Templates } from './pm/Masters';
import { Dashboard, Governance } from './pm/Reports';
import { Autopilot } from './pm/Autopilot';
import { ToastProvider } from './leave/ui';

/**
 * Performance Management (HR-PM-001 to HR-PM-009).
 * Every person sees "Today" first: a plain to-do list. The rest is grouped by who needs it: everyone, managers, approvers, HR setup, reports.
 * Sections live in the app sidebar, like Payroll and HR Business Partner.
 */
export const PerformanceModule: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser, users }) => {
  const admin = !!currentUser.isCompanyAdmin;
  const manage = admin || hasAnyPerm(currentUser.perms, ['pm.manage']);
  const approve = admin || hasAnyPerm(currentUser.perms, ['pm.approve']);
  const [flags, setFlags] = useState<{ manager: boolean; aggregate: boolean }>({ manager: false, aggregate: false });
  useEffect(() => { pmService.get('home').then((h) => setFlags({ manager: !!h.isManager, aggregate: !!h.canViewAggregate })).catch(() => {}); }, []);
  const items = pmNavItems({ manage, approve, aggregate: flags.aggregate || hasAnyPerm(currentUser.perms, ['pm.view']), manager: flags.manager });
  const { section: chosen } = pmNav.useNav();
  const itemsKey = items.map((i) => i.key).join(',');
  useEffect(() => { pmNav.publish(items); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => pmNav.publish([]), []);
  const section = pmNav.resolve(chosen, items) as Section;
  const [review, setReview] = useState('');
  const openReview = (id?: string) => { if (id) setReview(id); };
  const staff = users.filter((u) => u.active !== false);

  const body = () => {
    if (review) return <ReviewScreen id={review} back={() => setReview('')} />;
    switch (section) {
      case 'today': return <Today open={openReview} />;
      case 'mine': return <MyPerformance open={openReview} />;
      case 'checkins': return <MyCheckins />;
      case 'development': return <Development users={staff} manager={flags.manager} hr={manage} />;
      case 'team': return <ReviewList scope="team" open={openReview} title="My team: reviews" what="The reviews of the people who report to you." todo="Open one that is waiting for you." />;
      case 'teamPlans': return <PlanList scope="team" who="manager" title="My team: targets" what="The targets (KRA/KPI) for each person on your team. HR creates a starting plan. You set the real targets." todo="Open a plan marked 'Manager to set targets', set the targets, and send it to HR." />;
      case 'evidence': return <Evidence users={staff} manager={flags.manager} hr={manage} />;
      case 'approvals': return <ApprovalsScreen openReview={openReview} />;
      case 'start': return <StartHere />;
      case 'framework': return <Framework canApprove={approve} />;
      case 'comps': return <CompsRoles />;
      case 'sops': return <Sops users={staff} />;
      case 'templates': return <Templates canApprove={approve} />;
      case 'plans': return <AllPlans canApprove={approve} />;
      case 'cycles': return <Cycles users={staff} openReview={openReview} />;
      case 'reviews': return <ReviewList scope="all" open={openReview} title="All reviews" what="Every review in the company." />;
      case 'autopilot': return <Autopilot />;
      case 'dashboard': return <Dashboard />;
      case 'governance': return <Governance users={staff} />;
      default: return null;
    }
  };
  // Opening a section from the sidebar closes any open review so the click always does something.
  useEffect(() => { setReview(''); }, [section]);
  return (
    <ToastProvider>
      <div className="flex-1 overflow-auto p-4 md:p-6 max-w-5xl w-full mx-auto">{body()}</div>
    </ToastProvider>
  );
};
