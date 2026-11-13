import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Building2, CalendarDays, CheckCircle2, Copy, Download, Loader2, Mail, MoreHorizontal, Pencil, Plus, Puzzle, Search, ShieldCheck, Tag, Trash2, Upload, UserPlus, Users, X,
} from 'lucide-react';
import type { Company, Department, User } from '../types';
import { adminApi, parseCsv, subscribeToDepartments, subscribeToRoles } from '../services/adminService';
import { pipelineService } from '../services/pipelineService';
import { firestoreService } from '../services/firestoreService';
import { PERMISSIONS, hasPerm, type RoleDef } from '../../shared/permissions';
import { ToastProvider, useToast } from './leave/ui';
import { Chip, FilterField, KpiCard, KpiGrid, PageHeader, Pagination, searchInput, tbl } from './common/pageChrome';

type Tab = 'users' | 'departments' | 'roles' | 'integrations';

/** Set by App.tsx when Google sends the browser back to /?google=... after the connect screen. */
const readGoogleFlash = (): { result: string; reason: string } | null => {
  try { const v = sessionStorage.getItem('googleFlash'); return v ? JSON.parse(v) : null; } catch { return null; }
};

const input =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#6d4cf0] focus:outline-none focus:ring-2 focus:ring-[#6d4cf0]/25';
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#6d4cf0] px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-violet-500/25 hover:bg-[#5b3be0] disabled:opacity-60 cursor-pointer';
const ghostBtn =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer';
const iconBtn =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer';

