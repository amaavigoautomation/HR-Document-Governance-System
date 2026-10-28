import React, { useState } from 'react';
import { PartyPopper } from 'lucide-react';
import type { Celebrant } from '../../../../shared/home';
import { homeService } from '../../../services/homeService';
import { shortDate } from '../../leave/ui';
import { Avatar, HomeCard, Tabs } from '../parts';
import { useLoad } from '../useLoad';

type Kind = 'birthdays' | 'work' | 'marriage';
const RANGES = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }] as const;

export const CelebrationsCard: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [kind, setKind] = useState<Kind>('birthdays');
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const load = useLoad(() => homeService.wishes(range), [range, refreshKey]);
  const d = load.data;
  const rows: Celebrant[] = d ? d[kind] : [];
  return (
    <HomeCard title="Wish celebration" icon={<PartyPopper className="w-4 h-4 text-[#FA7014]" />} loading={load.loading && !d} error={load.error} onRetry={load.reload}>
      <Tabs value={kind} onChange={setKind} items={[
        { value: 'birthdays', label: 'Birthdays', count: d?.birthdays.length }, { value: 'work', label: 'Work anniversary', count: d?.work.length }, { value: 'marriage', label: 'Marriage', count: d?.marriage.length },
      ]} />
      <div className="flex gap-1 mb-2">
        {RANGES.map((r) => (
          <button key={r.value} type="button" onClick={() => setRange(r.value)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${range === r.value ? 'bg-orange-50 border-[#FA7014] text-[#FA7014]' : 'border-slate-200 text-slate-500'}`}>{r.label}</button>
        ))}
      </div>
      {rows.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No celebrations in this period</p> : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {rows.map((c) => (
            <li key={`${c.uid}-${c.kind}`} className="flex items-center gap-3 py-2">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-800 truncate">{c.name}</div>
                <div className="text-[11px] text-slate-500 truncate">{c.kind === 'WORK' && c.years ? `${c.years} year${c.years === 1 ? '' : 's'}` : c.title || c.department}</div>
              </div>
              <div className="text-[11px] font-semibold text-slate-600">{shortDate(c.date)}</div>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
};
