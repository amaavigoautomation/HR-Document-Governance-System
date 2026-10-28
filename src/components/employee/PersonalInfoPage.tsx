import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { PERSONAL_FIELDS, PERSONAL_GROUPS, type PersonalField, type PersonalTab } from '../../../shared/employeePersonal';
import { Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';

type Values = Record<string, string | boolean>;
const TABS: { key: PersonalTab; label: string; blurb: string }[] = [
  { key: 'general', label: 'General', blurb: 'Employment, languages and addresses' },
  { key: 'contact', label: 'Contact', blurb: 'How to reach you outside work' },
  { key: 'emergency', label: 'Emergency contacts', blurb: 'Who we call if something happens' },
];
// The wedding anniversary sits with the employment group on screen; it is saved separately on the server.
const ANNIVERSARY: PersonalField = { key: 'anniversaryDate', label: 'Wedding anniversary', kind: 'date', group: 'employment' };

const fieldsOf = (group: string) => [...PERSONAL_FIELDS, ANNIVERSARY].filter((x) => x.group === group);

const Row: React.FC<{ fd: PersonalField; value: string | boolean; editing: boolean; onChange: (v: string | boolean) => void }> = ({ fd, value, editing, onChange }) => {
  const long = fd.kind === 'long';
  if (!editing) {
    const shown = fd.kind === 'bool' ? (value ? 'Yes' : 'No') : fd.kind === 'date' ? (value ? niceDate(String(value)) : '') : String(value || '');
    return (
      <div className={long ? 'sm:col-span-2' : ''}>
        <dt className="text-[11px] font-semibold text-slate-500">{fd.label}</dt>
        <dd className={`text-sm break-words ${shown ? 'text-slate-800' : 'text-slate-300'}`}>{shown || 'Not added'}</dd>
      </div>
    );
  }
  if (fd.kind === 'bool') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />{fd.label}
      </label>
    );
  }
  return (
    <label className={`block text-xs font-semibold text-slate-600 space-y-1 ${long ? 'sm:col-span-2' : ''}`}>
      <span>{fd.label}</span>
      {long
        ? <textarea rows={2} maxLength={fd.max} className={input} value={String(value || '')} onChange={(e) => onChange(e.target.value)} />
        : <input type={fd.kind === 'date' ? 'date' : fd.kind === 'email' ? 'email' : fd.kind === 'phone' ? 'tel' : 'text'} maxLength={fd.max} className={input} value={String(value || '')} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
};

/** Personal Information: three tabs, each a set of cards that read like a profile and turn into inputs when you press Edit. */
export const PersonalInfoPage: React.FC<{ uid?: string }> = ({ uid }) => {
  const [saved, setSaved] = useState<Values | null>(null);
  const [draft, setDraft] = useState<Values>({});
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<PersonalTab>('general');
  const [editing, setEditing] = useState(false);
  const { busy, note, setNote, run } = useRunner();

  const load = useCallback(() => lifecycleService.personal(uid).then((d) => { setSaved(d.values); setErr(null); }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { setSaved(null); setEditing(false); setTab('general'); setNote(null); load(); }, [load, setNote]);

  const groups = useMemo(() => PERSONAL_GROUPS.filter((g) => g.tab === tab), [tab]);
  if (err) return <Notice tone="error">{err}</Notice>;
  if (!saved) return <div className="text-sm text-slate-500">Loading…</div>;

  const values = editing ? draft : saved;
  const start = () => { setDraft({ ...saved }); setNote(null); setEditing(true); };
  const changeTab = (t: PersonalTab) => { if (editing) return; setTab(t); setNote(null); };
  const save = () => run(async () => {
    const send: Values = {};
    for (const g of groups) for (const fd of fieldsOf(g.group)) send[fd.key] = draft[fd.key] ?? (fd.kind === 'bool' ? false : '');
    await lifecycleService.savePersonal(uid, send);
    await load();
    setEditing(false);
  }, 'Saved');

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} disabled={editing && tab !== t.key} onClick={() => changeTab(t.key)}
              className={`px-3.5 py-2 rounded-lg transition-colors disabled:opacity-40 ${tab === t.key ? 'bg-[#FA7014] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t.label}</button>
          ))}
        </div>
        {editing ? (
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy}>Save changes</button>
          </div>
        ) : <button type="button" className={btnGhost} onClick={start}><Pencil className="w-3.5 h-3.5" />Edit</button>}
      </div>
      <p className="text-xs text-slate-500">{TABS.find((t) => t.key === tab)!.blurb}. Only you and HR can see this page.</p>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      <div className={`grid gap-4 ${tab === 'emergency' ? 'md:grid-cols-2' : ''}`}>
        {groups.map((g) => (
          <section key={g.group} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-800">{g.title}</h3>
              {editing && g.group === 'addresses' && (
                <button type="button" className="text-[11px] font-bold text-[#FA7014]" onClick={() => setDraft({ ...draft, postalAddress: draft.permanentAddress || '' })}>Postal is the same as permanent</button>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {fieldsOf(g.group).map((fd) => (
                <Row key={fd.key} fd={fd} value={values[fd.key] ?? (fd.kind === 'bool' ? false : '')} editing={editing} onChange={(v) => setDraft({ ...draft, [fd.key]: v })} />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
};
