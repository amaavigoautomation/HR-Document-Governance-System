import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Award, FileImage, GraduationCap, Paperclip, Pencil, Plus, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import {
  COURSE_NATURES, COURSE_TYPES, QUALIFICATIONS, QUALIFICATION_STATUSES, STREAMS, durationText, type Qualification,
} from '../../../shared/employeeQualification';
import { Drawer, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { shrinkImage } from './shrinkImage';

type Item = Qualification & { id: string; hasDocument?: boolean; docKb?: number };
const blank: Qualification = {
  qualification: '', streamType: '', courseType: '', specialization: '', nature: '', status: 'Completed', instituteName: '', universityName: '',
  fromDate: '', toDate: '', dateOfPassing: '', percentage: '', grade: '', isHighest: false, remarks: '',
};
const STATUS_LOOK: Record<string, string> = {
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200', Pursuing: 'bg-sky-50 text-sky-700 border-sky-200', Discontinued: 'bg-slate-100 text-slate-600 border-slate-200',
};

const Select: React.FC<{ label: string; value: string; options: readonly string[]; onChange: (v: string) => void; disabled?: boolean; hint?: string }> = ({ label, value, options, onChange, disabled, hint }) => (
  <Field label={label} hint={hint}>
    <select className={input} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}><option value="">Not set</option>{options.map((o) => <option key={o}>{o}</option>)}</select>
  </Field>
);

