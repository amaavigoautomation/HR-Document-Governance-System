import React, { useState } from 'react';
import { User } from '../types';
import { Segmented } from './leave/ui';
import { CandidatesTab } from './hiring/CandidatesTab';
import { InterviewsTab } from './hiring/InterviewsTab';
import { ReferralsTab } from './hiring/ReferralsTab';
import { ScoringTab } from './hiring/ScoringTab';
import { OffersTab } from './hiring/OffersTab';
import { JoiningTab } from './hiring/JoiningTab';
import { DashboardTab } from './hiring/DashboardTab';
import { AiTab } from './hiring/AiTab';
import { hasAnyPerm } from '../../shared/permissions';

type Tab = 'candidates' | 'interviews' | 'referrals' | 'scoring' | 'offers' | 'joining' | 'ai' | 'dashboard';

/** Hiring pipeline for HR: candidates (score, screening, tests, interviews), interviews, referrals, scoring weights. */
export const HiringPipelineModule: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser, users }) => {
  const founder = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, ['req.founder_decide']);
  const seeDash = founder || hasAnyPerm(currentUser.perms, ['hrbp.view', 'hrbp.manage']);
  // A task in Hiring Automation can open a specific tab here (candidates, interviews, offers, joining).
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem('amaavigo_hiring_open_tab'); sessionStorage.removeItem('amaavigo_hiring_open_tab'); if (t && ['candidates', 'interviews', 'offers', 'joining'].includes(t)) return t as Tab; } catch { /* first tab */ }
    return 'candidates';
  });
  return (
    <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F6F7F9] p-4 sm:p-6 xl:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#F36B21]">Talent acquisition</div><h1 className="mt-1 text-[28px] font-bold tracking-tight text-slate-950">Hiring pipeline</h1><p className="mt-1 text-sm text-slate-500">Move candidates through screening, interviews, offers and joining.</p></div><div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Live hiring workspace</div></header>
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><div className="overflow-x-auto"><Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: 'candidates', label: 'Candidates' }, { value: 'interviews', label: 'Interviews' },
           { value: 'referrals', label: 'Referrals' }, { value: 'scoring', label: 'Scoring' },
          { value: 'offers', label: 'Offers' }, { value: 'joining', label: 'Joining' }, { value: 'ai', label: 'AI & duplicates' },
          ...(seeDash ? [{ value: 'dashboard' as Tab, label: 'Founder dashboard' }] : []),
        ]} />
      </div></div>
      {tab === 'candidates' && <CandidatesTab users={users} />}
      {tab === 'interviews' && <InterviewsTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'scoring' && <ScoringTab />}
      {tab === 'offers' && <OffersTab canApprove={founder} />}
      {tab === 'joining' && <JoiningTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'dashboard' && seeDash && <DashboardTab />}
    </div>
  );
};