/** Title and one line on the left, buttons on the right, at the top of a tab. */
const SectionHead: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 className="text-xl font-extrabold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

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
  const canIntegrations = !!currentUser.isCompanyAdmin;

  const tabs = useMemo(
    () => [
      canUsers && { key: 'users' as Tab, label: 'People', icon: <Users className="h-4 w-4" /> },
      canDepts && { key: 'departments' as Tab, label: 'Departments', icon: <Building2 className="h-4 w-4" /> },
      canRoles && { key: 'roles' as Tab, label: 'Roles & Permissions', icon: <ShieldCheck className="h-4 w-4" /> },
      canIntegrations && { key: 'integrations' as Tab, label: 'Integrations', icon: <Puzzle className="h-4 w-4" /> },
    ].filter(Boolean) as { key: Tab; label: string; icon: React.ReactNode }[],
    [canUsers, canDepts, canRoles, canIntegrations]
  );
  const [tab, setTab] = useState<Tab>(() => (readGoogleFlash() && canIntegrations ? 'integrations' : tabs[0]?.key || 'users'));

  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [activeIntegrations, setActiveIntegrations] = useState(0);

  useEffect(() => {
    if (!canIntegrations) return;
    pipelineService.googleStatus().then((r) => setActiveIntegrations(r.connected ? 1 : 0)).catch(() => setActiveIntegrations(0));
  }, [canIntegrations]);

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
    <ToastProvider>
    <div className="min-w-0 flex-1 space-y-5 p-4 sm:p-6">
      <PageHeader
        icon={Users}
        title="Administration"
        subtitle={<>Manage people, departments, roles, permissions and system integrations for <b>{company.name}</b>.</>}
      />

      <div className={`grid grid-cols-2 gap-3 ${tabs.length >= 4 ? 'lg:grid-cols-4' : tabs.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition-all cursor-pointer ${
              tab === t.key ? 'border-[#6d4cf0] bg-[#6d4cf0] text-white shadow-md shadow-violet-500/25' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <KpiGrid cols={4}>
        <KpiCard icon={Users} tone="violet" label="Total People" value={users.length} hint={`${users.filter((u) => u.active !== false).length} active`} />
        <KpiCard icon={Building2} tone="green" label="Departments" value={departments.length} />
        <KpiCard icon={ShieldCheck} tone="amber" label="Roles" value={roles.length} />
        <KpiCard icon={Puzzle} tone="blue" label="Active Integrations" value={activeIntegrations} hint={activeIntegrations ? 'Google Calendar' : 'None connected'} />
      </KpiGrid>

      {tab === 'users' && canUsers && <PeopleTab users={users} departments={departments} roles={roles} currentUser={currentUser} />}
      {tab === 'departments' && canDepts && <DepartmentsTab users={users} departments={departments} />}
      {tab === 'roles' && canRoles && <RolesTab roles={roles} users={users} company={company} currentUser={currentUser} />}
      {tab === 'integrations' && canIntegrations && <IntegrationsTab />}
    </div>
    </ToastProvider>
  );
};

// ----------------------------------------------------------------------------- Integrations

const GOOGLE_REASONS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled.',
  expired: 'The sign-in took too long. Please press Connect again.',
  scope: 'The calendar permission was not granted. When Google asks, tick the box that lets this app manage calendar events.',
  norefresh: 'Google did not give a lasting connection. Press Connect again and accept every permission.',
  notready: 'Google is not set up on this deployment yet. The platform owner must add the Google settings first.',
  company: 'Your company is not active.',
};

const IntegrationsTab: React.FC = () => {
  const [st, setSt] = useState<{ platformReady: boolean; connected: boolean; needsReconnect: boolean; email: string; connectedAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const load = async () => { try { setSt(await pipelineService.googleStatus()); } catch (e) { setFlash({ kind: 'error', text: message(e) }); } };
  useEffect(() => {
    const f = readGoogleFlash();
    if (f) {
      try { sessionStorage.removeItem('googleFlash'); } catch { /* nothing to clear */ }
      setFlash(f.result === 'connected' ? { kind: 'success', text: 'Google Calendar is connected. Video interviews now get a Google Meet link automatically.' } : { kind: 'error', text: GOOGLE_REASONS[f.reason] || 'Google Calendar could not be connected. Please try again.' });
    }
    load();
  }, []);
  const connect = async () => {
    setBusy(true); setFlash(null);
    try { const r = await pipelineService.googleConnect(); window.location.href = r.url; } catch (e) { setFlash({ kind: 'error', text: message(e) }); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar? New interviews will go back to pasted meeting links. Existing events stay in Google.')) return;
    setBusy(true); setFlash(null);
    try { await pipelineService.googleDisconnect(); await load(); setFlash({ kind: 'success', text: 'Google Calendar is disconnected.' }); } catch (e) { setFlash({ kind: 'error', text: message(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-900">Google Calendar and Google Meet</div>
            <p className="mt-1 max-w-xl text-xs text-slate-500">
              Connect the Google account that should own your interviews (for example hr@yourcompany.com). When HR schedules a video interview, a calendar event with a
              Google Meet link is created on that account, and the candidate, interviewers and guests get the schedule email. Without it, HR pastes a meeting link as before.
            </p>
            {st && (
              <p className="mt-2 text-xs font-semibold">
                {st.connected ? <span className="text-emerald-700">Connected as {st.email || 'a Google account'}</span>
                  : st.needsReconnect ? <span className="text-amber-700">The connection stopped working. Connect again.</span>
                  : !st.platformReady ? <span className="text-slate-500">Not available yet: the platform owner has not set up Google for this deployment.</span>
                  : <span className="text-slate-500">Not connected</span>}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {st?.connected ? (
              <button className={ghostBtn} disabled={busy} onClick={disconnect}>Disconnect</button>
            ) : (
              <button className={primaryBtn} disabled={busy || !st?.platformReady} onClick={connect}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />} {st?.needsReconnect ? 'Connect again' : 'Connect Google Calendar'}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">We ask Google only for permission to create and change calendar events. The connection can be removed here at any time, or from your Google account's security page.</p>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------- People

const PeopleTab: React.FC<{ users: User[]; departments: Department[]; roles: RoleDef[]; currentUser: User }> = ({
  users, departments, roles, currentUser,
}) => {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => !q || [u.name, u.email, u.empId, u.departmentName, ...(u.roleNames || [])].join(' ').toLowerCase().includes(q))
      .filter((u) => deptFilter === 'ALL' || u.departmentId === deptFilter)
      .filter((u) => roleFilter === 'ALL' || (u.roleIds || []).includes(roleFilter))
      .filter((u) => statusFilter === 'ALL' || (statusFilter === 'ACTIVE' ? u.active !== false : u.active === false))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, search, deptFilter, roleFilter, statusFilter]);
  useEffect(() => { setPage(1); }, [search, deptFilter, roleFilter, statusFilter]);
  const pageRows = rows.slice((page - 1) * 8, page * 8);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['name', 'email', 'employee id', 'department', 'roles', 'status'].join(',')].concat(
      rows.map((u) => [u.name, u.email, u.empId, u.departmentName, (u.roleNames || []).join(';'), u.active === false ? 'Inactive' : 'Active'].map(esc).join(','))
    );
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'people.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const toast = useToast();
  const resend = async (u: User) => {
    try {
      const r = await adminApi.resendInvite(u.id);
      if (r.emailed) {
        toast?.(`Invite sent to ${u.email}.`);
      } else {
        // The email did not go out, so the person sharing the link still needs it: keep this toast until dismissed.
        const link = r.inviteLink || '';
        toast?.(`The email to ${u.name} could not be sent. Share the invite link with them instead.`, 'error', {
          sticky: true,
          action: link ? { label: 'Copy invite link', onClick: () => { navigator.clipboard?.writeText(link); toast?.('Invite link copied.'); } } : undefined,
        });
      }
    } catch (e) {
      toast?.(message(e), 'error');
    }
  };

  return (
    <div className="space-y-3">
      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6">
        <SectionHead
          title="People Management"
          subtitle="Add, update and manage employee records, roles and access."
          actions={
            <>
              <button className={ghostBtn} onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> Export</button>
              <button className={ghostBtn} onClick={() => setShowImport(true)}><Upload className="h-4 w-4" /> Import CSV</button>
              <button className={primaryBtn} onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add Person</button>
            </>
          }
        />

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={searchInput} placeholder="Search by name, email or employee ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <FilterField icon={Building2} label="Department:">
            <select className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="ALL">All Departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FilterField>
          <FilterField icon={Tag} label="Role:">
            <select className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="ALL">All Roles</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </FilterField>
          <FilterField icon={ShieldCheck} label="Status:">
            <select className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </FilterField>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className={`${tbl.table} min-w-[760px]`}>
            <thead>
              <tr className={tbl.headRow}>
                <th className={`${tbl.th} rounded-l-xl`}>Employee</th>
                <th className={tbl.th}>Employee ID</th>
                <th className={tbl.th}>Department</th>
                <th className={tbl.th}>Role</th>
                <th className={tbl.th}>Status</th>
                <th className={`${tbl.th} rounded-r-xl text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className={tbl.body}>
              {pageRows.map((u) => (
                <tr key={u.id} className={tbl.row}>
                  <td className={tbl.td}>
                    <div className="flex items-center gap-3">
                      {u.avatar ? (
                        <img src={u.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
                          {(u.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900">{u.name}</div>
                        <div className="truncate text-xs text-slate-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className={tbl.td}>{u.empId ? <Chip tone="violet">{u.empId}</Chip> : <span className="text-slate-400">-</span>}</td>
                  <td className={`${tbl.td} text-slate-700`}>
                    {u.departmentName ? (
                      <span className="inline-flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-slate-500" />{u.departmentName}</span>
                    ) : '-'}
                  </td>
                  <td className={tbl.td}>
                    <div className="flex flex-wrap gap-1">
                      {(u.roleNames || []).map((n) => <Chip key={n} tone="violet">{n}</Chip>)}
                    </div>
                  </td>
                  <td className={tbl.td}>
                    <Chip tone={u.active === false ? 'slate' : 'green'}>
                      <span className={`h-1.5 w-1.5 rounded-full ${u.active === false ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                      {u.active === false ? 'Inactive' : 'Active'}
                    </Chip>
                  </td>
                  <td className={`${tbl.td} relative`}>
                    <div className="flex justify-end gap-1.5">
                      <button className={iconBtn} title="Edit" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Pencil className="h-4 w-4" /></button>
                      <button className={iconBtn} title="More" aria-label="More actions" aria-haspopup="menu" onClick={() => setMenuId(menuId === u.id ? null : u.id)}><MoreHorizontal className="h-4 w-4" /></button>
                    </div>
                    {menuId === u.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                        <div role="menu" className="absolute right-3 top-14 z-20 w-44 rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
                          <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 cursor-pointer" onClick={() => { setMenuId(null); resend(u); }}>
                            <Mail className="h-4 w-4" /> Resend invite
                          </button>
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">No people found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={8} total={rows.length} onPage={setPage} noun="people" />
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
        const newEmail = email.trim().toLowerCase();
        const emailChanged = newEmail !== (user.email || '').toLowerCase();
        const r = await adminApi.updateUser({ userId: user.id, name, title, departmentId, roleIds, active, ...(emailChanged ? { email: newEmail } : {}) });
        if (r.invite?.inviteLink) {
          setInviteLink(r.invite.inviteLink);
          return;
        }
        onDone(!emailChanged
          ? `${name} updated.`
          : r.invite
            ? r.invite.emailed
              ? `${name} updated. A new invite was sent to ${newEmail}, because they had not signed in yet.`
              : `${name} updated, but the invite email to ${newEmail} was NOT sent. Use Resend invite on their row.`
            : `${name} updated. Their sign-in email is now ${newEmail}${user.id === currentUser.id ? '.' : ', and they will need to sign in again.'}`);
      } else {
        const r = await adminApi.createUser({ name, email, title, departmentId, roleIds });
        if (r.inviteLink) {
          setInviteLink(r.inviteLink);
          return;
        }
        onDone(r.emailed
          ? `${name} added (${r.empId}). An invite email was sent to ${email}.`
          : `${name} added (${r.empId}), but the invite email was NOT sent${r.inviteError ? ` (${r.inviteError})` : ''}. Use Resend invite on their row.`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (inviteLink) {
    return (
      <Modal title={user ? 'Email updated' : 'Person added'} onClose={() => onDone(user ? `${name} updated. Share the invite link with them.` : `${name} added. Share the invite link with them.`)}>
        <Banner kind="success">{user ? 'The email was changed, but the invite email could not be sent.' : 'The account was created, but the invite email could not be sent.'} Share this link with {name} so they can set a password:</Banner>
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
          <input className={`${input} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          {user && email.trim().toLowerCase() !== (user.email || '').toLowerCase() && (
            <span className="mt-1 block text-[11px] font-medium text-amber-700">
              This is also their sign-in. Their password stays the same, and they will use the new address from now on.
            </span>
          )}
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
                <label key={r.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${roleIds.includes(r.id) ? 'border-[#6d4cf0] bg-violet-50' : 'border-slate-200'} ${allowed ? '' : 'opacity-40'}`}>
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
    const unsent = result.results.filter((r) => r.ok && !r.emailed && !r.inviteLink);
    return (
      <Modal title="Import finished" onClose={() => onDone(`${result.imported} people imported${result.failed ? `, ${result.failed} failed` : ''}.`)} wide>
        <Banner kind={result.failed ? 'error' : 'success'}>{result.imported} imported, {result.failed} failed.</Banner>
        {failed.length > 0 && (
          <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-rose-700">
            {failed.map((f) => <li key={f.row}>Row {f.row} ({f.email || 'no email'}): {f.error}</li>)}
          </ul>
        )}
        {unsent.length > 0 && (
          <div className="mt-3"><Banner kind="error">Invite emails were not sent to {unsent.length} {unsent.length === 1 ? 'person' : 'people'} ({unsent.slice(0, 5).map((u) => u.email).join(', ')}{unsent.length > 5 ? '…' : ''}). Use Resend invite on their row.</Banner></div>
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
  const toast = useToast();
  const [applying, setApplying] = useState(false);
  const applyHeads = async () => {
    setApplying(true);
    try {
      const r = await adminApi.syncManagers();
      toast?.(r.updated ? `Updated the manager of ${r.updated} ${r.updated === 1 ? 'person' : 'people'}.` : 'Everyone already reports to their department head.');
    } catch (e) { toast?.(message(e), 'error'); } finally { setApplying(false); }
  };
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
      <SectionHead
        title="Departments"
        subtitle="Group people and choose who leads each department."
        actions={
          <>
            <button className={ghostBtn} disabled={applying} onClick={applyHeads} title="Make every person report to the head of their department. Managers picked by hand are kept.">
              {applying && <Loader2 className="h-4 w-4 animate-spin" />} Apply department heads
            </button>
            <button className={primaryBtn} onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> Add Department</button>
          </>
        }
      />
      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => {
          const head = users.find((u) => u.id === d.headUserId);
          return (
            <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Building2 className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <div className="text-base font-extrabold text-slate-900">{d.name}</div>
                    <div className="text-xs text-slate-500">{counts.get(d.id) || 0} {(counts.get(d.id) || 0) === 1 ? 'person' : 'people'}</div>
                    <div className="mt-1 text-xs text-slate-600">Head: <span className="font-semibold">{head ? head.name : 'Not set'}</span></div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button className={iconBtn} aria-label={`Edit ${d.name}`} onClick={() => setEditing(d)}><Pencil className="h-4 w-4" /></button>
                  <button className={iconBtn} aria-label={`Delete ${d.name}`} onClick={() => remove(d)}><Trash2 className="h-4 w-4 text-rose-600" /></button>
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
          <span className="mt-1 block text-[11px] font-normal text-slate-400">People in this department report to the head. A manager picked by hand for someone is kept.</span>
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
      <SectionHead
        title="Roles & Permissions"
        subtitle="Build roles from a permission checklist. Nobody can grant a permission they do not hold."
        actions={<button className={primaryBtn} onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> New Role</button>}
      />
      {flash && <Banner kind={flash.kind}>{flash.text}</Banner>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-500"><ShieldCheck className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-extrabold text-slate-900">{r.name}</span>
                    {r.isAdmin && <Chip tone="violet">Full access</Chip>}
                  </div>
                  {r.description && <p className="text-xs text-slate-600">{r.description}</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    {PORTALS.find((p) => p.value === r.portal)?.label} · {r.isAdmin ? 'all' : r.permissions.length} permissions · {holders(r.id)} {holders(r.id) === 1 ? 'person' : 'people'}
                  </p>
                </div>
              </div>
              {!r.isAdmin && (
                <div className="flex gap-1.5">
                  <button className={iconBtn} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></button>
                  <button className={iconBtn} aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-rose-600" /></button>
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
                    <label key={p.key} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${selected.includes(p.key) ? 'bg-violet-50' : ''} ${disabled ? 'opacity-40' : ''}`}>
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
