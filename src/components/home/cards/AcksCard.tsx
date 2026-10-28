import React, { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { WidgetTarget } from '../../../../shared/dashboard';
import { homeService } from '../../../services/homeService';
import { HomeCard, Tabs } from '../parts';
import { useLoad } from '../useLoad';

export const AcksCard: React.FC<{ onOpen: (t: WidgetTarget) => void; refreshKey: number }> = ({ onOpen, refreshKey }) => {
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const load = useLoad(() => homeService.acks(), [refreshKey]);
  const d = load.data;
  const list = d?.allowed ? d[tab] : undefined;
  return (
    <HomeCard title="Acknowledgements" icon={<ClipboardCheck className="w-4 h-4 text-[#FA7014]" />} loading={load.loading && !d} error={load.error} onRetry={load.reload}
      empty={!!d && !d.allowed} emptyText="Nothing to acknowledge">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'active', label: 'Active', count: d?.active?.count }, { value: 'completed', label: 'Completed', count: d?.completed?.count }]} />
      {!list || list.items.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">{tab === 'active' ? 'You are all caught up' : 'Nothing acknowledged yet'}</p> : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {list.items.map((a) => (
            <li key={`${a.documentId}-${a.versionNumber}`} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-800 truncate">{a.title}</div>
                <div className="text-[11px] text-slate-500">v{a.versionNumber}</div>
              </div>
              {tab === 'active' && <button type="button" className="text-[11px] font-bold text-[#FA7014]" onClick={() => onOpen({ module: 'document-version-control', docTab: 'employee' })}>Review</button>}
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
};
