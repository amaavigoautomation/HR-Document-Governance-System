import React, { useState } from 'react';
import { CalendarDays, Link2, Mail, Phone, Send, User, Users } from 'lucide-react';
import { pipelineService } from '../../services/pipelineService';
import { Card, EmptyState, Notice, useRunner } from '../leave/ui';
import { Loading, useLoad } from '../common/loadUi';
import { Avatar } from '../home/parts';

const stageClass = (s: string) =>
  s === 'Selected' ? 'bg-emerald-50 text-emerald-700'
  : s === 'Rejected' ? 'bg-rose-50 text-rose-700'
  : s === 'On Hold' ? 'bg-amber-50 text-amber-700'
  : /interview/i.test(s) ? 'bg-violet-50 text-violet-700'
  : /offer/i.test(s) ? 'bg-amber-50 text-amber-700'
  : 'bg-sky-50 text-sky-700';

const shortDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (IST)';

const box = 'flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-[#FA7014] focus-within:ring-2 focus-within:ring-[#FA7014]/20';
const bare = 'min-w-0 flex-1 bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400';
const Label: React.FC<{ text: string; required?: boolean; children: React.ReactNode }> = ({ text, required, children }) => (
  <label className="block space-y-1.5">
    <span className="text-sm font-bold text-slate-900">{text}{required && <span className="text-rose-500"> *</span>}</span>
    {children}
  </label>
);

const empty = { requisitionId: '', name: '', email: '', mobile: '', resumeUrl: '', note: '' };

/** Open jobs and a referral form for any employee, plus the status of the people they referred (stage only). */
export const ReferralsTab: React.FC<{ onOpenInterviews?: () => void }> = ({ onOpenInterviews }) => {
  const jobs = useLoad(() => pipelineService.refJobs(), []);
  const mine = useLoad(() => pipelineService.refList(), []);
  const ivs = useLoad(() => pipelineService.interviews(), []);
  const [f, setF] = useState(empty);
  const { run, busy, note } = useRunner();
  const open: any[] = jobs.data?.jobs || [];
  const items: any[] = mine.data?.items || [];
  const upcoming: any[] = ((ivs.data?.items || []) as any[])
    .filter((i) => i.status === 'SCHEDULED' && (i.iAmOnPanel || i.iAmGuest))
    .sort((a, b) => String(a.startIso).localeCompare(String(b.startIso)))
    .slice(0, 3);

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#F36B21]"><Users className="h-6 w-6" /></span>
          <div><h2 className="text-xl font-bold text-slate-950">Refer a candidate</h2><p className="text-sm text-slate-600">Know someone great? Refer them for an open role.</p></div>
        </div>
        <Loading error={jobs.error} loading={jobs.loading} />
        {!jobs.loading && open.length === 0 && <EmptyState title="No open jobs right now" text="Check back soon." />}
        {open.length > 0 && (
          <div className="space-y-4">
            {note && <Notice tone={note.tone}>{note.text}</Notice>}
            <Label text="Candidate name" required><div className={box}><User className="h-4 w-4 text-slate-500" /><input className={bare} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Their full name" /></div></Label>
            <div className="grid gap-4 md:grid-cols-2">
              <Label text="Email" required><div className={box}><Mail className="h-4 w-4 text-slate-500" /><input className={bare} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" /></div></Label>
              <Label text="Phone"><div className={box}><Phone className="h-4 w-4 text-slate-500" /><input className={bare} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="+91 98765 43210" /></div></Label>
            </div>
            <Label text="Open role" required>
              <div className={box}>
                <select className={`${bare} cursor-pointer`} value={f.requisitionId} onChange={(e) => setF({ ...f, requisitionId: e.target.value })}>
                  <option value="">Select an open role</option>
                  {open.map((j) => <option key={j.id} value={j.id}>{j.positionTitle} - {j.departmentName}{j.location ? ` - ${j.location}` : ''}</option>)}
                </select>
              </div>
            </Label>
            <Label text="Resume link"><div className={box}><Link2 className="h-4 w-4 text-slate-500" /><input className={bare} value={f.resumeUrl} onChange={(e) => setF({ ...f, resumeUrl: e.target.value })} placeholder="Paste resume link (Google Drive, LinkedIn, etc.)" /></div></Label>
            <Label text="Why are they a good fit?"><div className={`${box} items-start`}><textarea className={`${bare} resize-none`} rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div></Label>
            <button type="button" disabled={busy || !f.requisitionId} onClick={() => run(async () => { await pipelineService.refSubmit(f); setF(empty); await mine.reload(); }, 'Thank you. The referral has been sent to HR.')} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F36B21] text-base font-bold text-white hover:bg-[#df5d18] disabled:opacity-50 cursor-pointer"><Send className="h-4 w-4" />Submit referral</button>
          </div>
        )}
      </section>

      <div className="space-y-4">
        <Card title={mine.data?.all ? 'All referrals' : 'My referrals'} subtitle="You see the stage only; interview notes stay private.">
          <Loading error={mine.error} loading={mine.loading} />
          {!mine.loading && items.length === 0 && <EmptyState title="No referrals yet" />}
          <div className="divide-y divide-slate-100">
            {items.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.candidateName} />
                  <div className="min-w-0"><div className="truncate text-sm font-bold text-slate-900">{r.candidateName}</div><div className="truncate text-xs text-slate-500">{r.positionTitle}{r.createdAt ? ` · ${shortDate(r.createdAt)}` : ''}{mine.data?.all ? ` · by ${r.referrerName}` : ''}</div></div>
                </div>
                <span className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold ${stageClass(r.stage)}`}>{r.stage}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title={<>My interviews <span className="text-sm font-normal text-slate-600">(upcoming)</span></>} right={onOpenInterviews && <button type="button" onClick={onOpenInterviews} className="text-sm font-bold text-[#F36B21] hover:underline cursor-pointer">View all →</button>}>
          {!ivs.loading && upcoming.length === 0 && <p className="py-2 text-sm text-slate-500">Interviews you are asked to take will show here.</p>}
          <div className="divide-y divide-slate-100">
            {upcoming.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#F36B21]"><CalendarDays className="h-5 w-5" /></span>
                  <div className="min-w-0"><div className="truncate text-sm font-bold text-slate-900">{i.positionTitle} – {i.round}</div><div className="truncate text-xs text-slate-600">Candidate: {i.candidateName}</div><div className="text-xs text-slate-600">{when(i.startIso)}</div></div>
                </div>
                {onOpenInterviews && <button type="button" onClick={onOpenInterviews} className="shrink-0 rounded-lg border border-[#F36B21] px-3 py-2 text-xs font-bold text-[#F36B21] hover:bg-orange-50 cursor-pointer">{!i.iSubmitted ? 'Give feedback' : 'View'}</button>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
