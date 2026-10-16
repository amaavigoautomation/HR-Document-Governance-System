import React, { useMemo, useState } from 'react';
import { Search, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';
import { HrLevel, User, UserRole } from '../types';
import { isFounder } from '../utils/requisitionPermissions';
import { setDepartmentHead, setHrLevel } from '../services/requisitionService';

interface Props {
  currentUser: User;
  users: User[];
}

export const RolesPanel: React.FC<Props> = ({ currentUser, users }) => {
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const founder = isFounder(currentUser);

  const q = search.trim().toLowerCase();
  const match = (u: User) =>
    !q || [u.name, u.email, u.departmentName, u.empId, u.loginId].some((v) => (v || '').toLowerCase().includes(q));

  const hrUsers = useMemo(
    () => users.filter((u) => u.role === UserRole.CREATOR && u.active !== false && match(u)).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, q]
  );
  const employees = useMemo(
    () => users.filter((u) => u.role === UserRole.EMPLOYEE && u.active !== false && match(u)).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, q]
  );

  const run = async (id: string, fn: () => Promise<void>) => {
    setError(null);
    setBusyId(id);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Could not update the role.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 text-sm font-black text-slate-900">
          <ShieldCheck className="w-4 h-4 text-[#FA7014]" /> Hiring roles
        </div>
        <p className="mt-1 text-xs text-slate-500">
          The founder appoints the Head HR. The founder and Head HR choose which employees are department heads (they can raise requisitions).
          Every change is written to the audit log.
        </p>
        <div className="relative mt-3 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA7014]/30"
            placeholder="Search people"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500">HR team</h3>
        <ul className="divide-y divide-slate-100">
          {hrUsers.length === 0 && <li className="p-4 text-xs text-slate-500">No HR users found.</li>}
          {hrUsers.map((u) => {
            const level: HrLevel = u.hrLevel === 'HEAD' ? 'HEAD' : 'STANDARD';
            return (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{u.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{u.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  {busyId === u.id && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                  <select
                    disabled={!founder || busyId === u.id}
                    value={level}
                    title={founder ? 'Change HR level' : 'Only the founder can change HR levels'}
                    onChange={(e) => run(u.id, () => setHrLevel(currentUser, u, e.target.value as HrLevel, users))}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="STANDARD">HR</option>
                    <option value="HEAD">Head HR</option>
                  </select>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500">
          Employees ({employees.length})
        </h3>
        <ul className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
          {employees.length === 0 && <li className="p-4 text-xs text-slate-500">No employees found.</li>}
          {employees.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 truncate">{u.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {u.departmentName} {u.title ? `- ${u.title}` : ''}
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                {busyId === u.id && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#FA7014]"
                  checked={u.isDepartmentHead === true}
                  disabled={busyId === u.id}
                  onChange={(e) => run(u.id, () => setDepartmentHead(currentUser, u, e.target.checked))}
                />
                Department head
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
