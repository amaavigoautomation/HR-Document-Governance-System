import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, Pill } from '../common/loadUi';
import { Card, Field, Notice, btnBig, btnDanger, btnGhost, btnPrimary, input, useRunner, ConfirmButton } from '../leave/ui';
import { Empty, Explain, Intro, ResultNote } from './common';

/** What each step of the last run did, in a sentence a person can read. */
const sayStep = (name: string, v: any): string => {
  if (v === undefined || v === null) return 'Did not run.';
  if (v.error) return `Problem: ${v.error}`;
  if (v.skipped) return v.skipped === 'Off' ? 'Switched off.' : String(v.skipped);
  switch (name) {
    case 'feeds': { const k = Object.keys(v); return k.length ? k.map((x) => `${x}: ${v[x]}`).join(' | ') : 'No feeds to read.'; }
    case 'attendance': return `${v.stored || 0} attendance item(s) written or updated for ${v.people || 0} people, ${v.unchanged || 0} unchanged.`;
    case 'openCycles': { const k = Object.keys(v); return k.length ? k.map((x) => `${x}: ${v[x]}`).join(' | ') : 'No cycle was due.'; }
    case 'packs': return `${v.sent || 0} review pack note(s) sent to managers.`;
    case 'publish': return `${v.published || 0} approved review(s) shared with employees.`;
    case 'lock': return `${v.locked || 0} finished cycle(s) locked.`;
    default: return JSON.stringify(v);
  }
};
const STEP_LABEL: Record<string, string> = { feeds: 'Evidence feeds', attendance: 'Attendance as evidence', openCycles: 'Open due cycles', packs: 'Review packs for managers', publish: 'Share approved reviews', lock: 'Lock finished cycles' };

const Switch: React.FC<{ on: boolean; set: (v: boolean) => void; title: string; text: string; children?: React.ReactNode }> = ({ on, set, title, text, children }) => (
  <div className="border border-slate-200 rounded-xl p-3 bg-white">
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" className="mt-1 w-4 h-4" checked={on} onChange={(e) => set(e.target.checked)} />
      <span><span className="block text-sm font-bold text-slate-800">{title} {on ? <Pill tone="green">on</Pill> : <Pill tone="slate">off</Pill>}</span><span className="block text-xs text-slate-600 mt-0.5">{text}</span></span>
    </label>
    {on && children && <div className="mt-3 pl-7">{children}</div>}
  </div>
);

