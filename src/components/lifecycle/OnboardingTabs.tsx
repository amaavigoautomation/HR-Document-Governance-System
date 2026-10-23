import React, { useCallback, useEffect, useState } from 'react';
import { lifecycleService } from '../../services/lifecycleService';
import { ASSIGNEE_LABEL, TASK_KIND_LABEL } from '../../../shared/lifecycleEngine';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, todayIst, useRunner } from '../leave/ui';

const dueTone = (t: any, today: string) => (t.status !== 'OPEN' ? 'text-slate-400' : t.dueDate && t.dueDate < today ? 'text-rose-600 font-bold' : 'text-slate-500');

const BankForm: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [f, setF] = useState({ holder: '', bankName: '', account: '', ifsc: '' });
  const { busy, note, run } = useRunner();
  return (
    <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="Account holder name"><input className={input} value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} /></Field>
        <Field label="Bank name"><input className={input} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
        <Field label="Account number"><input className={input} inputMode="numeric" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></Field>
        <Field label="IFSC code"><input className={input} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await lifecycleService.submitBank(f); onDone(); })}>Save bank details</button>
    </div>
  );
};

/** Tasks assigned to me (my own joining checklist, plus tasks I owe for other people). */
export const MyTasks: React.FC<{ onChange?: () => void }> = ({ onChange }) => {
  const [data, setData] = useState<any | null>(null);
  const [bankFor, setBankFor] = useState('');
  const { busy, note, run } = useRunner();
  const load = useCallback(() => lifecycleService.onboardingMy().then(setData).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const mine = data.tasks.filter((t: any) => t.own);
  const others = data.tasks.filter((t: any) => !t.own);
  const set = (t: any, status: string) => run(async () => { await lifecycleService.updateTask({ id: t.id, status }); await load(); onChange?.(); });

  const Row = ({ t }: { t: any }) => (
    <li className="py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={t.status === 'DONE'} disabled={busy || t.status === 'SKIPPED' || (t.kind === 'BANK' && t.own && t.status !== 'DONE')} onChange={(e) => set(t, e.target.checked ? 'DONE' : 'OPEN')} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-bold ${t.status === 'OPEN' ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{t.title}{!t.own && <span className="font-normal text-slate-500"> · for {t.forName}</span>}</div>
          {t.description && <div className="text-xs text-slate-500">{t.description}</div>}
          <div className={`text-[11px] ${dueTone(t, data.today)}`}>{t.status === 'SKIPPED' ? 'Skipped' : t.dueDate ? `Due ${niceDate(t.dueDate)}` : 'No due date'}{t.doneBy && t.status === 'DONE' ? ` · done by ${t.doneBy}` : ''}</div>
          {t.kind === 'BANK' && t.own && t.status === 'OPEN' && (bankFor === t.id ? <BankForm onDone={() => { setBankFor(''); load(); onChange?.(); }} /> : <button className={`${btnGhost} mt-1`} onClick={() => setBankFor(t.id)}>Enter bank details</button>)}
          {t.kind === 'POLICY' && t.own && t.status === 'OPEN' && <div className="text-[11px] text-slate-500 mt-0.5">Open the Policies tab, acknowledge each policy, then tick this.</div>}
        </div>
      </div>
    </li>
  );
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="My joining checklist">{mine.length === 0 ? <p className="text-sm text-slate-400">No checklist yet. HR starts it when you join.</p> : <ul>{mine.map((t: any) => <Row key={t.id} t={t} />)}</ul>}</Card>
      {others.length > 0 && <Card title="Tasks I need to do for new joiners"><ul>{others.map((t: any) => <Row key={t.id} t={t} />)}</ul></Card>}
    </div>
  );
};

