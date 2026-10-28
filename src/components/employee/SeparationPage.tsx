import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, FileText, Hourglass, Paperclip, RefreshCw, Trash2, X } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { EXIT_REASONS, EXIT_STATUS_LABEL, earliestLastDay, noticeShortfall, noticeServed, tenureText } from '../../../shared/lifecycleEngine';
import { Field, Notice, btnDanger, btnGhost, input, niceDate, useRunner } from '../leave/ui';
import { shrinkImage } from './shrinkImage';
import { peopleNav } from '../lifecycle/peopleNav';
import type { HRAgentModule } from '../HRAgentShell';

const STATUS_LOOK: Record<string, string> = {
  SUBMITTED: 'bg-amber-50 text-amber-700 border-amber-200', MANAGER_APPROVED: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-sky-50 text-sky-700 border-sky-200', COMPLETED: 'bg-slate-100 text-slate-600 border-slate-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200', WITHDRAWN: 'bg-slate-100 text-slate-600 border-slate-200',
};
const MAX_PDF_BYTES = 600 * 1024;

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('That file could not be read.'));
  r.readAsDataURL(file);
});
/** A PDF goes as it is (if small enough); a photo is shrunk to a JPEG. */
async function prepareFile(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is too large. Keep it under about 600 KB.');
    return readAsDataUrl(file);
  }
  return shrinkImage(file);
}

