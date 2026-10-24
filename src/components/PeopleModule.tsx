import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { User } from '../types';
import { lifecycleService } from '../services/lifecycleService';
import { Notice } from './leave/ui';
import { DirectoryTab } from './lifecycle/DirectoryTab';
import { ExitsTab, MyExit } from './lifecycle/ExitTabs';
import { LettersTab, MyLetters } from './lifecycle/LettersTab';
import { LifecycleSetup } from './lifecycle/LifecycleSetup';
import { MyTasks, OnboardingAdmin } from './lifecycle/OnboardingTabs';
import { ModuleSubNav } from './moduleNav';
import { peopleNav, peopleNavItems } from './lifecycle/peopleNav';

/**
 * Employee lifecycle for every role: directory and org chart, my joining tasks, my exit and letters; HR gets the admin side.
 * The section menu is shown in the app sidebar under "People". Screens without a sidebar (the employee portal)
 * pass `inlineNav` to show the same menu as pills at the top of the page.
 */
export const PeopleModule: React.FC<{ currentUser: User; inlineNav?: boolean }> = ({ inlineNav }) => {
  const [me, setMe] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [dir, setDir] = useState<{ uid: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { section, items } = peopleNav.useNav();

  const reload = useCallback(async () => {
    try {
      const m = await lifecycleService.me();
      setMe(m);
      if (m.canManage) {
        const [s, d] = await Promise.all([lifecycleService.settings(), lifecycleService.directory()]);
        setSettings(s.settings);
        setDir(d.people.map((p: any) => ({ uid: p.uid, name: p.name })));
      }
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Tell the menu (sidebar or pills) which sections this person may open.
  useEffect(() => { peopleNav.publish(peopleNavItems(me)); }, [me]);
  useEffect(() => () => peopleNav.publish([]), []);

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const navItems = peopleNavItems(me); // same list the menu shows, computed here so the first paint never lags the store
  const active = peopleNav.resolve(section, navItems.length ? navItems : items);
  const activeLabel = navItems.find((i) => i.key === active)?.label || '';
  const myUid = (me as any).uid || '';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        {inlineNav ? (
          <div>
            <h2 className="text-lg font-bold text-slate-900">People</h2>
            <p className="text-xs text-slate-500">Directory, joining tasks, exits and letters.</p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400" aria-label="You are here">
            <span>People</span><ChevronRight className="w-3.5 h-3.5" /><span className="text-slate-700">{activeLabel}</span>
          </div>
        )}
        {inlineNav && <ModuleSubNav nav={peopleNav} label="People sections" variant="pills" />}
        {active === 'directory' && <DirectoryTab canManage={me.canManage} />}
        {active === 'tasks' && <MyTasks onChange={reload} />}
        {active === 'exit' && <MyExit />}
        {active === 'myletters' && <MyLetters />}
        {active === 'onboarding' && <OnboardingAdmin />}
        {active === 'exits' && <ExitsTab canManage={me.canManage} me={myUid} people={dir} />}
        {active === 'letters' && settings && <LettersTab people={dir} templates={settings.letters} />}
        {active === 'setup' && <LifecycleSetup onSaved={reload} />}
      </div>
    </div>
  );
};
