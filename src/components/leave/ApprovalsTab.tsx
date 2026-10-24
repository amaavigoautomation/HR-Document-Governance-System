import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, FileText, PartyPopper, Users } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { CoverPanel } from './CoverPanel';
import {
  addDaysIso, btnDanger, btnGhost, btnPrimary, Card, ConfirmButton, days, EmptyState, halfNote, input, niceDate, Notice, range, Segmented,
  shortDate, shortRange, Skeleton, StatusPill, thisMonth, todayIst, useRunner,
} from './ui';

const initials = (n: string) => (n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('');
const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span className="w-9 h-9 rounded-full bg-slate-900 text-white text-xs font-black flex items-center justify-center shrink-0">{initials(name)}</span>
);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** One request card. Approve is one tap; reject needs a reason so the employee knows why. */
const Decide: React.FC<{ busy: boolean; cancel?: boolean; onDecide: (d: 'APPROVE' | 'REJECT', comment: string) => void }> = ({ busy, cancel, onDecide }) => {
  const [mode, setMode] = useState<'idle' | 'note' | 'reject'>('idle');
  const [text, setText] = useState('');
  if (mode === 'reject') {
    return (
      <div className="mt-3 space-y-2">
        <textarea autoFocus rows={2} className={input} placeholder={cancel ? 'Why must the leave stay? (required)' : 'Why are you rejecting? The employee will see this. (required)'} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <button className={btnDanger} disabled={busy || !text.trim()} onClick={() => onDecide('REJECT', text.trim())}>{cancel ? 'Keep the leave' : 'Reject request'}</button>
          <button className={btnGhost} onClick={() => { setMode('idle'); setText(''); }}>Back</button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {mode === 'note' && <input autoFocus className={input} placeholder="Note for the employee (optional)" value={text} onChange={(e) => setText(e.target.value)} />}
      <div className="flex flex-wrap items-center gap-2">
        <button className={`${btnPrimary} !px-5`} disabled={busy} onClick={() => onDecide('APPROVE', text.trim())}>{cancel ? 'Allow cancellation' : 'Approve'}</button>
        <button className={btnDanger} disabled={busy} onClick={() => { setMode('reject'); setText(''); }}>{cancel ? 'Keep leave' : 'Reject'}</button>
        {mode === 'idle' && <button className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => setMode('note')}>Add a note</button>}
      </div>
    </div>
  );
};

export const ApprovalsTab: React.FC<{ reload: () => void }> = ({ reload }) => (
  <div className="space-y-3">
    <CoverPanel onChanged={reload} />
    <ApprovalsList reload={reload} />
  </div>
);

