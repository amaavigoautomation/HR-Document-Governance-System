import React, { useState } from 'react';
import { pipelineService } from '../../services/pipelineService';
import { Card, EmptyState, Field, Notice, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

const stageTone = (s: string) => (s === 'Selected' ? 'green' : s === 'Rejected' ? 'red' : s === 'On Hold' ? 'amber' : 'blue') as 'green' | 'red' | 'amber' | 'blue';

/** Open jobs and a referral form for any employee, plus the status of the people they referred (stage only). */
export const ReferralsTab: React.FC = () => {
  const jobs = useLoad(() => pipelineService.refJobs(), []);
  const mine = useLoad(() => pipelineService.refList(), []);
  const [f, setF] = useState({ requisitionId: '', name: '', email: '', mobile: '', resumeUrl: '', note: '' });
  const { run, busy, note } = useRunner();
  const open: any[] = jobs.data?.jobs || [];
  const items: any[] = mine.data?.items || [];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Refer someone" subtitle="Know a good person for one of our open jobs? Tell us about them.">
        <Loading error={jobs.error} loading={jobs.loading} />
        {!jobs.loading && open.length === 0 && <EmptyState title="No open jobs right now" text="Check back soon." />}
        {open.length > 0 && (
          <div className="space-y-3">
            {note && <Notice tone={note.tone}>{note.text}</Notice>}
            <Field label="Job">
              <select className={input} value={f.requisitionId} onChange={(e) => setF({ ...f, requisitionId: e.target.value })}>
                <option value="">Choose a job</option>
                {open.map((j) => <option key={j.id} value={j.id}>{j.positionTitle} - {j.departmentName}{j.location ? ` - ${j.location}` : ''}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Their name"><input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Their email"><input className={input} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
              <Field label="Phone"><input className={input} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
              <Field label="Resume link (optional)"><input className={input} value={f.resumeUrl} onChange={(e) => setF({ ...f, resumeUrl: e.target.value })} placeholder="https://" /></Field>
            </div>
            <Field label="Why are they a good fit?"><textarea className={input} rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy || !f.requisitionId} onClick={() => run(async () => { await pipelineService.refSubmit(f); setF({ requisitionId: '', name: '', email: '', mobile: '', resumeUrl: '', note: '' }); await mine.reload(); }, 'Thank you. The referral has been sent to HR.')}>Send referral</button>
          </div>
        )}
      </Card>
      <Card title={mine.data?.all ? 'All referrals' : 'My referrals'} subtitle="You see the stage only; interview notes stay private.">
        <Loading error={mine.error} loading={mine.loading} />
        {!mine.loading && items.length === 0 && <EmptyState title="No referrals yet" />}
        <div className="divide-y divide-slate-100">
          {items.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <div><div className="font-bold text-slate-800">{r.candidateName}</div><div className="text-slate-500">{r.positionTitle}{mine.data?.all ? ` - referred by ${r.referrerName}` : ''}</div></div>
              <Pill tone={stageTone(r.stage)}>{r.stage}</Pill>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
