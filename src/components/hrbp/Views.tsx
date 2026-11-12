import React from 'react';
import { hrbpService } from '../../services/hrbpService';
import { Card, EmptyState, Notice } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';
import { OrgChart } from './OrgChart';
import { hrbpNav } from './hrbpNav';
import { Panel } from '../leave/kit';

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

const GROUPS: { key: 'department' | 'manager' | 'company'; label: string }[] = [{ key: 'department', label: 'Department' }, { key: 'manager', label: 'Manager' }, { key: 'company', label: 'Company' }];

/** Org chart, span of control, headcount against approved numbers, and resource planning (computed from the mappings). */
export const OrgView: React.FC = () => {
  const [by, setBy] = React.useState<'department' | 'manager' | 'company'>('department');
  const org = useLoad(() => hrbpService.get('org'), []);
  const head = useLoad(() => hrbpService.get('headcount', { by }), [by]);
  const res = useLoad(() => hrbpService.get('resource'), []);
  const o = org.data;
  return (
    <div className="space-y-4">
      <Loading error={org.error} loading={org.loading} />
      {o && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="People" value={o.total} sub={`${o.tree.spans.length} managers`} />
            <Stat label="Average span of control" value={o.tree.averageSpan} sub="direct reports per manager" />
            <Stat label="Vacant positions" value={o.vacantCount} tone={o.criticalVacant ? 'red' : undefined} sub={`${o.criticalVacant} critical`} />
            <Stat label="Awaiting mapping" value={o.unmapped} tone={o.unmapped ? 'amber' : 'green'} sub="no business unit or HRBP yet" />
          </div>
          {o.awaiting.length > 0 && (
            <Panel title="Awaiting HRBP assignment" right={<button type="button" onClick={() => hrbpNav.setSection('map')} className="h-9 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 cursor-pointer">Open People mapping</button>}>
              <p className="mb-2 text-xs text-slate-600">New joiners and newly confirmed employees land here until HR assigns their business unit, cost centre and HRBP.</p>
              <ul className="grid gap-2 md:grid-cols-2">
                {o.awaiting.slice(0, 12).map((a: any) => (
                  <li key={a.uid} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <span><b className="text-slate-900">{a.name}</b><span className="block text-xs text-slate-600">{a.department || 'No department'}</span></span>
                    <Pill tone={a.reason === 'DRAFT' ? 'amber' : 'slate'}>{a.reason === 'DRAFT' ? `${(a.status || 'new').toLowerCase()} - draft ready` : 'not mapped'}</Pill>
                  </li>
                ))}
              </ul>
              {o.awaiting.length > 12 && <p className="mt-2 text-xs text-slate-600">and {o.awaiting.length - 12} more.</p>}
            </Panel>
          )}
          <OrgChart nodes={o.tree.nodes} positions={o.positions} />
          <Panel title="Span of control" >
            {o.tree.spans.length === 0 ? <p className="py-4 text-sm text-slate-600">No reporting lines are set yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead><tr className="bg-slate-50 text-xs font-semibold text-slate-700"><th className="px-3 py-2.5">Manager</th><th className="px-3 py-2.5">Direct reports</th><th className="px-3 py-2.5">In their whole team</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {o.tree.spans.slice(0, 15).map((s: any) => (
                      <tr key={s.uid} className="text-slate-800">
                        <td className="px-3 py-2.5"><b className="text-slate-900">{s.name}</b>{s.title && <span className="ml-2 text-slate-600">{s.title}</span>}</td>
                        <td className="px-3 py-2.5"><span className="flex items-center gap-2"><span className="h-2 rounded-full bg-violet-500" style={{ width: `${Math.max(8, Math.min(160, s.direct * 16))}px` }} />{s.direct}</span></td>
                        <td className="px-3 py-2.5 tabular-nums">{s.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      <Card title="Business units" subtitle="Built from the people mapping.">
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {(o?.units || []).map((u: any) => (
            <div key={u.name} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-sm font-bold text-slate-800">{u.name}</span><Pill tone="blue">{u.people} people</Pill></div>
              <div className="text-slate-500">{u.head ? `Head: ${u.head} - ` : ''}{u.billable} billable{u.hrbps.length ? ` - HRBP: ${u.hrbps.join(', ')}` : ''}</div>
              <div className="mt-1 text-slate-600">{Object.entries(u.departments).map(([k, v]) => `${k} ${v}`).join(' - ')}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Headcount against approved numbers" subtitle="Approved numbers come from Hiring budgets. Gap = approved - people now - open vacancies."
        right={<div className="inline-flex rounded-xl border border-slate-200 p-0.5" role="group" aria-label="Group headcount by">{GROUPS.map((g) => <button key={g.key} type="button" aria-pressed={by === g.key} onClick={() => setBy(g.key)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${by === g.key ? 'bg-violet-600 text-white' : 'text-slate-700 hover:bg-violet-50'}`}>{g.label}</button>)}</div>}>
        <Loading error={head.error} loading={head.loading} />
        {by === 'manager' && <p className="mb-2 text-xs text-slate-600">Approved numbers and open vacancies are set per department, so they are not shown per manager.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] font-bold uppercase text-slate-500"><tr><th className="py-1 pr-3">{by === 'manager' ? 'Manager' : by === 'company' ? 'Group' : 'Department'}</th><th className="pr-3">Now</th><th className="pr-3">Billable</th><th className="pr-3">Approved</th><th className="pr-3">Open</th><th>Gap</th></tr></thead>
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
