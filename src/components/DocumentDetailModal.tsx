import React, { useState, useEffect } from 'react';
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
  Trash2,
  Loader2,
} from 'lucide-react';
import { AuditLogEntry, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { DocumentViewer } from './DocumentViewer';
import { governanceEngine } from '../services/governance';
import { auditService } from '../services/audit';
import { formatIST } from '../utils/dateFormat';
import { formatDDMMYYYY } from '../utils/documentHeaderFooter';
import { downloadDocumentWithIntactFormat } from '../utils/documentStamper';

interface DocumentDetailModalProps {
  document: DocumentMaster;
  currentUser: User;
  onClose: () => void;
  onOpenCreateVersion: (doc: DocumentMaster) => void;
  onOpenComparison: (versionId: string) => void;
  onDeleteDocument?: (docId: string) => void;
}

export const DocumentDetailModal: React.FC<DocumentDetailModalProps> = ({
  document,
  currentUser,
  onClose,
  onOpenCreateVersion,
  onOpenComparison,
  onDeleteDocument,
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'audit' | 'preview'>('timeline');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);

  const handleDownloadVersion = async (ver: DocumentVersion, forcedFormat?: 'pdf' | 'docx') => {
    try {
      setDownloadingVersionId(ver.id);
      await downloadDocumentWithIntactFormat({
        fileName: ver.fileName || `${ver.documentId || document.documentId}_v${ver.versionNumber}.pdf`,
        documentTitle: ver.documentTitle || document.title,
        versionNumber: ver.versionNumber,
        effectiveDate: formatDDMMYYYY(ver.effectiveFrom || ver.createdAt),
        createdByName: ver.createdByName || document.createdByName || 'Amee Shah',
        approvedByName:
          ver.status === VersionStatus.PUBLISHED
            ? (ver.reviewedByName || ver.publishedByName || 'Vishal Shah')
            : 'Not yet approved',
        approvedDate:
          ver.status === VersionStatus.PUBLISHED && (ver.reviewedAt || ver.publishedAt)
            ? formatDDMMYYYY(ver.reviewedAt || ver.publishedAt!)
            : 'Not yet approved',
        companyName: document.companyName || 'Amaavigo',
        rawContent: ver.rawContent,
        fileUrl: ver.fileUrl,
        forcedFormat,
      });
    } catch (err) {
      console.error('Failed to download document version:', err);
    } finally {
      setDownloadingVersionId(null);
    }
  };

  const versions = governanceEngine.getDocumentVersions(document.id);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() =>
    auditService.getLogs().filter(
      (l) =>
        l.documentId === document.documentId ||
        l.documentId === document.id ||
        l.documentMasterId === document.id ||
        l.documentMasterId === document.documentId
    )
  );

  useEffect(() => {
    const updateLogs = () => {
      const logs = auditService.getLogs().filter(
        (l) =>
          l.documentId === document.documentId ||
          l.documentId === document.id ||
          l.documentMasterId === document.id ||
          l.documentMasterId === document.documentId
      );
      setAuditLogs(logs);
    };
    updateLogs();
    const unsub = auditService.subscribe(() => updateLogs());
    return () => unsub();
  }, [document.id, document.documentId]);

  const inReviewVersion = versions.find((v) => v.status === VersionStatus.IN_REVIEW);
  const hasInReviewVersion = !!inReviewVersion || document.currentStatus === VersionStatus.IN_REVIEW;

  const activeVersion = selectedVersionId
    ? versions.find((v) => v.id === selectedVersionId) || versions[0]
    : document.currentPublishedVersionId
    ? versions.find((v) => v.id === document.currentPublishedVersionId) || versions[0]
    : versions[0];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* HEADER */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/20 border border-[#FA7014]/40 flex items-center justify-center shadow-inner">
              <FileText className="w-5 h-5 text-[#FA7014]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-slate-200 bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-700">
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

          <div className="flex items-center space-x-2 sm:space-x-3">
            {onDeleteDocument && (
              <button
                id="btn-detail-delete"
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center space-x-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                title="Delete this Document Master"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}

            <button
              id="btn-detail-revise"
              onClick={() => {
                if (hasInReviewVersion) return;
                onClose();
                onOpenCreateVersion(document);
              }}
              disabled={hasInReviewVersion}
              className={`inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl transition-all shadow-md ${
                hasInReviewVersion
                  ? 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed shadow-none'
                  : 'bg-[#FA7014] hover:bg-[#E65A05] text-white shadow-[#FA7014]/20'
              }`}
              title={
                hasInReviewVersion
                  ? `Cannot revise: Version v${inReviewVersion?.versionNumber || ''} is currently in review`
                  : 'Create New Version'
              }
            >
              <GitBranch className={`w-3.5 h-3.5 ${hasInReviewVersion ? 'text-slate-400' : 'text-white'}`} />
              <span>{hasInReviewVersion ? 'In Review (Revision Blocked)' : 'Create New Version'}</span>
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
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-600 shrink-0">
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Process Owner</span>
            <span className="font-semibold text-slate-900">{document.processOwnerName}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Confidentiality</span>
            <span className="font-semibold text-slate-900">{document.confidentiality}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Acknowledgement</span>
            <span className="font-semibold text-slate-900">
              {document.acknowledgementRequired ? 'Mandatory for All Employees' : 'Optional / Info'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px] uppercase font-bold">Current Published</span>
            <span className="font-bold text-[#FA7014]">
              {document.currentPublishedVersionNumber ? `v${document.currentPublishedVersionNumber} (Live)` : 'None'}
            </span>
          </div>
        </div>

        {/* SUB TABS */}
        <div className="bg-white border-b border-slate-200 px-6 pt-3 flex space-x-6 shrink-0">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'timeline'
                ? 'border-[#FA7014] text-[#FA7014]'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>Permanent Version History ({versions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('preview')}
            className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'preview'
                ? 'border-[#FA7014] text-[#FA7014]'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Eye className="w-4 h-4" />
            <span>Selected Version File Preview</span>
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {/* TAB 1: PERMANENT VERSION HISTORY TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="space-y-6">
              <div className="bg-orange-50/60 border border-orange-200 rounded-xl p-3.5 text-xs text-slate-800 flex items-center space-x-2.5">
                <ShieldCheck className="w-4 h-4 text-[#FA7014] shrink-0" />
                <span>
                  <strong>Governance Principle:</strong> Historical versions are permanently preserved and never overwritten. Only approved versions can supersede previous published baselines.
                </span>
              </div>

              <div className="relative border-l-2 border-slate-300 ml-4 space-y-6 pl-6">
                {versions.map((ver, idx) => {
                  const isCurrentPublished = ver.id === document.currentPublishedVersionId;
                  return (
                    <div
                      key={ver.id}
                      className={`relative bg-white rounded-2xl border p-5 shadow-xs transition-all ${
                        isCurrentPublished
                          ? 'border-[#FA7014] ring-2 ring-[#FA7014]/20'
                          : ver.status === VersionStatus.REVISION_REQUIRED
                          ? 'border-slate-300 bg-slate-50/50'
                          : 'border-slate-200'
                      }`}
                    >
                      {/* Timeline Dot */}
                      <span
                        className={`absolute -left-[31px] top-6 w-4 h-4 rounded-full border-2 border-white ${
                          ver.status === VersionStatus.PUBLISHED
                            ? 'bg-[#FA7014] ring-4 ring-orange-100'
                            : ver.status === VersionStatus.IN_REVIEW
                            ? 'bg-slate-900 ring-4 ring-slate-200'
                            : ver.status === VersionStatus.REVISION_REQUIRED
                            ? 'bg-slate-600 ring-4 ring-slate-200'
                            : 'bg-slate-400'
                        }`}
                      />

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                        <div className="flex items-center space-x-3">
                          <span className="font-mono text-base font-extrabold text-slate-900">
                            Version {ver.versionNumber}
                          </span>
                          <StatusBadge status={ver.status} size="sm" />
                          <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-semibold uppercase border border-slate-200">
                            {ver.versionType} Revision
                          </span>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            id={`btn-view-content-${ver.id}`}
                            onClick={() => {
                              setSelectedVersionId(ver.id);
                              setActiveTab('preview');
                            }}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-300 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Content</span>
                          </button>

                          <button
                            id={`btn-compare-${ver.id}`}
                            onClick={() => onOpenComparison(ver.id)}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-[#FA7014] bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-lg transition-colors border border-orange-200 cursor-pointer"
                          >
                            <GitCompare className="w-3.5 h-3.5" />
                            <span>Compare Baseline</span>
                          </button>

                          <button
                            id={`btn-download-version-${ver.id}`}
                            onClick={() => handleDownloadVersion(ver)}
                            disabled={downloadingVersionId === ver.id}
                            className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-300 shadow-2xs cursor-pointer disabled:opacity-60"
                            title={`Download ${ver.fileName || `Version ${ver.versionNumber}`}`}
                          >
                            {downloadingVersionId === ver.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                            ) : (
                              <Download className="w-3.5 h-3.5 text-slate-600" />
                            )}
                            <span>Download</span>
                          </button>
                        </div>
                      </div>

                      {/* Content & Metadata */}
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-slate-600">
                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">Created By</span>
                          <span className="font-medium text-slate-900">{ver.createdByName}</span>
                          <span className="text-slate-400 text-[11px] block font-mono">
                            {formatIST(ver.createdAt)}
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">Reviewed By</span>
                          <span className="font-medium text-slate-900">
                            {ver.reviewedByName || <span className="italic text-slate-400">Pending Review</span>}
                          </span>
                          {ver.reviewedAt && (
                            <span className="text-slate-400 text-[11px] block font-mono">
                              {formatIST(ver.reviewedAt)}
                            </span>
                          )}
                        </div>

                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">Effective & Re-review</span>
                          <span className="font-medium text-slate-900 block">
                            Effective: <span className="font-mono text-[#FA7014] font-bold">{formatDDMMYYYY(ver.effectiveFrom || ver.createdAt)}</span>
                          </span>
                          <span className="text-slate-500 text-[11px] block">
                            Re-review: <span className="font-mono font-semibold text-slate-700">{formatDDMMYYYY(ver.reviewDueDate, '1 Year')}</span>
                          </span>
                        </div>

                        <div>
                          <span className="text-slate-500 block text-[10px] uppercase font-bold">File Hash (SHA-256)</span>
                          <span className="font-mono text-[11px] text-slate-700 truncate block" title={ver.contentHash}>
                            {ver.contentHash.substring(0, 18)}...
                          </span>
                          <span className="text-slate-400 text-[11px] block">
                            {(ver.fileSize / 1024).toFixed(1)} KB ({ver.mimeType})
                          </span>
                        </div>
                      </div>

                      {/* Change Summary */}
                      {ver.changeSummary && (
                        <div className="mt-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-700">
                          <span className="font-bold text-slate-900">Change Summary:</span> {ver.changeSummary}
                        </div>
                      )}

                      {/* Rejection Comments Callout if applicable */}
                      {ver.reviewerComments && (
                        <div className="mt-2.5 bg-orange-50/60 border border-orange-200 rounded-xl p-3 text-xs text-slate-800 flex items-start space-x-2">
                          <MessageSquare className="w-4 h-4 text-[#FA7014] shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-slate-900">
                              Reviewer {ver.reviewedByName ? `(${ver.reviewedByName})` : ''} Feedback:
                            </span>{' '}
                            "{ver.reviewerComments}"
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
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  <span className="font-semibold text-slate-800">Previewing Version:</span>
                  <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                    v{activeVersion.versionNumber}
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-600 font-mono text-[11px] truncate max-w-[200px]" title={activeVersion.fileName}>
                    {activeVersion.fileName}
                  </span>
                </div>
                <button
                  id="btn-preview-download"
                  onClick={() => handleDownloadVersion(activeVersion)}
                  disabled={downloadingVersionId === activeVersion.id}
                  className="inline-flex items-center space-x-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-60 shadow-xs"
                  title={`Download v${activeVersion.versionNumber}`}
                >
                  {downloadingVersionId === activeVersion.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Download Version</span>
                </button>
              </div>

              <DocumentViewer
                fileName={activeVersion.fileName}
                rawContent={activeVersion.rawContent}
                fileUrl={activeVersion.fileUrl}
                mimeType={activeVersion.mimeType}
                headerFooterData={{
                  companyName: document.companyName || 'Amaavigo',
                  documentTitle: document.title || activeVersion.documentTitle,
                  versionNumber: activeVersion.versionNumber,
                  effectiveDate: formatDDMMYYYY(activeVersion.effectiveFrom || activeVersion.createdAt),
                  createdByName: activeVersion.createdByName || document.createdByName || 'Amee Shah',
                  approvedByName:
                    activeVersion.status === VersionStatus.PUBLISHED
                      ? (activeVersion.reviewedByName || activeVersion.publishedByName || 'Authorized Approver')
                      : 'Not yet approved',
                  approvedDate:
                    activeVersion.status === VersionStatus.PUBLISHED && (activeVersion.reviewedAt || activeVersion.publishedAt)
                      ? formatDDMMYYYY(activeVersion.reviewedAt || activeVersion.publishedAt!)
                      : 'Not yet approved',
                }}
              />
            </div>
          )}

          {/* TAB 3: AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Document Governance Audit Trail (IST)
                </h3>
                <span className="text-xs text-slate-400">{auditLogs.length} events logged</span>
              </div>

              <div className="divide-y divide-slate-200 text-xs">
                {auditLogs.map((log) => {
                  const performer = governanceEngine.resolvePerformer(log.performedById, log.performedByRole, log.performedByName);
                  return (
                    <div key={log.id} className="p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-[11px] font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                            {log.action}
                          </span>
                          {log.versionNumber && (
                            <span className="text-slate-600 font-semibold">v{log.versionNumber}</span>
                          )}
                        </div>
                        <span className="text-slate-500 font-mono text-[11px] font-medium">
                          {formatIST(log.performedAt)}
                        </span>
                      </div>

                      <div className="text-slate-800 mt-1">
                        {log.reason || `Action executed by ${performer.name}`}
                      </div>

                      <div className="mt-1.5 flex items-center space-x-3 text-[11px] text-slate-500">
                        <span>User: <strong className="text-slate-700">{performer.name}</strong> ({performer.role})</span>
                        <span>•</span>
                        <span>Source: {log.source}</span>
                        <span>•</span>
                        <span>IP: {log.ipAddress}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CONFIRM DELETE MODAL */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-60 overflow-y-auto bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-150 text-slate-900">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete Document Master?</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Are you sure you want to permanently delete <span className="font-bold text-slate-900">{document.documentId} ({document.title})</span> and all its associated version revisions and employee acknowledgment records?
            </p>
            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onDeleteDocument) {
                    onDeleteDocument(document.id);
                    setShowDeleteConfirm(false);
                    onClose();
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs transition-colors shadow-sm"
              >
                Yes, Delete Document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
