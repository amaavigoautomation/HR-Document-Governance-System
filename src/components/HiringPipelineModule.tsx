import React, { useState } from 'react';
import { User } from '../types';
import { CalendarDays, Handshake, LayoutGrid, Mail, Plus, RefreshCw, Sparkles, UserCheck, Users, BarChart3 } from 'lucide-react';
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
export const HiringPipelineModule: React.FC<{ currentUser: User; users: User[]; onAddCandidate?: () => void }> = ({ currentUser, users, onAddCandidate }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const founder = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, ['req.founder_decide']);
  const seeDash = founder || hasAnyPerm(currentUser.perms, ['hrbp.view', 'hrbp.manage']);
  // A task in Hiring Automation can open a specific tab here (candidates, interviews, offers, joining).
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem('amaavigo_hiring_open_tab'); sessionStorage.removeItem('amaavigo_hiring_open_tab'); if (t && ['candidates', 'interviews', 'offers', 'joining'].includes(t)) return t as Tab; } catch { /* first tab */ }
    return 'candidates';
  });
  const TABS: { value: Tab; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { value: 'candidates', label: 'Candidates', Icon: Users }, { value: 'interviews', label: 'Interviews', Icon: CalendarDays },
    { value: 'referrals', label: 'Referrals', Icon: UserCheck }, { value: 'scoring', label: 'Scoring', Icon: BarChart3 },
    { value: 'offers', label: 'Offers', Icon: Mail }, { value: 'joining', label: 'Joining', Icon: Handshake },
    { value: 'ai', label: 'AI & duplicates', Icon: Sparkles },
    ...(seeDash ? [{ value: 'dashboard' as Tab, label: 'Founder dashboard', Icon: LayoutGrid }] : []),
  ];
  return (
    <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F6F7F9] p-4 sm:p-6 xl:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">Talent Acquisition <span className="mx-1">/</span> <span className="font-semibold text-slate-800">Hiring Pipeline</span></div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Hiring Pipeline</h1>
          <p className="mt-1 text-sm text-slate-600">Move candidates through screening, interviews, offers and joining.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setRefreshKey((n) => n + 1)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#FA7014] hover:text-[#FA7014]"><RefreshCw className="h-4 w-4" />Refresh</button>
          {onAddCandidate && <button type="button" onClick={onAddCandidate} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#F36B21] px-5 text-sm font-bold text-white hover:bg-[#df5d18]"><Plus className="h-4 w-4" />Add candidate</button>}
        </div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Hiring pipeline sections">
        {TABS.map((x) => { const on = x.value === tab; return (
          <button key={x.value} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.value)} className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${on ? 'border-[#F36B21] text-[#F36B21]' : 'border-transparent text-slate-700 hover:text-slate-900'}`}><x.Icon className="h-4 w-4" />{x.label}</button>
        ); })}
      </nav>
      <div key={refreshKey} className="space-y-5">
      {tab === 'candidates' && <CandidatesTab users={users} />}
      {tab === 'interviews' && <InterviewsTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'scoring' && <ScoringTab />}
      {tab === 'offers' && <OffersTab canApprove={founder} />}
      {tab === 'joining' && <JoiningTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'dashboard' && seeDash && <DashboardTab />}
      </div>
    </div>
  );
};
