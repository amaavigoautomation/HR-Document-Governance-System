import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, EmptyState, Notice, input, niceDate, shortRange } from '../leave/ui';
import { ClipboardCheck } from 'lucide-react';
import { Loading, ReviewPill, fmtScore, useLoad } from './shared';
import { ReviewForm } from './ReviewForm';

/** Reviews for me, for my team, or for everyone (HR / approver). */
export const ReviewsTab: React.FC<{ scope: 'me' | 'team' | 'all'; me: any; onChanged: () => void }> = ({ scope, me, onChanged }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [cycleId, setCycleId] = useState('');
  const [status, setStatus] = useState('');
  const q = useLoad(() => perfService.reviews(scope, cycleId || undefined), [scope, cycleId]);
  const cycles = useLoad(() => (scope === 'all' ? perfService.cycles() : Promise.resolve({ items: [] })), [scope]);
  if (open) return <ReviewForm id={open} me={me} onBack={() => { setOpen(null); q.reload(); }} onChanged={() => { q.reload(); onChanged(); }} />;
  let items: any[] = q.data?.items || [];
  if (status) items = items.filter((r) => r.status === status);
  const title = scope === 'me' ? 'My reviews' : scope === 'team' ? 'Team reviews' : 'All reviews';
  return (
    <div className="space-y-4">
      <Card title={title} right={scope === 'all' ? (
        <div className="flex gap-2">
          <select className={`${input} !w-44`} value={cycleId} onChange={(e) => setCycleId(e.target.value)}><option value="">All cycles</option>{(cycles.data?.items || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={`${input} !w-44`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{['CONFIGURATION_PENDING', 'SELF_PENDING', 'MANAGER_PENDING', 'DISCUSSION_PENDING', 'HR_REVIEW', 'APPROVAL_PENDING', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'DEFERRED', 'CLOSED'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
        </div>) : undefined}>
        <Loading error={q.error} loading={q.loading} />
        {!q.loading && items.length === 0 && <EmptyState icon={ClipboardCheck} title="No reviews yet" text={scope === 'me' ? 'When a review cycle opens, your self-assessment will appear here.' : 'Nothing here right now.'} />}
        {items.length > 0 && (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1.5">Person</th><th>Review</th><th>Period</th><th>Status</th><th>Overall</th><th></th></tr></thead>
            <tbody>{items.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(r.id)}>
                <td className="py-2 font-semibold text-slate-800">{r.employeeName}<div className="text-[11px] font-normal text-slate-400">{r.department}</div></td>
                <td>{r.cycleName}</td><td className="text-xs text-slate-500">{shortRange(r.periodStart, r.periodEnd)}</td>
                <td><ReviewPill status={r.status} />{r.pendingReason && r.status === 'CONFIGURATION_PENDING' && <div className="text-[11px] text-rose-600 mt-0.5 max-w-[16rem]">{r.pendingReason}</div>}</td>
                <td className="font-bold">{r.overall !== null ? `${fmtScore(r.overall)}` : '–'}{r.critical > 0 && <span className="ml-1 text-[11px] text-rose-600">⚠ {r.critical}</span>}</td>
                <td className="text-xs text-slate-400">{r.status === 'SELF_PENDING' && r.selfDeadline ? `due ${niceDate(r.selfDeadline)}` : r.status === 'MANAGER_PENDING' && r.managerDeadline ? `due ${niceDate(r.managerDeadline)}` : ''}</td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
      {scope === 'me' && <Notice>Your manager's ratings and your final score appear after your review is approved and published.</Notice>}
    </div>
  );
};
