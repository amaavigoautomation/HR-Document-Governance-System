import React, { useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import type { WidgetTarget } from '../../../../shared/dashboard';
import { homeService } from '../../../services/homeService';
import { niceDate } from '../../leave/ui';
import { HomeCard, Tabs, safeHref } from '../parts';
import { useLoad } from '../useLoad';

export const FilesCard: React.FC<{ onOpen: (t: WidgetTarget) => void; refreshKey: number }> = ({ onOpen, refreshKey }) => {
  const [tab, setTab] = useState<'org' | 'employee'>('org');
  const org = useLoad(() => homeService.orgFiles(), [refreshKey]);
  const mine = useLoad(() => homeService.myFiles(), [refreshKey]);
  const cur = tab === 'org' ? org : mine;
  const empty = !cur.data || cur.data.items.length === 0;
  return (
    <HomeCard title="Important files" icon={<FolderOpen className="w-4 h-4 text-[#FA7014]" />} loading={cur.loading && !cur.data} error={cur.error} onRetry={cur.reload}>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'org', label: 'Organization' }, { value: 'employee', label: 'Employee' }]} />
      {empty ? <p className="py-6 text-center text-xs text-slate-400">No files to show</p> : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {tab === 'org' && org.data?.items.map((f) => {
            const href = safeHref(f.fileUrl || '');
            return (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-slate-800 truncate">{f.title}</div>
                  <div className="text-[11px] text-slate-500 truncate">{[f.category, `v${f.versionNumber}`, f.date && niceDate(f.date)].filter(Boolean).join(' · ')}</div>
                </div>
                {href ? <a href={href} target="_blank" rel="noopener noreferrer" download className="p-1.5 rounded hover:bg-slate-100" aria-label={`Download ${f.title}`}><Download className="w-4 h-4 text-slate-500" /></a>
                  : <button type="button" className="text-[11px] font-bold text-[#FA7014]" onClick={() => onOpen({ module: 'document-version-control', docTab: 'employee' })}>Open</button>}
              </li>
            );
          })}
          {tab === 'employee' && mine.data?.items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-800 truncate">{f.title}</div>
                <div className="text-[11px] text-slate-500">{f.kind === 'PAYSLIP' ? 'Payslip' : 'Letter'}{f.date ? ` · ${niceDate(f.date)}` : ''}</div>
              </div>
              <button type="button" className="text-[11px] font-bold text-[#FA7014]" onClick={() => onOpen(f.target)}>Open</button>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
};
