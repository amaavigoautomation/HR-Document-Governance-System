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
    <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F7F8FA] p-4 sm:p-6 xl:p-8">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-slate-900">My hiring</h1>
        <p className="text-xs text-slate-500 sm:text-sm">Refer talented people and manage your interview assignments.</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm"><Segmented value={tab} onChange={setTab} options={[{ value: 'referrals', label: 'Refer a candidate' }, { value: 'interviews', label: 'My interviews' }]} /></div>
      {tab === 'referrals' ? <ReferralsTab /> : <InterviewsTab />}
    </div>
  );
};
