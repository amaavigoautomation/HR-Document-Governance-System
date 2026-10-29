import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { perfService } from '../../services/perfService';
import { MOODS } from '../../../shared/home';
import { MOOD_MIN_GROUP } from '../../../shared/mood';
import { Card, Notice, Segmented, btnGhost, niceDate, shortDate, useRunner } from '../leave/ui';
import { Loading, useLoad } from './shared';

const EMOJI: Record<string, string> = Object.fromEntries(MOODS.map((m) => [m.value, m.emoji]));
const LABEL: Record<string, string> = Object.fromEntries(MOODS.map((m) => [m.value, m.label]));
const ORDER = ['UNHAPPY', 'SAD', 'OK', 'SATISFIED', 'EXCITED'];

/** Average on a 1-5 scale to the closest face. */
const face = (avg: number | null) => (avg == null ? '' : EMOJI[ORDER[Math.min(4, Math.max(0, Math.round(avg) - 1))]]);

const Counts: React.FC<{ counts: Record<string, number> | null }> = ({ counts }) => (
  <div className="flex flex-wrap gap-3 text-sm">
    {ORDER.map((m) => <span key={m} title={LABEL[m]} className="inline-flex items-center gap-1"><span className="text-lg">{EMOJI[m]}</span><strong>{counts?.[m] ?? 0}</strong></span>)}
  </div>
);

const Hidden: React.FC = () => <p className="text-sm text-slate-500">Not enough responses to show a result. Results appear once at least {MOOD_MIN_GROUP} different people have answered, so nobody can be picked out.</p>;

/** Daily average as simple bars. Days with fewer than the minimum people are left blank on purpose. */
const Trend: React.FC<{ series: any[] }> = ({ series }) => (
  <div>
    <div className="flex items-end gap-0.5 h-32" role="img" aria-label="Average mood per day">
      {series.map((d) => {
        const h = d.hidden || d.average == null ? 0 : (d.average / 5) * 100;
        return (
          <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={d.hidden || d.average == null ? `${niceDate(d.date)}: not enough responses` : `${niceDate(d.date)}: ${d.average.toFixed(1)} of 5 (${d.responses} answers)`}>
            {h > 0 ? <div className="rounded-t bg-[#FA7014]/80" style={{ height: `${h}%` }} /> : <div className="border-t border-dashed border-slate-300" />}
          </div>
        );
      })}
    </div>
    <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>{series.length ? shortDate(series[0].date) : ''}</span><span>1 = unhappy · 5 = excited</span><span>{series.length ? shortDate(series[series.length - 1].date) : ''}</span></div>
  </div>
);

function csv(report: any, days: number) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Date', 'Answers', 'People', 'Average (1-5)', ...ORDER.map((m) => LABEL[m])].map(q).join(',')];
  for (const d of report.series) lines.push([d.date, d.hidden ? '' : d.responses, d.hidden ? 'fewer than 3' : '', d.hidden || d.average == null ? '' : d.average.toFixed(2), ...ORDER.map((m) => (d.hidden ? '' : d.counts?.[m] ?? 0))].map(q).join(','));
  lines.push('', ['Department', 'People', 'Answers', 'Average (1-5)'].map(q).join(','));
  for (const d of report.departments) lines.push([d.department, d.hidden ? 'fewer than 3' : d.people, d.hidden ? '' : d.responses, d.hidden || d.average == null ? '' : d.average.toFixed(2)].map(q).join(','));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `moodometer-last-${days}-days.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const Mine: React.FC = () => {
  const mine = useLoad(() => perfService.moodMe(), []);
  const { run, busy, note } = useRunner();
  const d = mine.data;
  return (
    <Card title="How are you today?" subtitle="Optional. Your answer is private: HR and managers only ever see combined results for groups of 3 or more people. It is never used in ratings or reviews.">
      <Loading loading={mine.loading && !d} error={mine.error} />
      {d && (
        <>
          <div className="flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <button key={m.value} disabled={busy} onClick={() => run(async () => { await perfService.saveMood(m.value); await mine.reload(); })} aria-pressed={d.today === m.value}
                className={`flex flex-col items-center px-3 py-2 rounded-xl border text-xs font-bold min-w-[72px] transition-colors ${d.today === m.value ? 'border-[#FA7014] bg-orange-50 text-[#FA7014]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <span className="text-2xl">{m.emoji}</span>{m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">{d.today ? 'You can change your answer until midnight.' : 'One answer a day.'}</p>
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          {d.history.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-1.5">Your last 30 days</h4>
              <div className="flex flex-wrap gap-1.5">{d.history.map((h: any) => <span key={h.date} title={`${niceDate(h.date)}: ${LABEL[h.mood] || h.mood}`} className="text-xl">{EMOJI[h.mood]}</span>)}</div>
            </div>
          )}
        </>
      )}
    </Card>
  );
};

const Report: React.FC<{ scope: 'team' | 'company' }> = ({ scope }) => {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const r = useLoad(() => perfService.moodReport(Number(days), scope), [days, scope]);
  const rep = r.data?.report;
  return (
    <Card title={scope === 'team' ? 'My team’s mood' : 'Moodometer'} subtitle={scope === 'team' ? 'Combined result for your direct reports. Individuals are never shown.' : 'Voluntary, self-reported and anonymous. Groups under 3 people are hidden.'}
      right={<div className="flex items-center gap-2"><Segmented size="sm" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />{rep && scope === 'company' && <button className={btnGhost} onClick={() => csv(rep, Number(days))}><Download className="w-3.5 h-3.5" />CSV</button>}</div>}>
      <Loading loading={r.loading && !rep} error={r.error} />
      {rep && (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-4 mb-2">
              {!rep.overall.hidden && <span className="text-3xl">{face(rep.overall.average)} <span className="text-lg font-bold text-slate-700">{rep.overall.average.toFixed(1)}<span className="text-xs text-slate-400"> / 5</span></span></span>}
              <span className="text-sm text-slate-600">{rep.participation.responders} of {rep.participation.active} people answered ({rep.participation.percent}%)</span>
            </div>
            {rep.overall.hidden ? <Hidden /> : <Counts counts={rep.overall.counts} />}
          </div>
          {!rep.overall.hidden && <Trend series={rep.series} />}
          {scope === 'company' && rep.departments.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-1.5">By department</h4>
              <ul className="divide-y divide-slate-100">
                {rep.departments.map((d: any) => (
                  <li key={d.department} className="py-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-slate-700">{d.department}</span>
                    {d.hidden ? <span className="text-xs text-slate-400">fewer than {MOOD_MIN_GROUP} people answered</span> : <span className="inline-flex items-center gap-2"><span className="text-xl">{face(d.average)}</span><strong>{d.average.toFixed(1)}</strong><span className="text-xs text-slate-400">{d.people} people</span></span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

export const MoodTab: React.FC<{ me: any }> = ({ me }) => (
  <div className="space-y-4">
    <Mine />
    {me?.isManager && <Report scope="team" />}
    {(me?.canManage || me?.canApprove || me?.canView) && <Report scope="company" />}
  </div>
);
