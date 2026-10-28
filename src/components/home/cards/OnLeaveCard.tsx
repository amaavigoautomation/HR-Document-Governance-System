import React, { useState } from 'react';
import { Palmtree } from 'lucide-react';
import { homeService } from '../../../services/homeService';
import { shortRange } from '../../leave/ui';
import { Avatar, HomeCard, Tabs } from '../parts';
import { useLoad } from '../useLoad';

export const OnLeaveCard: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [scope, setScope] = useState<'today' | 'future'>('today');
  const load = useLoad(() => homeService.onLeave(scope), [scope, refreshKey]);
  const rows = load.data?.rows || [];
  return (
    <HomeCard title="Employees on leave" icon={<Palmtree className="w-4 h-4 text-[#FA7014]" />} loading={load.loading && !load.data} error={load.error} onRetry={load.reload} empty={rows.length === 0} emptyText={scope === 'today' ? 'Nobody is on leave today' : 'No upcoming leave'}>
      <Tabs value={scope} onChange={setScope} items={[{ value: 'today', label: 'Today' }, { value: 'future', label: 'In future' }]} />
      <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
        {rows.map((r, i) => (
          <li key={`${r.name}-${r.from}-${i}`} className="flex items-center gap-3 py-2">
            <Avatar name={r.name} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 truncate">{r.name}</div>
              <div className="text-[11px] text-slate-500 truncate">{r.department || ' '}</div>
            </div>
            <div className="text-[11px] text-slate-600 text-right">{shortRange(r.from, r.to)}{r.half ? ' · half day' : ''}</div>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
};
