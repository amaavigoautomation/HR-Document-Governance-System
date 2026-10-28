import React, { useCallback, useEffect, useState } from 'react';
import { HeartPulse, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import {
  BLOOD_GROUPS, FAMILY_EMPLOYMENT, FAMILY_GENDERS, FAMILY_RELATIONS, FAMILY_TITLES, MARITAL_STATUSES, type FamilyMember,
} from '../../../shared/employeeFamily';
import { Drawer, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { Avatar } from '../home/parts';

type Member = FamilyMember & { id: string };
const blank: FamilyMember = {
  title: '', name: '', gender: '', relation: '', address: '', bloodGroup: '', contactNo: '', dob: '', maritalStatus: '', marriageDate: '',
  employment: '', profession: '', nationality: '', insuranceNumber: '', remarks: '', isDependent: false, healthInsurance: false,
};

const Select: React.FC<{ label: string; value: string; options: readonly string[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
  <Field label={label}>
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Not set</option>{options.map((o) => <option key={o}>{o}</option>)}</select>
  </Field>
);

const MemberDrawer: React.FC<{ open: boolean; initial: Member | null; uid?: string; onClose: () => void; onSaved: () => void }> = ({ open, initial, uid, onClose, onSaved }) => {
  const [m, setM] = useState<FamilyMember>(blank);
  const { busy, note, setNote, run } = useRunner();
  useEffect(() => { if (open) { setM(initial ? { ...blank, ...initial } : blank); setNote(null); } }, [open, initial, setNote]);
  const set = <K extends keyof FamilyMember>(k: K, v: FamilyMember[K]) => setM((x) => ({ ...x, [k]: v }));
  const text = (k: keyof FamilyMember, label: string, type = 'text') => (
    <Field label={label}><input type={type} className={input} value={String(m[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} /></Field>
  );
  const married = ['Married', 'Divorced', 'Widowed'].includes(m.maritalStatus);
  return (
    <Drawer open={open} onClose={onClose} title={initial ? 'Edit family member' : 'Add family member'}
      footer={<div className="flex gap-2 justify-end"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(async () => { await lifecycleService.saveFamily({ uid, id: initial?.id, member: m }); onSaved(); onClose(); }, initial ? 'Saved' : 'Added')}>{initial ? 'Save' : 'Add'}</button></div>}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Who</h4>
          <div className="grid grid-cols-3 gap-3">
            <Select label="Title" value={m.title} options={FAMILY_TITLES} onChange={(v) => set('title', v)} />
            <div className="col-span-2">{text('name', 'Name')}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Relation" value={m.relation} options={FAMILY_RELATIONS} onChange={(v) => set('relation', v)} />
            <Select label="Gender" value={m.gender} options={FAMILY_GENDERS} onChange={(v) => set('gender', v)} />
            {text('dob', 'Date of birth', 'date')}
            <Select label="Blood group" value={m.bloodGroup} options={BLOOD_GROUPS} onChange={(v) => set('bloodGroup', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">{text('contactNo', 'Contact no.', 'tel')}{text('nationality', 'Nationality')}</div>
          {text('address', 'Address')}
        </section>
        <section className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Marriage and work</h4>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Marital status" value={m.maritalStatus} options={MARITAL_STATUSES} onChange={(v) => set('maritalStatus', v)} />
            {married && text('marriageDate', 'Marriage date', 'date')}
            <Select label="Employment" value={m.employment} options={FAMILY_EMPLOYMENT} onChange={(v) => set('employment', v)} />
            {text('profession', 'Profession')}
          </div>
        </section>
        <section className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Dependent and insurance</h4>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={m.isDependent} onChange={(e) => set('isDependent', e.target.checked)} />Depends on me financially</label>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={m.healthInsurance} onChange={(e) => set('healthInsurance', e.target.checked)} />Covered by my health insurance</label>
          {m.healthInsurance && text('insuranceNumber', 'Insurance number')}
          {text('remarks', 'Remarks')}
          <p className="text-[11px] text-slate-400">Photocopies cannot be attached yet. Share them with HR directly for now.</p>
        </section>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
    </Drawer>
  );
};

/** Family Details: one card per person. Add, edit and remove from the cards. */
export const FamilyDetailsPage: React.FC<{ uid?: string }> = ({ uid }) => {
  const [data, setData] = useState<{ members: Member[]; max: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; member: Member | null }>({ open: false, member: null });
  const [confirm, setConfirm] = useState<string | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(() => lifecycleService.family(uid).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { setData(null); setConfirm(null); load(); }, [load]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const { members } = data;
  const dependents = members.filter((x) => x.isDependent).length;
  const insured = members.filter((x) => x.healthInsurance).length;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4 text-slate-400" />{members.length} {members.length === 1 ? 'member' : 'members'}</span>
          <span>{dependents} dependent</span><span>{insured} insured</span>
        </div>
        <div className="flex gap-2">
          <button type="button" aria-label="Refresh" className={btnGhost} onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" /></button>
          <button type="button" className={btnPrimary} disabled={members.length >= data.max} onClick={() => setDrawer({ open: true, member: null })}><Plus className="w-3.5 h-3.5" />Add member</button>
        </div>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {members.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl py-10 text-center">
          <Users className="w-8 h-8 mx-auto text-slate-300" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-slate-700">No family members added yet</p>
          <p className="text-xs text-slate-500">Add your spouse, children and parents. Mark who depends on you and who is on your health insurance.</p>
        </div>
      ) : (
        <ul className="grid md:grid-cols-2 gap-3">
          {members.map((x) => (
            <li key={x.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Avatar name={x.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800 truncate">{[x.title, x.name].filter(Boolean).join(' ')}</div>
                  <div className="text-xs text-slate-500">{[x.relation, x.gender].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="flex gap-0.5">
                  <button type="button" aria-label={`Edit ${x.name}`} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setDrawer({ open: true, member: x })}><Pencil className="w-4 h-4" /></button>
                  <button type="button" aria-label={`Remove ${x.name}`} className="p-2 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirm(x.id)}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {x.isDependent && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-sky-50 text-sky-700 border-sky-200">Dependent</span>}
                {x.healthInsurance && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200"><ShieldCheck className="w-3 h-3" />Insured{x.insuranceNumber ? ` · ${x.insuranceNumber}` : ''}</span>}
                {x.bloodGroup && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200"><HeartPulse className="w-3 h-3" />{x.bloodGroup}</span>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {([['Contact', x.contactNo], ['Born', x.dob ? niceDate(x.dob) : ''], ['Marital status', x.maritalStatus], ['Married on', x.marriageDate ? niceDate(x.marriageDate) : ''], ['Work', [x.employment, x.profession].filter(Boolean).join(' · ')], ['Nationality', x.nationality]] as const)
                  .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-slate-400">{k}</dt><dd className="text-slate-700 break-words">{v}</dd></div>)}
              </dl>
              {x.remarks && <p className="mt-2 text-[11px] text-slate-500">{x.remarks}</p>}
              {confirm === x.id && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                  <span className="text-xs text-slate-600 mr-auto">Remove {x.name}?</span>
                  <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>Keep</button>
                  <button type="button" className={btnDanger} disabled={busy} onClick={() => run(async () => { await lifecycleService.deleteFamily({ uid, id: x.id }); setConfirm(null); await load(); }, 'Removed')}>Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <MemberDrawer open={drawer.open} initial={drawer.member} uid={uid} onClose={() => setDrawer({ open: false, member: null })} onSaved={() => void load()} />
    </div>
  );
};
