import React, { useState } from 'react';
import {
  X,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Archive,
  Download,
  Eye,
  GitBranch,
  ShieldCheck,
  Building,
  UserCheck,
  History,
  Lock,
  GitCompare,
  MessageSquare,
} from 'lucide-react';
import { AuditLogEntry, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { DocumentViewer } from './DocumentViewer';
import { governanceEngine } from '../services/governance';
import { auditService } from '../services/audit';

interface DocumentDetailModalProps {
  document: DocumentMaster;
  currentUser: User;
  onClose: () => void;
  onOpenCreateVersion: (doc: DocumentMaster) => void;
  onOpenComparison: (versionId: string) => void;
}

export const DocumentDetailModal: React.FC<DocumentDetailModalProps> = ({
  document,
  currentUser,
  onClose,
  onOpenCreateVersion,
  onOpenComparison,
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'audit' | 'preview'>('timeline');

  const versions = governanceEngine.getDocumentVersions(document.id);
  const auditLogs = auditService.getLogs({ documentId: document.documentId });

  const activeVersion = selectedVersionId
    ? versions.find((v) => v.id === selectedVersionId) || versions[0]
    : document.currentPublishedVersionId
    ? versions.find((v) => v.id === document.currentPublishedVersionId) || versions[0]
    : versions[0];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="glass-panel-dark rounded-2xl shadow-2xl border border-slate-800 w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* HEADER */}
        <div className="bg-slate-900/90 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center shadow-inner">
              <FileText className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded-lg border border-blue-800/60">
                  {document.documentId}
                </span>
                <h2 className="text-lg font-bold text-white">{document.title}</h2>
                <StatusBadge status={document.currentStatus} size="sm" />
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Permanent Document Master • Category: {document.category} • Department: {document.departmentName}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              id="btn-detail-revise"
              onClick={() => {
                onClose();
                onOpenCreateVersion(document);
              }}
              className="inline-flex items-center space-x-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-all shadow-md shadow-blue-900/30 border border-blue-400/30"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Create New Version</span>
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* METADATA BAR */}
        <div className="bg-slate-950/70 border-b border-slate-800 px-6 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-400 shrink-0">
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Process Owner</span>
            <span className="font-semibold text-slate-200">{document.processOwnerName}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Confidentiality</span>
            <span className="font-semibold text-slate-200">{document.confidentiality}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Acknowledgement</span>
            <span className="font-semibold text-slate-200">
              {document.acknowledgementRequired ? 'Mandatory for All Employees' : 'Optional / Info'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Current Published</span>
            <span className="font-bold text-emerald-400">
              {document.currentPublishedVersionNumber ? `v${document.currentPublishedVersionNumber} (Live)` : 'None'}
            </span>
          </div>
        </div>

        {/* SUB TABS */}
        <div className="bg-slate-900/60 border-b border-slate-800 px-6 pt-3 flex space-x-6 shrink-0">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'timeline'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>Permanent Version History ({versions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('preview')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'preview'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Selected Version File Preview</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'audit'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Audit Trail ({auditLogs.length})</span>
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          {/* TAB 1: PERMANENT VERSION HISTORY TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-6">
              <div className="bg-blue-950/40 border border-blue-800/60 rounded-xl p-3.5 text-xs text-blue-300 flex items-center space-x-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
                <span>
                  <strong>Governance Principle:</strong> Historical versions are permanently preserved and never overwritten. Only approved versions can supersede previous published baselines.
                </span>
              </div>

              <div className="relative border-l-2 border-slate-800 ml-4 space-y-6 pl-6">
                {versions.map((ver, idx) => {
                  const isCurrentPublished = ver.id === document.currentPublishedVersionId;
                  return (
                    <div
                      key={ver.id}
                      className={`relative glass-panel-dark rounded-2xl border p-5 shadow-md transition-all ${
                        isCurrentPublished
                          ? 'border-emerald-500/80 ring-2 ring-emerald-500/20'
                          : ver.status === VersionStatus.REVISION_REQUIRED
                          ? 'border-rose-900/60 bg-rose-950/20'
                          : 'border-slate-800/80'
                      }`}
                    >
                      {/* Timeline Dot */}
                      <span
                        className={`absolute -left-[31px] top-6 w-4 h-4 rounded-full border-2 border-slate-900 ${
                          ver.status === VersionStatus.PUBLISHED
                            ? 'bg-emerald-400 ring-4 ring-emerald-950'
                            : ver.status === VersionStatus.IN_REVIEW
                            ? 'bg-amber-400 ring-4 ring-amber-950'
                            : ver.status === VersionStatus.REVISION_REQUIRED
                            ? 'bg-rose-400 ring-4 ring-rose-950'
                            : 'bg-slate-600'
                        }`}
                      />

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                        <div className="flex items-center space-x-3">
                          <span className="font-mono text-base font-extrabold text-white">
                            Version {ver.versionNumber}
                          </span>
                          <StatusBadge status={ver.status} size="sm" />
                          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md font-semibold uppercase border border-slate-700">
                            {ver.versionType} Revision
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              setSelectedVersionId(ver.id);
                              setActiveTab('preview');
                            }}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-700"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Content</span>
                          </button>

                          <button
                            onClick={() => onOpenComparison(ver.id)}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-300 bg-blue-950/60 hover:bg-blue-900/60 px-2.5 py-1.5 rounded-lg transition-colors border border-blue-800/60"
                          >
                            <GitCompare className="w-3.5 h-3.5" />
                            <span>Compare Baseline</span>
                          </button>
                        </div>
                      </div>

                      {/* Content & Metadata */}
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-400">
                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">Created By</span>
                          <span className="font-medium text-slate-200">{ver.createdByName}</span>
                          <span className="text-slate-500 text-[11px] block">
                            {new Date(ver.createdAt).toLocaleString()}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">Reviewed By</span>
                          <span className="font-medium text-slate-200">
                            {ver.reviewedByName || <span className="italic text-slate-500">Pending Review</span>}
                          </span>
                          {ver.reviewedAt && (
                            <span className="text-slate-500 text-[11px] block">
                              {new Date(ver.reviewedAt).toLocaleString()}
                            </span>
                          )}
                        </div>

                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">File Hash (SHA-256)</span>
                          <span className="font-mono text-[11px] text-slate-300 truncate block" title={ver.contentHash}>
                            {ver.contentHash.substring(0, 18)}...
                          </span>
                          <span className="text-slate-500 text-[11px] block">
                            {(ver.fileSize / 1024).toFixed(1)} KB ({ver.mimeType})
                          </span>
                        </div>
                      </div>

                      {/* Change Summary */}
                      {ver.changeSummary && (
                        <div className="mt-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs text-slate-300">
                          <span className="font-bold text-white">Change Summary:</span> {ver.changeSummary}
                        </div>
                      )}

                      {/* Rejection Comments Callout if applicable */}
                      {ver.reviewerComments && (
                        <div className="mt-2.5 bg-rose-950/40 border border-rose-900/60 rounded-xl p-3 text-xs text-rose-300 flex items-start space-x-2">
                          <MessageSquare className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-rose-200">Reviewer Feedback:</span> "{ver.reviewerComments}"
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: SELECTED VERSION PREVIEW */}
          {activeTab === 'preview' && (
            <div className="space-y-4">
              <DocumentViewer
                fileName={activeVersion.fileName}
                rawContent={activeVersion.rawContent}
                fileUrl={activeVersion.fileUrl}
                mimeType={activeVersion.mimeType}
              />
            </div>
          )}

          {/* TAB 3: AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div className="glass-panel-dark rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Document Governance Audit Trail
                </h3>
                <span className="text-xs text-slate-400">{auditLogs.length} events logged</span>
              </div>

              <div className="divide-y divide-slate-800/80 text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="p-4 hover:bg-slate-800/40 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-[11px] font-bold text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded-lg border border-purple-800/60">
                          {log.action}
                        </span>
                        {log.versionNumber && (
                          <span className="text-slate-400 font-semibold">v{log.versionNumber}</span>
                        )}
                      </div>
                      <span className="text-slate-500 font-mono text-[11px]">
                        {new Date(log.performedAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-slate-200 mt-1">
                      {log.reason || `Action executed by ${log.performedByName}`}
                    </div>

                    <div className="mt-1.5 flex items-center space-x-3 text-[11px] text-slate-500">
                      <span>User: <strong className="text-slate-300">{log.performedByName}</strong> ({log.performedByRole})</span>
                      <span>•</span>
                      <span>Source: {log.source}</span>
                      <span>•</span>
                      <span>IP: {log.ipAddress}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
