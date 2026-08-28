import React, { useState } from 'react';
import {
  History,
  Search,
  Filter,
  ShieldCheck,
  Download,
  Calendar,
  User,
  Clock,
  Layers,
  FileText,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { AuditAction, AuditLogEntry } from '../types';
import { auditService } from '../services/audit';

export const AuditLogView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');

  const allLogs = auditService.getLogs();

  const filteredLogs = allLogs.filter((log) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      (log.documentId && log.documentId.toLowerCase().includes(q)) ||
      log.performedByName.toLowerCase().includes(q) ||
      (log.reason && log.reason.toLowerCase().includes(q)) ||
      log.action.toLowerCase().includes(q);

    const matchesAction = selectedAction === 'ALL' || log.action === selectedAction;
    return matchesSearch && matchesAction;
  });

  const getActionBadgeColor = (action: AuditAction) => {
    switch (action) {
      case AuditAction.VERSION_PUBLISHED:
      case AuditAction.REVIEW_APPROVED:
        return 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60';
      case AuditAction.REVIEW_REJECTED:
      case AuditAction.REVISION_REQUESTED:
        return 'bg-rose-950/60 text-rose-300 border-rose-800/60';
      case AuditAction.VERSION_SUPERSEDED:
      case AuditAction.VERSION_ARCHIVED:
        return 'bg-slate-800/80 text-slate-400 border-slate-700';
      case AuditAction.DOCUMENT_CREATED:
      case AuditAction.VERSION_CREATED:
        return 'bg-blue-950/60 text-blue-300 border-blue-800/60';
      case AuditAction.NOTIFICATION_SENT:
        return 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60';
      default:
        return 'bg-purple-950/60 text-purple-300 border-purple-800/60';
    }
  };

  const exportAuditJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
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
      <div className="glass-panel-dark rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-white tracking-tight">Compliance & Governance Audit Trail</h1>
            <span className="bg-purple-500/15 text-purple-300 text-xs px-3 py-0.5 rounded-full font-semibold border border-purple-500/30">
              Immutable Ledger
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1.5">
            Permanent event logging for all lifecycle transitions: document creations, reviewer approvals, rejection reasons, auto-publishing, superseding, and employee broadcasts.
          </p>
        </div>

        <button
          onClick={exportAuditJson}
          className="inline-flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-colors border border-slate-700 shadow-sm"
        >
          <Download className="w-4 h-4" />
          <span>Export Audit Log (JSON)</span>
        </button>
      </div>

      {/* FILTER & SEARCH */}
      <div className="glass-panel-dark p-4 rounded-2xl border border-slate-800/80 shadow-md flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Document ID, Performer Name, Reason..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-purple-500 placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Event Action:</span>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value)}
              className="bg-transparent font-medium text-slate-200 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900 text-white">All Actions ({allLogs.length})</option>
              {Object.values(AuditAction).map((act) => (
                <option key={act} value={act} className="bg-slate-900 text-white">
                  {act}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* AUDIT LOG TABLE */}
      <div className="glass-panel-dark rounded-2xl border border-slate-800/80 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <History className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-bold text-white">Logged Security & Governance Events</h2>
            <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-0.5 rounded-full font-mono border border-slate-700">
              {filteredLogs.length} events
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th scope="col" className="px-6 py-3.5 text-left">Action</th>
                <th scope="col" className="px-6 py-3.5 text-left">Document & Version</th>
                <th scope="col" className="px-6 py-3.5 text-left">Performer</th>
                <th scope="col" className="px-6 py-3.5 text-left">Event Details & Reason</th>
                <th scope="col" className="px-6 py-3.5 text-left">Source & IP</th>
                <th scope="col" className="px-6 py-3.5 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No audit records match your filter criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
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
                          <span className="font-mono font-bold text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded-lg border border-blue-800/60">
                            {log.documentId}
                          </span>
                          {log.versionNumber && (
                            <span className="ml-1.5 font-bold text-slate-300">v{log.versionNumber}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">System Scope</span>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-semibold text-slate-200">{log.performedByName}</div>
                      <div className="text-[11px] text-slate-500">{log.performedByRole}</div>
                    </td>

                    <td className="px-6 py-4 max-w-md">
                      <div className="text-slate-300 leading-relaxed">
                        {log.reason || 'Event executed.'}
                      </div>
                      {(log.oldValue || log.newValue) && (
                        <div className="text-[11px] text-slate-400 mt-1 font-mono">
                          {log.oldValue && <span className="line-through text-rose-400">{log.oldValue}</span>}
                          {log.oldValue && log.newValue && <span> → </span>}
                          {log.newValue && <span className="font-bold text-emerald-400">{log.newValue}</span>}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                      <div className="text-slate-300">{log.source}</div>
                      <div className="text-[10px] text-slate-500">{log.ipAddress}</div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap text-right text-slate-400 font-mono text-[11px]">
                      {new Date(log.performedAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
