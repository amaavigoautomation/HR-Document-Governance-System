import React from 'react';
import { dashService } from '../../services/hiringExtraService';
import { Card, Notice } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-black text-slate-900">{value}</div>{hint && <div className="text-[11px] text-slate-500">{hint}</div>}</div>
);
const Bar: React.FC<{ label: string; value: number; max: number; suffix?: string }> = ({ label, value, max, suffix = '' }) => (
  <div className="flex items-center gap-2 text-xs"><div className="w-32 truncate text-slate-700">{label}</div><div className="h-3 flex-1 rounded bg-slate-100"><div className="h-3 rounded bg-[#FA7014]" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} /></div><div className="w-20 text-right font-bold text-slate-800">{value}{suffix}</div></div>
);
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`;

/** Founder hiring dashboard: vacancies, pipeline, time to hire, offers, cost, joinings, budget, sources, attrition. */
export const DashboardTab: React.FC = () => {
  const d = useLoad(() => dashService.dashboard(), []);
  const ins = useLoad(() => dashService.insights(), []);
  const x = d.data?.dashboard;
  return (
    <div className="space-y-4">
      <Loading error={d.error} loading={d.loading} />
      {ins.data && (
        <Card title="What the numbers say" subtitle={ins.data.generatedBy === 'AI' ? 'Written by AI from the numbers below' : 'Rule-based reading of the numbers below'}>
          {ins.data.narrative && <p className="mb-2 text-sm text-slate-700">{ins.data.narrative}</p>}
          <ul className="space-y-1 text-sm">{(ins.data.insights || []).map((i: any, k: number) => <li key={k}><Pill tone={i.tone === 'good' ? 'green' : i.tone === 'warn' ? 'amber' : 'blue'}>{i.tone}</Pill> {i.text}</li>)}</ul>
          {ins.data.note && <p className="mt-1 text-[11px] text-slate-400">{ins.data.note}</p>}
        </Card>
      )}
      {x && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Open positions" value={x.positions.open} hint={`${x.positions.openVacancies} vacancies, ${x.positions.pendingApproval} awaiting approval`} />
            <Stat label="Time to hire" value={x.timeToHire.averageDays === null ? '-' : `${x.timeToHire.averageDays} d`} hint={`from founder approval to offer accepted (${x.timeToHire.sample} hires)`} />
            <Stat label="Offer acceptance" value={x.offers.acceptanceRate === null ? '-' : `${x.offers.acceptanceRate}%`} hint={`${x.offers.answered} answered offers`} />
            <Stat label="Cost per hire" value={x.costs.perHire === null ? '-' : rs(x.costs.perHire)} hint={`${rs(x.costs.total)} over ${x.costs.hires} hires`} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Pipeline">{x.pipeline.map((p: any) => <Bar key={p.stage} label={p.stage} value={p.count} max={Math.max(1, ...x.pipeline.map((q: any) => q.count))} />)}</Card>
            <Card title="Vacancies by department">{x.vacanciesByDepartment.length === 0 ? <p className="text-xs text-slate-500">No open vacancies.</p> : x.vacanciesByDepartment.map((v: any) => <Bar key={v.department} label={v.department} value={v.vacancies} max={Math.max(1, ...x.vacanciesByDepartment.map((q: any) => q.vacancies))} />)}</Card>
            <Card title="Upcoming joinings" subtitle={`${x.upcomingJoinings.next30Days} in the next 30 days`}>
              {x.upcomingJoinings.list.length === 0 ? <p className="text-xs text-slate-500">None scheduled.</p> : <ul className="space-y-1 text-sm">{x.upcomingJoinings.list.map((j: any, i: number) => <li key={i}>{j.candidateName} - {j.designation} - {j.joiningDate} ({j.daysAway} d)</li>)}</ul>}
            </Card>
            <Card title="Budget vs actual (CTC, LPA)" subtitle="Budget = vacancies x the job's maximum CTC. Actual = accepted offers.">
              {x.budgetVsActual.length === 0 ? <p className="text-xs text-slate-500">No approved jobs yet.</p> : <table className="w-full text-xs"><tbody>{x.budgetVsActual.map((b: any) => <tr key={b.department} className="border-t border-slate-100"><td className="py-1">{b.department}</td><td>{b.budgetedLpa}</td><td>{b.actualLpa}</td><td className={b.varianceLpa < 0 ? 'font-bold text-rose-600' : 'text-emerald-700'}>{b.varianceLpa >= 0 ? '+' : ''}{b.varianceLpa}</td></tr>)}</tbody></table>}
            </Card>
            <Card title="Where hires come from">
              <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th>Source</th><th>Applicants</th><th>Hires</th><th>Conversion</th></tr></thead><tbody>{x.sources.map((s: any) => <tr key={s.source} className="border-t border-slate-100"><td className="py-1">{s.source}</td><td>{s.applications}</td><td>{s.hires}</td><td>{s.conversionPct === null ? '-' : `${s.conversionPct}%`}</td></tr>)}</tbody></table>
            </Card>
            <Card title="Hiring cost by type">{x.costs.byCategory.length === 0 ? <p className="text-xs text-slate-500">No costs logged. Add them in the Offers tab.</p> : x.costs.byCategory.map((c: any) => <Bar key={c.category} label={c.category.replace('_', ' ').toLowerCase()} value={c.amount} max={Math.max(1, ...x.costs.byCategory.map((q: any) => q.amount))} />)}</Card>
            <Card title="Attrition" subtitle={`${x.attrition.exits12m} exits in 12 months${x.attrition.ratePct === null ? '' : ` - ${x.attrition.ratePct}% of ${x.attrition.headcount} people`}`}>
              {x.attrition.byMonth.map((m: any) => <Bar key={m.month} label={m.month} value={m.exits} max={Math.max(1, ...x.attrition.byMonth.map((q: any) => q.exits))} />)}
            </Card>
          </div>
          <Notice tone="info">Time to hire runs from the founder approving the job to the candidate accepting. Cost per hire is all logged hiring costs divided by hires.</Notice>
        </>
      )}
    </div>
  );
};
