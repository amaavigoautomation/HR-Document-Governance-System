import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { hasAnyPerm } from '../../shared/permissions';
import { pmService } from '../services/pmService';
import { pmNav, pmNavItems, type Section } from './pm/pmNav';
import { Home, type Go } from './pm/Home';
import { Mine } from './pm/Mine';
import { Team, TargetsScreen } from './pm/Team';
import { ReviewScreen } from './pm/ReviewScreen';
import { Setup } from './pm/Setup';
import { Exceptions, Plans, Reports, Reviews } from './pm/Hr';
import { ToastProvider } from './leave/ui';

/**
 * Performance Management.
 * Everyone lands on "To do": one list of what is waiting for them. Managers get "My team". HR gets Setup, Targets, Reviews and Needs attention.
 * Sections live in the app sidebar, like Payroll and HR Business Partner.
 */
export const PerformanceModule: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser }) => {
  const admin = !!currentUser.isCompanyAdmin;
  const hr = admin || hasAnyPerm(currentUser.perms, ['pm.manage']);
  const approver = admin || hasAnyPerm(currentUser.perms, ['pm.approve']);
  const [flags, setFlags] = useState<{ manager: boolean; reports: boolean; todo: number }>({ manager: false, reports: false, todo: 0 });
  useEffect(() => { pmService.get('home').then((h) => setFlags({ manager: !!h.isManager, reports: !!h.canReports, todo: (h.todo || []).length })).catch(() => {}); }, []);
  const items = pmNavItems({ hr, approver, manager: flags.manager, reports: flags.reports || hasAnyPerm(currentUser.perms, ['pm.view']) }, flags.todo);
  const { section: chosen } = pmNav.useNav();
  const itemsKey = items.map((i) => `${i.key}${i.badge || ''}`).join(',');
  useEffect(() => { pmNav.publish(items); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => pmNav.publish([]), []);
  const section = pmNav.resolve(chosen, items) as Section;

  // A review or a targets form opens on top of the current section; picking a section in the sidebar closes it.
  const [review, setReview] = useState('');
  const [targets, setTargets] = useState('');
  useEffect(() => { setReview(''); setTargets(''); }, [section]);
  const go: Go = { review: (id) => { setTargets(''); setReview(id); }, targets: (id) => { setReview(''); setTargets(id); } };

  const body = () => {
    if (review) return <ReviewScreen id={review} back={() => setReview('')} />;
    if (targets) return <TargetsScreen id={targets} back={() => setTargets('')} />;
    switch (section) {
      case 'home': return <Home go={go} />;
      case 'mine': return <Mine openReview={go.review} />;
      case 'team': return <Team go={go} />;
      case 'setup': return <Setup />;
      case 'plans': return <Plans go={go} />;
      case 'reviews': return <Reviews go={go} hr={hr} />;
      case 'exceptions': return <Exceptions />;
      case 'reports': return <Reports hr={hr} />;
      default: return null;
    }
  };
  return (
    <ToastProvider>
      <div className="flex-1 overflow-auto p-4 md:p-6 max-w-5xl w-full mx-auto">{body()}</div>
    </ToastProvider>
  );
};
