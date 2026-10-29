import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Eye, EyeOff, Image as ImageIcon, Search } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { maskIdentity } from '../../../shared/employeeIdentity';
import { PERSONAL_FIELDS, PERSONAL_GROUPS } from '../../../shared/employeePersonal';
import { Card, Notice, Segmented, btnGhost, input, niceDate } from '../leave/ui';

interface Person { uid: string; name: string; empId: string; department: string; title: string; active: boolean; managerName: string; joinDate: string; email: string }

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function downloadCsv(rows: Person[]) {
  const head = ['Employee code', 'Name', 'Department', 'Title', 'Reporting manager', 'Joining date', 'Status'];
  const lines = [head.map(csvCell).join(','), ...rows.map((p) => [p.empId, p.name, p.department, p.title, p.managerName, p.joinDate, p.active ? 'Active' : 'Inactive'].map(csvCell).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
  a.download = 'employees.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex gap-3 py-1.5 text-sm border-b border-slate-100 last:border-0"><dt className="w-44 shrink-0 text-slate-500">{label}</dt><dd className="font-medium text-slate-800 break-words min-w-0">{value || <span className="text-slate-300">—</span>}</dd></div>
);

/** Everything we hold about one employee, read-only, in one place. Uses the same endpoints (and permission checks) as the separate screens. */
const Detail: React.FC<{ person: Person; onBack: () => void }> = ({ person, onBack }) => {
  const uid = person.uid;
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<{ title: string; src: string | null } | null>(null);

  useEffect(() => {
    setD(null); setErr(null); setShown(new Set());
    Promise.all([lifecycleService.profile(uid), lifecycleService.personal(uid), lifecycleService.family(uid), lifecycleService.qualifications(uid), lifecycleService.identities(uid)])
      .then(([profile, personal, family, quals, ids]) => setD({ profile: profile.profile, personal, family: family.members, quals: quals.items, ids: ids.items }))
      .catch((e) => setErr(e?.message || 'Could not load this employee.'));
  }, [uid]);

  const open = async (title: string, load: () => Promise<{ dataUrl: string }>) => {
    setViewing({ title, src: null });
    try { setViewing({ title, src: (await load()).dataUrl }); } catch { setViewing(null); }
  };
  const toggle = (k: string) => setShown((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const p = d?.profile;
  return (
    <div className="space-y-4">
      <button type="button" className={btnGhost} onClick={onBack}><ArrowLeft className="w-3.5 h-3.5" />All employees</button>
      <div>
        <h2 className="text-lg font-black text-slate-800">{person.name} <span className="text-sm font-semibold text-slate-400">{person.empId}</span></h2>
        <p className="text-xs text-slate-500">{[person.title, person.department].filter(Boolean).join(' · ')}{!person.active ? ' · Inactive' : ''}</p>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {!d && !err && <p className="text-sm text-slate-500">Loading…</p>}
      {d && (
        <>
          <Card title="Employment">
            <dl>
              <Row label="Email" value={p.email} /><Row label="Mobile" value={p.mobile} /><Row label="Gender" value={p.gender} /><Row label="Date of birth" value={p.dob && niceDate(p.dob)} />
              <Row label="Joining date" value={p.joinDate && niceDate(p.joinDate)} /><Row label="Confirmation date" value={p.confirmationDate && niceDate(p.confirmationDate)} />
              <Row label="Reporting manager" value={p.reportingManager?.name} /><Row label="Approving manager" value={p.approvingManager?.name} />
              <Row label="Separation" value={p.exitStatus ? `${p.exitStatus.replace(/_/g, ' ').toLowerCase()}${p.lastWorkingDay ? `, last day ${niceDate(p.lastWorkingDay)}` : ''}` : ''} />
            </dl>
          </Card>

          <Card title="Identity documents" subtitle="Numbers are hidden until you click the eye.">
            <ul className="divide-y divide-slate-100">
              {d.ids.map((i: any) => {
                const v = i.pendingNumber || i.number;
                const vis = shown.has(i.type);
                return (
                  <li key={i.type} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                    <span className="w-44 shrink-0 text-slate-500">{i.label}</span>
                    <span className="font-mono text-slate-800">{v ? (vis ? v : maskIdentity(v)) : <span className="font-sans text-slate-300">Not added</span>}</span>
                    {v && <button type="button" aria-label={vis ? 'Hide number' : 'Show number'} className="p-1 rounded text-slate-500 hover:bg-slate-100" onClick={() => toggle(i.type)}>{vis ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>}
                    {i.status === 'PENDING' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">Waiting for HR</span>}
                    {i.files.map((f: any, n: number) => (
                      <button key={f.id} type="button" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:text-[#FA7014]" onClick={() => void open(`${i.label} photo ${n + 1}`, () => lifecycleService.identityFile(f.id, uid))}><ImageIcon className="w-3.5 h-3.5" />Photo {n + 1}</button>
                    ))}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Personal information">
            {PERSONAL_GROUPS.map((g) => {
              const fields = PERSONAL_FIELDS.filter((f) => f.group === g.group);
              return (
                <div key={g.group} className="mb-3 last:mb-0">
                  <h4 className="text-xs font-bold text-slate-500 uppercase mb-1">{g.title}</h4>
                  <dl>{fields.map((f) => { const v = d.personal.values[f.key]; return <Row key={f.key} label={f.label} value={f.kind === 'bool' ? (v ? 'Yes' : 'No') : f.kind === 'date' && v ? niceDate(String(v)) : String(v || '')} />; })}</dl>
                </div>
              );
            })}
            {d.personal.values.anniversaryDate && <Row label="Anniversary" value={niceDate(String(d.personal.values.anniversaryDate))} />}
          </Card>

          <Card title={`Family (${d.family.length})`}>
            {d.family.length === 0 ? <p className="text-sm text-slate-400">Nothing added.</p> : (
              <ul className="divide-y divide-slate-100">
                {d.family.map((m: any) => (
                  <li key={m.id} className="py-2 text-sm">
                    <div className="font-bold text-slate-800">{[m.title, m.name].filter(Boolean).join(' ')} <span className="font-medium text-slate-500">· {m.relation}</span>{m.isDependent ? ' · Dependent' : ''}</div>
                    <div className="text-xs text-slate-500">{[m.gender, m.dob && `Born ${niceDate(m.dob)}`, m.bloodGroup, m.contactNo, m.profession].filter(Boolean).join(' · ')}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Qualifications (${d.quals.length})`}>
            {d.quals.length === 0 ? <p className="text-sm text-slate-400">Nothing added.</p> : (
              <ul className="divide-y divide-slate-100">
                {d.quals.map((x: any) => (
                  <li key={x.id} className="py-2 text-sm flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-800">{x.qualification}{x.specialization ? ` · ${x.specialization}` : ''}{x.isHighest ? ' · Highest' : ''}</div>
                      <div className="text-xs text-slate-500">{[x.instituteName, x.universityName, x.status, x.dateOfPassing && `Passed ${niceDate(x.dateOfPassing)}`, x.percentage && `${x.percentage}%`, x.grade].filter(Boolean).join(' · ')}</div>
                    </div>
                    {x.hasDocument && <button type="button" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:text-[#FA7014]" onClick={() => void open(`${x.qualification} certificate`, () => lifecycleService.qualificationDoc(x.id, uid))}><ImageIcon className="w-3.5 h-3.5" />Certificate</button>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label={viewing.title} onClick={() => setViewing(null)}>
          <div className="bg-white rounded-xl p-3 max-w-3xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2"><strong className="text-sm">{viewing.title}</strong><button type="button" className={btnGhost} onClick={() => setViewing(null)}>Close</button></div>
            {viewing.src ? <img src={viewing.src} alt={viewing.title} className="w-full h-auto" /> : <p className="text-sm text-slate-500 p-6 text-center">Loading…</p>}
          </div>
        </div>
      )}
    </div>
  );
};

/** Employee 360: HR and admins find anyone and see everything held about them. */
export const Employee360Page: React.FC = () => {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [dept, setDept] = useState('');
  const [open, setOpen] = useState<Person | null>(null);

  useEffect(() => { lifecycleService.directory(true).then((r) => setPeople(r.people)).catch((e) => setErr(e?.message || 'Could not load employees.')); }, []);
  const departments = useMemo(() => [...new Set((people || []).map((p) => p.department).filter(Boolean))].sort(), [people]);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (people || []).filter((p) => (status === 'all' || p.active) && (!dept || p.department === dept) && (!n || `${p.name} ${p.empId} ${p.email} ${p.title}`.toLowerCase().includes(n)));
  }, [people, q, status, dept]);

  if (open) return <Detail person={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Everything held about an employee, in one place. Read only. Open a row to see their details; identity numbers stay hidden until you reveal them.</p>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden /><input className={`${input} pl-9`} placeholder="Search name, code, email or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" /></div>
        <select className={`${input} !w-auto`} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department"><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
        <Segmented size="sm" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'all', label: 'Including former' }]} />
        <button type="button" className={`${btnGhost} ml-auto`} disabled={!rows.length} onClick={() => downloadCsv(rows)}><Download className="w-3.5 h-3.5" />CSV ({rows.length})</button>
      </div>
      {!people && !err && <p className="text-sm text-slate-500">Loading…</p>}
      {people && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200"><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Department</th><th className="px-3 py-2 hidden md:table-cell">Title</th><th className="px-3 py-2 hidden lg:table-cell">Manager</th><th className="px-3 py-2 hidden lg:table-cell">Joined</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.uid} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(p)}>
                  <td className="px-3 py-2 text-slate-500">{p.empId}</td>
                  <td className="px-3 py-2"><button type="button" className="font-bold text-slate-800 hover:text-[#FA7014] text-left" onClick={() => setOpen(p)}>{p.name}</button>{!p.active && <span className="ml-2 text-[10px] font-bold text-slate-400">Inactive</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{p.department}</td>
                  <td className="px-3 py-2 text-slate-600 hidden md:table-cell">{p.title}</td>
                  <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">{p.managerName}</td>
                  <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">{p.joinDate && niceDate(p.joinDate)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No employees match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
