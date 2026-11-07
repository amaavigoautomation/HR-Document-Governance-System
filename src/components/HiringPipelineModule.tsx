import React, { useState } from 'react';
import { User } from '../types';
import { CalendarDays, Columns3, Handshake, LayoutGrid, List, Mail, Plus, RefreshCw, Sparkles, UserCheck, BarChart3 } from 'lucide-react';
import { CandidateDrawer, CandidatesTab } from './hiring/CandidatesTab';
import { PERIODS, PipelineBoard, PipelineStats, usePipelineData } from './hiring/PipelineBoard';
import { InterviewsTab } from './hiring/InterviewsTab';
import { ReferralsTab } from './hiring/ReferralsTab';
import { ScoringTab } from './hiring/ScoringTab';
import { OffersTab } from './hiring/OffersTab';
import { JoiningTab } from './hiring/JoiningTab';
import { DashboardTab } from './hiring/DashboardTab';
import { AiTab } from './hiring/AiTab';
import { hasAnyPerm } from '../../shared/permissions';

type Tab = 'pipeline' | 'candidates' | 'interviews' | 'referrals' | 'scoring' | 'offers' | 'joining' | 'ai' | 'dashboard';

/** Hiring pipeline for HR: candidates (score, screening, tests, interviews), interviews, referrals, scoring weights. */
export const HiringPipelineModule: React.FC<{ currentUser: User; users: User[]; onAddCandidate?: () => void; onOpenRequisitions?: () => void }> = ({ currentUser, users, onAddCandidate, onOpenRequisitions }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const founder = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, ['req.founder_decide']);
  const seeDash = founder || hasAnyPerm(currentUser.perms, ['hrbp.view', 'hrbp.manage']);
  // A task in Hiring Automation can open a specific tab here (candidates, interviews, offers, joining).
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem('amaavigo_hiring_open_tab'); sessionStorage.removeItem('amaavigo_hiring_open_tab'); if (t && ['candidates', 'interviews', 'offers', 'joining'].includes(t)) return t as Tab; } catch { /* first tab */ }
    return 'pipeline';
  });
  const [days, setDays] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);
  const data = usePipelineData(days, refreshKey);
  const MAIN: { value: Tab; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { value: 'pipeline', label: 'Pipeline', Icon: Columns3 }, { value: 'candidates', label: 'List', Icon: List },
    ...(seeDash ? [{ value: 'dashboard' as Tab, label: 'Analytics', Icon: BarChart3 }] : []),
  ];
  const MORE: { value: Tab; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { value: 'interviews', label: 'Interviews', Icon: CalendarDays }, { value: 'referrals', label: 'Referrals', Icon: UserCheck },
    { value: 'scoring', label: 'Scoring', Icon: BarChart3 }, { value: 'offers', label: 'Offers', Icon: Mail },
    { value: 'joining', label: 'Joining', Icon: Handshake }, { value: 'ai', label: 'AI & duplicates', Icon: Sparkles },
  ];
  return (
    <div className="flex-1 min-w-0 space-y-5 overflow-y-auto bg-[#F6F7F9] p-4 sm:p-6 xl:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">Talent Acquisition <span className="mx-1">/</span> <span className="font-semibold text-slate-800">Hiring Pipeline</span></div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Hiring Pipeline</h1>
          <p className="mt-1 text-sm text-slate-600">Track and manage candidates across all hiring stages.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none focus:border-[#FA7014]">{PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}</select>
          <button type="button" onClick={() => setRefreshKey((n) => n + 1)} aria-label="Refresh" title="Refresh" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 hover:border-[#FA7014] hover:text-[#FA7014]"><RefreshCw className="h-4 w-4" /></button>
          {onAddCandidate && <button type="button" onClick={onAddCandidate} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#FA7014] hover:text-[#FA7014]"><Plus className="h-4 w-4" />Add candidate</button>}
          {onOpenRequisitions && <button type="button" onClick={onOpenRequisitions} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#4f46e5] px-5 text-sm font-bold text-white hover:bg-[#4338ca]"><Plus className="h-4 w-4" />Create Requisition</button>}
        </div>
      </header>
      {tab === 'pipeline' && <PipelineStats d={data} />}
      <nav className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Hiring pipeline sections">
        {MAIN.map((x) => { const on = x.value === tab; return (
          <button key={x.value} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.value)} className={`inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-full px-5 py-2 text-sm font-semibold transition-colors ${on ? 'bg-violet-200 text-violet-900' : 'text-slate-700 hover:bg-white'}`}><x.Icon className="h-4 w-4" />{x.label}</button>
        ); })}
        <span className="mx-2 hidden h-5 w-px bg-slate-300 sm:block" aria-hidden />
        {MORE.map((x) => { const on = x.value === tab; return (
          <button key={x.value} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.value)} className={`inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${on ? 'bg-violet-200 text-violet-900' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}><x.Icon className="h-3.5 w-3.5" />{x.label}</button>
        ); })}
      </nav>
      <div key={refreshKey} className="space-y-5">
      {tab === 'pipeline' && <PipelineBoard d={data} onOpenCandidate={setOpenId} onOpenRequisitions={onOpenRequisitions} />}
      {tab === 'candidates' && <CandidatesTab users={users} />}
      {tab === 'interviews' && <InterviewsTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'scoring' && <ScoringTab />}
      {tab === 'offers' && <OffersTab canApprove={founder} />}
      {tab === 'joining' && <JoiningTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'dashboard' && seeDash && <DashboardTab />}
      </div>
      {openId && <CandidateDrawer id={openId} users={users} onClose={() => setOpenId(null)} onChanged={data.reload} />}
    </div>
  );
};