/** HR view: every checklist, who is behind, start a checklist, add tasks. */
export const OnboardingAdmin: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [openUid, setOpenUid] = useState('');
  const [startUid, setStartUid] = useState('');
  const [join, setJoin] = useState(todayIst());
  const [nt, setNt] = useState({ title: '', assignee: 'HR', dueDate: '' });
  const { busy, note, run } = useRunner();
  const load = useCallback(() => lifecycleService.onboarding().then(setData).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="Start a joining checklist">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Person"><select className={`${input} w-64`} value={startUid} onChange={(e) => { setStartUid(e.target.value); const p = data.withoutChecklist.find((x: any) => x.uid === e.target.value); if (p?.joinDate) setJoin(p.joinDate); }}>
            <option value="">Choose…</option>
            {data.withoutChecklist.map((p: any) => <option key={p.uid} value={p.uid}>{p.name}{p.empId ? ` (${p.empId})` : ''}</option>)}
          </select></Field>
          <Field label="Joining date"><input type="date" className={input} value={join} onChange={(e) => setJoin(e.target.value)} /></Field>
          <button className={btnPrimary} disabled={busy || !startUid} onClick={() => run(async () => { await lifecycleService.startChecklist(startUid, join); setStartUid(''); await load(); }, 'Checklist created.')}>Create checklist</button>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Tasks come from the templates in Setup. They also start by themselves when a candidate is marked onboarded and an account with the same email exists.</p>
      </Card>

      <Card title="Joiners">
        {data.rows.length === 0 && <p className="text-sm text-slate-400">No checklists yet.</p>}
        <ul className="divide-y divide-slate-100">
          {data.rows.map((r: any) => (
            <li key={r.uid} className="py-2.5">
              <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpenUid(openUid === r.uid ? '' : r.uid)}>
                <div className="flex-1 min-w-0"><div className="text-sm font-bold text-slate-900">{r.name} <span className="font-normal text-slate-400">{r.empId}</span></div><div className="text-[11px] text-slate-500">{r.joinDate ? `Joins ${niceDate(r.joinDate)}` : 'No joining date'} · {r.department}</div></div>
                <div className="w-28 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${r.total ? Math.round(((r.total - r.open) / r.total) * 100) : 0}%` }} /></div>
                <span className="text-[11px] font-bold text-slate-600 w-24 text-right">{r.total - r.open}/{r.total} done</span>
                {r.overdue > 0 && <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">{r.overdue} overdue</span>}
              </button>
              {openUid === r.uid && (
                <div className="mt-2 ml-1 space-y-1">
                  {r.tasks.map((t: any) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={t.status === 'DONE'} disabled={busy || t.status === 'SKIPPED'} onChange={(e) => run(async () => { await lifecycleService.updateTask({ id: t.id, status: e.target.checked ? 'DONE' : 'OPEN' }); await load(); })} />
                      <span className={`flex-1 ${t.status === 'OPEN' ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{t.title} <span className="text-slate-400">· {TASK_KIND_LABEL[t.kind as keyof typeof TASK_KIND_LABEL]} · {t.assigneeName || ASSIGNEE_LABEL[t.assignee as keyof typeof ASSIGNEE_LABEL]}</span></span>
                      <span className={dueTone(t, data.today)}>{t.dueDate ? niceDate(t.dueDate) : ''}</span>
                      {t.status === 'OPEN' && <button className="text-[11px] text-slate-500 hover:underline" disabled={busy} onClick={() => run(async () => { await lifecycleService.updateTask({ id: t.id, status: 'SKIPPED' }); await load(); })}>Skip</button>}
                      <button className="text-[11px] text-rose-600 hover:underline" disabled={busy} onClick={() => run(async () => { await lifecycleService.deleteTask(t.id); await load(); })}>Remove</button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-end gap-2 pt-2">
                    <input className={`${input} max-w-xs`} placeholder="Add a task" value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} />
                    <select className={`${input} max-w-[10rem]`} value={nt.assignee} onChange={(e) => setNt({ ...nt, assignee: e.target.value })}>{Object.entries(ASSIGNEE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    <input type="date" className={`${input} max-w-[10rem]`} value={nt.dueDate} onChange={(e) => setNt({ ...nt, dueDate: e.target.value })} />
                    <button className={btnGhost} disabled={busy || !nt.title.trim()} onClick={() => run(async () => { await lifecycleService.addTask({ uid: r.uid, ...nt }); setNt({ title: '', assignee: 'HR', dueDate: '' }); await load(); })}>Add</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

void btnDanger;
