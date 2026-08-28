import React from 'react';
import { VersionStatus } from '../types';
import { CheckCircle2, Clock, AlertTriangle, Archive, XCircle, FileCode } from 'lucide-react';

interface StatusBadgeProps {
  status: VersionStatus;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showIcon = true,
}) => {
  const getStyles = () => {
    switch (status) {
      case VersionStatus.PUBLISHED:
        return {
          bg: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
          darkBg: 'bg-emerald-950/40 text-emerald-300 border-emerald-700/50',
          label: 'PUBLISHED (LIVE)',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />,
        };
      case VersionStatus.IN_REVIEW:
        return {
          bg: 'bg-amber-500/10 text-amber-800 border-amber-500/30',
          darkBg: 'bg-amber-950/40 text-amber-300 border-amber-700/50',
          label: 'IN REVIEW',
          icon: <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
        };
      case VersionStatus.REVISION_REQUIRED:
        return {
          bg: 'bg-rose-500/10 text-rose-800 border-rose-500/30',
          darkBg: 'bg-rose-950/40 text-rose-300 border-rose-700/50',
          label: 'REVISION REQUIRED',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />,
        };
      case VersionStatus.SUPERSEDED:
        return {
          bg: 'bg-slate-500/10 text-slate-700 border-slate-400/30',
          darkBg: 'bg-slate-800 text-slate-400 border-slate-700',
          label: 'SUPERSEDED',
          icon: <Archive className="w-3.5 h-3.5 text-slate-500 shrink-0" />,
        };
      case VersionStatus.ARCHIVED:
        return {
          bg: 'bg-slate-500/10 text-slate-600 border-slate-300',
          darkBg: 'bg-slate-800 text-slate-400 border-slate-700',
          label: 'ARCHIVED',
          icon: <Archive className="w-3.5 h-3.5 text-slate-500 shrink-0" />,
        };
      case VersionStatus.DRAFT:
      default:
        return {
          bg: 'bg-blue-500/10 text-blue-800 border-blue-500/30',
          darkBg: 'bg-blue-950/40 text-blue-300 border-blue-700/50',
          label: 'DRAFT',
          icon: <FileCode className="w-3.5 h-3.5 text-blue-600 shrink-0" />,
        };
    }
  };

  const config = getStyles();

  const sizeClasses = {
    sm: 'text-[11px] px-2 py-0.5 space-x-1',
    md: 'text-xs px-2.5 py-1 space-x-1.5',
    lg: 'text-sm px-3 py-1.5 space-x-2',
  };

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full border ${config.bg} ${sizeClasses[size]}`}
    >
      {showIcon && config.icon}
      <span>{config.label}</span>
    </span>
  );
};
