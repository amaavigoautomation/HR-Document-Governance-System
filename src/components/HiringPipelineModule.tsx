import React, { useEffect, useState } from 'react';
import { Requisition, User } from '../types';
import { subscribeToRequisitions } from '../services/requisitionService';
import { Segmented } from './leave/ui';
import { CandidatesTab } from './hiring/CandidatesTab';
import { InterviewsTab } from './hiring/InterviewsTab';
import { PostingsTab } from './hiring/PostingsTab';
import { JdLibraryTab } from './hiring/JdLibraryTab';
import { ReferralsTab } from './hiring/ReferralsTab';
import { ScoringTab } from './hiring/ScoringTab';
import { OffersTab } from './hiring/OffersTab';
import { JoiningTab } from './hiring/JoiningTab';
import { DashboardTab } from './hiring/DashboardTab';
import { AiTab } from './hiring/AiTab';
import { FlowBuilder } from './hiringflow/FlowBuilder';
import { FlowRuns } from './hiringflow/FlowRuns';
import { FlowTasks } from './hiringflow/FlowTasks';
import { flowService, type FlowState } from '../services/flowService';
import { hasAnyPerm } from '../../shared/permissions';

type Tab = 'flow' | 'flowRuns' | 'tasks' | 'candidates' | 'interviews' | 'postings' | 'jd' | 'referrals' | 'scoring' | 'offers' | 'joining' | 'ai' | 'dashboard';

/** Hiring pipeline for HR: candidates (score, screening, tests, interviews), interviews, posting tracker, JD library, referrals, scoring weights. */
export const HiringPipelineModule: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser, users }) => {
  const founder = !!currentUser.isCompanyAdmin || hasAnyPerm(currentUser.perms, ['req.founder_decide']);
  const seeDash = founder || hasAnyPerm(currentUser.perms, ['hrbp.view', 'hrbp.manage']);
  const [tab, setTab] = useState<Tab>('candidates');
  const [flow, setFlow] = useState<FlowState | null>(null);
  const loadFlow = () => { flowService.state().then((r) => setFlow(r as any)).catch(() => undefined); };
  useEffect(loadFlow, []);
  const stuck = flow?.counts?.STUCK || 0;
  const [reqs, setReqs] = useState<Requisition[]>([]);
  useEffect(() => subscribeToRequisitions(setReqs), []);
  return (
    <div className="flex-1 min-w-0 space-y-4 overflow-y-auto p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Talent Acquisition - Hiring pipeline</h1>
        <p className="text-xs text-slate-500 sm:text-sm">From candidate to offer: score, screen, test, interview and collect blind feedback.</p>
      </div>
      <div className="overflow-x-auto">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: 'tasks', label: `My tasks${flow?.myOpen ? ` (${flow.myOpen})` : ''}` }, { value: 'flow', label: 'Hiring flow' }, { value: 'flowRuns', label: `Who is where${stuck ? ` (${stuck} need you)` : ''}` },
          { value: 'candidates', label: 'Candidates' }, { value: 'interviews', label: 'Interviews' }, { value: 'postings', label: 'Job postings' },
          { value: 'jd', label: 'JD library' }, { value: 'referrals', label: 'Referrals' }, { value: 'scoring', label: 'Scoring' },
          { value: 'offers', label: 'Offers' }, { value: 'joining', label: 'Joining' }, { value: 'ai', label: 'AI & duplicates' },
          ...(seeDash ? [{ value: 'dashboard' as Tab, label: 'Founder dashboard' }] : []),
        ]} />
      </div>
      {tab === 'tasks' && <FlowTasks onOpenTab={(t) => setTab(t as Tab)} onChanged={loadFlow} />}
      {tab === 'flow' && <FlowBuilder onChanged={loadFlow} />}
      {tab === 'flowRuns' && <FlowRuns people={flow?.people || []} onChanged={loadFlow} />}
      {tab === 'candidates' && <CandidatesTab users={users} />}
      {tab === 'interviews' && <InterviewsTab />}
      {tab === 'postings' && <PostingsTab requisitions={reqs} />}
      {tab === 'jd' && <JdLibraryTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'scoring' && <ScoringTab />}
      {tab === 'offers' && <OffersTab canApprove={founder} />}
      {tab === 'joining' && <JoiningTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'dashboard' && seeDash && <DashboardTab />}
    </div>
  );
};
