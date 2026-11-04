import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { hasAnyPerm } from '../../shared/permissions';
import { flowService, type FlowState } from '../services/flowService';
import { flowNav, flowNavItems, type FlowSection } from './hiringflow/flowNav';
import { FlowBuilder } from './hiringflow/FlowBuilder';
import { FlowRuns } from './hiringflow/FlowRuns';
import { FlowTasks } from './hiringflow/FlowTasks';
import { ToastProvider } from './leave/ui';

const MANAGE = ['app.manage', 'req.manage_jd', 'req.hr_decide'];
/** Where a task's "Open ..." button lands: the hiring screen it belongs to (or, for people who only give interview feedback, their own interviews tab). */
export const TAB_KEY = 'amaavigo_hiring_open_tab';

/**
 * Hiring Automation: the custom hiring flow (build it, watch applicants move through it) and the tasks it creates.
 * The screens where the real work is done (Candidates, Interviews, Offers, Joining) stay in Hiring pipeline.
 */
export const HiringAutomationModule: React.FC<{ currentUser: User; onNavigate: (module: 'talent-acquisition-pipeline' | 'my-hiring') => void }> = ({ currentUser, onNavigate }) => {
  const manage = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, MANAGE);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const load = useCallback(() => { flowService.state().then((r) => setFlow(r as any)).catch(() => undefined); }, []);
  useEffect(load, [load]);
  const items = flowNavItems(manage, { tasks: flow?.myOpen, stuck: flow?.counts?.STUCK });
  const itemsKey = JSON.stringify(items);
  const { section: chosen } = flowNav.useNav();
  useEffect(() => { flowNav.publish(items); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => flowNav.publish([]), []);
  const section = flowNav.resolve(chosen, items) as FlowSection;

  const openTab = (tab: string) => {
    try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* the screen just opens on its first tab */ }
    onNavigate(tab === 'interviews' && !manage ? 'my-hiring' : 'talent-acquisition-pipeline');
  };

  return (
    <ToastProvider>
      <div className="flex-1 min-w-0 space-y-4 overflow-y-auto p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Hiring Automation</h1>
          <p className="text-xs text-slate-500 sm:text-sm">Decide what happens to every applicant, step by step. The app moves them along and tells people what to do.</p>
        </div>
        {section === 'tasks' && <FlowTasks onOpenTab={openTab} onChanged={load} />}
        {section === 'flow' && manage && <FlowBuilder onChanged={load} />}
        {section === 'runs' && manage && <FlowRuns people={flow?.people || []} onChanged={load} />}
      </div>
    </ToastProvider>
  );
};