const Fact: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }> = ({ icon, label, value, sub }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3.5">
    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">{icon}{label}</div>
    <div className="mt-1 text-sm font-bold text-slate-800">{value}</div>
    {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
  </div>
);

/** Separation: where the person stands (service, notice, earliest leaving date), then either the form to declare it or the current case. */
export const SeparationPage: React.FC<{ uid?: string; onOpenModule: (m: HRAgentModule) => void }> = ({ uid, onOpenModule }) => {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('RESIGNATION');
  const [file, setFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState<{ name: string; src: string | null } | null>(null);
  const { busy, note, setNote, run } = useRunner();
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => lifecycleService.separation(uid).then((r) => {
    setD(r); setErr(null);
    setLast((cur) => cur || earliestLastDay(r.today, r.noticeDays));
  }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { setD(null); setLast(''); setRemarks(''); setFile(null); setReason('RESIGNATION'); setNote(null); load(); }, [load, setNote]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!d) return <div className="text-sm text-slate-500">Loading…</div>;

  const e = d.exit;
  const open = e && ['SUBMITTED', 'MANAGER_APPROVED', 'APPROVED'].includes(e.status);
  const done = e?.status === 'COMPLETED';
  const earliest = earliestLastDay(d.today, d.noticeDays);
  const end = e && (e.status === 'APPROVED' || done) ? e.lastWorkingDay : '';
  const tenure = d.employee.joinDate ? tenureText(d.employee.joinDate, end || d.today) : '';
  const short = !open && last ? noticeShortfall(d.noticeDays, noticeServed(d.today, last)) : 0;
  const forOther = !d.isSelf;
  const canDeclare = !open && !done && (d.isSelf || d.canDeclareForOthers);
  const title = forOther ? `Declare separation of ${d.employee.name}` : 'Resign';

  const submit = () => run(async () => {
    if (forOther) await lifecycleService.startExit({ uid: d.employee.uid, reason, lastWorkingDay: last, comments: remarks });
    else await lifecycleService.resign({ requestedLastDay: last, comments: remarks });
    if (file) await lifecycleService.setSeparationFile({ uid, dataUrl: await prepareFile(file), fileName: file.name });
    setFile(null); setLast(''); await load();
  }, forOther ? 'Separation declared. Clearance is open.' : 'Resignation submitted.');
  const attach = async (f: File) => run(async () => { await lifecycleService.setSeparationFile({ uid, dataUrl: await prepareFile(f), fileName: f.name }); await load(); }, 'Document attached');
  const view = async () => {
    setViewing({ name: d.file.name, src: null });
    try { setViewing({ name: d.file.name, src: (await lifecycleService.separationFile(uid)).dataUrl }); } catch { setViewing(null); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{d.employee.name}{d.employee.empId ? ` (${d.employee.empId})` : ''}{d.employee.department ? ` · ${d.employee.department}` : ''}</p>
        <button type="button" aria-label="Refresh" className={btnGhost} onClick={() => void load()}><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Fact icon={<FileText className="w-3.5 h-3.5" />} label="Document no." value={e?.docNo || 'Not declared'} />
        <Fact icon={<CalendarClock className="w-3.5 h-3.5" />} label="Joined" value={d.employee.joinDate ? niceDate(d.employee.joinDate) : 'Not set'} sub={tenure ? `${tenure} of service` : undefined} />
        <Fact icon={<Hourglass className="w-3.5 h-3.5" />} label="Notice period" value={`${d.noticeDays} days`} />
        <Fact icon={<CalendarClock className="w-3.5 h-3.5" />} label="Earliest leaving date" value={niceDate(end || earliest)} sub={end ? 'Agreed last working day' : 'If you resign today'} />
      </div>

      {canDeclare && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {forOther ? 'This starts the exit straight away and opens clearance.' : d.hasManager ? 'Your manager and then HR will review this. You can withdraw it until it is approved.' : 'HR will review this. You can withdraw it until it is approved.'}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {forOther && (
              <Field label="Reason"><select className={input} value={reason} onChange={(x) => setReason(x.target.value)}>{EXIT_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>)}</select></Field>
            )}
            <Field label={forOther ? 'Last working day' : 'Last working day I am asking for'} hint={`Full notice means ${niceDate(earliest)} or later`}>
              <input type="date" className={input} min={d.today} value={last} onChange={(x) => setLast(x.target.value)} />
            </Field>
          </div>
          {short > 0 && <Notice tone="warn">That is {short} {short === 1 ? 'day' : 'days'} short of the {d.noticeDays}-day notice period. HR decides whether to waive it.</Notice>}
          <Field label="Remarks (optional)"><textarea className={input} rows={3} maxLength={1000} value={remarks} onChange={(x) => setRemarks(x.target.value)} /></Field>
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Supporting document (optional)</div>
            <button type="button" onClick={() => fileInput.current?.click()} className="w-full border border-dashed border-slate-300 rounded-lg px-4 py-3 text-left text-xs text-slate-500 hover:bg-slate-50 inline-flex items-center gap-2">
              <Paperclip className="w-4 h-4" />{file ? <span className="text-slate-800 font-semibold">{file.name}</span> : 'Choose a PDF or photo, for example your resignation letter'}
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            {(remarks || file) && <button type="button" className={btnGhost} onClick={() => { setRemarks(''); setFile(null); }}>Clear</button>}
            <button type="button" className={btnDanger} disabled={busy || !last} onClick={() => { if (window.confirm(forOther ? `Declare the separation of ${d.employee.name}?` : 'Submit your resignation? You can withdraw it only until it is approved.')) void submit(); }}>{forOther ? 'Declare separation' : 'Submit resignation'}</button>
          </div>
        </section>
      )}
      {!canDeclare && !e && <p className="text-xs text-slate-500">No separation has been declared for this person.</p>}

      {e && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-800">Current case</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_LOOK[e.status] || STATUS_LOOK.WITHDRAWN}`}>{EXIT_STATUS_LABEL[e.status as keyof typeof EXIT_STATUS_LABEL]}</span>
          </div>
          <dl className="grid sm:grid-cols-3 gap-x-6 gap-y-3 text-xs">
            <div><dt className="text-slate-500">Submitted on</dt><dd className="font-bold text-slate-800">{niceDate(e.resignationDate)}</dd></div>
            <div><dt className="text-slate-500">{e.status === 'APPROVED' || done ? 'Last working day' : 'Asked for'}</dt><dd className="font-bold text-slate-800">{niceDate(e.status === 'APPROVED' || done ? e.lastWorkingDay : e.requestedLastDay)}</dd></div>
            <div><dt className="text-slate-500">Notice served</dt><dd className="font-bold text-slate-800">{e.noticeServedDays} of {e.noticeRequiredDays} days{e.noticeShortfallDays > 0 ? ` (${e.noticeShortfallDays} short)` : ''}</dd></div>
            {e.reason && e.initiatedBy === 'HR' && <div><dt className="text-slate-500">Reason</dt><dd className="font-bold text-slate-800 capitalize">{String(e.reason).replace(/_/g, ' ').toLowerCase()}</dd></div>}
            {e.managerName && <div><dt className="text-slate-500">Manager</dt><dd className="font-bold text-slate-800">{e.managerName}</dd></div>}
            {e.clearance?.length > 0 && <div><dt className="text-slate-500">Clearance</dt><dd className="font-bold text-slate-800">{e.clearance.length - e.totals.pending} of {e.clearance.length} done{e.totals.dues ? ` · dues Rs. ${e.totals.dues.toLocaleString('en-IN')}` : ''}</dd></div>}
          </dl>
          {e.comments && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{e.comments}</p>}

          <div className="flex flex-wrap items-center gap-2">
            {d.file ? (
              <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700">
                <button type="button" className="inline-flex items-center gap-1.5 px-2 py-1 hover:text-[#FA7014]" onClick={() => void view()}><FileText className="w-3.5 h-3.5" />{d.file.name}<span className="text-slate-400">{d.file.kb} KB</span></button>
                {open && <button type="button" aria-label="Remove document" className="px-1.5 py-1 text-slate-400 hover:text-rose-700" onClick={() => void run(async () => { await lifecycleService.deleteSeparationFile(uid); await load(); }, 'Document removed')}><Trash2 className="w-3.5 h-3.5" /></button>}
              </span>
            ) : open && (
              <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FA7014] px-2 py-1 rounded-lg hover:bg-orange-50" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip className="w-3.5 h-3.5" />Attach document</button>
            )}
            <span className="ml-auto flex gap-2">
              {d.isSelf && ['SUBMITTED', 'MANAGER_APPROVED'].includes(e.status) && (
                <button type="button" className={btnDanger} disabled={busy} onClick={() => void run(async () => { await lifecycleService.withdraw(); await load(); }, 'Withdrawn')}>Withdraw</button>
              )}
              {d.canDeclareForOthers && (
                <button type="button" className={btnGhost} onClick={() => { peopleNav.setSection('exits'); onOpenModule('people'); }}>Approve and clear in People</button>
              )}
            </span>
          </div>
          <ul className="text-[11px] text-slate-500 space-y-0.5">
            {e.events.slice().reverse().slice(0, 6).map((x: any, i: number) => <li key={i}>{new Date(x.at).toLocaleDateString('en-IN')} · {x.by}: {String(x.action).replace(/_/g, ' ').toLowerCase()}{x.note ? ` (${x.note})` : ''}</li>)}
          </ul>
        </section>
      )}

      <input ref={fileInput} type="file" accept="application/pdf,image/*" className="hidden" aria-label="Choose a document"
        onChange={(x) => { const f = x.target.files?.[0]; x.target.value = ''; if (!f) return; if (open) void attach(f); else setFile(f); }} />
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label={viewing.name} onClick={() => setViewing(null)}>
          <div className="relative max-w-3xl w-full h-[85vh]" onClick={(x) => x.stopPropagation()}>
            <button type="button" aria-label="Close" className="absolute -top-3 -right-3 z-10 bg-white rounded-full p-1.5 shadow" onClick={() => setViewing(null)}><X className="w-4 h-4" /></button>
            {!viewing.src ? <div className="bg-white rounded-lg p-10 text-center text-sm text-slate-500">Loading…</div>
              : viewing.src.startsWith('data:application/pdf') ? <iframe title={viewing.name} src={viewing.src} className="w-full h-full rounded-lg bg-white" />
              : <img src={viewing.src} alt={viewing.name} className="w-full h-full object-contain rounded-lg bg-white" />}
          </div>
        </div>
      )}
    </div>
  );
};
