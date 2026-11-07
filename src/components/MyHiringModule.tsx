import React, { useState } from 'react';
import { User } from '../types';
import { Segmented } from './leave/ui';
import { ReferralsTab } from './hiring/ReferralsTab';
import { InterviewsTab } from './hiring/InterviewsTab';

/** For every employee: refer people for open jobs, follow your referrals, and give feedback on interviews you are asked to take. */
export const MyHiringModule: React.FC<{ currentUser: User }> = () => {
  const [tab, setTab] = useState<'referrals' | 'interviews'>(() => {
    try { const t = sessionStorage.getItem('amaavigo_hiring_open_tab'); sessionStorage.removeItem('amaavigo_hiring_open_tab'); if (t === 'interviews') return 'interviews'; } catch { /* first tab */ }
    return 'referrals';
  });
  return (
    <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F6F7F9] p-4 sm:p-6 xl:p-8">
      <header><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#F36B21]">Talent acquisition</div><h1 className="mt-1 text-[28px] font-bold tracking-tight text-slate-950">My hiring</h1><p className="mt-1 text-sm text-slate-500">Refer talented people and manage your interview assignments.</p></header>
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><Segmented value={tab} onChange={setTab} options={[{ value: 'referrals', label: 'Refer a candidate' }, { value: 'interviews', label: 'My interviews' }]} /></div>
      {tab === 'referrals' ? <ReferralsTab /> : <InterviewsTab />}
    </div>
  );
};
