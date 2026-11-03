import React, { useState } from 'react';
import { cycleService } from '../../services/hiringExtraService';
import { User } from '../../types';
import { Card, ConfirmButton, EmptyState, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';

const staffOf = (users: User[]) => users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
const nowQuarter = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const REC = ['CONFIRM', 'EXTEND', 'TERMINATE'];

// ------------------------------------------------------------------ probation

export const Probation: React.FC<{ users: User[] }> = ({ users }) => {
  const list = useLoad(() => cycleService.probList(), []);
  const { run, busy, note } = useRunner();
  const [f, setF] = useState({ uid: '', managerUid: '', joinDate: '', months: '3' });
  const [fb, setFb] = useState<Record<string, any>>({});
  const [dec, setDec] = useState<Record<string, { note: string; extendMonths: string }>>({});
  const items: any[] = list.data?.items || [];
  const manage = !!list.data?.canManage;
  const staff = staffOf(users);
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {manage && (
        <Card title="Start a probation" subtitle="Review dates are set at 30, 60 and 90 days (or a confirmation review for longer ones). The manager is reminded before each is due.">
          <div className="grid gap-2 sm:grid-cols-5">
            <select className={input} value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value })}><option value="">Employee</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <select className={input} value={f.managerUid} onChange={(e) => setF({ ...f, managerUid: e.target.value })}><option value="">Manager (if known)</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <input className={input} type="date" value={f.joinDate} onChange={(e) => setF({ ...f, joinDate: e.target.value })} />
            <input className={input} placeholder="Months" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
            <button className={btnPrimary} disabled={busy || !f.uid} onClick={() => run(async () => { await cycleService.probStart(f); setF({ uid: '', managerUid: '', joinDate: '', months: '3' }); await list.reload(); }, 'Probation started.')}>Start</button>
          </div>
        </Card>
      )}
      <Loading error={list.error} loading={list.loading} />
      {!list.loading && items.length === 0 && <EmptyState title="No probations" />}
      {items.map((p) => (
        <Card key={p.id} title={`${p.name} - ${p.title || p.department || ''}`} subtitle={`${p.joinDate} to ${p.endDate}${p.managerName ? ` - manager ${p.managerName}` : ''}`} right={<Pill tone={p.status === 'ACTIVE' ? 'amber' : p.status === 'CONFIRMED' ? 'green' : 'slate'}>{String(p.status).toLowerCase()}</Pill>}>
          <div className="space-y-2">
            {(p.milestones || []).map((m: any) => {
              const k = `${p.id}:${m.key}`;
              const v = fb[k] || { rating: '', kpiPct: '', recommendation: 'CONFIRM', strengths: '', improvements: '' };
              return (
                <div key={m.key} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><b>{m.label}</b><span className="text-xs text-slate-500">due {m.dueOn}</span>
                    {m.status === 'SUBMITTED' ? <Pill tone="green">rating {m.rating}/5, {String(m.recommendation).toLowerCase()}</Pill> : m.dueOn < (list.data?.today || '') ? <Pill tone="red">overdue</Pill> : <Pill tone="amber">pending</Pill>}</div>
                  {m.status === 'SUBMITTED' && <p className="mt-1 text-xs text-slate-600">{m.kpiPct !== null && m.kpiPct !== undefined ? `KPI ${m.kpiPct}%. ` : ''}{m.strengths && `Strengths: ${m.strengths}. `}{m.improvements && `To improve: ${m.improvements}.`}</p>}
                  {m.status !== 'SUBMITTED' && p.status === 'ACTIVE' && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <input className={input} placeholder="Rating 1-5" value={v.rating} onChange={(e) => setFb({ ...fb, [k]: { ...v, rating: e.target.value } })} />
                      <input className={input} placeholder="KPI % (optional)" value={v.kpiPct} onChange={(e) => setFb({ ...fb, [k]: { ...v, kpiPct: e.target.value } })} />
                      <select className={`${input} sm:col-span-2`} value={v.recommendation} onChange={(e) => setFb({ ...fb, [k]: { ...v, recommendation: e.target.value } })}>{REC.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</select>
                      <input className={`${input} sm:col-span-2`} placeholder="Strengths" value={v.strengths} onChange={(e) => setFb({ ...fb, [k]: { ...v, strengths: e.target.value } })} />
                      <input className={`${input} sm:col-span-2`} placeholder="What to improve" value={v.improvements} onChange={(e) => setFb({ ...fb, [k]: { ...v, improvements: e.target.value } })} />
                      <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await cycleService.probFeedback({ id: p.id, key: m.key, ...v }); await list.reload(); }, 'Review saved.')}>Submit review</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {manage && p.status === 'ACTIVE' && (
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <input className={`${input} sm:col-span-2`} placeholder="Reason (needed to extend or end)" value={dec[p.id]?.note || ''} onChange={(e) => setDec({ ...dec, [p.id]: { note: e.target.value, extendMonths: dec[p.id]?.extendMonths || '' } })} />
              <input className={input} placeholder="Extend by months" value={dec[p.id]?.extendMonths || ''} onChange={(e) => setDec({ ...dec, [p.id]: { note: dec[p.id]?.note || '', extendMonths: e.target.value } })} />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await cycleService.probDecide({ id: p.id, decision: 'CONFIRM', note: dec[p.id]?.note }); await list.reload(); }, 'Confirmed.')}>Confirm</button>
                <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await cycleService.probDecide({ id: p.id, decision: 'EXTEND', note: dec[p.id]?.note, extendMonths: dec[p.id]?.extendMonths }); await list.reload(); }, 'Extended.')}>Extend</button>
                <ConfirmButton disabled={busy} question="End probation?" yes="End" onConfirm={() => run(async () => { await cycleService.probDecide({ id: p.id, decision: 'TERMINATE', note: dec[p.id]?.note }); await list.reload(); }, 'Probation ended.')}>End</ConfirmButton>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ OKRs

export const Okrs: React.FC<{ users: User[] }> = ({ users }) => {
  const [quarter, setQuarter] = useState(nowQuarter());
  const list = useLoad(() => cycleService.okrList(quarter), [quarter]);
  const { run, busy, note } = useRunner();
  const [f, setF] = useState({ level: 'INDIVIDUAL', ownerUid: '', teamName: '', title: '', krs: '' });
  const [val, setVal] = useState<Record<string, string>>({});
  const items: any[] = list.data?.items || [];
  const staff = staffOf(users);
  // One key result per line: "Title | start | target | unit"
  const parseKrs = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [title, start, target, unit] = l.split('|').map((x) => x.trim()); return { title, start: start || 0, target, unit: unit || '' }; });
  const tone = (s: string) => (s === 'DONE' ? 'green' : s === 'ON_TRACK' ? 'blue' : s === 'AT_RISK' ? 'amber' : 'red') as 'green' | 'blue' | 'amber' | 'red';
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="Objectives and key results" right={<input className={`${input} w-28`} value={quarter} onChange={(e) => setQuarter(e.target.value.toUpperCase())} />}>
        <div className="grid gap-2 sm:grid-cols-4">
          <select className={input} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="INDIVIDUAL">Individual</option><option value="TEAM">Team (HR)</option><option value="COMPANY">Company (HR)</option></select>
          {f.level === 'INDIVIDUAL' ? <select className={input} value={f.ownerUid} onChange={(e) => setF({ ...f, ownerUid: e.target.value })}><option value="">Me</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select> : <input className={input} placeholder="Team name" value={f.teamName} onChange={(e) => setF({ ...f, teamName: e.target.value })} />}
          <input className={`${input} sm:col-span-2`} placeholder="Objective" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <Field label="Key results, one per line: title | start | target | unit"><textarea className={`${input} h-20`} value={f.krs} onChange={(e) => setF({ ...f, krs: e.target.value })} placeholder="Close 20 hires | 0 | 20 | hires" /></Field>
        <button className={`${btnPrimary} mt-2`} disabled={busy || !f.title || !f.krs} onClick={() => run(async () => { await cycleService.okrSave({ level: f.level, ownerUid: f.ownerUid || undefined, teamName: f.teamName, title: f.title, quarter, keyResults: parseKrs(f.krs) }); setF({ ...f, title: '', krs: '' }); await list.reload(); }, 'Objective saved.')}>Add objective</button>
      </Card>
      <Loading error={list.error} loading={list.loading} />
      {!list.loading && items.length === 0 && <EmptyState title={`No objectives for ${quarter}`} />}
      {items.map((o) => (
        <Card key={o.id} title={o.title} subtitle={`${o.level.toLowerCase()} - ${o.ownerName}`} right={<Pill tone={tone(o.status)}>{o.progress}% {String(o.status).replace('_', ' ').toLowerCase()}</Pill>}>
          {(o.keyResults || []).map((k: any) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-1.5 text-sm">
              <span>{k.title} <span className="text-xs text-slate-500">({k.start} to {k.target} {k.unit})</span></span>
              <span className="flex items-center gap-2">
                <b>{k.current}</b> <span className="text-xs text-slate-500">{k.progress}%</span>
                {o.state !== 'CLOSED' && <><input className={`${input} w-24`} placeholder="New value" value={val[k.id] || ''} onChange={(e) => setVal({ ...val, [k.id]: e.target.value })} />
                  <button className={btnGhost} disabled={busy || !val[k.id]} onClick={() => run(async () => { await cycleService.okrUpdate({ id: o.id, krId: k.id, current: val[k.id] }); setVal({ ...val, [k.id]: '' }); await list.reload(); }, 'Updated.')}>Update</button></>}
              </span>
            </div>
          ))}
          {o.state !== 'CLOSED' && <div className="mt-2 flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await cycleService.okrClose({ id: o.id }); await list.reload(); }, 'Closed.')}>Close objective</button><ConfirmButton disabled={busy} onConfirm={() => run(async () => { await cycleService.okrDelete(o.id); await list.reload(); })}>Delete</ConfirmButton></div>}
        </Card>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ promotions

export const Promotions: React.FC<{ users: User[] }> = ({ users }) => {
  const list = useLoad(() => cycleService.promoList(), []);
  const { run, busy, note } = useRunner();
  const [f, setF] = useState({ uid: '', toTitle: '', newCtcLpa: '', effectiveDate: '', justification: '', evidence: '' });
  const [reason, setReason] = useState<Record<string, string>>({});
  const items: any[] = list.data?.items || [];
  const tone = (s: string) => (s === 'APPLIED' ? 'green' : s === 'REJECTED' || s === 'WITHDRAWN' ? 'red' : s === 'APPROVED' ? 'blue' : 'amber') as 'green' | 'red' | 'blue' | 'amber';
  const act = (id: string, action: string, done: string) => run(async () => { await cycleService.promoAct({ id, action, note: reason[id] }); await list.reload(); }, done);
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="Propose a promotion" subtitle="Manager proposes, HR recommends, the founder decides, HR applies. Applying changes the employee's designation; the salary revision is then created in Payroll.">
        <div className="grid gap-2 sm:grid-cols-4">
          <select className={input} value={f.uid} onChange={(e) => setF({ ...f, uid: e.target.value })}><option value="">Employee</option>{staffOf(users).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <input className={input} placeholder="New designation" value={f.toTitle} onChange={(e) => setF({ ...f, toTitle: e.target.value })} />
          <input className={input} placeholder="New CTC LPA (optional)" value={f.newCtcLpa} onChange={(e) => setF({ ...f, newCtcLpa: e.target.value })} />
          <input className={input} type="date" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
        </div>
        <textarea className={`${input} mt-2 h-20`} placeholder="Why (at least a couple of sentences)" value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
        <input className={`${input} mt-2`} placeholder="Evidence: KPI results, reviews (optional)" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
        <button className={`${btnPrimary} mt-2`} disabled={busy || !f.uid || !f.toTitle || !f.effectiveDate} onClick={() => run(async () => { await cycleService.promoPropose(f); setF({ uid: '', toTitle: '', newCtcLpa: '', effectiveDate: '', justification: '', evidence: '' }); await list.reload(); }, 'Proposal submitted.')}>Submit proposal</button>
      </Card>
      <Loading error={list.error} loading={list.loading} />
      {!list.loading && items.length === 0 && <EmptyState title="No promotion proposals" />}
      {items.map((p) => (
        <Card key={p.id} title={`${p.name}: ${p.fromTitle || '-'} to ${p.toTitle}`} subtitle={`Effective ${p.effectiveDate}${p.newCtcLpa ? ` - new CTC ${p.newCtcLpa} LPA` : ''} - proposed by ${p.proposedBy}`} right={<Pill tone={tone(p.status)}>{String(p.status).replace('_', ' ').toLowerCase()}</Pill>}>
          <p className="text-sm text-slate-700">{p.justification}</p>
          {p.salaryRevisionNeeded && <Notice tone="warn">Create the {p.newCtcLpa} LPA salary revision in Payroll.</Notice>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={`${input} max-w-[240px]`} placeholder="Note / reason" value={reason[p.id] || ''} onChange={(e) => setReason({ ...reason, [p.id]: e.target.value })} />
            {p.status === 'PROPOSED' && list.data?.canRecommend && <button className={btnPrimary} disabled={busy} onClick={() => act(p.id, 'recommend', 'Recommended to the founder.')}>Recommend</button>}
            {p.status === 'HR_RECOMMENDED' && list.data?.canDecide && <button className={btnPrimary} disabled={busy} onClick={() => act(p.id, 'approve', 'Approved.')}>Approve</button>}
            {['PROPOSED', 'HR_RECOMMENDED'].includes(p.status) && (list.data?.canRecommend || list.data?.canDecide) && <button className={btnDanger} disabled={busy} onClick={() => act(p.id, 'reject', 'Rejected.')}>Reject</button>}
            {p.status === 'APPROVED' && list.data?.canRecommend && <button className={btnPrimary} disabled={busy} onClick={() => act(p.id, 'apply', 'Applied. The designation is updated.')}>Apply</button>}
            {['PROPOSED', 'HR_RECOMMENDED'].includes(p.status) && <button className={btnGhost} disabled={busy} onClick={() => act(p.id, 'withdraw', 'Withdrawn.')}>Withdraw</button>}
          </div>
        </Card>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ quarterly round

export const Quarterly: React.FC = () => {
  const list = useLoad(() => cycleService.qcList(), []);
  const { run, busy, note } = useRunner();
  const [quarter, setQuarter] = useState(nowQuarter());
  const items: any[] = list.data?.items || [];
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="Quarterly review round" subtitle="One checklist per quarter: KPI review, OKR close-out, training, promotions, salary revisions, improvement plans. HR is reminded before the due date.">
        <div className="flex gap-2"><input className={`${input} w-32`} value={quarter} onChange={(e) => setQuarter(e.target.value.toUpperCase())} /><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await cycleService.qcOpen({ quarter }); await list.reload(); }, 'Round opened.')}>Open round</button></div>
      </Card>
      <Loading error={list.error} loading={list.loading} />
      {items.map((q) => (
        <Card key={q.id} title={q.quarter} subtitle={`Due ${q.dueOn}`} right={<Pill tone={q.closedAt ? 'green' : 'amber'}>{q.closedAt ? 'complete' : 'open'}</Pill>}>
          {(q.steps || []).map((s: any) => (
            <label key={s.key} className="flex items-start gap-2 border-t border-slate-100 py-1.5 text-sm"><input type="checkbox" className="mt-1" checked={s.done} disabled={busy} onChange={(e) => run(async () => { await cycleService.qcTick({ id: q.id, key: s.key, done: e.target.checked }); await list.reload(); })} /><span><b>{s.label}</b><br /><span className="text-xs text-slate-500">{s.hint}</span></span></label>
          ))}
        </Card>
      ))}
    </div>
  );
};
