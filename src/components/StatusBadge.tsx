import React from 'react';
import { VersionStatus } from '../types';
import { CheckCircle2, Clock, AlertTriangle, Archive, FileCode } from 'lucide-react';

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
          bg: 'bg-slate-900 text-white border-slate-900',
          label: 'PUBLISHED (LIVE)',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-[#FA7014] shrink-0" />,
        };
      case VersionStatus.IN_REVIEW:
        return {
          bg: 'bg-[#FA7014]/10 text-[#FA7014] border-[#FA7014]/30',
          label: 'IN REVIEW',
          icon: <Clock className="w-3.5 h-3.5 text-[#FA7014] shrink-0" />,
        };
      case VersionStatus.REVISION_REQUIRED:
        return {
          bg: 'bg-orange-50 text-orange-950 border-orange-200',
          label: 'REVISION REQUIRED',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-[#FA7014] shrink-0" />,
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
