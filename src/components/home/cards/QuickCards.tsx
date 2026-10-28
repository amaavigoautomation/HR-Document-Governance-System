import React from 'react';
import { BarChart3, ExternalLink, Link2 } from 'lucide-react';
import type { WidgetTarget } from '../../../../shared/dashboard';
import type { QuickLink, QuickReport } from '../../../../shared/home';
import { HomeCard, safeHref } from '../parts';

const tile = 'flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-orange-50 hover:border-orange-200 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition-colors';

export const QuickLinksCard: React.FC<{ links: QuickLink[]; onOpen: (t: WidgetTarget) => void }> = ({ links, onOpen }) => (
  <HomeCard title="Quick links" icon={<Link2 className="w-4 h-4 text-[#FA7014]" />} empty={links.length === 0} emptyText="No quick links yet">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {links.map((l) => {
        if (l.kind === 'URL') {
          const href = l.url && /^https:\/\//i.test(l.url) ? safeHref(l.url) : null;
          return href ? (
            <a key={l.id} href={href} target="_blank" rel="noopener noreferrer" className={tile}>
              <span className="flex-1 truncate">{l.label}</span><ExternalLink className="w-3 h-3 text-slate-400" aria-label="Opens in a new tab" />
            </a>
          ) : null;
        }
        return l.target ? <button key={l.id} type="button" className={tile} onClick={() => onOpen(l.target!)}>{l.label}</button> : null;
      })}
    </div>
  </HomeCard>
);

export const QuickReportsCard: React.FC<{ reports: QuickReport[]; onOpen: (t: WidgetTarget) => void }> = ({ reports, onOpen }) => (
  <HomeCard title="Quick reports" icon={<BarChart3 className="w-4 h-4 text-[#FA7014]" />} empty={reports.length === 0} emptyText="No reports available">
    <ul className="divide-y divide-slate-100">
      {reports.map((r) => (
        <li key={r.id}>
          <button type="button" className="w-full text-left py-2 hover:text-[#FA7014]" onClick={() => onOpen(r.target)}>
            <div className="text-xs font-bold text-slate-800">{r.label}</div>
            <div className="text-[11px] text-slate-500">{r.hint}</div>
          </button>
        </li>
      ))}
    </ul>
  </HomeCard>
);
