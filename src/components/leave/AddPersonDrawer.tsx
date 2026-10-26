import React, { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { adminApi, subscribeToDepartments, subscribeToRoles } from '../../services/adminService';
import { leaveService } from '../../services/leaveService';
import type { Department, User } from '../../types';
import type { RoleDef } from '../../../shared/permissions';
import { btnGhost, btnPrimary, Drawer, Field, input, Notice, todayIst } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  currentUser: User;
  settings: { locations: { id: string; name: string }[]; policies: { id: string; name: string }[] };
  /** Active people who can be picked as the approver. */
  managers: { uid: string; name: string }[];
  /** Called after the person exists (and their leave details are saved, when that worked). */
  onAdded: (message: string) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/**
 * Adds a new person from Leave → Manage → People: creates the account (same server rules as Administration → People,
 * so it needs the "manage people" permission), sends the invite, then saves their office, policy, approver and join date.
 */
export const AddPersonDrawer: React.FC<Props> = ({ open, onClose, currentUser, settings, managers, onAdded }) => {
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const empty = { name: '', email: '', title: '', departmentId: '', roleIds: [] as string[], locationId: '', policyId: '', managerUid: '', joinDate: todayIst(), gender: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [warn, setWarn] = useState('');
  // Set when the account exists but the invite email is not confirmed sent: the panel then explains and offers a retry.
  const [created, setCreated] = useState<{ userId: string; inviteError?: string } | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!open) return;
    const a = subscribeToRoles(setRoles);
    const b = subscribeToDepartments(setDepartments);
    return () => { a(); b(); };
  }, [open]);

  // A role is offered only if the person adding could grant everything in it (the server checks this too).
  const assignable = useMemo(
    () => roles.filter((r) => (currentUser.isCompanyAdmin ? true : !r.isAdmin && r.permissions.every((p) => currentUser.perms?.includes(p)))),
    [roles, currentUser],
  );
  // Default to the plain employee role once roles load.
  useEffect(() => {
    if (!open || f.roleIds.length || assignable.length === 0) return;
    const emp = assignable.find((r) => r.id.endsWith('_employee')) || assignable[0];
    setF((x) => ({ ...x, roleIds: [emp.id] }));
  }, [open, assignable, f.roleIds.length]);

  const set = (patch: Partial<typeof empty>) => setF((x) => ({ ...x, ...patch }));
  const toggleRole = (id: string) => set({ roleIds: f.roleIds.includes(id) ? f.roleIds.filter((r) => r !== id) : [...f.roleIds, id] });

  const close = () => { setF(empty); setError(''); setInviteLink(''); setWarn(''); setCreated(null); onClose(); };

  const retry = async () => {
    if (!created) return;
    setRetrying(true); setError('');
    try {
      const r = await adminApi.resendInvite(created.userId);
      if (r.emailed) { onAdded(`Invite emailed to ${f.email.trim()}.`); close(); return; }
      setInviteLink(r.inviteLink || '');
      setCreated({ ...created, inviteError: r.inviteLink ? undefined : 'The email could not be sent.' });
    } catch (e) { setError(message(e)); } finally { setRetrying(false); }
  };

  const submit = async () => {
    setError(''); setWarn('');
    if (f.name.trim().length < 2) return setError('Enter the full name.');
    if (!f.email.trim()) return setError('Enter the work email.');
    if (!f.roleIds.length) return setError('Choose at least one role.');
    setBusy(true);
    try {
      const r = await adminApi.createUser({ name: f.name.trim(), email: f.email.trim(), title: f.title.trim(), departmentId: f.departmentId, roleIds: f.roleIds });
      let leaveSaved = true;
      try {
        await leaveService.saveProfiles([{ uid: r.userId, locationId: f.locationId, policyId: f.policyId, managerUid: f.managerUid, joinDate: f.joinDate, gender: f.gender }]);
      } catch { leaveSaved = false; }
      const done = `${f.name.trim()} added (${r.empId}).${r.emailed ? ` An invite was emailed to ${f.email.trim()}.` : ''}`;
      if (!r.emailed) {
        // Never claim an invite went out when it did not: show the link, or the reason, and let them try again.
        setInviteLink(r.inviteLink || '');
        setCreated({ userId: r.userId, inviteError: r.inviteLink ? undefined : r.inviteError || 'The invite could not be created.' });
        setWarn(leaveSaved ? '' : 'Their leave details could not be saved. Set them in the table.');
        onAdded(`${f.name.trim()} added (${r.empId}). The invite email was NOT sent.`);
        return;
      }
      onAdded(leaveSaved ? done : `${done} Their leave details could not be saved. Set them in the table.`);
      close();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={close} title="Add a person" subtitle="Creates their account, emails an invite and sets up their leave."
      footer={created ? <div className="flex justify-end gap-2"><button className={btnGhost} onClick={retry} disabled={retrying}>{retrying ? 'Sending…' : 'Send invite again'}</button><button className={btnPrimary} onClick={close}>Done</button></div> : (
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={close} disabled={busy}>Cancel</button>
          <button className={btnPrimary} onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add and invite'}</button>
        </div>)}>
      {created ? (
        <div className="space-y-3">
          {error && <Notice tone="error">{error}</Notice>}
          <Notice tone="warn">{f.name.trim()}'s account was created, but the invite email was not sent{created.inviteError ? ` (${created.inviteError})` : ''}. {inviteLink ? 'Share this link so they can set a password, or try sending again:' : 'Try sending again, or use Administration → People → Resend invite.'}</Notice>
          {warn && <Notice tone="warn">{warn}</Notice>}
          {inviteLink && (
            <div className="flex gap-2">
              <input readOnly className={`${input} font-mono text-[11px]`} value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
              <button className={btnGhost} aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(inviteLink)}><Copy className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {error && <Notice tone="error">{error}</Notice>}
          <Field label="Full name"><input className={input} value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Field>
          <Field label="Work email"><input className={input} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Job title"><input className={input} value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Department">
              <select className={input} value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
                <option value="">No department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <fieldset>
            <legend className="text-xs font-semibold text-slate-600 mb-1">Roles</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {assignable.map((r) => (
                <label key={r.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${f.roleIds.includes(r.id) ? 'border-[#FA7014] bg-orange-50' : 'border-slate-200'}`}>
                  <input type="checkbox" checked={f.roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />
                  <span className="font-bold text-slate-800">{r.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Leave and attendance</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Office">
              <select className={input} value={f.locationId} onChange={(e) => set({ locationId: e.target.value })}>
                <option value="">Default office</option>
                {settings.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Leave policy">
              <select className={input} value={f.policyId} onChange={(e) => set({ policyId: e.target.value })}>
                <option value="">Default policy</option>
                {settings.policies.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Approver (manager)">
              <select className={input} value={f.managerUid} onChange={(e) => set({ managerUid: e.target.value })}>
                <option value="">None (HR approves)</option>
                {managers.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Joined"><input type="date" className={input} value={f.joinDate} onChange={(e) => set({ joinDate: e.target.value })} /></Field>
            <Field label="Gender">
              <select className={input} value={f.gender} onChange={(e) => set({ gender: e.target.value })}>
                <option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
              </select>
            </Field>
          </div>
        </div>
      )}
    </Drawer>
  );
};