export const Autopilot: React.FC = () => {
  const [d, setD] = useState<any>(null); const [tick, setTick] = useState(0); const [s, setS] = useState<any>(null); const { busy, note, run } = useRunner();
  const [feed, setFeed] = useState<{ id?: string; name: string; url: string } | null>(null); const [ran, setRan] = useState<any>(null);
  useEffect(() => { pmService.get('auto-get').then((r) => { setD(r); setS(r.settings); }); }, [tick]);
  if (!d || !s) return <Loading loading />;
  const set = (p: any) => setS({ ...s, ...p });
  const save = (extra: any = {}) => run(async () => { const r = await pmService.post('auto-save', { ...s, ...extra }); setS(r.settings); setTick((t) => t + 1); }, 'Saved.');
  const last = d.settings.lastRun;
  return (
    <div className="space-y-4">
      <Intro title="Autopilot" what="Turn on the routine work you no longer want to do by hand. Everything here is optional and starts switched off. Nobody is ever rated by the autopilot: managers rate, HR checks, approvers approve." todo="Tick what you want, press Save, then press Run now to see it work. After that it runs by itself every day." />
      <ResultNote note={note} />

      <Card title="Cycles and reviews" subtitle="These save HR the clicking.">
        <div className="space-y-3">
          <Switch on={s.autoOpen} set={(v) => set({ autoOpen: v })} title="Open review cycles on their date" text={`Set an "open on" date when you create a cycle (Review cycles). On that day everyone covered gets their review and a message.${d.waitingCycles.length ? ` Waiting now: ${d.waitingCycles.map((c: any) => `${c.name} (${c.autoOpenOn})`).join(', ')}.` : ''}`} />
          <Switch on={s.autoPublish} set={(v) => set({ autoPublish: v })} title="Share approved reviews with employees" text="After an approver approves a review, it is shared with the employee automatically. The short wait gives the approver time to amend.">
            <Field label="Wait this many days after approval"><input type="number" min={0} max={14} className={`${input} w-24`} value={s.publishDelayDays} onChange={(e) => set({ publishDelayDays: e.target.value })} /></Field>
          </Switch>
          <Switch on={s.autoLock} set={(v) => set({ autoLock: v })} title="Lock a cycle when everyone has answered" text="Only when every review in the cycle is acknowledged. A deferred, disputed or unanswered review always waits for a person." />
          <Switch on={s.sendPacks} set={(v) => set({ sendPacks: v })} title="Send managers a review pack" text="When an employee submits their self-assessment, the manager gets a short note: evidence found, gaps, check-ins. The full pack and a draft of talking points are on the review screen." />
        </div>
      </Card>

      <Card title="Evidence made for you" subtitle="So nobody has to type or upload it.">
        <div className="space-y-3">
          <Switch on={s.attendanceEvidence} set={(v) => set({ attendanceEvidence: v })} title="Use attendance as evidence" text="Last month's and this month's attendance (days present, late, absent, on leave) is added as evidence, only for people whose targets include the KPI named below. It is information for the manager. It is never a rating.">
            <Field label="Name of the KPI (type it exactly as in 'KRA/KPI by role')"><input className={input} placeholder="Attendance & punctuality" value={s.attendanceKpiName} onChange={(e) => set({ attendanceKpiName: e.target.value })} /></Field>
          </Switch>
        </div>
        <div className="mt-4">
          <div className="text-sm font-bold text-slate-800">Evidence feeds</div>
          <p className="text-xs text-slate-600 mb-2">A feed is a link to a CSV file that is read every day, for example a Google Sheet your team already fills in (share it as "anyone with the link can view"). Columns: <b>employee_email</b>, <b>title</b>, and a <b>task_id</b> or <b>link</b>; optional <b>completed_on</b>, <b>kpi</b>, <b>quality</b>, <b>rework</b>. Rows are matched to a KPI by name. Rows that cannot be matched wait in the manager's queue.</p>
          {d.feeds.length === 0 && <Empty text="No feeds yet." />}
          <div className="space-y-2">{d.feeds.map((f: any) => (
            <div key={f.id} className="border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><div className="text-sm font-bold">{f.name}</div><div className="text-xs text-slate-500 truncate max-w-md">{f.url}</div>
                {f.lastRunAt && <div className={`text-xs mt-0.5 ${String(f.lastResult).startsWith('Problem') ? 'text-rose-700' : 'text-slate-600'}`}>Last read {String(f.lastRunAt).slice(0, 16).replace('T', ' ')}: {f.lastResult}</div>}</div>
              <div className="flex gap-2">
                <button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await pmService.post('feed-run', { id: f.id }); setRan(r.message); setTick((t) => t + 1); }, 'Read the feed.')}><Play className="w-4 h-4" />Read now</button>
                <button className={btnGhost} onClick={() => setFeed({ id: f.id, name: f.name, url: f.url })}>Edit</button>
                <ConfirmButton className={btnDanger} question="Remove this feed? Evidence already read stays." yes="Remove" onConfirm={() => run(async () => { await pmService.post('feed-delete', { id: f.id }); setTick((t) => t + 1); })}><Trash2 className="w-4 h-4" /></ConfirmButton>
              </div>
            </div>))}</div>
          {ran && <Notice tone="ok">{ran}</Notice>}
          {!feed ? <button className={`${btnPrimary} mt-3`} onClick={() => setFeed({ name: '', url: '' })}><Plus className="w-4 h-4" />Add a feed</button> : (
            <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-slate-50 grid md:grid-cols-2 gap-3">
              <Field label="Name"><input className={input} placeholder="Sales sheet" value={feed.name} onChange={(e) => setFeed({ ...feed, name: e.target.value })} /></Field>
              <Field label="Link to the CSV or Google Sheet"><input className={input} placeholder="https://docs.google.com/spreadsheets/d/..." value={feed.url} onChange={(e) => setFeed({ ...feed, url: e.target.value })} /></Field>
              <div className="flex gap-2"><button className={btnBig} disabled={busy} onClick={() => run(async () => { await pmService.post('feed-save', feed); setFeed(null); setTick((t) => t + 1); }, 'Feed saved. Press "Read now" to test it.')}>Save feed</button><button className={btnGhost} onClick={() => setFeed(null)}>Cancel</button></div>
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <button className={btnBig} disabled={busy} onClick={() => save()}>Save</button>
        <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const sv = await pmService.post('auto-save', s); setS(sv.settings); const r = await pmService.post('auto-run'); setRan(null); setTick((t) => t + 1); void r; }, 'Saved and ran once.')}><Play className="w-4 h-4" />Save and run now</button>
      </div>

      <Card title="What the autopilot did last time" subtitle={last ? `${String(last.at).slice(0, 16).replace('T', ' ')} (by ${last.by})` : 'It has not run yet. It runs every day on its own.'}>
        {!last ? <Empty text="Nothing yet." /> : <ul className="space-y-1.5">{Object.keys(STEP_LABEL).map((k) => <li key={k} className="text-sm"><b className="text-slate-800">{STEP_LABEL[k]}:</b> <span className={String(sayStep(k, last.steps[k])).startsWith('Problem') ? 'text-rose-700' : 'text-slate-600'}>{sayStep(k, last.steps[k])}</span></li>)}</ul>}
      </Card>
      <Explain>
        <p>The autopilot runs once a day together with the other daily Performance jobs (set <code>CRON_SECRET</code>), and whenever you press Run now. Every step is safe to run twice, and every change is on the audit trail.</p>
        <p>It never rates anyone, never decides pay or promotion, and never guesses which KPI a piece of evidence belongs to. Evidence it cannot place waits for a manager.</p>
      </Explain>
    </div>
  );
};