const ItemDrawer: React.FC<{ open: boolean; initial: Item | null; uid?: string; onClose: () => void; onSaved: () => void }> = ({ open, initial, uid, onClose, onSaved }) => {
  const [q, setQ] = useState<Qualification>(blank);
  const [file, setFile] = useState<File | null>(null);
  const { busy, note, setNote, run } = useRunner();
  useEffect(() => { if (open) { setQ(initial ? { ...blank, ...initial } : blank); setFile(null); setNote(null); } }, [open, initial, setNote]);
  const set = <K extends keyof Qualification>(k: K, v: Qualification[K]) => setQ((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Qualification, label: string, type = 'text', hint?: string) => (
    <Field label={label} hint={hint}><input type={type} className={input} value={String(q[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} /></Field>
  );
  const pursuing = q.status === 'Pursuing';
  const length = durationText(q.fromDate, q.toDate);
  return (
    <Drawer open={open} onClose={onClose} title={initial ? 'Edit qualification' : 'Add qualification'}
      footer={<div className="flex gap-2 justify-end"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(async () => {
          const saved = await lifecycleService.saveQualification({ uid, id: initial?.id, item: q });
          if (file) await lifecycleService.setQualificationDoc({ uid, id: saved.id, dataUrl: await shrinkImage(file) });
          onSaved(); onClose();
        }, initial ? 'Saved' : 'Added')}>{initial ? 'Save' : 'Add'}</button></div>}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">What you studied</h4>
          <Select label="Qualification" value={q.qualification} options={QUALIFICATIONS} onChange={(v) => set('qualification', v)} />
          {q.qualification ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Stream" value={q.streamType} options={STREAMS} onChange={(v) => set('streamType', v)} />
                <Select label="Course type" value={q.courseType} options={COURSE_TYPES} onChange={(v) => set('courseType', v)} />
              </div>
              {text('specialization', 'Specialization', 'text', 'For example: Computer Science, Marketing')}
              <div className="grid grid-cols-2 gap-3">
                <Select label="Mode of study" value={q.nature} options={COURSE_NATURES} onChange={(v) => set('nature', v)} />
                <Select label="Status" value={q.status} options={QUALIFICATION_STATUSES} onChange={(v) => set('status', v)} />
              </div>
            </>
          ) : <p className="text-[11px] text-slate-400">Choose a qualification to see the rest.</p>}
        </section>
        {q.qualification && (
          <>
            <section className="space-y-3">
              <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Where</h4>
              {text('instituteName', 'Institute / college')}
              {text('universityName', 'University or board')}
            </section>
            <section className="space-y-3">
              <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">When and how well</h4>
              <div className="grid grid-cols-2 gap-3">
                {text('fromDate', 'Started', 'date')}{text('toDate', 'Ended', 'date')}
                {!pursuing && text('dateOfPassing', 'Date of passing', 'date')}
                {text('percentage', 'Percentage', 'text', '0 to 100')}
                {text('grade', 'Grade')}
              </div>
              {length && <p className="text-[11px] text-slate-500">Course length: {length}</p>}
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={q.isHighest} onChange={(e) => set('isHighest', e.target.checked)} />This is my highest qualification</label>
              {text('remarks', 'Remarks')}
            </section>
            <section className="space-y-2">
              <h4 className="text-[11px] font-black uppercase tracking-wide text-slate-400">Certificate</h4>
              <input type="file" accept="image/*" aria-label="Certificate photo" className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-bold" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <p className="text-[11px] text-slate-400">{initial?.hasDocument ? 'A certificate is already attached. Choosing a photo replaces it.' : 'A photo of the certificate or marksheet (JPG or PNG).'}</p>
            </section>
          </>
        )}
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
      </div>
    </Drawer>
  );
};

/** Qualification Details: an education timeline, newest first, with the highest qualification marked. */
export const QualificationPage: React.FC<{ uid?: string }> = ({ uid }) => {
  const [data, setData] = useState<{ items: Item[]; max: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; item: Item | null }>({ open: false, item: null });
  const [confirm, setConfirm] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ title: string; src: string | null } | null>(null);
  const { busy, note, run } = useRunner();
  const attachTo = useRef('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => lifecycleService.qualifications(uid).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { setData(null); setConfirm(null); load(); }, [load]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const { items } = data;
  const view = async (x: Item) => {
    setViewing({ title: `${x.qualification} certificate`, src: null });
    try { setViewing({ title: `${x.qualification} certificate`, src: (await lifecycleService.qualificationDoc(x.id, uid)).dataUrl }); } catch { setViewing(null); }
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await run(async () => { await lifecycleService.setQualificationDoc({ uid, id: attachTo.current, dataUrl: await shrinkImage(file) }); await load(); }, 'Certificate attached');
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><GraduationCap className="w-4 h-4 text-slate-400" />{items.length} {items.length === 1 ? 'qualification' : 'qualifications'}</span>
        <div className="flex gap-2">
          <button type="button" aria-label="Refresh" className={btnGhost} onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" /></button>
          <button type="button" className={btnPrimary} disabled={items.length >= data.max} onClick={() => setDrawer({ open: true, item: null })}><Plus className="w-3.5 h-3.5" />Add qualification</button>
        </div>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      {items.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl py-10 text-center">
          <GraduationCap className="w-8 h-8 mx-auto text-slate-300" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-slate-700">No qualifications added yet</p>
          <p className="text-xs text-slate-500">Add your degrees, diplomas and certifications, newest first.</p>
        </div>
      ) : (
        <ol className="relative border-l-2 border-slate-200 ml-3 space-y-3">
          {items.map((x) => {
            const span = durationText(x.fromDate, x.toDate);
            const when = x.status === 'Pursuing' ? 'Pursuing' : x.dateOfPassing ? `Passed ${niceDate(x.dateOfPassing)}` : '';
            const score = [x.percentage && `${x.percentage}%`, x.grade && `Grade ${x.grade}`].filter(Boolean).join(' · ');
            return (
              <li key={x.id} className="pl-5 relative">
                <span className={`absolute -left-[9px] top-4 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center ${x.isHighest ? 'bg-[#FA7014]' : 'bg-slate-300'}`} aria-hidden />
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-800">{x.qualification}{x.specialization ? ` · ${x.specialization}` : ''}</h3>
                        {x.isHighest && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-50 text-[#FA7014] border-orange-200"><Star className="w-3 h-3" />Highest</span>}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_LOOK[x.status] || STATUS_LOOK.Completed}`}>{x.status}</span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{[x.instituteName, x.universityName].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex gap-0.5">
                      <button type="button" aria-label={`Edit ${x.qualification}`} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setDrawer({ open: true, item: x })}><Pencil className="w-4 h-4" /></button>
                      <button type="button" aria-label={`Remove ${x.qualification}`} className="p-2 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirm(x.id)}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    {when && <span>{when}</span>}{score && <span className="inline-flex items-center gap-1"><Award className="w-3.5 h-3.5 text-slate-400" />{score}</span>}
                    {span && <span>{span}</span>}{[x.streamType, x.courseType, x.nature].filter(Boolean).length > 0 && <span className="text-slate-400">{[x.streamType, x.courseType, x.nature].filter(Boolean).join(' · ')}</span>}
                  </div>
                  {x.remarks && <p className="mt-1.5 text-[11px] text-slate-500">{x.remarks}</p>}
                  <div className="mt-3 flex items-center gap-2">
                    {x.hasDocument ? (
                      <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700">
                        <button type="button" className="inline-flex items-center gap-1.5 px-2 py-1 hover:text-[#FA7014]" onClick={() => void view(x)}><FileImage className="w-3.5 h-3.5" />Certificate<span className="text-slate-400">{x.docKb} KB</span></button>
                        <button type="button" aria-label="Remove certificate" className="px-1.5 py-1 text-slate-400 hover:text-rose-700" onClick={() => void run(async () => { await lifecycleService.deleteQualificationDoc({ uid, id: x.id }); await load(); }, 'Certificate removed')}><Trash2 className="w-3.5 h-3.5" /></button>
                      </span>
                    ) : (
                      <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FA7014] px-2 py-1 rounded-lg hover:bg-orange-50" disabled={busy} onClick={() => { attachTo.current = x.id; fileInput.current?.click(); }}><Paperclip className="w-3.5 h-3.5" />Attach certificate</button>
                    )}
                  </div>
                  {confirm === x.id && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                      <span className="text-xs text-slate-600 mr-auto">Remove this qualification{x.hasDocument ? ' and its certificate' : ''}?</span>
                      <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>Keep</button>
                      <button type="button" className={btnDanger} disabled={busy} onClick={() => void run(async () => { await lifecycleService.deleteQualification({ uid, id: x.id }); setConfirm(null); await load(); }, 'Removed')}>Remove</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e)} aria-label="Choose a certificate photo" />
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label={viewing.title} onClick={() => setViewing(null)}>
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="Close" className="absolute -top-3 -right-3 bg-white rounded-full p-1.5 shadow" onClick={() => setViewing(null)}><X className="w-4 h-4" /></button>
            {viewing.src ? <img src={viewing.src} alt={viewing.title} className="w-full max-h-[85vh] object-contain rounded-lg bg-white" /> : <div className="bg-white rounded-lg p-10 text-center text-sm text-slate-500">Loading…</div>}
          </div>
        </div>
      )}
      <ItemDrawer open={drawer.open} initial={drawer.item} uid={uid} onClose={() => setDrawer({ open: false, item: null })} onSaved={() => void load()} />
    </div>
  );
};
