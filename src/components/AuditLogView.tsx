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
        return 'bg-slate-900 text-white border-slate-900';
      case AuditAction.REVIEW_REJECTED:
      case AuditAction.REVISION_REQUESTED:
        return 'bg-orange-50 text-orange-950 border-orange-200';
      case AuditAction.DOCUMENT_DELETED:
      case AuditAction.ALL_DOCUMENTS_CLEARED:
        return 'bg-rose-50 text-rose-700 border-rose-300';
      case AuditAction.REVIEW_STARTED:
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case AuditAction.VERSION_SUPERSEDED:
      case AuditAction.VERSION_ARCHIVED:
        return 'bg-slate-100 text-slate-500 border-slate-200';
      case AuditAction.DOCUMENT_CREATED:
      case AuditAction.VERSION_CREATED:
        return 'bg-[#FA7014]/10 text-[#FA7014] border-[#FA7014]/30';
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
      <div className="bg-white rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Compliance & Governance Audit Trail</h1>
            <span className="bg-[#FA7014]/10 text-[#FA7014] text-xs px-3 py-0.5 rounded-full font-semibold border border-[#FA7014]/30">
              Immutable Ledger
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5">
            Permanent event logging for all lifecycle transitions: document creations, reviewer approvals, rejection reasons, auto-publishing, superseding, and employee broadcasts.
          </p>
        </div>

        <button
          onClick={exportAuditJson}
          className="inline-flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors border border-slate-900 shadow-sm"
        >
          <Download className="w-4 h-4 text-[#FA7014]" />
          <span>Export Audit Log (JSON)</span>
        </button>
      </div>

      {/* FILTER & SEARCH */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Document ID, Performer Name, Reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Event Action Filter */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500">Event Action:</span>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
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
          </div>

          {/* Date Filter (beside event action) */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700">
            <Calendar className="w-3.5 h-3.5 text-[#FA7014]" />
            <span className="text-slate-500">Event Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer text-xs"
              title="Filter audit logs by specific date"
            />
            {selectedDate && (
              <button
                type="button"
                onClick={() => setSelectedDate('')}
                className="ml-1 text-slate-400 hover:text-rose-600 p-0.5 rounded-md hover:bg-slate-200/60 transition-colors cursor-pointer"
                title="Clear date filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Clear Filters Button */}
          {(searchTerm || selectedAction !== 'ALL' || selectedDate) && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSelectedAction('ALL');
                setSelectedDate('');
              }}
              className="text-xs text-slate-500 hover:text-rose-600 font-medium px-2.5 py-1.5 rounded-xl hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors cursor-pointer"
              title="Reset all active filters"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* AUDIT LOG TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5 flex-wrap gap-2">
            <div className="flex items-center space-x-2">
              <History className="w-4 h-4 text-[#FA7014]" />
              <h2 className="text-sm font-bold text-slate-900">Logged Security & Governance Events</h2>
            </div>
            <span className="bg-slate-100 text-slate-800 text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold border border-slate-200">
              {filteredLogs.length} events
            </span>
            {selectedDate && (
              <span className="bg-orange-50 text-[#FA7014] text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold border border-orange-200 flex items-center space-x-1">
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

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
              <tr>
                <th scope="col" className="px-6 py-3.5 text-left">Action</th>
                <th scope="col" className="px-6 py-3.5 text-left">Document & Version</th>
                <th scope="col" className="px-6 py-3.5 text-left">Performer</th>
                <th scope="col" className="px-6 py-3.5 text-left">Event Details & Reason</th>
                <th scope="col" className="px-6 py-3.5 text-left">Source & IP</th>
                <th scope="col" className="px-6 py-3.5 text-right">Timestamp (IST)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
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
                        className="mt-3 inline-flex items-center space-x-1 text-xs text-[#FA7014] hover:underline font-semibold cursor-pointer"
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
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`font-mono text-[11px] font-bold px-2.5 py-1 rounded-lg border inline-block ${getActionBadgeColor(
                            log.action
                          )}`}
                        >
                          {log.action}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
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

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{performer.name}</div>
                        <div className="text-[11px] text-slate-500">{performer.role}</div>
                      </td>

                      <td className="px-6 py-4 max-w-md">
                        <div className="text-slate-700 leading-relaxed">
                          {log.reason || 'Event executed.'}
                        </div>
                        {(log.oldValue || log.newValue) && (
                          <div className="text-[11px] text-slate-500 mt-1 font-mono">
                            {log.oldValue && <span className="line-through text-slate-400">{log.oldValue}</span>}
                            {log.oldValue && log.newValue && <span> → </span>}
                            {log.newValue && <span className="font-bold text-[#FA7014]">{log.newValue}</span>}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                        <div className="text-slate-900">{log.source}</div>
                        <div className="text-[10px] text-slate-400">{log.ipAddress}</div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right text-slate-600 font-mono text-[11px] font-medium">
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
