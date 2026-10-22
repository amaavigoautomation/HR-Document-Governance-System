import React, { useCallback, useEffect, useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { Card, Notice, StatusPill, btnDanger, btnGhost, btnPrimary, days, dayName, input, niceDate, range, thisMonth, useRunner } from './ui';

export const ApprovalsTab: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [data, setData] = useState<{ leaves: any[]; regularizations: any[] } | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const { busy, note, run } = useRunner();

  const load = useCallback(() => leaveService.inbox().then(setData).catch(() => setData({ leaves: [], regularizations: [] })), []);
  useEffect(() => { load(); }, [load]);

  const act = (id: string, decision: 'APPROVE' | 'REJECT', reg = false) =>
    run(async () => {
      const comment = comments[id] || '';
      if (reg) await leaveService.decideRegularization(id, decision, comment);
      else await leaveService.decide(id, decision, comment);
      await Promise.all([load(), reload()]);
    }, decision === 'APPROVE' ? 'Approved.' : 'Rejected.');

  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const empty = data.leaves.length === 0 && data.regularizations.length === 0;

  const Buttons = ({ id, reg, cancel }: { id: string; reg?: boolean; cancel?: boolean }) => (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={`${input} max-w-xs`} placeholder="Comment (optional)" value={comments[id] || ''} onChange={(e) => setComments({ ...comments, [id]: e.target.value })} />
      <button className={btnPrimary} disabled={busy} onClick={() => act(id, 'APPROVE', reg)}>{cancel ? 'Allow cancellation' : 'Approve'}</button>
      <button className={btnDanger} disabled={busy} onClick={() => act(id, 'REJECT', reg)}>{cancel ? 'Keep leave' : 'Reject'}</button>
    </div>
  );

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {empty && <Card><div className="text-sm text-slate-500">Nothing is waiting for you.</div></Card>}
      {data.leaves.length > 0 && (
        <Card title={`Leave requests (${data.leaves.length})`}>
          <div className="divide-y divide-slate-100">
            {data.leaves.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">{r.name} · {r.typeName} · {days(r.days)}</div>
                    <div className="text-xs text-slate-500">{range(r.from, r.to)}{r.reason ? ` · “${r.reason}”` : ''}</div>
                    {r.docUrl && <a className="text-xs text-[#FA7014] underline" href={r.docUrl} target="_blank" rel="noopener noreferrer">Supporting document</a>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    {r.stage === 'CANCEL' && <StatusPill status="CANCEL_REQUESTED" />}
                    {r.stage === 'HR' && <span className="px-2 py-0.5 rounded-full bg-slate-100">HR step</span>}
                    {r.stage === 'MANAGER' && r.managerName && <span>Manager: {r.managerName}</span>}
                    {r.escalated && <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">Waiting {r.waitingDays}d</span>}
                  </div>
                </div>
                <Buttons id={r.id} cancel={r.stage === 'CANCEL'} />
              </div>
            ))}
          </div>
        </Card>
      )}
      {data.regularizations.length > 0 && (
        <Card title={`Attendance corrections (${data.regularizations.length})`}>
          <div className="divide-y divide-slate-100">
            {data.regularizations.map((r) => (
              <div key={r.id} className="py-3">
                <div className="text-sm font-bold text-slate-800">{r.name} · {niceDate(r.date)}</div>
                <div className="text-xs text-slate-500">{r.checkIn} to {r.checkOut} · “{r.reason}”</div>
                <Buttons id={r.id} reg />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export const TeamCalendar: React.FC = () => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const y = parseInt(month.slice(0, 4), 10);
    const m = parseInt(month.slice(5, 7), 10);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    setError(null);
    leaveService.teamCalendar(`${month}-01`, last).then(setData).catch((e) => setError(e.message));
  }, [month]);

  const dates: string[] = [];
  if (data) for (let d = data.from; d <= data.to; d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10)) dates.push(d);
  const people: string[] = Array.from(new Set<string>((data?.items || []).map((i: any) => i.name)));
  const holiday = (d: string) => data?.holidays.find((h: any) => h.date === d);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input type="month" className={`${input} max-w-[11rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <span className="text-xs text-slate-500">Orange = pending, blue = approved. Holidays are shaded.</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="text-[10px] border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-left sticky left-0 bg-white min-w-[8rem]">Person</th>
              {dates.map((d) => (
                <th key={d} title={holiday(d)?.name} className={`px-1 py-1 w-6 font-semibold ${holiday(d) ? 'bg-violet-50 text-violet-700' : ['Sun'].includes(dayName(d)) ? 'text-slate-300' : 'text-slate-500'}`}>
                  <div>{d.slice(8)}</div><div className="font-normal">{dayName(d)[0]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={dates.length + 1}>No one is away this month.</td></tr>}
            {people.map((name) => (
              <tr key={name} className="border-t border-slate-100">
                <td className="p-2 sticky left-0 bg-white font-semibold text-slate-700">{name}</td>
                {dates.map((d) => {
                  const it = data.items.find((i: any) => i.name === name && i.from <= d && i.to >= d);
                  return (
                    <td key={d} title={it ? `${it.type || 'On leave'}${it.reason ? ': ' + it.reason : ''}` : undefined}
                      className={`w-6 h-6 ${it ? (it.status === 'PENDING' ? 'bg-orange-300' : 'bg-sky-400') : holiday(d) ? 'bg-violet-50' : ''}`} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.holidays.length > 0 && <div className="text-xs text-slate-500">Holidays: {data.holidays.map((h: any) => `${niceDate(h.date)} ${h.name}`).join(' · ')}</div>}
    </div>
  );
};
export { btnGhost };
