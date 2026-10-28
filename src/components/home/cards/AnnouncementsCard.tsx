import React from 'react';
import { Megaphone, Pin, Quote, Settings2 } from 'lucide-react';
import type { AnnouncementKind } from '../../../../shared/home';
import { homeService } from '../../../services/homeService';
import { niceDate } from '../../leave/ui';
import { HomeCard } from '../parts';
import { useLoad } from '../useLoad';

export const AnnouncementsCard: React.FC<{ kind: AnnouncementKind; canManage: boolean; onManage: () => void; refreshKey: number }> = ({ kind, canManage, onManage, refreshKey }) => {
  const ceo = kind === 'CEO_SPEAK';
  const load = useLoad(() => homeService.announcements(kind), [kind, refreshKey]);
  const items = load.data?.items || [];
  return (
    <HomeCard
      title={ceo ? 'CEO speak' : 'Announcements'}
      icon={ceo ? <Quote className="w-4 h-4 text-[#FA7014]" /> : <Megaphone className="w-4 h-4 text-[#FA7014]" />}
      right={canManage ? <button type="button" onClick={onManage} className="p-1 rounded hover:bg-slate-100" aria-label="Manage"><Settings2 className="w-4 h-4 text-slate-500" /></button> : undefined}
      loading={load.loading && !load.data} error={load.error} onRetry={load.reload}
      empty={items.length === 0} emptyText={ceo ? 'No message yet' : 'No announcements'}
    >
      <ul className="space-y-3 max-h-80 overflow-y-auto">
        {(ceo ? items.slice(0, 1) : items).map((a) => (
          <li key={a.id} className={ceo ? '' : 'border-b border-slate-100 pb-3 last:border-0'}>
            <div className="flex items-start gap-1.5">
              {a.pinned && <Pin className="w-3 h-3 mt-1 text-[#FA7014] shrink-0" aria-label="Pinned" />}
              <h3 className="text-sm font-bold text-slate-800">{a.title}</h3>
            </div>
            <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">{a.body}</p>
            <p className="mt-1 text-[11px] text-slate-400">{[a.authorName, a.authorTitle].filter(Boolean).join(', ')}{a.publishAt ? ` · ${niceDate(a.publishAt.slice(0, 10))}` : ''}</p>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
};
