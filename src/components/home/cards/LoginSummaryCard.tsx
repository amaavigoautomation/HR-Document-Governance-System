import React from 'react';
import { Activity } from 'lucide-react';
import { homeService } from '../../../services/homeService';
import { shortDate } from '../../leave/ui';
import { HomeCard } from '../parts';
import { useLoad } from '../useLoad';

export const LoginSummaryCard: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const load = useLoad(() => homeService.loginSummary(5), [refreshKey]);
  const s = load.data?.series || [];
  const max = Math.max(1, ...s.flatMap((x) => [x.web, x.mobile]));
  const W = 300, H = 120, pad = 18;
  const x = (i: number) => pad + (s.length < 2 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (s.length - 1));
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad);
  const line = (k: 'web' | 'mobile') => s.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join(' ');
  const empty = s.length === 0 || s.every((p) => p.web + p.mobile === 0);
  return (
    <HomeCard title="Employee login summary" icon={<Activity className="w-4 h-4 text-[#FA7014]" />} loading={load.loading && !load.data} error={load.error} onRetry={load.reload} empty={empty} emptyText="No logins recorded yet">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Logins per day from web and mobile">
        {[0, 0.5, 1].map((f) => <line key={f} x1={pad} x2={W - pad} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f0" strokeWidth="1" />)}
        <path d={line('web')} fill="none" stroke="#FA7014" strokeWidth="2" />
        <path d={line('mobile')} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeDasharray="4 3" />
        {s.map((p, i) => (<g key={p.date}><circle cx={x(i)} cy={y(p.web)} r="3" fill="#FA7014" /><circle cx={x(i)} cy={y(p.mobile)} r="3" fill="#0ea5e9" />
          <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="8" fill="#64748b">{shortDate(p.date)}</text></g>))}
      </svg>
      <div className="flex gap-4 text-[11px] text-slate-600 justify-center">
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-[#FA7014]" />Web</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-0.5 bg-sky-500" />Mobile</span>
      </div>
      <table className="sr-only"><tbody>{s.map((p) => <tr key={p.date}><td>{p.date}</td><td>web {p.web}</td><td>mobile {p.mobile}</td></tr>)}</tbody></table>
    </HomeCard>
  );
};
