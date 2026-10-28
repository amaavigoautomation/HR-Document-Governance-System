import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AnnouncementKind, QuickLink } from '../../../shared/home';
import { ANNOUNCEMENT_LIMITS, MAX_QUICK_LINKS } from '../../../shared/home';
import { homeService, type HomeLayout, type ManagedAnnouncement, type PersonDates } from '../../services/homeService';
import { Drawer, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, todayIst, useRunner } from '../leave/ui';
import { Tabs } from './parts';
import { useLoad } from './useLoad';

const CARD_LABEL: Record<string, string> = {
  mood: 'Mood', calendar: 'Calendar', attendance: 'Online attendance', 'quick-links': 'Quick links', 'quick-reports': 'Quick reports',
  'on-leave': 'Employees on leave', celebrations: 'Wish celebration', files: 'Important files', 'ceo-speak': 'CEO speak',
  announcements: 'Announcements', 'login-summary': 'Login summary', acknowledgements: 'Acknowledgements',
};

type Draft = { id?: string; title: string; body: string; authorName: string; authorTitle: string; pinned: boolean; publishAt: string; expireAt: string; departmentIds: string[]; active: boolean };
const blank = (): Draft => ({ title: '', body: '', authorName: '', authorTitle: '', pinned: false, publishAt: todayIst(), expireAt: '', departmentIds: [], active: true });

