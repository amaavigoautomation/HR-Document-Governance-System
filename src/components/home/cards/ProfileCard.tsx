import React, { useState } from 'react';
import { CalendarHeart } from 'lucide-react';
import { Card, Drawer, Field, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../../leave/ui';
import { homeService, type HomeProfile, type PersonStatus } from '../../../services/homeService';
import { Avatar } from '../parts';
import { useLoad } from '../useLoad';

const STATUS_LOOK: Record<PersonStatus, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ON_LEAVE: { label: 'On leave', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  INACTIVE: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const PersonRow: React.FC<{ role: string; name: string; title?: string; status: PersonStatus; note?: string }> = ({ role, name, title, status, note }) => {
  const look = STATUS_LOOK[status];
  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{role}</div>
        <div className="text-sm font-semibold text-slate-800 truncate">{name}</div>
        {(title || note) && <div className="text-[11px] text-slate-500 truncate">{note || title}</div>}
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${look.cls}`}>{look.label}</span>
    </div>
  );
};

/** The person's own birth date, marriage date and whether to show them in celebrations. */
const MyDatesDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const load = useLoad(() => homeService.myDates(), [open]);
  const [form, setForm] = useState<{ dob: string; marriageDate: string; showCelebrations: boolean; showMarriage: boolean } | null>(null);
  const { busy, note, run } = useRunner();
  React.useEffect(() => { if (load.data) setForm(load.data); }, [load.data]);

  return (
    <Drawer
      open={open} onClose={onClose} title="My dates" subtitle="Used for birthday and anniversary wishes on Home"
      footer={<div className="flex gap-2 justify-end"><button type="button" className={btnGhost} onClick={onClose}>Close</button>
        <button type="button" className={btnPrimary} disabled={busy || !form} onClick={() => form && run(async () => { await homeService.saveMyDates(form); onClose(); }, 'Saved')}>Save</button></div>}
    >
      {!form ? <p className="text-xs text-slate-500">Loading…</p> : (
        <div className="space-y-4">
          <Field label="Date of birth" hint="Colleagues see only the day and month, never the year.">
            <input type="date" className={input} value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </Field>
          <Field label="Marriage anniversary (optional)">
            <input type="date" className={input} value={form.marriageDate} onChange={(e) => setForm({ ...form, marriageDate: e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={form.showMarriage} onChange={(e) => setForm({ ...form, showMarriage: e.target.checked })} />
            <span>Show my marriage anniversary to colleagues<span className="block text-slate-400">Off by default. It is never shown unless you turn this on.</span></span>
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={!form.showCelebrations} onChange={(e) => setForm({ ...form, showCelebrations: !e.target.checked })} />
            <span>Do not show me in any celebration<span className="block text-slate-400">Hides your birthday and work anniversary too.</span></span>
          </label>
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
        </div>
      )}
    </Drawer>
  );
};

export const ProfileCard: React.FC<{ fallbackName: string; refreshKey: number }> = ({ fallbackName, refreshKey }) => {
  const load = useLoad(() => homeService.profile(), [refreshKey]);
  const [datesOpen, setDatesOpen] = useState(false);
  const p: HomeProfile | null = load.data;
  const name = p?.name || fallbackName;

  return (
    <Card className="overflow-hidden !p-0">
      <div className="h-16 bg-gradient-to-r from-orange-100 via-orange-50 to-amber-100" />
      <div className="px-4 pb-4 -mt-8 text-center">
        <div className="flex justify-center"><span className="ring-4 ring-white rounded-full"><Avatar name={name || '?'} size="lg" /></span></div>
        <h2 className="mt-2 text-base font-black text-slate-800">{name}</h2>
        <p className="text-xs text-slate-500">{[p?.title, p?.department].filter(Boolean).join(' · ') || ' '}</p>
        {p?.joinDate && <p className="text-[11px] text-slate-400 mt-0.5">Joined {niceDate(p.joinDate)}{p.empId ? ` · ${p.empId}` : ''}</p>}
      </div>
      <div className="border-t border-slate-100 px-4 py-1 divide-y divide-slate-100">
        {load.error && <p className="py-2 text-xs text-rose-700">{load.error} <button type="button" className="underline font-bold" onClick={load.reload}>Retry</button></p>}
        {p?.reportingManager && <PersonRow role="Reporting manager" name={p.reportingManager.name} title={p.reportingManager.title} status={p.reportingManager.status} />}
        {p?.approvingManager && (
          <PersonRow
            role="Approving manager" name={p.approvingManager.name} title={p.approvingManager.title} status={p.approvingManager.status}
            note={p.approvingManager.covering ? 'Covering today' : undefined}
          />
        )}
        {p && !p.reportingManager && !load.error && <p className="py-3 text-xs text-slate-500">No manager is set for you yet. HR approves your requests.</p>}
      </div>
      <div className="border-t border-slate-100 px-4 py-2">
        <button type="button" className="text-xs font-bold text-[#FA7014] inline-flex items-center gap-1 hover:underline" onClick={() => setDatesOpen(true)}>
          <CalendarHeart className="w-3.5 h-3.5" /> My birthday and dates
        </button>
      </div>
      <MyDatesDrawer open={datesOpen} onClose={() => setDatesOpen(false)} />
    </Card>
  );
};
