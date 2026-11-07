import React, { useMemo, useState } from 'react';
import { ArrowRight, Clock, Layers, MoreVertical, Play, Plus, Search, Users, Workflow, Zap } from 'lucide-react';
import { flowService, type FamilyView } from '../../services/flowService';
import { STEP_INFO, STEP_ORDER, type FlowStep } from '../../../shared/flowEngine';
import { Loading, useLoad } from '../common/loadUi';
import { niceDate } from '../leave/ui';

export type AutomationTab = 'workflows' | 'templates' | 'activity';

const when = (iso?: string) => (iso ? `${niceDate(iso.slice(0, 10))}, ${new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}` : '—');

const Tile: React.FC<{ label: string; value: React.ReactNode; tone: string; icon: string; Icon: React.FC<{ className?: string }>; hint?: string }> = ({ label, value, tone, icon, Icon, hint }) => (
  <div className={`flex items-center gap-4 rounded-2xl border border-white px-5 py-4 ${tone}`} title={hint}>
    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${icon}`}><Icon className="h-6 w-6" /></span>
    <span><span className="block text-3xl font-bold leading-tight tabular-nums text-slate-950">{value}</span><span className="block text-sm text-slate-700">{label}</span></span>
  </div>
);

const stepsText = (steps: FlowStep[] | undefined) => {
  if (!steps?.length) return '—';
  const names = steps.map((s) => s.title || STEP_INFO[s.type]?.label || s.type);
  return names.length > 3 ? `${names.slice(0, 3).join(' → ')} +${names.length - 3}` : names.join(' → ');
};

interface Props { onOpenFlow: (familyId: string) => void; onCreate: () => void }

/** The front page of Hiring Automation: how many flows are live, how applicants are moving through them, and a list of flows. */
export const AutomationHome: React.FC<Props> = ({ onOpenFlow, onCreate }) => {
  const st = useLoad(() => flowService.state(), []);
  const runs = useLoad(() => flowService.runs(), []);
  const [tab, setTab] = useState<AutomationTab>('workflows');
  const [filter, setFilter] = useState<'all' | 'active' | 'draft'>('all');
  const [q, setQ] = useState('');
  const activity = useLoad(() => (tab === 'activity' ? flowService.activity(100) : Promise.resolve(null)), [tab]);

  const families: FamilyView[] = (st.data as any)?.families || [];
  const items = runs.data?.items || [];
  const lastRun = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of items) if (!m.get(r.familyId) || r.updatedAt > m.get(r.familyId)!) m.set(r.familyId, r.updatedAt);
    return m;
  }, [items]);
  const live = families.filter((f) => f.active).length;
  const engaged = new Set(items.map((r) => r.applicationId)).size;
  const notStuck = items.length ? Math.round((items.filter((r) => r.status !== 'STUCK').length / items.length) * 100) : null;

  const rows = families.filter((f) => (filter === 'all' || (filter === 'active' ? !!f.active : !!f.draft && !f.active))
    && (!q || `${f.name} ${f.designations.join(' ')}`.toLowerCase().includes(q.toLowerCase())));

  if (st.loading && !st.data) return <Loading loading />;
  if (st.error && !st.data) return <Loading error={st.error} />;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Automation summary">
        <Tile label="Active Workflows" value={live} tone="bg-gradient-to-br from-violet-100/80 to-indigo-50" icon="bg-violet-100 text-violet-600" Icon={Zap} />
        <Tile label="Automations Run" value={runs.loading && !runs.data ? '—' : items.length} tone="bg-gradient-to-br from-sky-100/80 to-blue-50" icon="bg-sky-100 text-sky-600" Icon={Play} hint="Applicants who have entered a hiring flow" />
        <Tile label="Candidates Engaged" value={runs.loading && !runs.data ? '—' : engaged} tone="bg-gradient-to-br from-emerald-100/70 to-green-50" icon="bg-emerald-100 text-emerald-600" Icon={Users} />
        <Tile label="Not Stuck" value={notStuck === null ? '—' : `${notStuck}%`} tone="bg-gradient-to-br from-emerald-100/70 to-green-50" icon="bg-emerald-100 text-emerald-600" Icon={Clock} hint="Share of applicants in a flow who are not waiting for HR to fix something" />
      </section>

      <nav className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Automation sections">
        {([['workflows', 'Workflows', Workflow], ['templates', 'Templates', Layers], ['activity', 'Activity Log', Clock]] as const).map(([k, l, I]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold ${tab === k ? 'bg-violet-200 text-violet-900' : 'text-slate-700 hover:bg-slate-50'}`}><I className="h-4 w-4" />{l}</button>
        ))}
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {tab === 'workflows' && <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-2 text-xl font-bold text-slate-950"><Workflow className="h-5 w-5" />Automation Workflows</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select value={filter} onChange={(e) => setFilter(e.target.value as any)} aria-label="Show" className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none"><option value="all">All Workflows</option><option value="active">Active</option><option value="draft">Draft</option></select>
                <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workflows..." aria-label="Search workflows" className="h-10 w-56 rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#4f46e5]" /></div>
              </div>
            </div>
            {rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{families.length ? 'No workflows match.' : 'No workflow yet. Create one to start.'}</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['Workflow Name', 'Trigger', 'Actions', 'Status', 'Last Run', ''].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((f) => {
                    const doc = f.active || f.draft;
                    const lr = lastRun.get(f.familyId);
                    return (
                      <tr key={f.familyId} className="cursor-pointer hover:bg-violet-50/40" onClick={() => onOpenFlow(f.familyId)}>
                        <td className="px-3 py-3.5"><span className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Workflow className="h-5 w-5" /></span><span className="min-w-0"><span className="block truncate font-bold text-slate-900">{f.name}</span><span className="block text-xs text-slate-500">{f.inFlight} applicant{f.inFlight === 1 ? '' : 's'} in it now</span></span></span></td>
                        <td className="px-3 py-3.5"><span className="inline-block max-w-[16rem] truncate rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700" title={f.isDefault ? 'Every role without its own flow' : f.designations.join(', ')}>{f.isDefault ? 'All other roles' : f.designations.join(', ') || '—'}</span></td>
                        <td className="px-3 py-3.5 text-slate-800">{stepsText(doc?.steps)}</td>
                        <td className="px-3 py-3.5">{f.active ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Active · v{f.active.version}</span> : f.draft ? <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Draft</span> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">Not built</span>}{f.draft && f.active && <span className="ml-1 text-[11px] font-semibold text-amber-800">unpublished changes</span>}</td>
                        <td className="px-3 py-3.5 text-slate-700">{lr ? when(lr) : '—'}</td>
                        <td className="px-3 py-3.5 text-right"><button type="button" aria-label={`Open ${f.name}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody></table></div>
            )}
          </>}

          {tab === 'templates' && <>
            <h2 className="mb-1 inline-flex items-center gap-2 text-xl font-bold text-slate-950"><Layers className="h-5 w-5" />Templates</h2>
            <p className="mb-4 text-sm text-slate-600">The steps you can put in a hiring flow. Create a workflow, then add any of these.</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {STEP_ORDER.map((t) => (
                <li key={t} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-lg" aria-hidden>{STEP_INFO[t].icon}</span>
                  <span className="min-w-0"><span className="block font-bold text-slate-900">{STEP_INFO[t].label}</span><span className="block text-xs text-slate-600">{STEP_INFO[t].does}</span></span>
                </li>
              ))}
            </ul>
          </>}

          {tab === 'activity' && <>
            <h2 className="mb-4 inline-flex items-center gap-2 text-xl font-bold text-slate-950"><Clock className="h-5 w-5" />Activity Log</h2>
            {activity.loading && !activity.data ? <Loading loading /> : activity.error ? <Loading error={activity.error} /> : (activity.data?.items.length ? (
              <ol className="divide-y divide-slate-100">
                {activity.data.items.map((a, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600"><Zap className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm text-slate-900"><b>{a.candidateName}</b>{a.designation ? ` · ${a.designation}` : ''}</span><span className="block text-sm text-slate-700">{a.text}</span><span className="block text-xs text-slate-500">{a.flowName} · {a.by}</span></span>
                    <span className="shrink-0 text-xs text-slate-500">{when(a.at)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="py-8 text-center text-sm text-slate-500">Nothing has happened in a flow yet.</p>)}
          </>}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="inline-flex items-center gap-2 text-lg font-bold text-slate-950"><Zap className="h-5 w-5" />Create Automation</h3>
            <p className="mt-2 text-sm text-slate-600">Build a hiring flow for a role, with the steps and people you choose.</p>
            <button type="button" onClick={onCreate} className="mt-4 inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-violet-300 bg-violet-100 text-sm font-semibold text-violet-900 hover:bg-violet-200"><Plus className="h-4 w-4" />Create Workflow</button>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="inline-flex items-center gap-2 text-lg font-bold text-slate-950"><Layers className="h-5 w-5" />Popular Templates</h3>
            <ul className="mt-3 divide-y divide-slate-100">
              {(['screen', 'interview', 'email', 'offer', 'onboard'] as const).map((t) => (
                <li key={t}><button type="button" onClick={() => setTab('templates')} className="flex w-full cursor-pointer items-center gap-3 py-2.5 text-left text-sm text-slate-800"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50" aria-hidden>{STEP_INFO[t].icon}</span><span className="flex-1 truncate">{STEP_INFO[t].label}</span><ArrowRight className="h-4 w-4 text-slate-500" /></button></li>
              ))}
            </ul>
            <button type="button" onClick={() => setTab('templates')} className="mt-3 cursor-pointer text-sm font-bold text-[#4f46e5] hover:underline">View All Templates <ArrowRight className="inline h-3.5 w-3.5" /></button>
          </section>
        </aside>
      </div>
    </div>
  );
};
