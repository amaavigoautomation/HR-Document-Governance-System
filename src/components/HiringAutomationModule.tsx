import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { hasAnyPerm } from '../../shared/permissions';
import { flowService, type FlowState } from '../services/flowService';
import { flowNav, flowNavItems, type FlowSection } from './hiringflow/flowNav';
import { AutomationHome } from './hiringflow/AutomationHome';
import { FlowBuilder } from './hiringflow/FlowBuilder';
import { FlowRuns } from './hiringflow/FlowRuns';
import { FlowTasks } from './hiringflow/FlowTasks';
import { ToastProvider } from './leave/ui';
import { Plus } from 'lucide-react';

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

  // Opening a flow (or starting a new one) from the Workflows page lands in the flow builder.
  const [target, setTarget] = useState<{ id: string | null; adding: boolean; n: number }>({ id: null, adding: false, n: 0 });
  const toBuilder = (id: string | null, adding: boolean) => { setTarget((t) => ({ id, adding, n: t.n + 1 })); flowNav.setSection('flow'); };

  const openTab = (tab: string) => {
    try { sessionStorage.setItem(TAB_KEY, tab); } catch { /* the screen just opens on its first tab */ }
    onNavigate(tab === 'interviews' && !manage ? 'my-hiring' : 'talent-acquisition-pipeline');
  };

  return (
    <ToastProvider>
      <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F6F7F9] p-4 sm:p-6 xl:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-500">Talent Acquisition <span className="mx-1">/</span> <span className="font-semibold text-slate-800">Hiring Automation</span></div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Hiring Automation</h1>
            <p className="mt-1 text-sm text-slate-600">Automate your hiring workflows, communications and candidate actions.</p>
          </div>
          {manage && <button type="button" onClick={() => toBuilder(null, true)} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-[#4f46e5] px-5 text-sm font-bold text-white hover:bg-[#4338ca]"><Plus className="h-4 w-4" />Create Workflow</button>}
        </header>
        {section === 'workflows' && manage && <AutomationHome onOpenFlow={(id) => toBuilder(id, false)} onCreate={() => toBuilder(null, true)} />}
        {section === 'tasks' && <FlowTasks onOpenTab={openTab} onChanged={load} />}
        {section === 'flow' && manage && <FlowBuilder key={target.n} onChanged={load} initialFamilyId={target.id} startAdding={target.adding} />}
        {section === 'runs' && manage && <FlowRuns people={flow?.people || []} onChanged={load} />}
      </div>
    </ToastProvider>
  );
};
