import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { lifecycleService } from '../../services/lifecycleService';
import { buildOrgTree, flattenOrg, type OrgNode } from '../../../shared/lifecycleEngine';
import { Card, Notice, btnGhost, input, useRunner } from '../leave/ui';

type P = { uid: string; name: string; email: string; empId: string; department: string; title: string; active: boolean; managerUid: string; managerName: string; joinDate: string; directReports: number };

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');

const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span className="w-8 h-8 rounded-full bg-[#FA7014]/15 text-[#FA7014] text-[11px] font-bold flex items-center justify-center shrink-0">{initials(name)}</span>
);

const OrgBranch: React.FC<{ node: OrgNode<P>; depth: number; open: Set<string>; toggle: (uid: string) => void; me: string }> = ({ node, depth, open, toggle, me }) => {
  const p = node.person;
  const isOpen = open.has(p.uid);
  return (
    <li>
      <div className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.uid === me ? 'bg-[#FA7014]/10' : 'hover:bg-slate-50'}`} style={{ marginLeft: depth * 20 }}>
        {node.children.length > 0 ? (
          <button type="button" aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={() => toggle(p.uid)} className="w-5 h-5 text-xs font-bold text-slate-500 border border-slate-300 rounded">{isOpen ? '−' : '+'}</button>
        ) : <span className="w-5" />}
        <Avatar name={p.name} />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate">{p.name}{!p.active && <span className="ml-2 text-[10px] text-slate-400">inactive</span>}</div>
          <div className="text-[11px] text-slate-500 truncate">{[p.title, p.department].filter(Boolean).join(' · ') || p.email}</div>
        </div>
        {node.total > 0 && <span className="ml-auto text-[10px] font-bold text-slate-500 whitespace-nowrap">{node.children.length} direct · {node.total} total</span>}
      </div>
      {isOpen && node.children.length > 0 && (
        <ul className="border-l border-slate-200" style={{ marginLeft: depth * 20 + 18 }}>
          {node.children.map((c) => <OrgBranch key={c.person.uid} node={c} depth={0} open={open} toggle={toggle} me={me} />)}
        </ul>
      )}
    </li>
  );
};

/** Directory (search, filter) and the reporting tree. HR and leave managers can change who someone reports to. */
export const DirectoryTab: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [data, setData] = useState<{ people: P[]; canEdit: boolean; me: string } | null>(null);
  const [view, setView] = useState<'list' | 'chart'>('list');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { busy, note, run } = useRunner();

  const load = useCallback(() => lifecycleService.directory(canManage && showAll).then(setData).catch(() => undefined), [canManage, showAll]);
  useEffect(() => { load(); }, [load]);

  const people = data?.people || [];
  const tree = useMemo(() => buildOrgTree(people), [people]);
  useEffect(() => { setOpen(new Set(tree.map((n) => n.person.uid))); }, [tree]);

  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const depts = Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort();
  const needle = q.trim().toLowerCase();
  const rows = people.filter((p) => (!dept || p.department === dept) && (!needle || [p.name, p.email, p.empId, p.title, p.department].some((x) => x.toLowerCase().includes(needle))));
  const toggle = (uid: string) => setOpen((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const allUids = flattenOrg(tree).filter((x) => x.total > 0).map((x) => x.person.uid);
  const noManager = people.filter((p) => p.active && !p.managerUid).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
          {([['list', 'Directory'], ['chart', 'Org chart']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-md ${view === k ? 'bg-[#FA7014] text-white' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
        {view === 'list' && (
          <>
            <input className={`${input} max-w-xs`} placeholder="Search name, email, ID, title" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={`${input} max-w-[12rem]`} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => <option key={d}>{d}</option>)}
            </select>
          </>
        )}
        {view === 'chart' && (
          <>
            <button className={btnGhost} onClick={() => setOpen(new Set(allUids))}>Expand all</button>
            <button className={btnGhost} onClick={() => setOpen(new Set())}>Collapse all</button>
          </>
        )}
        {canManage && <label className="text-xs text-slate-600 flex items-center gap-1.5 ml-auto"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include inactive people</label>}
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {data.canEdit && noManager > 1 && <Notice>{noManager} active people have no reporting manager (one is normally the head of the company). Set them here so approvals and the chart are right.</Notice>}

      {view === 'list' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="p-2">Name</th><th className="p-2">Title</th><th className="p-2">Department</th><th className="p-2">Reports to</th><th className="p-2">Joined</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.uid} className="border-b border-slate-100 align-middle">
                    <td className="p-2"><div className="flex items-center gap-2"><Avatar name={p.name} /><div><div className="font-bold text-slate-900">{p.name}{!p.active && <span className="ml-2 text-[10px] text-slate-400">inactive</span>}</div><a className="text-slate-500 hover:underline" href={`mailto:${p.email}`}>{p.email}</a></div></div></td>
                    <td className="p-2">{p.title || '–'}{p.empId && <div className="text-slate-400">{p.empId}</div>}</td>
                    <td className="p-2">{p.department || '–'}</td>
                    <td className="p-2">
                      {data.canEdit ? (
                        <select className={`${input} !py-1 text-xs`} disabled={busy} value={p.managerUid} onChange={(e) => run(async () => { await lifecycleService.setManager(p.uid, e.target.value); await load(); }, 'Reporting line updated.')}>
                          <option value="">No manager</option>
                          {people.filter((m) => m.active && m.uid !== p.uid).map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
                        </select>
                      ) : (p.managerName || '–')}
                    </td>
                    <td className="p-2">{p.joinDate || '–'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">Nobody matches.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{rows.length} of {people.length} people</p>
        </Card>
      ) : (
        <Card>
          {tree.length === 0 ? <p className="text-sm text-slate-400">No people yet.</p> : <ul className="space-y-0.5">{tree.map((n) => <OrgBranch key={n.person.uid} node={n} depth={0} open={open} toggle={toggle} me={data.me} />)}</ul>}
        </Card>
      )}
    </div>
  );
};
