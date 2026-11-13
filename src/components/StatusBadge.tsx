import React from 'react';
import { VersionStatus } from '../types';
import { CheckCircle2, Clock, AlertTriangle, Archive, FileCode, XCircle } from 'lucide-react';

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
          bg: 'bg-emerald-100 text-emerald-800 border-emerald-200',
          label: 'PUBLISHED (LIVE)',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />,
        };
      case VersionStatus.IN_REVIEW:
        return {
          bg: 'bg-violet-100 text-violet-800 border-violet-200',
          label: 'IN REVIEW',
          icon: <Clock className="w-3.5 h-3.5 text-violet-600 shrink-0" />,
        };
      case VersionStatus.REVISION_REQUIRED:
        return {
          bg: 'bg-orange-100 text-orange-800 border-orange-200',
          label: 'REVISION REQUIRED',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" />,
        };
      case VersionStatus.REJECTED:
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-200',
          label: 'REJECTED',
          icon: <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />,
        };
      case VersionStatus.SUPERSEDED:
        return {
          bg: 'bg-slate-100 text-slate-600 border-slate-200',
          label: 'SUPERSEDED',
          icon: <Archive className="w-3.5 h-3.5 text-slate-500 shrink-0" />,
        };
      case VersionStatus.ARCHIVED:
        return {
          bg: 'bg-slate-100 text-slate-500 border-slate-200',
          label: 'ARCHIVED',
          icon: <Archive className="w-3.5 h-3.5 text-slate-400 shrink-0" />,
        };
      case VersionStatus.DRAFT:
      default:
        return {
          bg: 'bg-slate-100 text-slate-800 border-slate-200',
          label: 'DRAFT',
          icon: <FileCode className="w-3.5 h-3.5 text-slate-600 shrink-0" />,
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
