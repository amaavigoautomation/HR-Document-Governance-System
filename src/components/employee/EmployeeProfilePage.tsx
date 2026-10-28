import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, FileText, Pencil, RefreshCw, Search, UserRound } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { Avatar } from '../home/parts';
import { Drawer, Field, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';

type Mgr = { uid: string; name: string; empId: string } | null;
interface Profile {
  uid: string; name: string; email: string; empId: string; department: string; title: string; active: boolean;
  salutation: string; firstName: string; middleName: string; lastName: string; shortName: string; nameInLocal: string;
  machineCode: string; oldCode: string; mobile: string; gender: string; dob: string; joinDate: string; leavingDate: string;
  confirmationDate: string; wef: string; reportingManager: Mgr; approvingManager: Mgr;
  exitStatus: string; exitReason: string; resignationDate: string; lastWorkingDay: string;
}
type Tab = 'about' | 'joining' | 'org' | 'separation';
const TABS: { key: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { key: 'about', label: 'About', icon: UserRound },
  { key: 'joining', label: 'Joining Details', icon: Briefcase },
  { key: 'org', label: 'Organization Info.', icon: Building2 },
  { key: 'separation', label: 'Separation', icon: FileText },
];
const EXIT_LABEL: Record<string, string> = { SUBMITTED: 'Resignation submitted', MANAGER_APPROVED: 'Manager approved', APPROVED: 'Approved, serving notice', COMPLETED: 'Exited', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' };

const Item: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-semibold text-slate-500">{label}</div>
    <div className="text-sm text-slate-800 break-words min-h-[1.25rem]">{value || ''}</div>
  </div>
);
const Grid: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">{children}</div>;
const mgrText = (m: Mgr) => (m ? `${m.empId ? m.empId + ' - ' : ''}${m.name}` : '');

const EditDrawer: React.FC<{ p: Profile; open: boolean; onClose: () => void; onSaved: () => void }> = ({ p, open, onClose, onSaved }) => {
  const [f, setF] = useState<Record<string, string>>({});
  const { busy, note, run } = useRunner();
  useEffect(() => {
    if (open) setF({ salutation: p.salutation, firstName: p.firstName, middleName: p.middleName, lastName: p.lastName, shortName: p.shortName, nameInLocal: p.nameInLocal, machineCode: p.machineCode, oldCode: p.oldCode, mobile: p.mobile, gender: p.gender, dob: p.dob, confirmationDate: p.confirmationDate, wef: p.wef });
  }, [open, p]);
  const t = (k: string, label: string, type = 'text') => (
    <Field label={label}><input type={type} className={input} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <Drawer open={open} onClose={onClose} title="Edit profile" subtitle={p.name}
      footer={<div className="flex gap-2 justify-end"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(async () => { await lifecycleService.saveProfile(p.uid, f); onSaved(); onClose(); }, 'Saved')}>Save</button></div>}>
      <div className="space-y-3">
        {t('salutation', 'Title (Mr, Ms ...)')}{t('firstName', 'First name')}{t('middleName', 'Middle name')}{t('lastName', 'Last name')}
        {t('shortName', 'Short name')}{t('nameInLocal', 'Name in local language')}
        <Field label="Gender">
          <select className={input} value={f.gender ?? ''} onChange={(e) => setF({ ...f, gender: e.target.value })}>
            <option value="">Not set</option><option>Male</option><option>Female</option><option>Other</option>
          </select>
        </Field>
        {t('dob', 'Date of birth', 'date')}{t('mobile', 'Mobile number', 'tel')}{t('machineCode', 'Machine code')}{t('oldCode', 'Old code')}
        {t('confirmationDate', 'Confirmation date', 'date')}{t('wef', 'Effective from (WEF)', 'date')}
        <p className="text-[11px] text-slate-400">Joining date and reporting manager are changed from People and Leave setup.</p>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
    </Drawer>
  );
};

