import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Star, UserPlus } from 'lucide-react';
import { Avatar } from '../home/parts';
import { Panel } from '../leave/kit';

export interface OrgNode { uid: string; name: string; title: string; department: string; empId: string; managerUid: string; businessUnit: string; hrbp: string; billable: boolean; mapped: boolean }
export interface OrgPosition { id: string; title: string; department: string; reportsToUid: string; reportsToName: string; critical: boolean; status: string; incumbentName: string }

/** One person's card in the chart. */
const PersonCard: React.FC<{ n: OrgNode; direct: number; total: number; open: boolean; toggle?: () => void }> = ({ n, direct, total, open, toggle }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
    {toggle ? (
      <button type="button" aria-label={open ? `Hide ${n.name}'s team` : `Show ${n.name}'s team`} aria-expanded={open} onClick={toggle} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-violet-50 cursor-pointer">
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
    ) : <span className="h-6 w-6 shrink-0" />}
    <Avatar name={n.name} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 text-sm"><b className="text-slate-900">{n.name}</b>{n.title && <span className="text-slate-600">{n.title}</span>}</div>
      <div className="text-xs text-slate-600">{[n.department, n.businessUnit, n.hrbp ? `HRBP ${n.hrbp}` : ''].filter(Boolean).join(' · ') || 'Not mapped yet'}</div>
    </div>
    {!n.mapped && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700" title="No business unit or HRBP yet">Needs mapping</span>}
    {direct > 0 && <span className="whitespace-nowrap rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700" title={`${direct} direct, ${total} in total`}>{direct} direct{total !== direct ? ` · ${total} total` : ''}</span>}
  </div>
);

const VacantCard: React.FC<{ p: OrgPosition }> = ({ p }) => (
  <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50/40 px-3 py-2.5">
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600"><UserPlus className="h-4 w-4" /></span>
    <div className="min-w-0 flex-1 text-sm"><b className="text-slate-900">Vacant: {p.title}</b><div className="text-xs text-slate-600">{p.department || 'No department'}</div></div>
    {p.critical && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><Star className="h-3 w-3" />Critical</span>}
  </div>
);

/**
 * The reporting structure as a tree: everyone under their manager, with vacant positions shown as dashed boxes
 * under whoever they report to. People who have no manager set are listed apart so the chart stays readable.
 */
export const OrgChart: React.FC<{ nodes: OrgNode[]; positions: OrgPosition[] }> = ({ nodes, positions }) => {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const { kids, roots, loose, total } = useMemo(() => {
    const kids = new Map<string, OrgNode[]>();
    nodes.forEach((n) => { if (n.managerUid) kids.set(n.managerUid, [...(kids.get(n.managerUid) || []), n]); });
    kids.forEach((l) => l.sort((a, b) => a.name.localeCompare(b.name)));
    const under = (uid: string, seen = new Set<string>()): number => { if (seen.has(uid)) return 0; seen.add(uid); return (kids.get(uid) || []).reduce((a, k) => a + 1 + under(k.uid, seen), 0); };
    const top = nodes.filter((n) => !n.managerUid);
    const withTeam = top.filter((n) => kids.has(n.uid) || positions.some((p) => p.reportsToUid === n.uid && p.status !== 'FILLED')).sort((a, b) => under(b.uid) - under(a.uid) || a.name.localeCompare(b.name));
    const loose = top.filter((n) => !withTeam.includes(n)).sort((a, b) => a.name.localeCompare(b.name));
    return { kids, roots: withTeam, loose, total: under };
  }, [nodes, positions]);
  const vacantUnder = (uid: string) => positions.filter((p) => p.reportsToUid === uid && p.status !== 'FILLED');
  const unplaced = positions.filter((p) => p.status !== 'FILLED' && !p.reportsToUid);
  const match = (n: OrgNode) => !q || `${n.name} ${n.title} ${n.department}`.toLowerCase().includes(q.toLowerCase());

  const render = (n: OrgNode, depth: number, seen: Set<string>): React.ReactNode => {
    if (seen.has(n.uid)) return null;
    const next = new Set(seen).add(n.uid);
    const team = kids.get(n.uid) || [];
    const vac = vacantUnder(n.uid);
    const isOpen = !closed.has(n.uid);
    const hasTeam = team.length > 0 || vac.length > 0;
    return (
      <li key={n.uid} className="relative">
        <div className={q && !match(n) ? 'opacity-40' : ''}><PersonCard n={n} direct={team.length} total={total(n.uid)} open={isOpen} toggle={hasTeam ? () => setClosed((s) => { const x = new Set(s); if (x.has(n.uid)) x.delete(n.uid); else x.add(n.uid); return x; }) : undefined} /></div>
        {hasTeam && isOpen && depth < 12 && (
          <ul className="ml-5 mt-2 space-y-2 border-l-2 border-violet-100 pl-5">
            {team.map((k) => render(k, depth + 1, next))}
            {vac.map((p) => <li key={p.id}><VacantCard p={p} /></li>)}
          </ul>
        )}
      </li>
    );
  };

  return (
    <Panel title="Organisation chart" right={
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Find a person" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" className="h-9 w-44 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200" />
        <button type="button" className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 hover:border-violet-300 cursor-pointer" onClick={() => setClosed(new Set())}>Expand all</button>
        <button type="button" className="h-9 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 hover:border-violet-300 cursor-pointer" onClick={() => setClosed(new Set(nodes.filter((n) => kids.has(n.uid)).map((n) => n.uid)))}>Collapse all</button>
      </div>}>
      {nodes.length === 0 ? <p className="py-6 text-center text-sm text-slate-600">No one to show yet.</p> : (
        <>
          <ul className="space-y-3">{roots.map((n) => render(n, 0, new Set()))}</ul>
          {unplaced.length > 0 && <div className="mt-3 space-y-2"><div className="text-sm font-bold text-slate-900">Vacant positions with no manager set</div>{unplaced.map((p) => <VacantCard key={p.id} p={p} />)}</div>}
          {loose.length > 0 && (
            <details className="mt-4 rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-bold text-slate-900">{loose.length} {loose.length === 1 ? 'person has' : 'people have'} no manager set and no team</summary>
              <p className="mt-1 text-xs text-slate-600">Set their manager in People &gt; Directory so they appear in the chart.</p>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">{loose.map((n) => <li key={n.uid} className={q && !match(n) ? 'opacity-40' : ''}><PersonCard n={n} direct={0} total={0} open={false} /></li>)}</ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
};
