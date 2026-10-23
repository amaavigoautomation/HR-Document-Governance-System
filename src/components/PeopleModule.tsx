import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import { lifecycleService } from '../services/lifecycleService';
import { Notice } from './leave/ui';
import { DirectoryTab } from './lifecycle/DirectoryTab';
import { ExitsTab, MyExit } from './lifecycle/ExitTabs';
import { LettersTab, MyLetters } from './lifecycle/LettersTab';
import { LifecycleSetup } from './lifecycle/LifecycleSetup';
import { MyTasks, OnboardingAdmin } from './lifecycle/OnboardingTabs';

type Tab = 'directory' | 'tasks' | 'exit' | 'myletters' | 'onboarding' | 'exits' | 'letters' | 'setup';

/** Employee lifecycle for every role: directory and org chart, my joining tasks, my exit and letters; HR gets the admin side. */
export const PeopleModule: React.FC<{ currentUser: User }> = () => {
  const [me, setMe] = useState<any | null>(null);
  const [settings, setSettings] = useState<any | null>(null);
  const [dir, setDir] = useState<{ uid: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('directory');

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

  if (error) return <div className="p-6"><Notice tone="error">{error}</Notice></div>;
  if (!me) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'directory', label: 'Directory & org chart', show: true },
    { key: 'tasks', label: me.openTasks ? `My tasks (${me.openTasks})` : 'My tasks', show: true },
    { key: 'exit', label: 'My exit', show: true },
    { key: 'myletters', label: 'My letters', show: true },
    { key: 'onboarding', label: 'Onboarding', show: me.canManage },
    { key: 'exits', label: 'Exits', show: me.canManage || me.isManager },
    { key: 'letters', label: 'Letters', show: me.canManage },
    { key: 'setup', label: 'Setup', show: me.canManage },
  ];
  const visible = tabs.filter((t) => t.show);
  const active: Tab = visible.some((t) => t.key === tab) ? tab : 'directory';
  const myUid = (me as any).uid || '';

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">People</h2>
          <p className="text-xs text-slate-500">Directory, joining tasks, exits and letters.</p>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {visible.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 -mb-px ${active === t.key ? 'border-[#FA7014] text-[#FA7014]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {t.label}
            </button>
          ))}
        </div>
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
