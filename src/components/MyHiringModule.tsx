import React, { useState } from 'react';
import { CalendarDays, UserPlus } from 'lucide-react';
import { User } from '../types';
import { ReferralsTab } from './hiring/ReferralsTab';
import { InterviewsTab } from './hiring/InterviewsTab';

type Tab = 'referrals' | 'interviews';
const TABS: { value: Tab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'referrals', label: 'Refer a candidate', Icon: UserPlus },
  { value: 'interviews', label: 'My interviews', Icon: CalendarDays },
];

/** For every employee: refer people for open jobs, follow your referrals, and give feedback on interviews you are asked to take. */
export const MyHiringModule: React.FC<{ currentUser: User }> = () => {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem('amaavigo_hiring_open_tab'); sessionStorage.removeItem('amaavigo_hiring_open_tab'); if (t === 'interviews') return 'interviews'; } catch { /* first tab */ }
    return 'referrals';
  });
  return (
    <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F6F7F9] p-4 sm:p-6 xl:p-8">
      <header>
        <div className="text-sm text-slate-500">Talent Acquisition <span className="mx-1">/</span> <span className="font-semibold text-slate-800">My Hiring</span></div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">My Hiring</h1>
        <p className="mt-1 text-sm text-slate-600">Refer talented people and manage your interview assignments.</p>
      </header>
      <nav className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="My hiring sections">
        {TABS.map((x) => { const on = x.value === tab; return (
          <button key={x.value} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.value)} className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold cursor-pointer ${on ? 'border-[#F36B21] text-[#F36B21]' : 'border-transparent text-slate-700 hover:text-slate-900'}`}><x.Icon className="h-4 w-4" />{x.label}</button>
        ); })}
      </nav>
      {tab === 'referrals' ? <ReferralsTab onOpenInterviews={() => setTab('interviews')} /> : <InterviewsTab />}
    </div>
  );
};
