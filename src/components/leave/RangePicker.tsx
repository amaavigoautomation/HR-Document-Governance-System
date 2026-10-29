import React, { useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { addDaysIso, input } from './ui';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
export const monthOf = (iso: string) => iso.slice(0, 7);
export const shiftMonth = (m: string, by: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);

export type Preset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'cycle' | 'custom';
export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' }, { value: 'thisMonth', label: 'This Month' }, { value: 'lastMonth', label: 'Last Month' },
  { value: 'cycle', label: 'Attendance Cycle' }, { value: 'custom', label: 'Custom Range' },
];
export const MAX_RANGE_DAYS = 93;

/** The from/to dates for a preset. The attendance cycle runs from `startDay` of one month to the day before it next month. */
export function rangeFor(preset: Preset, today: string, startDay: number, custom: { from: string; to: string }): { from: string; to: string } {
  const m = monthOf(today);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDaysIso(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: addDaysIso(today, -6), to: today };
    case 'last30': return { from: addDaysIso(today, -29), to: today };
    case 'thisMonth': return { from: `${m}-01`, to: `${m}-${lastDay(m)}` };
    case 'lastMonth': { const p = shiftMonth(m, -1); return { from: `${p}-01`, to: `${p}-${lastDay(p)}` }; }
    case 'cycle': {
      const d = String(Math.min(28, Math.max(1, startDay))).padStart(2, '0');
      const begin = Number(today.slice(8)) >= startDay ? `${m}-${d}` : `${shiftMonth(m, -1)}-${d}`;
      const next = shiftMonth(monthOf(begin), 1);
      return { from: begin, to: addDaysIso(`${next}-${d}`, -1) };
    }
    default: return custom;
  }
}
export const fmtLong = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8))}, ${iso.slice(0, 4)}`;
export const monthsBetween = (from: string, to: string) => { const out: string[] = []; for (let m = monthOf(from); m <= monthOf(to); m = shiftMonth(m, 1)) out.push(m); return out; };


/** The "Today / Yesterday / Last 7 Days ... Custom Range" dropdown used on the attendance screens. */
export const RangePicker: React.FC<{
  preset: Preset; onPreset: (p: Preset) => void;
  custom: { from: string; to: string }; onCustom: (c: { from: string; to: string }) => void;
  from: string; to: string; today: string;
}> = ({ preset, onPreset, custom, onCustom, from, to, today }) => {
  const [menu, setMenu] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  // The list is placed on the screen itself (not inside the card), so a card that clips its contents cannot cut it off.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const toggle = () => {
    if (!menu && btn.current) {
      const r = btn.current.getBoundingClientRect();
      const listHeight = PRESETS.length * 40 + 8;
      const top = r.bottom + 4 + listHeight > window.innerHeight && r.top - listHeight - 4 > 0 ? r.top - listHeight - 4 : r.bottom + 4;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 184)), top });
    }
    setMenu(!menu);
  };
  const range = from === to ? fmtLong(from) : `${fmtLong(from)} - ${fmtLong(to)}`;
  return (
    <>
        <div className="relative">
          <button type="button" aria-haspopup="listbox" aria-expanded={menu} ref={btn} onClick={toggle}
            className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm text-slate-700 min-w-[15rem] hover:border-slate-400">
            <CalendarDays className="w-4 h-4 text-slate-400" /><span className="flex-1 text-left">{range}</span><ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden />
              <ul role="listbox" style={{ left: pos.left, top: pos.top }} className="fixed z-50 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm max-h-[70vh] overflow-auto">
                {PRESETS.map((p) => (
                  <li key={p.value} role="option" aria-selected={preset === p.value}>
                    <button type="button" className={`w-full text-left px-4 py-2 ${preset === p.value ? 'bg-blue-500 text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                      onClick={() => { onPreset(p.value); if (p.value !== 'custom') setMenu(false); }}>{p.label}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <input type="date" aria-label="From" className={`${input} !w-auto`} max={today} value={custom.from} onChange={(e) => onCustom({ ...custom, from: e.target.value })} />
            to
            <input type="date" aria-label="To" className={`${input} !w-auto`} value={custom.to} onChange={(e) => onCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
    </>
  );
};