const AnnouncementsAdmin: React.FC<{ kind: AnnouncementKind; onChanged: () => void }> = ({ kind, onChanged }) => {
  const load = useLoad(() => homeService.announcementsAll(kind), [kind]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { busy, note, run } = useRunner();
  const edit = (a: ManagedAnnouncement) => setDraft({ id: a.id, title: a.title, body: a.body, authorName: a.authorName, authorTitle: a.authorTitle, pinned: a.pinned, publishAt: a.publishAt, expireAt: a.expireAt, departmentIds: a.departmentIds, active: a.active });
  const save = () => draft && run(async () => { await homeService.saveAnnouncement({ ...draft, kind }); setDraft(null); load.reload(); onChanged(); }, 'Saved');
  const del = (id: string) => run(async () => { await homeService.deleteAnnouncement(id); load.reload(); onChanged(); }, 'Deleted');
  const depts = load.data?.departments || [];

  if (draft) {
    return (
      <div className="space-y-3">
        <Field label="Title"><input className={input} maxLength={ANNOUNCEMENT_LIMITS.title} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
        <Field label="Message"><textarea className={input} rows={6} maxLength={ANNOUNCEMENT_LIMITS.body} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (name)" hint="Leave empty to use your name"><input className={input} maxLength={ANNOUNCEMENT_LIMITS.name} value={draft.authorName} onChange={(e) => setDraft({ ...draft, authorName: e.target.value })} /></Field>
          <Field label="Role"><input className={input} maxLength={ANNOUNCEMENT_LIMITS.name} value={draft.authorTitle} onChange={(e) => setDraft({ ...draft, authorTitle: e.target.value })} /></Field>
          <Field label="Show from"><input type="date" className={input} value={draft.publishAt} onChange={(e) => setDraft({ ...draft, publishAt: e.target.value })} /></Field>
          <Field label="Show until (optional)"><input type="date" className={input} value={draft.expireAt} onChange={(e) => setDraft({ ...draft, expireAt: e.target.value })} /></Field>
        </div>
        {depts.length > 0 && (
          <Field label="Audience" hint="No department ticked means everyone.">
            <div className="flex flex-wrap gap-2">
              {depts.map((d) => {
                const on = draft.departmentIds.includes(d.id);
                return <label key={d.id} className="text-xs inline-flex items-center gap-1"><input type="checkbox" checked={on} onChange={() => setDraft({ ...draft, departmentIds: on ? draft.departmentIds.filter((x) => x !== d.id) : [...draft.departmentIds, d.id] })} />{d.name}</label>;
              })}
            </div>
          </Field>
        )}
        <label className="text-xs inline-flex items-center gap-2"><input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />Pin to the top</label>
        <label className="text-xs inline-flex items-center gap-2 ml-4"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Active</label>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <div className="flex gap-2 justify-end"><button type="button" className={btnGhost} onClick={() => setDraft(null)}>Cancel</button><button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>Save</button></div>
      </div>
    );
  }
  const items = load.data?.items || [];
  return (
    <div>
      <button type="button" className={btnPrimary} onClick={() => setDraft(blank())}>{kind === 'CEO_SPEAK' ? 'Write a new message' : 'New announcement'}</button>
      {load.error && <p className="mt-2 text-xs text-rose-700">{load.error}</p>}
      {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}
      <ul className="mt-3 divide-y divide-slate-100">
        {items.length === 0 && <li className="py-6 text-center text-xs text-slate-400">Nothing posted yet</li>}
        {items.map((a) => (
          <li key={a.id} className="py-2 flex items-center gap-2">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => edit(a)}>
              <div className="text-xs font-bold text-slate-800 truncate">{a.title}</div>
              <div className="text-[11px] text-slate-500">{a.live ? 'Live' : a.active ? 'Scheduled or ended' : 'Off'} · from {niceDate(a.publishAt)}</div>
            </button>
            <button type="button" className={btnDanger} disabled={busy} onClick={() => void del(a.id)} aria-label={`Delete ${a.title}`}><Trash2 className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const HomeSetup: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const load = useLoad(() => homeService.settings(), []);
  const [s, setS] = useState<{ hiddenCards: string[]; quickLinks: QuickLink[]; onLeaveVisibility: 'COMPANY' | 'DEPARTMENT' } | null>(null);
  const { busy, note, run } = useRunner();
  React.useEffect(() => { if (load.data) setS({ hiddenCards: load.data.settings.hiddenCards, quickLinks: load.data.settings.quickLinks, onLeaveVisibility: load.data.settings.onLeaveVisibility }); }, [load.data]);
  if (!s) return <p className="text-xs text-slate-500">{load.error || 'Loading…'}</p>;
  const setLink = (i: number, patch: Partial<QuickLink>) => setS({ ...s, quickLinks: s.quickLinks.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="space-y-5">
      <Field label="Cards on Home" hint="Untick a card to hide it for everyone.">
        <div className="grid grid-cols-2 gap-1">
          {(load.data?.cards || []).map((c) => (
            <label key={c} className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={!s.hiddenCards.includes(c)} onChange={() => setS({ ...s, hiddenCards: s.hiddenCards.includes(c) ? s.hiddenCards.filter((x) => x !== c) : [...s.hiddenCards, c] })} />{CARD_LABEL[c] || c}</label>
          ))}
        </div>
      </Field>
      <Field label="Who can see employees on leave">
        <select className={input} value={s.onLeaveVisibility} onChange={(e) => setS({ ...s, onLeaveVisibility: e.target.value as 'COMPANY' | 'DEPARTMENT' })}>
          <option value="COMPANY">Everyone in the company</option><option value="DEPARTMENT">Only people in the same department</option>
        </select>
      </Field>
      <Field label="Quick links" hint="Web links must start with https://. Links to screens in this app are kept as they are.">
        <div className="space-y-2">
          {s.quickLinks.map((l, i) => (
            <div key={l.id} className="flex gap-2 items-center">
              <input className={input} aria-label="Label" maxLength={40} value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} />
              {l.kind === 'URL' ? <input className={input} aria-label="Address" placeholder="https://" value={l.url || ''} onChange={(e) => setLink(i, { url: e.target.value })} /> : <span className="text-[11px] text-slate-400 whitespace-nowrap">In this app</span>}
              <button type="button" className={btnDanger} aria-label={`Remove ${l.label}`} onClick={() => setS({ ...s, quickLinks: s.quickLinks.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          {s.quickLinks.length < MAX_QUICK_LINKS && <button type="button" className={btnGhost} onClick={() => setS({ ...s, quickLinks: [...s.quickLinks, { id: `q-${Date.now()}`, label: '', kind: 'URL', url: 'https://' }] })}>Add a web link</button>}
        </div>
      </Field>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run(async () => { await homeService.saveSettings(s); onChanged(); }, 'Saved')}>Save</button>
    </div>
  );
};

/** Birthdays and marriage dates in bulk: one row per line, "email, birth date, marriage date". */
const DatesImport: React.FC = () => {
  const load = useLoad(() => homeService.peopleDates(), []);
  const [text, setText] = useState('');
  const { busy, note, run } = useRunner();
  const [skipped, setSkipped] = useState<string[]>([]);
  const submit = () => run(async () => {
    const rows = text.split(/\r?\n/).map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((c) => c[0]).map(([email, dob, marriageDate]) => ({ email, dob: dob || '', marriageDate: marriageDate || '' }));
    const r = await homeService.savePeopleDates(rows);
    setSkipped(r.skipped || []);
    setText('');
    load.reload();
  }, 'Saved');
  const people: PersonDates[] = load.data?.people || [];
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600">Paste one person per line: <code>email, birth date, marriage date</code> with dates as YYYY-MM-DD. Colleagues only ever see the day and month. A person's own choice to hide themselves is kept.</p>
      <textarea className={`${input} font-mono`} rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="asha@company.com, 1994-03-21," />
      <button type="button" className={btnPrimary} disabled={busy || !text.trim()} onClick={() => void submit()}>Save dates</button>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {skipped.length > 0 && <Notice tone="warn">Not saved: {skipped.join(', ')}</Notice>}
      <p className="text-[11px] text-slate-500">{people.filter((p) => p.dob).length} of {people.length} people have a birth date.</p>
    </div>
  );
};

type Tab = 'announcements' | 'ceo' | 'setup' | 'dates';

export const ManageHome: React.FC<{ open: boolean; onClose: () => void; can: HomeLayout['can']; onChanged: () => void }> = ({ open, onClose, can, onChanged }) => {
  const items = [
    ...(can.announce ? [{ value: 'announcements' as Tab, label: 'Announcements' }, { value: 'ceo' as Tab, label: 'CEO message' }] : []),
    ...(can.manageHome ? [{ value: 'setup' as Tab, label: 'Cards and links' }] : []),
    ...(can.people ? [{ value: 'dates' as Tab, label: 'Dates' }] : []),
  ];
  const [tab, setTab] = useState<Tab>(items[0]?.value || 'announcements');
  const cur = items.some((i) => i.value === tab) ? tab : items[0]?.value;
  return (
    <Drawer open={open} onClose={onClose} title="Manage Home" subtitle="What people see when they sign in">
      {items.length === 0 ? <p className="text-xs text-slate-500">You have nothing to manage here.</p> : (
        <>
          <Tabs value={cur as Tab} onChange={setTab} items={items} />
          {cur === 'announcements' && <AnnouncementsAdmin kind="ANNOUNCEMENT" onChanged={onChanged} />}
          {cur === 'ceo' && <AnnouncementsAdmin kind="CEO_SPEAK" onChanged={onChanged} />}
          {cur === 'setup' && <HomeSetup onChanged={onChanged} />}
          {cur === 'dates' && <DatesImport />}
        </>
      )}
    </Drawer>
  );
};