const ApprovalsList: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [data, setData] = useState<{ leaves: any[]; regularizations: any[] } | null>(null);
  const [overlap, setOverlap] = useState<any[]>([]);
  const [kind, setKind] = useState<'leave' | 'fix'>('leave');
  const { busy, note, run } = useRunner();

  const load = useCallback(() => leaveService.inbox().then((d) => {
    setData(d);
    const leaves: any[] = d.leaves || [];
    if (leaves.length === 0) { setOverlap([]); return; }
    // One calendar call covers every request, so we can say who else is away on those days.
    const from = leaves.reduce((m, r) => (r.from < m ? r.from : m), leaves[0].from);
    let to = leaves.reduce((m, r) => (r.to > m ? r.to : m), leaves[0].to);
    if (daysBetween(from, to) > 95) to = addDaysIso(from, 95);
    leaveService.teamCalendar(from, to).then((c) => setOverlap(c.items || [])).catch(() => setOverlap([]));
  }).catch(() => setData({ leaves: [], regularizations: [] })), []);
  useEffect(() => { load(); }, [load]);

  const alsoAway = useCallback((r: any) => {
    const names = overlap.filter((o) => o.uid !== r.uid && o.from <= r.to && o.to >= r.from).map((o) => o.name);
    return Array.from(new Set(names));
  }, [overlap]);

  const act = (id: string, decision: 'APPROVE' | 'REJECT', comment: string, reg = false) =>
    run(async () => {
      if (reg) await leaveService.decideRegularization(id, decision, comment);
      else await leaveService.decide(id, decision, comment);
      await Promise.all([load(), reload()]);
    }, decision === 'APPROVE' ? 'Approved. The employee has been told.' : 'Rejected. The employee has been told.');

  const bulk = useMemo(() => (data?.leaves || []).filter((r) => r.stage !== 'CANCEL'), [data]);
  const approveAll = () => run(async () => {
    for (const r of bulk) await leaveService.decide(r.id, 'APPROVE', '');
    await Promise.all([load(), reload()]);
  }, `Approved ${bulk.length} request(s).`);

  if (!data) return <Skeleton rows={3} />;
  const nLeave = data.leaves.length;
  const nFix = data.regularizations.length;
  if (nLeave + nFix === 0) {
    return <Card><EmptyState icon={PartyPopper} title="All caught up" text="Nothing is waiting for you. New requests will show up here and you will get an email." /></Card>;
  }
  const active = kind === 'leave' && nLeave === 0 ? 'fix' : kind === 'fix' && nFix === 0 ? 'leave' : kind;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={active} onChange={setKind} options={[
          { value: 'leave', label: <>Leave requests <b className="ml-1 text-[10px] bg-slate-200 text-slate-700 rounded-full px-1.5">{nLeave}</b></>, disabled: nLeave === 0 },
          { value: 'fix', label: <>Attendance fixes <b className="ml-1 text-[10px] bg-slate-200 text-slate-700 rounded-full px-1.5">{nFix}</b></>, disabled: nFix === 0 },
        ]} />
        {active === 'leave' && bulk.length > 1 && (
          <ConfirmButton className={btnGhost} disabled={busy} question={`Approve all ${bulk.length}?`} yes="Approve all" onConfirm={approveAll}>Approve all ({bulk.length})</ConfirmButton>
        )}
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      {active === 'leave' && data.leaves.map((r) => {
        const away = alsoAway(r);
        return (
          <Card key={r.id}>
            <div className="flex items-start gap-3">
              <Avatar name={r.name} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-bold text-slate-900">{r.name}</span>
                  {r.coveringFor && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Covering for {r.coveringFor}</span>}
                  {r.managerAway && r.stage === 'MANAGER' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{r.managerName || 'Manager'} is on leave</span>}
                  {r.stage === 'CANCEL' && <StatusPill status="CANCEL_REQUESTED" />}
                  {r.stage === 'HR' && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">HR approval{r.managerName ? ` · ${r.managerName} said yes` : ''}</span>}
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${r.escalated ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'text-slate-400'}`}>
                    <Clock className="w-3 h-3" />{r.waitingDays === 0 ? 'Sent today' : `Waiting ${r.waitingDays} day${r.waitingDays === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="mt-1 text-base font-black text-slate-800">{shortRange(r.from, r.to)}</div>
                <div className="text-xs text-slate-600">{r.typeName} · <b>{days(r.days)}</b>{halfNote(r)}</div>
                {r.reason && <div className="mt-1.5 text-xs text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">“{r.reason}”</div>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                  <span className={`flex items-center gap-1 ${away.length ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
                    <Users className="w-3.5 h-3.5" />{away.length ? `Also away: ${away.slice(0, 4).join(', ')}${away.length > 4 ? ` +${away.length - 4}` : ''}` : 'No one else away then'}
                  </span>
                  {r.docUrl && <a className="flex items-center gap-1 text-[#FA7014] font-bold underline" href={r.docUrl} target="_blank" rel="noopener noreferrer"><FileText className="w-3.5 h-3.5" />Document</a>}
                </div>
                <Decide busy={busy} cancel={r.stage === 'CANCEL'} onDecide={(d, c) => act(r.id, d, c)} />
              </div>
            </div>
          </Card>
        );
      })}

      {active === 'fix' && data.regularizations.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start gap-3">
            <Avatar name={r.name} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-900">{r.name} <span className="font-normal text-slate-500">wants to fix {shortDate(r.date)}</span>
                {r.coveringFor && <span className="ml-2 align-middle text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Covering for {r.coveringFor}</span>}
              </div>
              <div className="mt-1 text-xs text-slate-600">Real times: <b>{r.checkIn}</b> to <b>{r.checkOut}</b></div>
              {r.reason && <div className="mt-1.5 text-xs text-slate-700 bg-slate-50 rounded-lg px-2.5 py-1.5 border border-slate-100">“{r.reason}”</div>}
              <Decide busy={busy} onDecide={(d, c) => act(r.id, d, c, true)} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

// ------------------------------------------------------------------ team calendar (month grid on desktop, list on phones)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_CHIPS = 3;
const shiftMonth = (m: string, delta: number) =>
  new Date(Date.UTC(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1 + delta, 1)).toISOString().slice(0, 7);
const monthTitle = (m: string) => `${MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}`;
const CHIP_STYLE: Record<string, string> = {
  PENDING: 'bg-white text-orange-800 border-orange-300 border-dashed',
  APPROVED: 'bg-sky-100 text-sky-800 border-sky-200',
};

export const TeamCalendar: React.FC = () => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayIst();

  useEffect(() => {
    const y = parseInt(month.slice(0, 4), 10);
    const m = parseInt(month.slice(5, 7), 10);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    let alive = true;
    setError(null); setLoading(true); setSelected(null);
    leaveService.teamCalendar(`${month}-01`, last)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [month]);

  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const iso = (day: number) => `${month}-${String(day).padStart(2, '0')}`;

  const items: any[] = data?.items || [];
  const holidays: any[] = data?.holidays || [];
  const leavesOn = (d: string) => items.filter((i) => i.from <= d && i.to >= d);
  const holidayOn = (d: string) => holidays.find((h) => h.date === d);
  const awayThisMonth = new Set(items.map((i) => i.uid || i.name)).size;
  const selectedLeaves = selected ? leavesOn(selected) : [];
  const selectedHoliday = selected ? holidayOn(selected) : undefined;

  // Phone list: one row per day that has someone away or a holiday.
  const agenda = Array.from({ length: daysInMonth }, (_, i) => iso(i + 1)).map((d) => ({ d, leaves: leavesOn(d), hol: holidayOn(d) })).filter((x) => x.leaves.length || x.hol);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-1">
            <button className={`${btnGhost} !px-2`} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="w-4 h-4" /></button>
            <h3 className="text-base font-bold text-slate-900 min-w-[9.5rem] text-center">{monthTitle(month)}</h3>
            <button className={`${btnGhost} !px-2`} aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="w-4 h-4" /></button>
            {month !== thisMonth() && <button className={btnGhost} onClick={() => setMonth(thisMonth())}>Today</button>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-100 border border-sky-200" /> Approved</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-white border border-dashed border-orange-300" /> Waiting</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-violet-100 border border-violet-200" /> Holiday</span>
          </div>
        </div>
        {error && <div className="p-3"><Notice tone="error">{error}</Notice></div>}

        {/* phones */}
        <div className={`md:hidden ${loading ? 'opacity-60' : ''}`}>
          {agenda.length === 0 ? <EmptyState icon={Users} title="Everyone is in this month" /> : (
            <div className="divide-y divide-slate-100">
              {agenda.map(({ d, leaves, hol }) => (
                <div key={d} className={`px-3 py-2.5 flex gap-3 ${d === today ? 'bg-orange-50/50' : ''}`}>
                  <div className="w-12 shrink-0 text-center">
                    <div className="text-[10px] font-bold uppercase text-slate-400">{shortDate(d).slice(0, 3)}</div>
                    <div className={`text-lg font-black ${d === today ? 'text-[#FA7014]' : 'text-slate-800'}`}>{Number(d.slice(8))}</div>
                  </div>
                  <div className="flex-1 flex flex-wrap gap-1 content-center">
                    {hol && <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-violet-100 text-violet-800">{hol.name}</span>}
                    {leaves.map((l, k) => <span key={k} className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${CHIP_STYLE[l.status] || CHIP_STYLE.APPROVED}`}>{l.name}{l.halfDay ? ' ½' : ''}</span>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* desktop */}
        <div className={`hidden md:block ${loading ? 'opacity-60' : ''} transition-opacity`}>
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((w, i) => <div key={w} className={`px-2 py-2 text-[11px] font-bold uppercase tracking-wide ${i >= 5 ? 'text-slate-400' : 'text-slate-500'}`}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: totalCells }, (_, idx) => {
              const day = idx - offset + 1;
              const inMonth = day >= 1 && day <= daysInMonth;
              const borders = `border-b border-slate-100 ${idx % 7 !== 6 ? 'border-r' : ''}`;
              if (!inMonth) return <div key={idx} className={`min-h-[6.5rem] bg-slate-50/60 ${borders}`} />;
              const d = iso(day);
              const leaves = leavesOn(d);
              const hol = holidayOn(d);
              const isSel = d === selected;
              const weekend = idx % 7 >= 5;
              return (
                <button key={idx} type="button" onClick={() => setSelected(isSel ? null : d)}
                  className={`min-h-[6.5rem] p-1.5 text-left flex flex-col gap-1 transition-colors ${borders} ${isSel ? 'bg-[#FA7014]/5 ring-2 ring-inset ring-[#FA7014]/50' : hol ? 'bg-violet-50/60 hover:bg-violet-50' : weekend ? 'bg-slate-50/60 hover:bg-slate-100/60' : 'hover:bg-slate-50'}`}>
                  <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${d === today ? 'bg-[#FA7014] text-white' : weekend ? 'text-slate-400' : 'text-slate-700'}`}>{day}</span>
                  {hol && <span className="text-[10px] leading-tight font-semibold text-violet-700 truncate w-full" title={hol.name}>{hol.name}</span>}
                  {leaves.slice(0, MAX_CHIPS).map((l, k) => (
                    <span key={k} title={`${l.name}${l.type ? ' · ' + l.type : ''}${l.status === 'PENDING' ? ' (waiting)' : ''}`}
                      className={`text-[10px] leading-tight font-semibold px-1.5 py-0.5 rounded border truncate w-full ${CHIP_STYLE[l.status] || CHIP_STYLE.APPROVED}`}>{l.name}{l.halfDay ? ' ½' : ''}</span>
                  ))}
                  {leaves.length > MAX_CHIPS && <span className="text-[10px] font-semibold text-slate-500 px-1">+{leaves.length - MAX_CHIPS} more</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-slate-200 text-xs text-slate-500 bg-slate-50/60">
          {items.length === 0 ? 'No one is away this month.' : `${awayThisMonth} ${awayThisMonth === 1 ? 'person is' : 'people are'} away this month.`}<span className="hidden md:inline"> Click a day for details.</span>
        </div>
      </div>

      {selected && (
        <Card title={niceDate(selected)} right={<button className={btnGhost} onClick={() => setSelected(null)}>Close</button>}>
          {selectedHoliday && <div className="text-xs font-semibold text-violet-700 mb-2">Holiday: {selectedHoliday.name}{selectedHoliday.optional ? ' (optional)' : ''}</div>}
          {selectedLeaves.length === 0 ? <div className="text-sm text-slate-500">Nobody is on leave this day.</div> : (
            <div className="divide-y divide-slate-100">
              {selectedLeaves.map((l, k) => (
                <div key={k} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">{l.name}{l.halfDay ? ' · half day' : ''}</div>
                    <div className="text-xs text-slate-500">{l.type || 'On leave'} · {range(l.from, l.to)}{l.reason ? ` · “${l.reason}”` : ''}</div>
                  </div>
                  <StatusPill status={l.status} short />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
