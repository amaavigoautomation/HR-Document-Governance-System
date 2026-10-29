import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, ConfirmButton, Segmented, btnGhost, input, niceDate, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from './shared';

const LABEL: Record<string, string> = {
  NO_KRA: 'No KRA/KPI', NO_MANAGER: 'No reporting manager', NO_FRAMEWORK: 'No approved framework', NO_ROLE_FAMILY: 'No role family', SOP_GAP: 'SOP gap', SOP_NOT_ACKNOWLEDGED: 'SOP not acknowledged',
  SOP_VERSION_CHANGED: 'SOP version changed', MANAGER_CHANGED: 'Manager changed', DEPARTMENT_TRANSFER: 'Department transfer', EVIDENCE_MISSING: 'Evidence unavailable', EVIDENCE_UNMAPPED: 'Unmapped task evidence',
  REVIEW_DISPUTED: 'Review disputed', REVIEW_OVERDUE: 'Review overdue', AI_UNSUPPORTED: 'AI output excluded', EXTENDED_LEAVE: 'Extended leave', DUPLICATE_EXECUTION: 'Duplicate ignored', REVIEW_AMENDED: 'Review amended',
  CONFIDENTIAL_REFERRAL: 'Confidential referral', FAIRNESS: 'Fairness check',
};

export const Governance: React.FC<{ me: any }> = ({ me }) => {
  const [tab, setTab] = useState<'exceptions' | 'audit'>('exceptions');
  const [status, setStatus] = useState('OPEN');
  const ex = useLoad(() => perfService.exceptions(status), [status]);
  const au = useLoad(() => (tab === 'audit' ? perfService.auditLog() : Promise.resolve({ items: [] })), [tab]);
  const { busy, run } = useRunner();
  const [why, setWhy] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4">
      <Segmented value={tab} onChange={setTab} options={[{ value: 'exceptions', label: 'Exceptions' }, { value: 'audit', label: 'Audit log' }]} />
      {tab === 'exceptions' && (
        <Card title="Exceptions" subtitle="Things the system would not guess about. Each one needs a person." right={<select className={`${input} !w-32`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="RESOLVED">Resolved</option></select>}>
          <Loading error={ex.error} loading={ex.loading} />
          {!ex.loading && (ex.data?.items || []).length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
          <ul className="divide-y divide-slate-100">{(ex.data?.items || []).map((e: any) => (
            <li key={e.id} className="py-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap"><Pill tone={e.severity === 'HIGH' ? 'red' : e.severity === 'MEDIUM' ? 'amber' : 'slate'}>{LABEL[e.category] || e.category}</Pill><span className="text-xs text-slate-400">{niceDate(e.createdAt.slice(0, 10))}{e.owner ? ` · ${e.owner}` : ''}</span></div>
              <p className="text-sm text-slate-700">{e.message}</p>
              {e.status === 'OPEN' && me.canManage && (
                <div className="flex gap-2"><input className={input} placeholder="How it was handled" value={why[e.id] || ''} onChange={(ev) => setWhy({ ...why, [e.id]: ev.target.value })} />
                  <ConfirmButton className={btnGhost} question="Mark resolved?" yes="Resolve" disabled={busy} onConfirm={() => run(async () => { await perfService.resolveException(e.id, why[e.id] || ''); await ex.reload(); })}>Resolve</ConfirmButton></div>)}
              {e.status === 'RESOLVED' && <p className="text-xs text-slate-400">Resolved by {e.resolvedBy}{e.resolution ? `: ${e.resolution}` : ''}</p>}
            </li>))}</ul>
        </Card>)}
      {tab === 'audit' && (
        <Card title="Audit log" subtitle="Every approval, change and calibration, with who and when. It cannot be edited.">
          <Loading error={au.error} loading={au.loading} />
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="py-1">When</th><th>Who</th><th>What</th><th>About</th></tr></thead>
            <tbody>{(au.data?.items || []).map((a: any) => <tr key={a.id} className="border-t border-slate-100"><td className="py-1.5 whitespace-nowrap">{a.at.slice(0, 16).replace('T', ' ')}</td><td>{a.actor}</td><td className="font-semibold">{a.action.toLowerCase().replace(/_/g, ' ')}</td><td className="text-slate-500">{a.entity.toLowerCase()}</td></tr>)}</tbody></table></div>
        </Card>)}
    </div>
  );
};
