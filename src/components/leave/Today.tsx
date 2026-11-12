import React, { useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarPlus, ChevronRight, Clock, Coffee, Fingerprint, Inbox, Layers, LogIn, LogOut, MapPin, Palmtree, Sun, UserRound, Users, Wrench, Zap } from 'lucide-react';
import { Avatar } from '../home/parts';
import { leaveService } from '../../services/leaveService';
import { PunchCard } from './AttendanceTab';
import { Updates } from './HrGovernance';
import { AskPolicy } from './AskPolicy';
import { Card, days, EmptyState, halfNote, hm, Notice, relDay, shortDate, shortRange, Skeleton, StatusPill, useRunner } from './ui';

const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3600_000).getUTCHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
};
const toMin = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + m; };
/** "09:02" to "09:02 AM". */
const t12 = (hhmm?: string | null) => {
  if (!hhmm) return '--';
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const hmOrZero = (m: number) => hm(m) || '0h 00m';
const fullDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
/** Minutes since midnight in IST, refreshed every 15 seconds. */
function useIstMinutes() {
  const calc = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const [t, setT] = useState(calc);
  useEffect(() => { const id = setInterval(() => setT(calc()), 15_000); return () => clearInterval(id); }, []);
  return t;
}

/** Balance tiles: big number left, small bar showing used vs total. */
export const BalanceStrip: React.FC<{ me: any; onApply?: (typeId: string) => void }> = ({ me, onApply }) => {
  const list = me.balances.filter((b: any) => !b.isLop && b.eligible);
  if (list.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
      {list.map((b: any) => {
        const total = Math.max(b.credited, b.balance + b.used + (b.pending || 0));
        const leftPct = b.requiresBalance && total > 0 ? Math.max(0, Math.min(100, Math.round((b.balance / total) * 100))) : 0;
        return (
          <button key={b.typeId} type="button" onClick={() => onApply?.(b.typeId)} title={onApply ? `Apply for ${b.name}` : undefined}
            className="text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-[#6d4cf0]/60 transition-colors">
            <div className="text-xs font-bold text-slate-600 truncate">{b.name}</div>
            {b.requiresBalance ? (
              <>
                <div className="mt-1 flex items-baseline gap-1"><span className="text-2xl font-black text-slate-900">{b.balance}</span><span className="text-xs text-slate-400">days left</span></div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden" title={`${b.balance} of ${total} days left`}><div className="h-full bg-emerald-500" style={{ width: `${leftPct}%` }} /></div>
                <div className="mt-1 text-[10px] text-slate-400">Used {b.used}{b.pending ? ` · ${b.pending} waiting` : ''} · {b.cycleLabel}</div>
              </>
            ) : (
              <>
                <div className="mt-1 text-sm font-bold text-slate-700">No limit</div>
                <div className="mt-1 text-[10px] text-slate-400">Taken {b.used} day(s) · {b.cycleLabel}</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
};

const Panel: React.FC<{ title: React.ReactNode; Icon?: React.FC<{ className?: string }>; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, Icon, right, className = '', children }) => (
  <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-950">{Icon && <Icon className="h-4 w-4 text-violet-600" />}{title}</h2>{right}
    </div>
    {children}
  </section>
);

/** Original calendar-and-clock picture for the greeting card. */
const Illustration: React.FC = () => (
  <svg viewBox="0 0 160 130" className="h-28 w-36 shrink-0" aria-hidden>
    <ellipse cx="82" cy="120" rx="62" ry="7" fill="#ddd6fe" opacity=".6" />
    <rect x="34" y="62" width="92" height="56" rx="10" fill="#ede9fe" stroke="#c4b5fd" strokeWidth="2" />
    <rect x="34" y="62" width="92" height="14" rx="7" fill="#c4b5fd" />
    {[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => <rect key={`${r}${c}`} x={44 + c * 15} y={82 + r * 9} width="9" height="5" rx="1.5" fill={r === 1 && c === 2 ? '#6d4cf0' : '#ddd6fe'} />))}
    <circle cx="96" cy="48" r="34" fill="#fff" stroke="#8b6cf3" strokeWidth="5" />
    <circle cx="96" cy="48" r="26" fill="#f5f3ff" />
    <path d="M96 30v18l12 7" fill="none" stroke="#6d4cf0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30 60c-8-14-6-26 4-34 2 12 8 18 14 24-6 2-12 6-18 10z" fill="#c4b5fd" opacity=".7" />
  </svg>
);

const ST_PILL: Record<string, string> = { Present: 'bg-emerald-50 text-emerald-700', Late: 'bg-amber-50 text-amber-700', 'On Leave': 'bg-violet-50 text-violet-700', 'Half Day Leave': 'bg-violet-50 text-violet-700', 'Not in yet': 'bg-slate-100 text-slate-600', Absent: 'bg-rose-50 text-rose-700', Holiday: 'bg-sky-50 text-sky-700', 'Weekly Off': 'bg-sky-50 text-sky-700' };
const dayLabel = (d: any): string => {
  if (!d) return '—';
  if (d.status === 'LEAVE') return 'On Leave';
  if (d.status === 'HALF_LEAVE') return 'Half Day Leave';
  if (d.status === 'HOLIDAY') return 'Holiday';
  if (d.status === 'WEEKLY_OFF') return 'Weekly Off';
  if (d.checkIn) return d.late ? 'Late' : 'Present';
  if (d.status === 'ABSENT') return 'Absent';
  return 'Not in yet';
};

export const Today: React.FC<{ me: any; reload: () => void; onApply: (typeId?: string) => void; onOpen: (tab: string) => void; refreshKey: number }> = ({ me, reload, onApply, onOpen, refreshKey }) => {
  const [mine, setMine] = useState<any[] | null>(null);
  const [away, setAway] = useState<any[] | null>(null);
  const [team, setTeam] = useState<any[] | null>(null);
  const { busy, note, run } = useRunner();
  const nowMin = useIstMinutes();

  useEffect(() => {
    leaveService.myRequests().then((r) => setMine(r.items)).catch(() => setMine([]));
    leaveService.teamCalendar(me.today, me.today).then((r) => setAway(r.items.filter((i: any) => i.uid !== me.person.uid && i.status === 'APPROVED'))).catch(() => setAway([]));
    leaveService.attendanceReport({ from: me.today, to: me.today }).then((r: any) => setTeam(r.people || [])).catch(() => setTeam([]));
  }, [me.today, me.person.uid, refreshKey]);

  const att = me.attendanceToday;
  const shift = me.settings.shift;
  const shiftMins = Math.max(0, toMin(shift.end) - toMin(shift.start));
  const sessions: { in: string; out: string | null }[] = att.sessions || [];
  const worked = (att.workedMinutes || 0) + (att.open && att.openSince ? Math.max(0, nowMin - toMin(att.openSince)) : 0);
  const breaks = sessions.slice(1).map((x, i) => ({ from: sessions[i].out as string, to: x.in })).filter((b) => b.from);
  const breakMins = breaks.reduce((n, b) => n + Math.max(0, toMin(b.to) - toMin(b.from)), 0);
  const remaining = Math.max(0, shiftMins - worked);
  const state: 'out' | 'in' | 'back' = !att.checkIn ? 'out' : att.open ? 'in' : 'back';
  const late = !!att.checkIn && toMin(att.checkIn) > toMin(shift.start) + (shift.graceMinutes || 0);
  const first = (me.person.name || '').split(' ')[0];

  const onLeaveToday = (mine || []).some((r) => r.status === 'APPROVED' && r.from <= me.today && r.to >= me.today);
  const holiday = (me.holidays || []).find((h: any) => h.date === me.today && !h.optional);
  const statusText = state !== 'out' ? (late ? 'Late' : 'Present') : onLeaveToday ? 'On Leave' : holiday ? 'Holiday' : 'Not checked in';
  const statusTone = statusText === 'Present' ? ['bg-gradient-to-br from-emerald-100/80 to-green-50 border-emerald-100', 'text-emerald-600', 'text-emerald-600'] : statusText === 'Late' ? ['bg-gradient-to-br from-amber-100/80 to-orange-50 border-amber-100', 'text-amber-600', 'text-amber-600'] : ['bg-gradient-to-br from-slate-100 to-slate-50 border-slate-200', 'text-slate-500', 'text-slate-700'];

  const punch = (kind: 'in' | 'out') => run(async () => {
    if (kind === 'in') await leaveService.checkIn(); else await leaveService.checkOut();
    await reload();
  }, kind === 'in' ? 'Checked in. Have a good day!' : 'Checked out.');

  const R = 52; const C = 2 * Math.PI * R;
  const pct = shiftMins ? Math.min(1, worked / shiftMins) : 0;

  const timeline: { label: string; sub: string; done: boolean; Icon?: React.FC<{ className?: string }> }[] = [
    { label: 'Check In', sub: t12(att.checkIn), done: !!att.checkIn },
    ...breaks.map((b) => ({ label: 'Break', sub: `${t12(b.from)} – ${t12(b.to)}`, done: true, Icon: Coffee })),
    { label: 'Check Out', sub: att.open || !att.checkOut ? '--' : t12(att.checkOut), done: !!att.checkOut && !att.open },
  ];

  const schedule = [
    { Icon: Clock, label: 'Work Hours', value: `${t12(shift.start)} – ${t12(shift.end)}` },
    { Icon: Layers, label: 'Shift', value: `General (${Math.round(shiftMins / 60 * 10) / 10}h)` },
    { Icon: UserRound, label: 'Reports to', value: me.profile?.manager || '—' },
    { Icon: MapPin, label: 'Location', value: me.profile?.location || '—' },
  ];
  const actions = [
    { label: 'Apply Leave', Icon: CalendarPlus, on: () => onApply() },
    { label: 'Regularize Attendance', Icon: Clock, on: () => onOpen('regularization') },
    { label: 'Mark Attendance', Icon: Fingerprint, on: () => onOpen('attendance') },
    { label: 'View Team Calendar', Icon: CalendarDays, on: () => onOpen('team') },
  ];

  const teamRows = (team || []).map((p) => ({ ...p, day: (p.days || [])[0] })).slice(0, 6);

  const coming = (mine || []).filter((r) => ['PENDING', 'APPROVED', 'CANCEL_REQUESTED', 'INFO_REQUESTED'].includes(r.status) && r.to >= me.today).sort((a, b) => a.from.localeCompare(b.from)).slice(0, 4);
  const holidays = (me.holidays || []).filter((h: any) => h.date >= me.today).slice(0, 3);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Today</h1>
          <p className="mt-1 text-sm text-slate-600">View your attendance, working hours and schedule for today.</p>
        </div>
        <span className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"><CalendarDays className="h-4 w-4 text-violet-600" />{fullDate(me.today)}</span>
      </header>

      {me.approvals > 0 && (
        <button onClick={() => onOpen('approvals')} className="flex w-full items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left hover:bg-violet-100/70">
          <Inbox className="h-5 w-5 text-violet-600" />
          <span className="flex-1 text-sm font-bold text-slate-800">{me.approvals} {me.approvals === 1 ? 'request is' : 'requests are'} waiting for your approval</span>
          <span className="text-xs font-bold text-violet-700">Review →</span>
        </button>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1.1fr_0.7fr]">
        <section className="flex min-w-0 items-center justify-between gap-2 overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-100/80 via-violet-50 to-white p-5 shadow-sm">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-950">{greeting()}, {first || 'there'} 👋</h2>
            <p className="mt-0.5 text-sm text-slate-600">{state === 'in' ? 'You are currently checked in.' : state === 'back' ? 'You have checked out for now.' : 'You have not checked in yet.'}</p>
            <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${state === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-slate-600'}`}><span className={`h-2 w-2 rounded-full ${state === 'in' ? 'bg-emerald-500' : 'bg-slate-400'}`} />{state === 'in' ? 'Checked In' : state === 'back' ? 'Checked Out' : 'Not Checked In'}</span>
            <div className="mt-2 text-3xl font-bold tabular-nums text-slate-950">{att.checkIn ? t12(att.checkIn) : '--:--'}</div>
            <div className="text-xs text-slate-500">{att.checkIn ? 'Clocked in at' : 'Not clocked in yet'}</div>
            {state === 'in'
              ? <button type="button" disabled={busy} onClick={() => punch('out')} className="mt-3 inline-flex h-10 w-full max-w-[16rem] items-center justify-center gap-2 rounded-xl border border-violet-400 bg-white text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60 cursor-pointer"><LogOut className="h-4 w-4" />Check Out</button>
              : <button type="button" disabled={busy} onClick={() => punch('in')} className="mt-3 inline-flex h-10 w-full max-w-[16rem] items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60 cursor-pointer"><LogIn className="h-4 w-4" />{state === 'back' ? 'Check In Again' : 'Check In'}</button>}
            {note && <div className="mt-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
          </div>
          <Illustration />
        </section>

        <Panel title="Today's Summary">
          <div className="flex flex-wrap items-center gap-5">
            <div className="relative h-40 w-40 shrink-0" role="img" aria-label={`${hmOrZero(worked)} worked of ${hmOrZero(shiftMins)}`}>
              <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
                <circle cx="70" cy="70" r={R} fill="none" stroke="#ede9fe" strokeWidth="12" />
                <circle cx="70" cy="70" r={R} fill="none" stroke="#6d4cf0" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} />
              </svg>
              <span className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-2xl font-bold text-slate-950">{hmOrZero(worked).replace(' 0', ' ')}</span><span className="text-xs text-slate-500">of {Math.round(shiftMins / 60 * 10) / 10}h</span></span>
            </div>
            <ul className="min-w-[10rem] flex-1 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
              {[[Clock, 'Worked', hmOrZero(worked)], [Coffee, 'Break', breakMins ? hm(breakMins) : '0m'], [Clock, 'Remaining', hmOrZero(remaining)]].map(([I, l, v]: any) => (
                <li key={l} className="flex items-center gap-2.5"><I className="h-4 w-4 text-slate-500" /><span className="flex-1 text-slate-700">{l}</span><b className="tabular-nums text-slate-900">{v}</b></li>
              ))}
            </ul>
          </div>
        </Panel>

        <section className={`flex min-w-0 flex-col justify-center rounded-2xl border p-5 shadow-sm ${statusTone[0]}`}>
          <span className={`flex h-12 w-12 items-center justify-center rounded-full bg-white/80 ${statusTone[1]}`}><CalendarCheck className="h-6 w-6" /></span>
          <div className="mt-3 text-sm font-semibold text-slate-800">Attendance Status</div>
          <div className={`text-3xl font-bold leading-tight ${statusTone[2]}`}>{statusText}</div>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Panel title="Today's Schedule" Icon={CalendarDays}>
          <ul className="divide-y divide-slate-100 text-sm">
            {schedule.map(({ Icon, label, value }) => (
              <li key={label} className="flex items-center gap-3 py-3"><Icon className="h-4 w-4 shrink-0 text-slate-500" /><span className="flex-1 text-slate-700">{label}</span><b className="truncate text-right text-slate-900">{value}</b></li>
            ))}
          </ul>
        </Panel>

        <Panel title="Today's Activity" Icon={CalendarCheck}>
          <ol className="relative space-y-5 pl-1">
            {timeline.map((t, i) => (
              <li key={i} className="relative flex items-start gap-3">
                {i < timeline.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-0.5rem)] w-0.5 bg-violet-200" aria-hidden />}
                <span className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${t.done ? (t.Icon ? 'bg-violet-100 text-violet-600' : 'bg-emerald-500 text-white') : 'border-2 border-slate-300 bg-white'}`}>{t.done ? (t.Icon ? <t.Icon className="h-3.5 w-3.5" /> : <span className="text-xs">✓</span>) : null}</span>
                <span><span className="block text-sm font-bold text-slate-900">{t.label}</span><span className="block text-xs text-slate-500">{t.sub}</span></span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Quick Actions" Icon={Zap} className="md:col-span-2 lg:col-span-1">
          <div className="space-y-2">
            {actions.map((a) => (
              <button key={a.label} type="button" onClick={a.on} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-sm font-medium text-slate-800 hover:border-violet-300 hover:bg-violet-50/40 cursor-pointer">
                <a.Icon className="h-4 w-4 text-violet-600" /><span className="flex-1">{a.label}</span><ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>
        </Panel>
      </div>

      {team && team.length > 1 && (
        <Panel title={<>Team Attendance <span className="text-sm font-normal text-slate-600">(Today)</span></>} Icon={Users} right={<button type="button" onClick={() => onOpen('reports')} className="text-sm font-semibold text-violet-700 hover:underline cursor-pointer">View Team Attendance →</button>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="bg-slate-50 text-xs font-semibold text-slate-600">{['Employee', 'Department', 'Check In', 'Check Out', 'Status'].map((h) => <th key={h} className="px-3 py-2.5 first:rounded-l-lg last:rounded-r-lg">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {teamRows.map((p) => { const label = dayLabel(p.day); return (
                  <tr key={p.uid} className="text-slate-800">
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={p.name} /><b className="truncate text-slate-900">{p.name}</b></span></td>
                    <td className="px-3 py-2.5">{p.department || '—'}</td>
                    <td className="px-3 py-2.5 tabular-nums">{t12(p.day?.checkIn)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{t12(p.day?.checkOut)}</td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ST_PILL[label] || 'bg-slate-100 text-slate-600'}`}>{label}</span></td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <AskPolicy />
      <Updates refreshKey={refreshKey} onOpen={(link) => onOpen(link as any)} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-950">Leave balance <span className="text-sm font-normal text-slate-600">(My)</span></h3>
          <button className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => onOpen('my')}>History →</button>
        </div>
        <BalanceStrip me={me} onApply={(id) => onApply(id)} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Your upcoming leave" className="md:col-span-2" right={<button className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => onOpen('my')}>All requests →</button>}>
          {!mine ? <Skeleton rows={2} /> : coming.length === 0 ? (
            <EmptyState title="No leave planned" text="Need a break? It takes under a minute." />
          ) : (
            <div className="divide-y divide-slate-100">
              {coming.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-800">{shortRange(r.from, r.to)} <span className="font-normal text-slate-400">· {relDay(r.from, me.today)}</span></div>
                    <div className="truncate text-xs text-slate-500">{r.typeName} · {days(r.days)}{halfNote(r)}</div>
                  </div>
                  <StatusPill status={r.status} short />
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Away today">
            {!away ? <Skeleton rows={1} /> : away.length === 0 ? <div className="flex items-center gap-2 text-xs text-slate-500"><Users className="h-4 w-4" />Everyone in your team is in.</div> : (
              <div className="space-y-1.5">
                {away.slice(0, 6).map((a, i) => <div key={i} className="flex items-center gap-2 text-xs"><Palmtree className="h-3.5 w-3.5 text-sky-500" /><span className="font-semibold text-slate-700">{a.name}</span>{a.halfDay && <span className="text-slate-400">½ day</span>}</div>)}
                {away.length > 6 && <button className="text-xs font-bold text-slate-500" onClick={() => onOpen('team')}>+{away.length - 6} more</button>}
              </div>
            )}
          </Card>
          <Card title="Next holidays">
            {holidays.length === 0 ? <div className="text-xs text-slate-500">No holidays added yet.</div> : holidays.map((h: any) => (
              <div key={h.date} className="flex items-center gap-2 py-1 text-xs">
                <Sun className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                <span className="flex-1 truncate font-semibold text-slate-700">{h.name}{h.optional ? <span className="font-normal text-slate-400"> (optional)</span> : ''}</span>
                <span className="whitespace-nowrap text-slate-500">{shortDate(h.date)}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
};
