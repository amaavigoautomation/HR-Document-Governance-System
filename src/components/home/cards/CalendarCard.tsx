import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { homeService, type CalendarDay } from '../../../services/homeService';
import { STATUS_LABEL, thisMonth } from '../../leave/ui';
import { HomeCard } from '../parts';
import { useLoad } from '../useLoad';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const shiftMonth = (month: string, by: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** One look per kind of day, matching the legend under the calendar. */
function look(d: CalendarDay): { cell: string; label: string } {
  if (d.pending) return { cell: 'bg-amber-100 text-amber-800', label: 'Leave waiting for approval' };
  switch (d.status) {
    case 'ABSENT': case 'INCOMPLETE': return { cell: 'bg-rose-100 text-rose-700', label: STATUS_LABEL[d.status] };
    case 'LEAVE': return { cell: 'bg-emerald-100 text-emerald-700', label: 'Leave' };
    case 'HOLIDAY': return { cell: 'bg-violet-100 text-violet-700', label: d.holiday || 'Holiday' };
    case 'HALF_DAY': case 'HALF_LEAVE': return { cell: 'bg-pink-100 text-pink-700', label: STATUS_LABEL[d.status] };
    case 'WEEKLY_OFF': return { cell: 'bg-blue-100 text-blue-700', label: 'Weekly off' };
    default: return d.optional ? { cell: 'bg-stone-200 text-stone-700', label: `Optional: ${d.holiday}` } : { cell: 'text-slate-600', label: STATUS_LABEL[d.status] || '' };
  }
}

const LEGEND: { key: 'absent' | 'leave' | 'holiday' | 'halfDay' | 'unapproved' | 'weekOff' | 'optional'; label: string; dot: string }[] = [
  { key: 'absent', label: 'Absent', dot: 'bg-rose-500' },
  { key: 'leave', label: 'Leave', dot: 'bg-emerald-500' },
  { key: 'holiday', label: 'Holiday', dot: 'bg-violet-500' },
  { key: 'halfDay', label: 'Half day', dot: 'bg-pink-500' },
  { key: 'unapproved', label: 'Waiting approval', dot: 'bg-amber-500' },
  { key: 'weekOff', label: 'Week off', dot: 'bg-blue-500' },
  { key: 'optional', label: 'Optional holiday', dot: 'bg-stone-500' },
];

export const CalendarCard: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [month, setMonth] = useState(thisMonth());
  const load = useLoad(() => homeService.calendar(month), [month, refreshKey]);
  const cal = load.data;

  const cells = useMemo(() => {
    if (!cal?.days?.length) return [];
    const first = new Date(`${cal.days[0].date}T00:00:00Z`).getUTCDay();
    return [...Array.from({ length: first }, () => null), ...cal.days] as (CalendarDay | null)[];
  }, [cal]);

  const title = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const nav = (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Previous month" className="p-1 rounded hover:bg-slate-100" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="w-4 h-4" /></button>
      <span className="text-xs font-bold text-slate-700 w-20 text-center">{title}</span>
      <button type="button" aria-label="Next month" className="p-1 rounded hover:bg-slate-100" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="w-4 h-4" /></button>
    </div>
  );

  return (
    <HomeCard
      title="Calendar" icon={<CalendarDays className="w-4 h-4 text-[#FA7014]" />} right={nav}
      loading={load.loading && !cal} error={load.error} onRetry={load.reload}
      empty={!!cal && !cal.configured} emptyText="Leave and attendance is not set up yet" emptyHint="HR sets it up under Leave & Attendance."
    >
      {cal?.configured && (
        <>
          <div className="grid grid-cols-7 gap-y-1 text-center">
            {WEEK.map((w) => <div key={w} className="text-[10px] font-bold text-slate-400 pb-1">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} />;
              const l = look(d);
              const today = d.date === cal.today;
              return (
                <div key={d.date} className="flex justify-center">
                  <span
                    title={l.label ? `${d.date}: ${l.label}` : d.date}
                    className={`w-8 h-8 inline-flex items-center justify-center rounded-full text-xs font-semibold ${l.cell} ${today ? 'ring-2 ring-[#FA7014]' : ''}`}
                  >
                    {Number(d.date.slice(8))}
                  </span>
                </div>
              );
            })}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
            {LEGEND.map((l) => (
              <li key={l.key} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${l.dot}`} aria-hidden />{l.label} ({cal.legend?.[l.key] ?? 0})</li>
            ))}
          </ul>
        </>
      )}
    </HomeCard>
  );
};
