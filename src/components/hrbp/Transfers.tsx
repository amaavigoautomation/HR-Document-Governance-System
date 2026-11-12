import React, { useState } from 'react';
import { hrbpService } from '../../services/hrbpService';
import { User } from '../../types';
import { Notice, useRunner } from '../leave/ui';
import { Loading, useLoad } from '../common/loadUi';
import { btnViolet, dmy, field, Panel, Pill } from '../leave/kit';

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Move someone to another department, business unit or manager. Their mapping and the org chart are updated in one go. */
export const Transfers: React.FC<{ users: User[] }> = ({ users }) => {
  const list = useLoad(() => hrbpService.get('transfer-list'), []);
  const units = useLoad(() => hrbpService.get('bu-list'), []);
  const [f, setF] = useState({ employeeUid: '', department: '', businessUnit: '', managerUid: '', effectiveDate: today(), reason: '' });
  const { run, busy, note } = useRunner();
  const staff = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const depts = Array.from(new Set(users.map((u) => u.departmentName).filter(Boolean))) as string[];
  const who = staff.find((u) => u.id === f.employeeUid);
  const items: any[] = list.data?.items || [];
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const label = 'block text-sm font-semibold text-slate-900';

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title="Transfer history">
        <Loading error={list.error} loading={list.loading} />
        {!list.loading && items.length === 0 && <p className="py-6 text-center text-sm text-slate-600">No transfers recorded yet.</p>}
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <li key={t.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-slate-900">{t.employeeName}</b><Pill tone="blue">{dmy(t.effectiveDate)}</Pill></div>
              <div className="mt-1 text-slate-700">
                {t.from.department !== t.to.department && <div>Department: {t.from.department || 'none'} → <b>{t.to.department}</b></div>}
                {t.from.businessUnit !== t.to.businessUnit && <div>Business unit: {t.from.businessUnit || 'none'} → <b>{t.to.businessUnit}</b></div>}
                {t.from.managerName !== t.to.managerName && <div>Manager: {t.from.managerName || 'none'} → <b>{t.to.managerName}</b></div>}
              </div>
              <div className="mt-1 text-xs text-slate-600">{t.reason} · recorded by {t.createdBy}</div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="New transfer">
        <p className="mb-3 text-xs text-slate-600">Fill in only what changes. It takes effect straight away, and the reporting line, business unit and org chart follow.</p>
        {note && <div className="mb-3"><Notice tone={note.tone}>{note.text}</Notice></div>}
        <div className="space-y-3">
          <label className={label}>Employee
            <select className={`${field} mt-1 w-full font-normal`} value={f.employeeUid} onChange={(e) => set({ employeeUid: e.target.value })}>
              <option value="">Choose a person</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}{u.departmentName ? ` - ${u.departmentName}` : ''}</option>)}
            </select>
          </label>
          {who && <p className="text-xs text-slate-600">Now in {who.departmentName || 'no department'}.</p>}
          <label className={label}>New department
            <input list="hrbp-depts" className={`${field} mt-1 w-full font-normal`} value={f.department} onChange={(e) => set({ department: e.target.value })} placeholder="Leave empty if unchanged" />
            <datalist id="hrbp-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
          </label>
          <label className={label}>New business unit
            <input list="hrbp-units" className={`${field} mt-1 w-full font-normal`} value={f.businessUnit} onChange={(e) => set({ businessUnit: e.target.value })} placeholder="Leave empty if unchanged" />
            <datalist id="hrbp-units">{(units.data?.items || []).map((u: any) => <option key={u.id} value={u.name} />)}</datalist>
          </label>
          <label className={label}>New manager
            <select className={`${field} mt-1 w-full font-normal`} value={f.managerUid} onChange={(e) => set({ managerUid: e.target.value })}>
              <option value="">Unchanged</option>
              {staff.filter((u) => u.id !== f.employeeUid).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className={label}>Effective date
            <input type="date" max={today()} className={`${field} mt-1 w-full font-normal`} value={f.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
          </label>
          <label className={label}>Reason
            <textarea rows={2} maxLength={300} className="mt-1 w-full rounded-xl border border-slate-200 p-3 text-sm font-normal outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200" value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
          </label>
          <button type="button" className={`${btnViolet} w-full`} disabled={busy || !f.employeeUid || !f.reason.trim()} onClick={() => run(async () => {
            await hrbpService.post('transfer-save', { ...f });
            setF({ employeeUid: '', department: '', businessUnit: '', managerUid: '', effectiveDate: today(), reason: '' });
            await list.reload();
          }, 'Transfer recorded. The org chart is updated.')}>{busy ? 'Saving…' : 'Record transfer'}</button>
        </div>
      </Panel>
    </div>
  );
};
