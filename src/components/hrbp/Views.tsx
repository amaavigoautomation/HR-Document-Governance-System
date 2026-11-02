import React from 'react';
import { hrbpService } from '../../services/hrbpService';
import { Card, EmptyState, Notice } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'red' | 'amber' | 'green'; sub?: string }> = ({ label, value, tone, sub }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`text-2xl font-black ${tone === 'red' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
  </div>
);

/** Leadership dashboard: one screen for the whole people picture. */
export const DashboardView: React.FC = () => {
  const d = useLoad(() => hrbpService.get('dash'), []);
  const x = d.data;
  return (
    <div className="space-y-4">
      <Loading error={d.error} loading={d.loading} />
      {x && (
        <>
          {x.attention.length > 0 && <Notice tone="warn">Needs attention: {x.attention.join(' - ')}.</Notice>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Headcount" value={x.headcount.headcount} sub={`${x.headcount.billable} billable - ${x.headcount.openVacancies} open vacancies`} />
            <Stat label="Over-allocated" value={x.resource.over} tone={x.resource.over ? 'red' : 'green'} sub={`${x.resource.bench} on bench`} />
            <Stat label="KPIs this quarter" value={`${x.kpi.green}/${x.kpi.green + x.kpi.amber + x.kpi.red}`} tone={x.kpi.red ? 'red' : 'green'} sub={`${x.kpi.red} red - ${x.kpi.amber} amber`} />
            <Stat label="Active PIPs" value={x.pip.active} tone={x.pip.active ? 'amber' : undefined} sub={`${x.pip.draft} in draft`} />
            <Stat label="Flight risk (HIGH)" value={x.talent.highRisk} tone={x.talent.highRisk ? 'red' : 'green'} sub={`${x.talent.reviewed} reviewed in ${x.quarter}`} />
            <Stat label="Retention plans open" value={x.retention.open} sub={`${x.retention.highRisk} high risk`} />
            <Stat label="Critical roles uncovered" value={x.succession.withoutSuccessor} tone={x.succession.withoutSuccessor ? 'red' : 'green'} sub={`of ${x.succession.criticalRoles} critical roles`} />
            <Stat label="Certificates" value={x.certs.expired} tone={x.certs.expired ? 'red' : 'green'} sub={`expired - ${x.certs.expiring} expiring soon`} />
          </div>
          <Card title="Employee pulse">
            {x.pulse ? <div className="text-sm text-slate-700">{x.pulse.title}: {x.pulse.participation.percent}% took part ({x.pulse.participation.responses} of {x.pulse.participation.people}). {x.pulse.hidden ? 'Results stay hidden until at least 5 people answer.' : `Overall score ${x.pulse.overall} out of 5.`}</div> : <EmptyState title="No survey yet" text="Run a pulse survey from the Pulse surveys section." />}
            <div className="mt-2 text-xs text-slate-500">{x.recognitionLast30} recognitions given in the last 30 days.</div>
          </Card>
        </>
      )}
    </div>
  );
};

/** Org structure, headcount against approved numbers, and resource planning (computed from the mappings). */
export const OrgView: React.FC = () => {
  const org = useLoad(() => hrbpService.get('org'), []);
  const head = useLoad(() => hrbpService.get('headcount'), []);
  const res = useLoad(() => hrbpService.get('resource'), []);
  return (
    <div className="space-y-4">
      <Card title="Business units" subtitle="Built from the people mapping.">
        <Loading error={org.error} loading={org.loading} />
        {org.data && org.data.unmapped > 0 && <Notice tone="warn">{org.data.unmapped} employee(s) are not mapped yet. Open People mapping to assign their business unit and HRBP.</Notice>}
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {(org.data?.units || []).map((u: any) => (
            <div key={u.name} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-800">{u.name}</span><Pill tone="blue">{u.people} people</Pill></div>
              <div className="text-slate-500">{u.head ? `Head: ${u.head} - ` : ''}{u.billable} billable{u.hrbps.length ? ` - HRBP: ${u.hrbps.join(', ')}` : ''}</div>
              <div className="mt-1 text-slate-600">{Object.entries(u.departments).map(([k, v]) => `${k} ${v}`).join(' - ')}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Headcount against approved numbers" subtitle="Approved numbers come from Hiring budgets. Gap = approved - people now - open vacancies.">
        <Loading error={head.error} loading={head.loading} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] font-bold uppercase text-slate-500"><tr><th className="py-1 pr-3">Department</th><th className="pr-3">Now</th><th className="pr-3">Billable</th><th className="pr-3">Approved</th><th className="pr-3">Open</th><th>Gap</th></tr></thead>
            <tbody>{(head.data?.rows || []).map((r: any) => (
              <tr key={r.department} className="border-t border-slate-100"><td className="py-1.5 pr-3 font-semibold text-slate-800">{r.department}</td><td className="pr-3">{r.headcount}</td><td className="pr-3">{r.billable}</td><td className="pr-3">{r.approved ?? '-'}</td><td className="pr-3">{r.openVacancies}</td><td className={r.gap !== null && r.gap < 0 ? 'font-bold text-rose-600' : ''}>{r.gap ?? '-'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Resource planning" subtitle="Billable people against client work.">
        <Loading error={res.error} loading={res.loading} />
        {res.data && (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs"><Pill tone="red">{res.data.summary.over} over 100%</Pill><Pill tone="green">{res.data.summary.full} fully booked</Pill><Pill tone="amber">{res.data.summary.partial} partly booked</Pill><Pill tone="slate">{res.data.summary.bench} on bench</Pill><Pill tone="slate">{res.data.summary.nonBillable} non-billable</Pill></div>
            <div className="grid gap-4 md:grid-cols-2">
              <div><div className="mb-1 text-xs font-bold text-slate-700">Needs attention</div>{[...res.data.over, ...res.data.bench].map((p: any) => <div key={p.employeeUid} className="flex justify-between border-b border-slate-100 py-1 text-xs"><span>{p.name}</span><span className={p.state === 'OVER' ? 'font-bold text-rose-600' : 'text-slate-500'}>{p.state === 'OVER' ? `${p.total}% allocated` : 'bench'}</span></div>)}{res.data.over.length + res.data.bench.length === 0 && <div className="text-xs text-slate-500">Everyone is balanced.</div>}</div>
              <div><div className="mb-1 text-xs font-bold text-slate-700">People per client (full-time equivalents)</div>{res.data.clients.map((c: any) => <div key={c.client} className="flex justify-between border-b border-slate-100 py-1 text-xs"><span>{c.client}</span><span className="font-semibold">{c.fte}</span></div>)}</div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};