/** Employee Master: one employee's profile. Everyone opens their own; HR can pick anyone. */
export const EmployeeProfilePage: React.FC<{ canPick: boolean }> = ({ canPick }) => {
  const [uid, setUid] = useState<string | undefined>(undefined);
  const [data, setData] = useState<{ profile: Profile; canEdit: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('about');
  const [edit, setEdit] = useState(false);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string }[]>([]);

  const load = useCallback(() => lifecycleService.profile(uid).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canPick) lifecycleService.directory(true).then((d) => setPeople(d.people)).catch(() => undefined); }, [canPick]);

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? people.filter((p) => `${p.name} ${p.empId}`.toLowerCase().includes(n)).slice(0, 8) : [];
  }, [q, people]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const p = data.profile;

  return (
    <div className="space-y-4">
      {canPick && (
        <div className="relative max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden />
          <input className={`${input} pl-9`} placeholder="Find an employee by name or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find an employee" />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
              {matches.map((m) => (
                <li key={m.uid}><button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => { setUid(m.uid); setQ(''); setTab('about'); }}>{m.name}<span className="text-xs text-slate-400 ml-2">{m.empId}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-5">
        <div className="relative shrink-0 self-start"><span className="inline-flex"><Avatar name={p.name} size="lg" /></span></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-800">{[p.empId, p.name].filter(Boolean).join(' - ')}</h2>
            {data.canEdit && <button type="button" className={btnGhost} onClick={() => setEdit(true)}><Pencil className="w-3.5 h-3.5" />Edit</button>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mt-1">
            <span className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${p.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />{p.active ? 'Active' : 'Inactive'}</span>
            {p.machineCode && <span><b>Machine Code</b> {p.machineCode}</span>}
            {p.oldCode && <span><b>Old Code</b> {p.oldCode}</span>}
            {p.title && <span>{p.title}</span>}{p.department && <span>{p.department}</span>}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 mt-3">
            <Item label="Date Of Birth" value={niceDate(p.dob)} />
            <Item label="Date Of Joining" value={niceDate(p.joinDate)} />
            <Item label="Leaving Date" value={niceDate(p.leavingDate)} />
            <Item label="Confirmation Date" value={niceDate(p.confirmationDate)} />
            <Item label="Company Email" value={p.email} />
            <Item label="Mobile Number" value={p.mobile} />
            <Item label="Reporting Manager" value={p.reportingManager?.name} />
            <Item label="Approving Manager" value={p.approvingManager?.name} />
          </div>
        </div>
      </section>

      <div className="flex flex-col md:flex-row gap-4">
        <nav className="md:w-56 shrink-0 bg-white border border-slate-200 rounded-xl p-1.5 space-y-0.5 self-start w-full" aria-label="Profile sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${tab === key ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </nav>
        <section className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black text-slate-800">{TABS.find((t) => t.key === tab)!.label.replace(' Info.', ' Info')}</h3>
            <button type="button" aria-label="Refresh" className="p-1.5 rounded hover:bg-slate-100 text-slate-500" onClick={() => void load()}><RefreshCw className="w-4 h-4" /></button>
          </div>
          {tab === 'about' && (
            <div className="space-y-6">
              <Grid>
                <Item label="Emp Code" value={p.empId} /><Item label="Machine Code" value={p.machineCode} /><Item label="Old Code" value={p.oldCode} />
                <Item label="Title" value={p.salutation} /><Item label="First Name" value={p.firstName} /><Item label="Middle Name" value={p.middleName} />
                <Item label="Last Name" value={p.lastName} /><Item label="Gender" value={p.gender} /><Item label="Date Of Birth" value={niceDate(p.dob)} />
                <Item label="Short Name" value={p.shortName} /><Item label="Name In Local" value={p.nameInLocal} /><Item label="WEF" value={niceDate(p.wef)} />
              </Grid>
              <div>
                <h4 className="text-sm font-black text-slate-800 mb-3">Reporting and Approving Manager</h4>
                <Grid>
                  <Item label="Reporting Manager" value={mgrText(p.reportingManager)} /><Item label="Approving Manager" value={mgrText(p.approvingManager)} /><Item label="WEF" value={niceDate(p.wef)} />
                </Grid>
              </div>
            </div>
          )}
          {tab === 'joining' && <Grid><Item label="Date Of Joining" value={niceDate(p.joinDate)} /><Item label="Confirmation Date" value={niceDate(p.confirmationDate)} /><Item label="Status" value={p.active ? 'Active' : 'Inactive'} /></Grid>}
          {tab === 'org' && <Grid><Item label="Department" value={p.department} /><Item label="Designation" value={p.title} /><Item label="Company Email" value={p.email} /><Item label="Reporting Manager" value={mgrText(p.reportingManager)} /><Item label="Approving Manager" value={mgrText(p.approvingManager)} /></Grid>}
          {tab === 'separation' && (p.exitStatus
            ? <Grid><Item label="Status" value={EXIT_LABEL[p.exitStatus] || p.exitStatus} /><Item label="Reason" value={p.exitReason} /><Item label="Resignation Date" value={niceDate(p.resignationDate)} /><Item label="Last Working Day" value={niceDate(p.lastWorkingDay)} /></Grid>
            : <p className="text-xs text-slate-500">No separation has been declared.</p>)}
        </section>
      </div>
      {data.canEdit && <EditDrawer p={p} open={edit} onClose={() => setEdit(false)} onSaved={() => void load()} />}
    </div>
  );
};
