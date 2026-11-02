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

type Tab = 'candidates' | 'interviews' | 'postings' | 'jd' | 'referrals' | 'scoring';

/** Hiring pipeline for HR: candidates (score, screening, tests, interviews), interviews, posting tracker, JD library, referrals, scoring weights. */
export const HiringPipelineModule: React.FC<{ currentUser: User; users: User[] }> = ({ users }) => {
  const [tab, setTab] = useState<Tab>('candidates');
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
          { value: 'candidates', label: 'Candidates' }, { value: 'interviews', label: 'Interviews' }, { value: 'postings', label: 'Job postings' },
          { value: 'jd', label: 'JD library' }, { value: 'referrals', label: 'Referrals' }, { value: 'scoring', label: 'Scoring' },
        ]} />
      </div>
      {tab === 'candidates' && <CandidatesTab users={users} />}
      {tab === 'interviews' && <InterviewsTab />}
      {tab === 'postings' && <PostingsTab requisitions={reqs} />}
      {tab === 'jd' && <JdLibraryTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'scoring' && <ScoringTab />}
    </div>
  );
};
