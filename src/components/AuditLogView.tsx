import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  Search,
  Filter,
  ShieldCheck,
  Download,
  Calendar,
  User as UserIcon,
  Clock,
  Layers,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  X,
} from 'lucide-react';
import { AuditAction, AuditLogEntry, User, UserRole } from '../types';
import { auditService } from '../services/audit';
import { governanceEngine } from '../services/governance';
import { formatIST } from '../utils/dateFormat';
import { FilterField, HeroCard, filterCard, searchInput, tbl } from './common/pageChrome';

interface AuditLogViewProps {
  users?: User[];
}

const EXCLUDED_AUDIT_ACTIONS = new Set<string>([
  'VERSION_ARCHIVED',
  'ALL_DOCUMENTS_CLEARED',
  'ALL_DOCUMENT_CLEARED',
  'FILE_HASH_VALIDATED',
  'USER_UPDATED',
]);

export const AuditLogView: React.FC<AuditLogViewProps> = ({ users }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [allLogs, setAllLogs] = useState<AuditLogEntry[]>(() => auditService.getLogs());

  useEffect(() => {
    setAllLogs(auditService.getLogs());
    const unsub = auditService.subscribe((updatedLogs) => {
      setAllLogs(updatedLogs);
    });
    return () => unsub();
  }, []);

  const userList = useMemo(() => {
    return users && users.length > 0 ? users : governanceEngine.getUsers();
  }, [users]);

  // Helper to dynamically resolve the latest performer name and role from the active user roster
  const resolvePerformer = (log: AuditLogEntry) => {
    // 1. Match by user ID / empId / loginId
    if (log.performedById) {
      const match = userList.find(
        (u) =>
          u.id === log.performedById ||
          (u.empId && u.empId.toLowerCase() === log.performedById.toLowerCase()) ||
          (u.loginId && u.loginId.toLowerCase() === log.performedById.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === log.performedById.toLowerCase())
      );
      if (match) {
        return {
          name: match.name,
          role: match.role || log.performedByRole,
          title: match.title,
        };
      }
    }

    // 2. Match by name in user roster
    if (log.performedByName) {
      const byName = userList.find(
        (u) =>
          u.name.toLowerCase() === log.performedByName.toLowerCase() ||
          (u.email && u.email.toLowerCase() === log.performedByName.toLowerCase())
      );
      if (byName) {
        return {
          name: byName.name,
          role: byName.role || log.performedByRole,
          title: byName.title,
        };
      }
    }

    // 3. Match by role in user roster if available
    const rawRole = (log.performedByRole || '').toString().toUpperCase();
    if (rawRole === 'CREATOR' || rawRole === 'HR') {
      const creator = userList.find((u) => u.role === UserRole.CREATOR);
      if (creator) {
        return {
          name: log.performedByName || creator.name,
          role: UserRole.CREATOR,
          title: creator.title,
        };
      }
    }

    if (rawRole === 'REVIEWER' || rawRole === 'APPROVER') {
      const reviewer = userList.find((u) => u.role === UserRole.REVIEWER);
      if (reviewer) {
        return {
          name: log.performedByName || reviewer.name,
          role: UserRole.REVIEWER,
          title: reviewer.title,
        };
      }
    }

    return {
      name: log.performedByName || 'System User',
      role: log.performedByRole || UserRole.EMPLOYEE,
      title: '',
    };
  };

  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      const q = searchTerm.toLowerCase();
      const performer = resolvePerformer(log);
      const matchesSearch =
        (log.documentId && log.documentId.toLowerCase().includes(q)) ||
        performer.name.toLowerCase().includes(q) ||
        performer.role.toLowerCase().includes(q) ||
        (log.reason && log.reason.toLowerCase().includes(q)) ||
        log.action.toLowerCase().includes(q);

      const matchesAction = selectedAction === 'ALL' || log.action === selectedAction;

      const matchesDate = !selectedDate || (() => {
        try {
          const d = new Date(log.performedAt);
          if (isNaN(d.getTime())) {
            return log.performedAt.startsWith(selectedDate);
          }
          // Match against IST date (as rendered in the table), ISO date, or local calendar date
          const istDate = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          const isoDate = log.performedAt.split('T')[0];
          const localDate = d.toLocaleDateString('en-CA');
          return istDate === selectedDate || isoDate === selectedDate || localDate === selectedDate;
        } catch {
          return log.performedAt.startsWith(selectedDate);
        }
      })();

      return matchesSearch && matchesAction && matchesDate;
    });
  }, [allLogs, searchTerm, selectedAction, selectedDate, userList]);

  const getActionBadgeColor = (action: AuditAction) => {
    switch (action) {
      case AuditAction.VERSION_PUBLISHED:
      case AuditAction.REVIEW_APPROVED:
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case AuditAction.REVIEW_REJECTED:
      case AuditAction.REVISION_REQUESTED:
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case AuditAction.DOCUMENT_DELETED:
      case AuditAction.ALL_DOCUMENTS_CLEARED:
        return 'bg-rose-50 text-rose-700 border-rose-300';
      case AuditAction.REVIEW_STARTED:
        return 'bg-sky-100 text-sky-800 border-sky-200';
      case AuditAction.VERSION_SUPERSEDED:
      case AuditAction.VERSION_ARCHIVED:
        return 'bg-slate-100 text-slate-500 border-slate-200';
      case AuditAction.DOCUMENT_CREATED:
      case AuditAction.VERSION_CREATED:
        return 'bg-violet-100 text-violet-800 border-violet-200';
      case AuditAction.NOTIFICATION_SENT:
        return 'bg-slate-100 text-slate-800 border-slate-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const exportAuditJson = () => {
    const exportableData = filteredLogs.map((log) => {
      const perf = resolvePerformer(log);
      return {
        ...log,
        performedByName: perf.name,
        performedByRole: perf.role,
      };
    });
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportableData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `HR_DocGov_AuditLog_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <HeroCard
        icon={History}
        title="Audit Trail"
        badge="Immutable Ledger"
        subtitle="Permanent event logging for every lifecycle step: document creations, reviewer approvals, rejection reasons, auto-publishing, superseding and employee broadcasts."
        actions={
          <button
            onClick={exportAuditJson}
            className="inline-flex items-center gap-2 bg-[#6d4cf0] hover:bg-[#5b3be0] text-white font-bold px-5 py-3 rounded-xl text-sm transition-all shadow-md shadow-violet-500/30 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Audit Log (JSON)</span>
          </button>
        }
      />

      {/* FILTER & SEARCH */}
      <div className={filterCard}>
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Document ID, Performer Name, Reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={searchInput}
          />
        </div>

        <FilterField icon={Filter} label="Event Action:">
          <select
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
            className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer"
          >
            <option value="ALL">All Actions ({allLogs.length})</option>
            {Object.values(AuditAction)
              .filter((act) => !EXCLUDED_AUDIT_ACTIONS.has(act))
              .map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
          </select>
        </FilterField>

        <FilterField icon={Calendar} label="Event Date:">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer text-sm"
            title="Filter audit logs by specific date"
          />
          {selectedDate && (
            <button
              type="button"
              onClick={() => setSelectedDate('')}
              className="ml-1 text-slate-400 hover:text-rose-600 p-0.5 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
              title="Clear date filter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </FilterField>

        {(searchTerm || selectedAction !== 'ALL' || selectedDate) && (
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setSelectedAction('ALL');
              setSelectedDate('');
            }}
            className="h-11 text-sm text-slate-600 hover:text-rose-600 font-semibold px-3.5 rounded-xl hover:bg-slate-50 border border-slate-200 transition-colors cursor-pointer"
            title="Reset all active filters"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* AUDIT LOG TABLE */}
      <div className={tbl.wrap}>
        <div className="px-6 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5 flex-wrap gap-2">
            <h2 className="text-xl font-extrabold text-slate-900">Logged Security &amp; Governance Events</h2>
            <span className="bg-slate-100 text-slate-700 text-xs px-3 py-1 rounded-full font-bold">
              {filteredLogs.length} events
            </span>
            {selectedDate && (
              <span className="bg-violet-100 text-violet-700 text-xs px-2.5 py-1 rounded-full font-semibold flex items-center space-x-1">
                <Calendar className="w-3 h-3" />
                <span>Date: {selectedDate}</span>
                <button
                  type="button"
                  onClick={() => setSelectedDate('')}
                  className="hover:text-rose-600 ml-0.5 cursor-pointer"
                  title="Remove date filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          <table className={`${tbl.table} text-xs`}>
            <thead>
              <tr className={tbl.headRow}>
                <th scope="col" className={`${tbl.th} rounded-l-xl uppercase tracking-wide`}>Action</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Document & Version</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Performer</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Event Details & Reason</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Source & IP</th>
                <th scope="col" className={`${tbl.th} rounded-r-xl uppercase tracking-wide text-right`}>Timestamp (IST)</th>
              </tr>
            </thead>
            <tbody className={tbl.body}>
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <p className="text-sm font-medium text-slate-600">No audit records match your filter criteria.</p>
                    {selectedDate && (
                      <p className="text-xs text-slate-400 mt-1">
                        No events logged on date: <span className="font-semibold text-slate-700 font-mono">{selectedDate}</span>
                      </p>
                    )}
                    {(searchTerm || selectedAction !== 'ALL' || selectedDate) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchTerm('');
                          setSelectedAction('ALL');
                          setSelectedDate('');
                        }}
                        className="mt-3 inline-flex items-center space-x-1 text-xs text-[#6d4cf0] hover:underline font-semibold cursor-pointer"
                      >
                        <span>Clear all active filters</span>
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const performer = resolvePerformer(log);
                  return (
                    <tr key={log.id} className={tbl.row}>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`font-mono text-[11px] font-bold px-2.5 py-1 rounded-lg border inline-block ${getActionBadgeColor(
                            log.action
                          )}`}
                        >
                          {log.action}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {log.documentId ? (
                          <div>
                            {log.action === AuditAction.DOCUMENT_DELETED || log.newValue === 'DELETED' ? (
                              <div className="inline-flex items-center space-x-1.5 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">
                                <span className="font-mono font-bold text-rose-700">{log.documentId}</span>
                                <span className="text-[10px] bg-rose-200/80 text-rose-800 px-1 py-0.2 rounded font-sans uppercase font-bold tracking-tight">
                                  Deleted
                                </span>
                              </div>
                            ) : (
                              <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                                {log.documentId}
                              </span>
                            )}
                            {log.versionNumber && (
                              <span className="ml-1.5 font-bold text-slate-700">v{log.versionNumber}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">System Scope</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{performer.name}</div>
                        <div className="text-[11px] text-slate-500">{performer.role}</div>
                      </td>

                      <td className="py-3.5 px-4 max-w-md">
                        <div className="text-slate-700 leading-relaxed">
                          {log.reason || 'Event executed.'}
                        </div>
                        {(log.oldValue || log.newValue) && (
                          <div className="text-[11px] text-slate-500 mt-1 font-mono">
                            {log.oldValue && <span className="line-through text-slate-400">{log.oldValue}</span>}
                            {log.oldValue && log.newValue && <span> → </span>}
                            {log.newValue && <span className="font-bold text-[#6d4cf0]">{log.newValue}</span>}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                        <div className="text-slate-900">{log.source}</div>
                        <div className="text-[10px] text-slate-400">{log.ipAddress}</div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap text-right text-slate-600 font-mono text-[11px] font-medium">
                        {formatIST(log.performedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
