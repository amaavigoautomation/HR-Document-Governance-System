import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Building2, CheckCircle2, Copy, Loader2, Mail, Pencil, Plus, ShieldCheck, Trash2, Upload, UserPlus, Users, X,
} from 'lucide-react';
import type { Company, Department, User } from '../types';
import { adminApi, parseCsv, subscribeToDepartments, subscribeToRoles } from '../services/adminService';
import { firestoreService } from '../services/firestoreService';
import { PERMISSIONS, hasPerm, type RoleDef } from '../../shared/permissions';

type Tab = 'users' | 'departments' | 'roles';

const input =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#FA7014] focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20';
const primaryBtn =
  'inline-flex items-center gap-2 rounded-xl bg-[#FA7014] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#E65A05] disabled:opacity-60';
const ghostBtn =
  'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';

const PORTALS = [
  { value: 'EMPLOYEE', label: 'Employee portal', hint: 'Reads and acknowledges documents' },
  { value: 'CREATOR', label: 'HR portal', hint: 'Creates documents, runs hiring' },
  { value: 'REVIEWER', label: 'Approver portal', hint: 'Reviews and approves' },
];

const Modal: React.FC<{ title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> = ({ title, onClose, wide, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
    <div
      className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white p-5 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-black text-slate-900">{title}</h3>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

const Banner: React.FC<{ kind: 'error' | 'success'; children: React.ReactNode }> = ({ kind, children }) => (
  <div
    className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs font-medium ${
      kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
    }`}
  >
    {kind === 'error' ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
    <div className="min-w-0 break-words">{children}</div>
  </div>
);

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

interface Props {
  currentUser: User;
  company: Company;
}

export const AdminModule: React.FC<Props> = ({ currentUser, company }) => {
  const perms = currentUser.perms;
  const canUsers = hasPerm(perms, 'users.manage');
  const canDepts = hasPerm(perms, 'departments.manage');
  const canRoles = hasPerm(perms, 'roles.manage');

  const tabs = useMemo(
    () => [
      canUsers && { key: 'users' as Tab, label: 'People', icon: <Users className="h-3.5 w-3.5" /> },
      canDepts && { key: 'departments' as Tab, label: 'Departments', icon: <Building2 className="h-3.5 w-3.5" /> },
      canRoles && { key: 'roles' as Tab, label: 'Roles & permissions', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    ].filter(Boolean) as { key: Tab; label: string; icon: React.ReactNode }[],
    [canUsers, canDepts, canRoles]
  );
  const [tab, setTab] = useState<Tab>(tabs[0]?.key || 'users');

  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);

  useEffect(() => {
    const offs = [
      firestoreService.subscribeToEmployees(setUsers),
      subscribeToDepartments(setDepartments),
      subscribeToRoles(setRoles),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  if (!tabs.length) {
    return <div className="p-6 text-sm text-slate-500">You do not have access to administration.</div>;
  }

  return (
    <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Administration</h1>
        <p className="text-xs text-slate-500 sm:text-sm">
          Manage people, departments and roles for <b>{company.name}</b>.
        </p>
      </div>

      <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-0.5 text-xs font-bold">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${tab === t.key ? 'bg-[#FA7014] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && canUsers && <PeopleTab users={users} departments={departments} roles={roles} currentUser={currentUser} />}
      {tab === 'departments' && canDepts && <DepartmentsTab users={users} departments={departments} />}
      {tab === 'roles' && canRoles && <RolesTab roles={roles} users={users} company={company} currentUser={currentUser} />}
    </div>
  );
};

// ----------------------------------------------------------------------------- People

const PeopleTab: React.FC<{ users: User[]; departments: Department[]; roles: RoleDef[]; currentUser: User }> = ({
  users, departments, roles, currentUser,
}) => {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => !q || [u.name, u.email, u.empId, u.departmentName, ...(u.roleNames || [])].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, search]);

  const resend = async (u: User) => {
    try {
      const r = await adminApi.resendInvite(u.id);
      setFlash({ kind: 'success', text: r.emailed ? `Invite sent to ${u.email}.` : `Email could not be sent. Share this link with ${u.name}: ${r.inviteLink}` });
    } catch (e) {
      setFlash({ kind: 'error', text: message(e) });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input className={`${input} max-w-xs`} placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2">
          <button className={ghostBtn} onClick={() => setShowImport(true)}>
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </button>
          <button className={primaryBtn} onClick={() => setEditing('new')}>
            <UserPlus className="h-3.5 w-3.5" /> Add person
          </button>
        </div>
      </div>

      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Person</th>
              <th className="px-3 py-2.5">ID</th>
              <th className="px-3 py-2.5">Department</th>
              <th className="px-3 py-2.5">Roles</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/60">
                <td className="px-3 py-2.5">
                  <div className="font-bold text-slate-900">{u.name}</div>
                  <div className="text-slate-500">{u.email}</div>
                </td>
                <td className="px-3 py-2.5 font-mono text-slate-600">{u.empId}</td>
                <td className="px-3 py-2.5 text-slate-700">{u.departmentName || '-'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {(u.roleNames || []).map((n) => (
                      <span key={n} className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-[#C2570C]">{n}</span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${u.active === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>
                    {u.active === false ? 'Inactive' : 'Active'}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <button className={ghostBtn} title="Resend invite" onClick={() => resend(u)}><Mail className="h-3.5 w-3.5" /></button>
                    <button className={ghostBtn} onClick={() => setEditing(u)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">No people found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          departments={departments}
          roles={roles}
          currentUser={currentUser}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); setFlash({ kind: 'success', text }); }}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={(text) => { setShowImport(false); setFlash({ kind: 'success', text }); }}
        />
      )}
    </div>
  );
};

const UserModal: React.FC<{
  user: User | null; departments: Department[]; roles: RoleDef[]; currentUser: User;
  onClose: () => void; onDone: (msg: string) => void;
}> = ({ user, departments, roles, currentUser, onClose, onDone }) => {
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [title, setTitle] = useState(user?.title || '');
  const [departmentId, setDepartmentId] = useState(user?.departmentId || '');
  const [roleIds, setRoleIds] = useState<string[]>(user?.roleIds || []);
  const [active, setActive] = useState(user ? user.active !== false : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  // A role is only offered if the actor could grant everything in it (the server enforces this too).
  const assignable = roles.filter((r) =>
    currentUser.isCompanyAdmin ? true : !r.isAdmin && r.permissions.every((p) => currentUser.perms?.includes(p))
  );
  const toggle = (id: string) => setRoleIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!roleIds.length) return setError('Choose at least one role.');
    setBusy(true);
    try {
      if (user) {
        await adminApi.updateUser({ userId: user.id, name, title, departmentId, roleIds, active });
        onDone(`${name} updated.`);
      } else {
        const r = await adminApi.createUser({ name, email, title, departmentId, roleIds });
        if (r.inviteLink) {
          setInviteLink(r.inviteLink);
          return;
        }
        onDone(`${name} added (${r.empId}). An invite email was sent to ${email}.`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (inviteLink) {
    return (
      <Modal title="Person added" onClose={() => onDone(`${name} added. Share the invite link with them.`)}>
        <Banner kind="success">The account was created, but the invite email could not be sent. Share this link with {name} so they can set a password:</Banner>
        <div className="mt-3 flex items-center gap-2">
          <input readOnly className={`${input} font-mono text-[11px]`} value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={ghostBtn} onClick={() => navigator.clipboard?.writeText(inviteLink)}><Copy className="h-3.5 w-3.5" /></button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={user ? `Edit ${user.name}` : 'Add a person'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Banner kind="error">{error}</Banner>}
        <label className="block text-xs font-bold text-slate-600">Full name
          <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-xs font-bold text-slate-600">Work email
          <input className={`${input} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!user} />
        </label>
        <label className="block text-xs font-bold text-slate-600">Job title
          <input className={`${input} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-xs font-bold text-slate-600">Department
          <select className={`${input} mt-1`} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="text-xs font-bold text-slate-600">Roles</legend>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {(user ? roles : assignable).map((r) => {
              const allowed = assignable.some((a) => a.id === r.id) || (user?.roleIds || []).includes(r.id);
              return (
                <label key={r.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${roleIds.includes(r.id) ? 'border-[#FA7014] bg-orange-50' : 'border-slate-200'} ${allowed ? '' : 'opacity-40'}`}>
                  <input type="checkbox" checked={roleIds.includes(r.id)} disabled={!allowed} onChange={() => toggle(r.id)} />
                  <span className="font-bold text-slate-800">{r.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {user && (
          <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Account active (untick to block sign-in)
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {user ? 'Save changes' : 'Add and invite'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const CSV_TEMPLATE = 'name,email,department,roles,title\nAsha Rao,asha@company.com,Finance,Employee,Accountant\nRahul Mehta,rahul@company.com,Engineering,Department Head;Employee,Engineering Lead\n';

const ImportModal: React.FC<{ onClose: () => void; onDone: (msg: string) => void }> = ({ onClose, onDone }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof adminApi.importUsers>> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseCsv(text), [text]);

  const run = async () => {
    setError('');
    if (!parsed.length) return setError('Add a CSV with a header row and at least one person.');
    setBusy(true);
    try {
      setResult(
        await adminApi.importUsers(parsed.map((r) => ({ name: r.name, email: r.email, department: r.department, roles: r.roles || r.role, title: r.title })))
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'people-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  if (result) {
    const failed = result.results.filter((r) => !r.ok);
    const links = result.results.filter((r) => r.ok && r.inviteLink);
    return (
      <Modal title="Import finished" onClose={() => onDone(`${result.imported} people imported${result.failed ? `, ${result.failed} failed` : ''}.`)} wide>
        <Banner kind={result.failed ? 'error' : 'success'}>{result.imported} imported, {result.failed} failed.</Banner>
        {failed.length > 0 && (
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
            {failed.map((f) => <li key={f.row}>Row {f.row} ({f.email || 'no email'}): {f.error}</li>)}
          </ul>
        )}
        {links.length > 0 && (
          <div className="mt-3 text-xs text-slate-600">
            Invite emails could not be sent for {links.length} people. Share their links:
            <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto font-mono text-[10px]">
              {links.map((l) => <li key={l.row} className="break-all">{l.email}: {l.inviteLink}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button className={primaryBtn} onClick={() => onDone(`${result.imported} people imported${result.failed ? `, ${result.failed} failed` : ''}.`)}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import people from CSV" onClose={onClose} wide>
      <div className="space-y-3">
        {error && <Banner kind="error">{error}</Banner>}
        <p className="text-xs text-slate-500">
          Columns: <b>name, email, department, roles, title</b>. Separate several roles with a semicolon. Departments that do not exist yet are created for you. Role names must match the Roles tab. Everyone gets an email invite to set their password (up to 300 per import).
        </p>
        <div className="flex gap-2">
          <button className={ghostBtn} onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Choose file</button>
          <button className={ghostBtn} onClick={downloadTemplate}>Download template</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }} />
        </div>
        <textarea className={`${input} h-40 font-mono text-xs`} placeholder="...or paste CSV here" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{parsed.length} {parsed.length === 1 ? 'person' : 'people'} found</span>
          <div className="flex gap-2">
            <button className={ghostBtn} onClick={onClose}>Cancel</button>
            <button className={primaryBtn} onClick={run} disabled={busy || !parsed.length}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Import {parsed.length || ''}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ----------------------------------------------------------------------------- Departments

const DepartmentsTab: React.FC<{ users: User[]; departments: Department[] }> = ({ users, departments }) => {
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [flash, setFlash] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    users.forEach((u) => u.departmentId && m.set(u.departmentId, (m.get(u.departmentId) || 0) + 1));
    return m;
  }, [users]);

  const remove = async (d: Department) => {
    if (!window.confirm(`Delete the ${d.name} department?`)) return;
    try {
      await adminApi.deleteDepartment(d.id);
      setFlash({ kind: 'success', text: `${d.name} deleted.` });
    } catch (e) {
      setFlash({ kind: 'error', text: message(e) });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={primaryBtn} onClick={() => setEditing('new')}><Plus className="h-3.5 w-3.5" /> Add department</button>
      </div>
      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => {
          const head = users.find((u) => u.id === d.headUserId);
          return (
            <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-slate-900">{d.name}</div>
                  <div className="text-xs text-slate-500">{counts.get(d.id) || 0} people</div>
                  <div className="mt-1 text-xs text-slate-500">Head: {head ? head.name : 'Not set'}</div>
                </div>
                <div className="flex gap-1">
                  <button className={ghostBtn} onClick={() => setEditing(d)}><Pencil className="h-3.5 w-3.5" /></button>
                  <button className={ghostBtn} onClick={() => remove(d)}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></button>
                </div>
              </div>
            </div>
          );
        })}
        {!departments.length && <div className="col-span-full rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">No departments yet.</div>}
      </div>
      {editing && (
        <DepartmentModal
          department={editing === 'new' ? null : editing}
          users={users}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); setFlash({ kind: 'success', text }); }}
        />
      )}
    </div>
  );
};

const DepartmentModal: React.FC<{ department: Department | null; users: User[]; onClose: () => void; onDone: (m: string) => void }> = ({ department, users, onClose, onDone }) => {
  const [name, setName] = useState(department?.name || '');
  const [headUserId, setHeadUserId] = useState(department?.headUserId || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi.saveDepartment({ departmentId: department?.id, name, headUserId });
      onDone(`${name} saved.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={department ? 'Edit department' : 'Add department'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <Banner kind="error">{error}</Banner>}
        <label className="block text-xs font-bold text-slate-600">Name
          <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-xs font-bold text-slate-600">Department head (optional)
          <select className={`${input} mt-1`} value={headUserId} onChange={(e) => setHeadUserId(e.target.value)}>
            <option value="">No head</option>
            {users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</button>
        </div>
      </form>
    </Modal>
  );
};

// ----------------------------------------------------------------------------- Roles

const RolesTab: React.FC<{ roles: RoleDef[]; users: User[]; company: Company; currentUser: User }> = ({ roles, users, company, currentUser }) => {
  const [editing, setEditing] = useState<RoleDef | 'new' | null>(null);
  const [flash, setFlash] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const holders = (id: string) => users.filter((u) => (u.roleIds || []).includes(id)).length;

  const remove = async (r: RoleDef) => {
    if (!window.confirm(`Delete the ${r.name} role?`)) return;
    try {
      await adminApi.deleteRole(r.id);
      setFlash({ kind: 'success', text: `${r.name} deleted.` });
    } catch (e) {
      setFlash({ kind: 'error', text: message(e) });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button className={primaryBtn} onClick={() => setEditing('new')}><Plus className="h-3.5 w-3.5" /> New role</button>
      </div>
      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-900">{r.name}</span>
                  {r.isAdmin && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">Full access</span>}
                </div>
                {r.description && <p className="text-xs text-slate-500">{r.description}</p>}
                <p className="mt-1 text-[11px] text-slate-400">
                  {PORTALS.find((p) => p.value === r.portal)?.label} · {r.isAdmin ? 'all' : r.permissions.length} permissions · {holders(r.id)} {holders(r.id) === 1 ? 'person' : 'people'}
                </p>
              </div>
              {!r.isAdmin && (
                <div className="flex gap-1">
                  <button className={ghostBtn} onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></button>
                  <button className={ghostBtn} onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5 text-rose-600" /></button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <RoleModal
          role={editing === 'new' ? null : editing}
          company={company}
          currentUser={currentUser}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); setFlash({ kind: 'success', text }); }}
        />
      )}
    </div>
  );
};

const RoleModal: React.FC<{ role: RoleDef | null; company: Company; currentUser: User; onClose: () => void; onDone: (m: string) => void }> = ({
  role, company, currentUser, onClose, onDone,
}) => {
  const [name, setName] = useState(role?.name || '');
  const [description, setDescription] = useState(role?.description || '');
  const [portal, setPortal] = useState<string>(role?.portal || 'EMPLOYEE');
  const [selected, setSelected] = useState<string[]>(role?.permissions || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const groups = useMemo(() => {
    const map = new Map<string, typeof PERMISSIONS>();
    PERMISSIONS.forEach((p) => map.set(p.group, [...(map.get(p.group) || []), p]));
    return Array.from(map.entries());
  }, []);

  const toggle = (key: string) => setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  // You can only hand out permissions you hold yourself (the server enforces this as well).
  const canGrant = (key: string) => !!currentUser.isCompanyAdmin || !!currentUser.perms?.includes(key);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi.saveRole({ roleId: role?.id, name, description, permissions: selected, portal });
      onDone(`${name} saved. People with this role get the change next time they sign in or refresh.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={role ? `Edit ${role.name}` : 'New role'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {error && <Banner kind="error">{error}</Banner>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-slate-600">Role name
            <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block text-xs font-bold text-slate-600">Opens in
            <select className={`${input} mt-1`} value={portal} onChange={(e) => setPortal(e.target.value)}>
              {PORTALS.map((p) => <option key={p.value} value={p.value}>{p.label} - {p.hint}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs font-bold text-slate-600">Description
          <input className={`${input} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="space-y-3">
          {groups.map(([group, perms]) => (
            <fieldset key={group}>
              <legend className="text-[11px] font-black uppercase tracking-wide text-slate-500">{group}</legend>
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {perms.map((p) => {
                  const moduleOff = p.module && !company.modules.includes(p.module);
                  const disabled = !canGrant(p.key);
                  return (
                    <label key={p.key} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${selected.includes(p.key) ? 'bg-orange-50' : ''} ${disabled ? 'opacity-40' : ''}`}>
                      <input type="checkbox" className="mt-0.5" checked={selected.includes(p.key)} disabled={disabled} onChange={() => toggle(p.key)} />
                      <span>
                        <span className="font-semibold text-slate-800">{p.label}</span>
                        {moduleOff && <span className="ml-1 text-[10px] text-slate-400">(module not enabled for your company)</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryBtn} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save role</button>
        </div>
      </form>
    </Modal>
  );
};
