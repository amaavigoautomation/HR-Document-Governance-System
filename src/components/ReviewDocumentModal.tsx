import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  GitBranch,
  Layers,
  Clock,
  Sparkles,
  Download,
  Lock,
  ArrowRight,
  Split,
  Check,
  Building,
  UserCheck,
  Info,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Ban,
} from 'lucide-react';
import {
  DocumentComparisonResult,
  DocumentMaster,
  DocumentVersion,
  InlineRevisionComment,
  ConfidentialityLevel,
  User,
  UserRole,
  VersionStatus,
  VersionType,
  AuditAction,
} from '../types';
import { governanceEngine } from '../services/governance';
import { auditService } from '../services/audit';
import { DocumentViewer } from './DocumentViewer';
import { formatIST, formatISTDate } from '../utils/dateFormat';
import { formatDDMMYYYY } from '../utils/documentHeaderFooter';
import { downloadDocumentWithIntactFormat } from '../utils/documentStamper';
import { extractPointByPointDiffs, PointDiffItem } from '../services/comparison';

interface ReviewDocumentModalProps {
  version: DocumentVersion;
  currentUser: User;
  users?: User[];
  onClose: () => void;
  onApproveSuccess: () => void;
  onRejectSuccess: () => void;
}

export const ReviewDocumentModal: React.FC<ReviewDocumentModalProps> = ({
  version,
  currentUser,
  users,
  onClose,
  onApproveSuccess,
  onRejectSuccess,
}) => {
  const isApprover = currentUser.role === UserRole.REVIEWER;
  const [activeTab, setActiveTab] = useState<'sideBySide' | 'summary' | 'fullText'>('sideBySide');
  const [comparison, setComparison] = useState<DocumentComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Approval Modal State
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('Reviewed and verified compliance with corporate governance standards.');
  const [isApproving, setIsApproving] = useState(false);

  // Revision Request Modal State (formerly Reject Modal)
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionComments, setRejectionComments] = useState('');
  const [rejectionError, setRejectionError] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Permanent Rejection Modal State
  const [showPermanentRejectModal, setShowPermanentRejectModal] = useState(false);
  const [permanentRejectReason, setPermanentRejectReason] = useState('');
  const [isPermanentRejecting, setIsPermanentRejecting] = useState(false);

  // Inline Revision Comments State
  const [inlineComments, setInlineComments] = useState<InlineRevisionComment[]>(version.inlineComments || []);

  const master = governanceEngine.getDocumentMasterById(version.documentMasterId);

  const creator = useMemo(() => {
    const userList = users && users.length > 0 ? users : governanceEngine.getUsers();
    const matched = userList.find((u) => {
      if (
        version.createdById &&
        (u.id === version.createdById ||
          u.loginId?.toUpperCase() === version.createdById.toUpperCase() ||
          u.empId?.toUpperCase() === version.createdById.toUpperCase())
      ) {
        return true;
      }
      if (version.createdByName && u.name.trim().toLowerCase() === version.createdByName.trim().toLowerCase()) {
        return true;
      }
      if (
        master?.createdById &&
        (u.id === master.createdById ||
          u.loginId?.toUpperCase() === master.createdById.toUpperCase() ||
          u.empId?.toUpperCase() === master.createdById.toUpperCase())
      ) {
        return true;
      }
      if (master?.createdByName && u.name.trim().toLowerCase() === master.createdByName.trim().toLowerCase()) {
        return true;
      }
      return false;
    });
    return {
      name: matched?.name || version.createdByName || master?.createdByName || 'HR Author',
      title:
        matched?.title ||
        version.createdByTitle ||
        master?.createdByTitle ||
        (matched?.departmentName ? `${matched.departmentName} Author` : (master?.departmentName ? `${master.departmentName} Author` : 'Lead HR Operations & Document Specialist')),
    };
  }, [version, master, users]);

  const handleDownloadVersion = async () => {
    try {
      setIsDownloading(true);
      await downloadDocumentWithIntactFormat({
        fileName: version.fileName || `${version.documentId}_v${version.versionNumber}.pdf`,
        documentTitle: version.documentTitle || master?.title,
        versionNumber: version.versionNumber,
        effectiveDate: formatDDMMYYYY(version.effectiveFrom || version.createdAt),
        createdByName: creator.name || version.createdByName || 'Amee Shah',
        approvedByName:
          version.status === VersionStatus.PUBLISHED
            ? (version.reviewedByName || version.publishedByName || 'Authorized Approver')
            : 'Not yet approved',
        approvedDate:
          version.status === VersionStatus.PUBLISHED && (version.reviewedAt || version.publishedAt)
            ? formatDDMMYYYY(version.reviewedAt || version.publishedAt!)
            : 'Not yet approved',
        companyName: master?.companyName || 'Amaavigo',
        rawContent: version.rawContent,
        fileUrl: version.fileUrl || version.originalFileUrl,
        originalFileUrl: version.originalFileUrl || version.fileUrl,
        versionId: version.id,
        documentId: version.documentId || master?.documentId || master?.id,
      });
    } catch (err) {
      console.error('Failed to download version in review modal:', err);
    } finally {
      setIsDownloading(false);
    }
  };
  const docVersions = useMemo(() => {
    return governanceEngine.getDocumentVersions(version.documentMasterId || master?.id || '');
  }, [version.documentMasterId, master?.id]);

  // Candidates for baseline comparison: all versions other than the current version being reviewed
  const candidateBaselines = useMemo(() => {
    return docVersions.filter((v) => v.id !== version.id);
  }, [docVersions, version.id]);

  // Default baseline to compare against:
  // 1. Explicit previousVersionId if found in candidateBaselines
  // 2. Or the rejected / superseded predecessor draft that was addressed by this version
  // 3. Or master.currentPublishedVersionId
  // 4. Or the latest available candidate
  const defaultBaselineId = useMemo(() => {
    if (version.previousVersionId && candidateBaselines.some((b) => b.id === version.previousVersionId)) {
      return version.previousVersionId;
    }
    const preDraft = candidateBaselines.find(
      (b) => b.status === VersionStatus.REVISION_REQUIRED || b.status === VersionStatus.SUPERSEDED
    );
    if (preDraft) return preDraft.id;
    if (master?.currentPublishedVersionId && candidateBaselines.some((b) => b.id === master.currentPublishedVersionId)) {
      return master.currentPublishedVersionId;
    }
    return candidateBaselines[0]?.id || '';
  }, [version.previousVersionId, candidateBaselines, master?.currentPublishedVersionId]);

  const [selectedBaselineId, setSelectedBaselineId] = useState<string>(defaultBaselineId);

  useEffect(() => {
    setSelectedBaselineId(defaultBaselineId);
  }, [defaultBaselineId]);

  const activeBaseline =
    candidateBaselines.find((b) => b.id === selectedBaselineId) ||
    candidateBaselines.find((b) => b.id === version.previousVersionId) ||
    (master?.currentPublishedVersionId ? governanceEngine.getVersionById(master.currentPublishedVersionId) : null) ||
    candidateBaselines[0];

  const [summaryFilter, setSummaryFilter] = useState<'all' | 'modified' | 'added' | 'removed'>('all');
  const [sideBySideMode, setSideBySideMode] = useState<'cards' | 'changed' | 'lines'>('cards');

  const pointDiffs = useMemo(() => {
    return extractPointByPointDiffs(activeBaseline?.rawContent || '', version.rawContent || '');
  }, [activeBaseline?.rawContent, version.rawContent]);

  const filteredPointDiffs = useMemo(() => {
    if (summaryFilter === 'modified') return pointDiffs.filter((p) => p.type === 'modified');
    if (summaryFilter === 'added') return pointDiffs.filter((p) => p.type === 'added');
    if (summaryFilter === 'removed') return pointDiffs.filter((p) => p.type === 'removed');
    return pointDiffs.filter((p) => p.type !== 'unchanged');
  }, [pointDiffs, summaryFilter]);

  useEffect(() => {
    if (!version.id) return;
    // Log immutable review inspection event
    auditService.logEvent(AuditAction.REVIEW_STARTED, currentUser, {
      documentMasterId: version.documentMasterId,
      documentId: version.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      reason: isApprover
        ? `Approver ${currentUser.name} (${currentUser.role}) initiated governance inspection on v${version.versionNumber}.`
        : `HR Author ${currentUser.name} (${currentUser.role}) inspected baseline comparison on v${version.versionNumber}.`,
    });
  }, [version.id, isApprover]);

  useEffect(() => {
    if (!version.id) return;
    setLoading(true);
    try {
      const comp = governanceEngine.getComparison(version.id, selectedBaselineId || undefined);
      setComparison(comp);
    } catch (e) {
      console.error('Error generating comparison:', e);
    } finally {
      setLoading(false);
    }
  }, [version.id, selectedBaselineId]);

  const handleApprove = async () => {
    if (!isApprover) {
      alert('Forbidden: HR Authors cannot approve documents. Only authorized Approvers can render decisions.');
      return;
    }

    setIsApproving(true);
    try {
      await governanceEngine.approveVersion(currentUser, version.id, approvalNotes);
      setShowApproveConfirm(false);
      onApproveSuccess();
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!isApprover) {
      setRejectionError('Forbidden: HR Authors cannot reject documents. Only authorized Approvers can render decisions.');
      return;
    }

    if (!rejectionComments.trim() && inlineComments.length === 0) {
      setRejectionError('Rejection comments or inline text comments are mandatory. Please detail the required revisions.');
      return;
    }

    setIsRejecting(true);
    try {
      const finalComments =
        rejectionComments.trim() ||
        `Please address the ${inlineComments.length} specific inline revision comment(s) highlighted in the document.`;
      await governanceEngine.rejectVersion(currentUser, version.id, finalComments, inlineComments);
      setShowRejectModal(false);
      onRejectSuccess();
    } catch (err: any) {
      setRejectionError(err.message || 'Failed to reject document');
    } finally {
      setIsRejecting(false);
    }
  };

  const handlePermanentReject = async () => {
    if (!isApprover) {
      alert('Forbidden: HR Authors cannot reject documents. Only authorized Approvers can render decisions.');
      return;
    }

    setIsPermanentRejecting(true);
    try {
      await governanceEngine.permanentlyRejectDocument(
        currentUser,
        version.id,
        permanentRejectReason
      );
      setShowPermanentRejectModal(false);
      onRejectSuccess();
    } catch (err: any) {
      alert(err.message || 'Failed to permanently reject document');
    } finally {
      setIsPermanentRejecting(false);
    }
  };

  const isAlreadyDecided = version.status !== VersionStatus.IN_REVIEW || !!version.reviewedAt;

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* MODAL HEADER */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/20 border border-[#FA7014]/40 flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-6 h-6 text-[#FA7014]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-slate-200 bg-slate-800 px-2.5 py-0.5 rounded-lg border border-slate-700">
                  {version.documentId}
                </span>
                <h2 className="text-lg font-bold text-white">{version.documentTitle}</h2>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                    version.status === VersionStatus.PUBLISHED
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : version.status === VersionStatus.REVISION_REQUIRED
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-[#FA7014]/20 text-[#FA7014] border-[#FA7014]/30'
                  }`}
                >
                  v{version.versionNumber} ({version.status.replace('_', ' ')})
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Submitted by <span className="text-slate-200 font-semibold">{creator.name}</span>
                {creator.title && <span className="text-slate-400"> ({creator.title})</span>} on{' '}
                {formatISTDate(version.createdAt)} • Comparison Baseline:{' '}
                <span className="text-[#FA7014] font-semibold">
                  {activeBaseline
                    ? `v${activeBaseline.versionNumber} (${activeBaseline.status.replace('_', ' ')})`
                    : 'Initial Baseline'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="btn-download-review-version"
              onClick={handleDownloadVersion}
              disabled={isDownloading}
              className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl transition-all border border-slate-700 cursor-pointer disabled:opacity-60 shadow-xs"
              title={`Download Version v${version.versionNumber} (${version.fileName || 'PDF'})`}
            >
              {isDownloading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
              ) : (
                <Download className="w-3.5 h-3.5 text-slate-300" />
              )}
              <span>Download v{version.versionNumber}</span>
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* DECISION FINALIZED BANNER (If already decided) */}
        {isAlreadyDecided && (
          <div className="bg-slate-100 border-b border-slate-300 px-6 py-3 flex items-center justify-between gap-3 text-xs text-slate-800">
            <div className="flex items-center space-x-2.5">
              <Lock className="w-4 h-4 text-slate-600 shrink-0" />
              <div>
                <span className="font-bold text-slate-900">Decision Finalized:</span> This document version received a formal decision ({version.status}) on{' '}
                {version.reviewedAt ? formatIST(version.reviewedAt) : 'previously'} by{' '}
                <span className="font-semibold text-slate-900">{version.reviewedByName || 'Authorized Reviewer'}</span>. Further decisions cannot be submitted for this version.
                {version.reviewerComments && (
                  <span className="block mt-0.5 text-slate-600 italic">" {version.reviewerComments} "</span>
                )}
              </div>
            </div>
            <span className="shrink-0 bg-slate-200 text-slate-700 px-2.5 py-1 rounded-md font-semibold text-[11px] border border-slate-300">
              Read-Only Inspection
            </span>
          </div>
        )}

        {/* HR AUTHOR READ-ONLY COMPARISON BANNER (When HR or non-approver inspects a version in review) */}
        {!isApprover && !isAlreadyDecided && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center space-x-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <div>
                <span className="font-bold text-amber-950">Baseline Comparison (HR Author View):</span>{' '}
                This document is <span className="font-semibold text-amber-900">Pending Review</span> by the designated Approver. HR Authors have read-only access to baseline diffs and content for auditing. Approval and rejection decisions are strictly restricted to Approvers.
              </div>
            </div>
            <span className="shrink-0 bg-amber-100 text-amber-800 px-2.5 py-1 rounded-md font-semibold text-[11px] border border-amber-300">
              Read-Only Inspection
            </span>
          </div>
        )}

        {/* METADATA & HASH VERIFICATION BAR */}
        <div className="bg-slate-50 px-6 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-600 shrink-0 gap-2">
          <div className="flex items-center space-x-4">
            <div>
              <span className="text-slate-500">Category:</span> <span className="font-semibold text-slate-800">{master?.category}</span>
            </div>
            <div>
              <span className="text-slate-500">Department:</span> <span className="font-semibold text-slate-800">{master?.departmentName}</span>
            </div>
            <div>
              <span className="text-slate-500">Confidentiality:</span> <span className="font-semibold text-slate-800">{master?.confidentiality}</span>
            </div>
            <div>
              <span className="text-slate-500">Revised Effective Date:</span>{' '}
              <span className="font-bold text-[#FA7014] font-mono">{formatDDMMYYYY(version.effectiveFrom || version.createdAt)}</span>
            </div>
            <div>
              <span className="text-slate-500">Re-review Date:</span>{' '}
              <span className="font-bold text-slate-800 font-mono">{formatDDMMYYYY(version.reviewDueDate, '1 Year')}</span>
            </div>
            <div>
              <span className="text-slate-500">Acknowledgement:</span>{' '}
              <span className="font-semibold text-slate-800">{master?.acknowledgementRequired ? 'Mandatory' : 'Optional'}</span>
            </div>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="bg-white border-b border-slate-200 px-6 pt-3 flex items-center justify-between shrink-0">
          <div className="flex space-x-4">
            <button
              id="tab-side-by-side"
              onClick={() => setActiveTab('sideBySide')}
              className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
                activeTab === 'sideBySide'
                  ? 'border-[#FA7014] text-[#FA7014]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Split className="w-3.5 h-3.5" />
              <span>Side-by-Side Version Diff</span>
            </button>

            <button
              id="tab-summary"
              onClick={() => setActiveTab('summary')}
              className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
                activeTab === 'summary'
                  ? 'border-[#FA7014] text-[#FA7014]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Change Summary & Highlights</span>
            </button>

            <button
              id="tab-full-text"
              onClick={() => setActiveTab('fullText')}
              className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
                activeTab === 'fullText'
                  ? 'border-[#FA7014] text-[#FA7014]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Full Submitted Document</span>
              {inlineComments.length > 0 && (
                <span className="bg-[#FA7014] text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ml-1">
                  {inlineComments.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* MAIN COMPARISON CONTENT CONTAINER */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {loading ? (
            <div className="py-20 text-center text-slate-500">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-[#FA7014]" />
              <span>Analyzing version differences and extracting diffs...</span>
            </div>
          ) : (
            <>
              {/* TAB 1: SIDE-BY-SIDE DIFF */}
              {activeTab === 'sideBySide' && (
                <div className="space-y-4">
                  {/* Baseline Header Notice & Comparison Target Selector */}
                  <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-700 flex flex-wrap items-center justify-between shadow-2xs gap-3">
                    <div className="flex items-center space-x-2.5">
                      <Info className="w-4 h-4 text-[#FA7014] shrink-0" />
                      <span className="font-semibold text-slate-900">Comparing against:</span>
                      {candidateBaselines.length > 1 ? (
                        <select
                          id="select-comparison-baseline"
                          value={selectedBaselineId}
                          onChange={(e) => setSelectedBaselineId(e.target.value)}
                          className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/30 focus:border-[#FA7014] cursor-pointer"
                        >
                          {candidateBaselines.map((b) => {
                            const isPrevDraft = b.id === version.previousVersionId;
                            const isLive = b.id === master?.currentPublishedVersionId;
                            return (
                              <option key={b.id} value={b.id}>
                                v{b.versionNumber} ({b.status.replace('_', ' ')})
                                {isPrevDraft ? ' — [Previous Draft / Feedback Baseline]' : isLive ? ' — [Live Published Baseline]' : ''}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <span>
                          <strong>v{activeBaseline?.versionNumber || '1.0'} ({activeBaseline?.status?.replace('_', ' ') || 'Initial'})</strong>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 text-slate-500 font-mono text-xs">
                      {/* View Mode Switcher */}
                      <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl font-sans font-semibold">
                        <button
                          id="btn-mode-cards"
                          onClick={() => setSideBySideMode('cards')}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                            sideBySideMode === 'cards'
                              ? 'bg-white text-[#FA7014] font-bold shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Point-by-Point View
                        </button>
                        <button
                          id="btn-mode-lines"
                          onClick={() => setSideBySideMode('lines')}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                            sideBySideMode === 'lines'
                              ? 'bg-white text-[#FA7014] font-bold shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Line Code Table
                        </button>
                      </div>

                      <span>
                        Similarity: <strong className="text-slate-900">{comparison?.statistics.similarityPercentage}%</strong>
                      </span>
                    </div>
                  </div>

                  {/* POINT CARDS SIDE BY SIDE VIEW */}
                  {sideBySideMode !== 'lines' ? (
                    <div className="space-y-4">
                      {/* Sub-filter Bar */}
                      <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="font-bold text-slate-900 flex items-center space-x-2">
                          <Split className="w-4 h-4 text-[#FA7014]" />
                          <span>Full Document Side-by-Side Comparison with Point Highlights</span>
                        </div>
                        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl font-semibold shrink-0">
                          <button
                            id="btn-sb-filter-all"
                            onClick={() => setSummaryFilter('all')}
                            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                              summaryFilter === 'all'
                                ? 'bg-white text-slate-900 font-bold shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            All Document Points ({pointDiffs.length})
                          </button>
                          <button
                            id="btn-sb-filter-[#FA7014]"
                            onClick={() => setSummaryFilter('modified')}
                            className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                              summaryFilter === 'modified'
                                ? 'bg-white text-[#FA7014] font-bold shadow-2xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            Changed Points ({pointDiffs.filter((p) => p.type !== 'unchanged').length})
                          </button>
                        </div>
                      </div>

                      {/* Point Cards */}
                      {pointDiffs
                        .filter((p) => (summaryFilter === 'modified' ? p.type !== 'unchanged' : true))
                        .map((pt, idx) => (
                          <div key={`sb-card-${pt.id || idx}`} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
                            {/* Point Card Top Header */}
                            <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between text-xs font-bold">
                              <div className="flex items-center space-x-2">
                                <span className="bg-[#FA7014] px-2.5 py-0.5 rounded text-[11px] font-extrabold uppercase text-white">
                                  {pt.pointNumber}
                                </span>
                                <span className="text-slate-200 truncate max-w-lg">{pt.title}</span>
                              </div>
                              <div>
                                {pt.type === 'modified' && (
                                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold">
                                    Point Modified
                                  </span>
                                )}
                                {pt.type === 'added' && (
                                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold">
                                    New Point Added
                                  </span>
                                )}
                                {pt.type === 'removed' && (
                                  <span className="bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold">
                                    Point Removed
                                  </span>
                                )}
                                {pt.type === 'unchanged' && (
                                  <span className="bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium">
                                    Unchanged Point
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Side-by-Side Paragraph Comparison Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 text-xs divide-y md:divide-y-0 md:divide-x divide-slate-200">
                              {/* Left Column: Baseline */}
                              <div className={`p-4 ${pt.type === 'removed' ? 'bg-rose-50/40' : pt.type === 'modified' ? 'bg-amber-50/20' : 'bg-slate-50/50'}`}>
                                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                                  <span>BASELINE (v{activeBaseline?.versionNumber || '1.0'})</span>
                                  {pt.type === 'removed' && <span className="text-rose-600 font-semibold">[Removed]</span>}
                                </div>
                                <div className="text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">
                                  {pt.oldWords && pt.oldWords.length > 0 ? (
                                    pt.oldWords.map((w, wi) =>
                                      w.isRemoved ? (
                                        <span key={wi} className="bg-rose-100 text-rose-800 line-through font-medium px-0.5 rounded">
                                          {w.text}
                                        </span>
                                      ) : (
                                        <span key={wi}>{w.text}</span>
                                      )
                                    )
                                  ) : (
                                    <span className="text-slate-400 italic">{pt.oldText}</span>
                                  )}
                                </div>
                              </div>

                              {/* Right Column: New Revision */}
                              <div className={`p-4 ${pt.type === 'added' ? 'bg-emerald-50/40' : pt.type === 'modified' ? 'bg-orange-50/40' : 'bg-white'}`}>
                                <div className="text-[11px] font-bold text-[#FA7014] uppercase tracking-wider mb-2 flex items-center justify-between">
                                  <span>NEW REVISION (v{version.versionNumber})</span>
                                  {pt.type === 'added' && <span className="text-emerald-600 font-semibold">[Added]</span>}
                                </div>
                                <div className="text-slate-900 leading-relaxed font-sans whitespace-pre-wrap">
                                  {pt.newWords && pt.newWords.length > 0 ? (
                                    pt.newWords.map((w, wi) =>
                                      w.isAdded ? (
                                        <span key={wi} className="bg-orange-200/90 text-slate-900 font-bold px-0.5 rounded">
                                          {w.text}
                                        </span>
                                      ) : (
                                        <span key={wi}>{w.text}</span>
                                      )
                                    )
                                  ) : (
                                    <span className="text-slate-400 italic">{pt.newText}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    /* Line-by-line table view */
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-mono text-xs">
                      <div className="grid grid-cols-2 bg-slate-900 text-white font-sans text-xs font-bold py-2.5 px-4 border-b border-slate-800">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] border border-slate-700 text-slate-300">
                            {activeBaseline?.id === master?.currentPublishedVersionId ? 'LIVE BASELINE' : 'PREVIOUS VERSION'}
                          </span>
                          <span>{activeBaseline ? `v${activeBaseline.versionNumber} (${activeBaseline.status.replace('_', ' ')})` : 'Baseline Not Set'}</span>
                        </div>
                        <div className="flex items-center space-x-2 pl-4 border-l border-slate-800 flex-wrap gap-y-1">
                          <span className="bg-[#FA7014] px-2 py-0.5 rounded text-[11px] text-white font-bold">NEW VERSION</span>
                          <span>v{version.versionNumber} (In Review)</span>
                        </div>
                      </div>

                      <div className="divide-y divide-slate-200 overflow-x-auto max-h-[55vh]">
                        {comparison?.sideBySideLines.map((row, idx) => {
                          const left = row.left;
                          const right = row.right;

                          const leftBg =
                            left?.type === 'removed'
                              ? 'bg-slate-100 text-slate-500 line-through'
                              : left?.type === 'modified'
                              ? 'bg-orange-50/70 text-slate-800 font-medium'
                              : 'bg-white text-slate-700';

                          const rightBg =
                            right?.type === 'added'
                              ? 'bg-orange-50 text-slate-900 font-medium'
                              : right?.type === 'modified'
                              ? 'bg-orange-50/70 text-slate-900 font-medium'
                              : 'bg-white text-slate-700';

                          return (
                            <div key={idx} className="grid grid-cols-2 text-[12px] leading-relaxed">
                              {/* Left Line */}
                              <div className={`p-2 flex items-start space-x-3 border-r border-slate-200 ${leftBg}`}>
                                <span className="text-slate-400 select-none text-[10px] w-6 text-right shrink-0">
                                  {left?.lineNumber || ''}
                                </span>
                                <pre className="font-mono whitespace-pre-wrap break-words flex-1">
                                  {left?.content || (left?.type === 'empty' ? ' ' : '')}
                                </pre>
                              </div>

                              {/* Right Line */}
                              <div className={`p-2 flex items-start space-x-3 ${rightBg}`}>
                                <span className="text-slate-400 select-none text-[10px] w-6 text-right shrink-0">
                                  {right?.lineNumber || ''}
                                </span>
                                <pre className="font-mono whitespace-pre-wrap break-words flex-1">
                                  {right?.content || (right?.type === 'empty' ? ' ' : '')}
                                </pre>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CHANGE SUMMARY & HIGHLIGHTS */}
              {activeTab === 'summary' && (
                <div className="space-y-6">
                  {/* CREATOR CHANGE SUMMARY CARD */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-2">
                        <Sparkles className="w-4 h-4 text-[#FA7014]" />
                        <span>Creator Change Summary & Justification</span>
                      </h3>
                      <span className="text-[11px] font-mono text-slate-500">
                        Authored by: <strong className="text-slate-900">{creator.name}</strong>
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed font-medium">
                      {version.changeSummary || 'No explicit change summary submitted.'}
                    </p>
                  </div>

                  {/* EXECUTIVE CONCISE 5-6 LINES CHANGE SUMMARY */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                    <div className="mb-4 pb-3 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-[#FA7014]" />
                          <span>Executive Version Transition Summary (v{activeBaseline?.versionNumber || '1.0'} → v{version.versionNumber})</span>
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          High-level point-by-point summary highlighting key policy alterations between baseline and new revision.
                        </p>
                      </div>
                      <span className="bg-orange-50 text-[#FA7014] border border-orange-200 text-[11px] font-bold px-2.5 py-1 rounded-lg">
                        {pointDiffs.filter((p) => p.type !== 'unchanged').length} Point Change(s) Detected
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {pointDiffs.filter((p) => p.type !== 'unchanged').length === 0 ? (
                        <div className="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-500">
                          No text changes detected between version {activeBaseline?.versionNumber || '1.0'} and v{version.versionNumber}.
                        </div>
                      ) : (
                        pointDiffs
                          .filter((p) => p.type !== 'unchanged')
                          .map((pt, idx) => (
                            <div key={`exec-sum-${pt.id || idx}`} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-start space-x-3 text-xs leading-relaxed">
                              <span className="bg-[#FA7014] text-white font-extrabold text-[11px] px-2 py-0.5 rounded shrink-0">
                                {pt.pointNumber}
                              </span>
                              <div className="flex-1">
                                <span className="font-bold text-slate-900">{pt.title}: </span>
                                <span className="text-slate-800 font-medium">{pt.summaryText}</span>
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: FULL DOCUMENT TEXT */}
              {activeTab === 'fullText' && (
                <div className="space-y-4">
                  {isApprover && !isAlreadyDecided && (
                    <div className="bg-orange-50/80 border border-orange-200 rounded-xl p-3 text-xs text-slate-800 flex flex-wrap items-center justify-between shadow-2xs gap-3">
                      <div className="flex items-center space-x-2">
                        <MessageSquare className="w-4 h-4 text-[#FA7014] shrink-0" />
                        <span>
                          <strong>Approver Inline Revision Mode:</strong> Select any text passage in the Word document with your mouse to attach specific revision comments and instructions for HR before requesting revisions.
                        </span>
                      </div>
                      {inlineComments.length > 0 && (
                        <span className="bg-[#FA7014] text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shrink-0">
                          {inlineComments.length} Comment{inlineComments.length > 1 ? 's' : ''} Attached
                        </span>
                      )}
                    </div>
                  )}

                  {version.status === VersionStatus.REVISION_REQUIRED && inlineComments.length > 0 && !isApprover && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-950 flex items-center justify-between shadow-2xs gap-3">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-[#FA7014] shrink-0" />
                        <span>
                          <strong>Approver Revision Comments:</strong> The approver highlighted {inlineComments.length} specific passage(s) requiring revision. Review the highlighted sections and notes in the right sidebar.
                        </span>
                      </div>
                    </div>
                  )}

                  <DocumentViewer
                    fileName={version.fileName}
                    rawContent={version.rawContent}
                    fileUrl={version.fileUrl}
                    originalFileUrl={version.originalFileUrl}
                    mimeType={version.mimeType}
                    versionId={version.id}
                    documentId={version.documentId}
                    enableInlineComments={isApprover && !isAlreadyDecided}
                    inlineComments={inlineComments}
                    currentUser={currentUser}
                    onAddInlineComment={(newC) => {
                      const commentObj: InlineRevisionComment = {
                        ...newC,
                        id: `comment-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                        createdAt: new Date().toISOString(),
                      };
                      setInlineComments((prev) => [...prev, commentObj]);
                    }}
                    onDeleteInlineComment={(id) => {
                      setInlineComments((prev) => prev.filter((c) => c.id !== id));
                    }}
                    headerFooterData={{
                      companyName: master?.companyName || 'Amaavigo',
                      documentTitle: version.documentTitle || master?.title || 'Document',
                      versionNumber: version.versionNumber,
                      effectiveDate: formatDDMMYYYY(version.effectiveFrom || new Date()),
                      createdByName: version.createdByName || master?.createdByName || 'Amee Shah',
                      approvedByName:
                        version.status === VersionStatus.PUBLISHED
                          ? (version.reviewedByName || version.publishedByName || 'Authorized Approver')
                          : 'Not yet approved',
                      approvedDate:
                        version.status === VersionStatus.PUBLISHED && (version.reviewedAt || version.publishedAt)
                          ? formatDDMMYYYY(version.reviewedAt || version.publishedAt!)
                          : 'Not yet approved',
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* DECISION ACTION BAR (Sticky Bottom) */}
        <div className="bg-slate-900 text-white px-6 py-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          {/* USER CONTEXT / ROLE BADGE */}
          {isApprover ? (
            <div className="text-xs text-slate-400">
              Approver: <span className="font-semibold text-white">{currentUser.name}</span> ({currentUser.title || 'HR Policy & Governance Lead'})
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-amber-400 border border-slate-700">
                {currentUser.role === UserRole.CREATOR ? 'HR Author View' : 'Read-Only View'}
              </span>
              <span>
                Logged in as: <strong className="text-white">{currentUser.name}</strong> ({currentUser.title || currentUser.role})
              </span>
            </div>
          )}

          {/* ACTION CONTROLS */}
          {isApprover ? (
            isAlreadyDecided ? (
              <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
                <span className="inline-flex items-center space-x-1.5 bg-slate-800 text-slate-300 border border-slate-700 font-semibold px-4 py-2 rounded-xl text-xs">
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Decision Finalized ({version.status.replace('_', ' ')})</span>
                </span>
                <button
                  id="btn-close-decided-modal"
                  onClick={onClose}
                  className="inline-flex items-center space-x-1.5 bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold px-5 py-2 rounded-xl text-xs transition-all shadow-md shadow-[#FA7014]/20 cursor-pointer"
                >
                  <span>Close Window</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
                <button
                  id="btn-open-permanent-reject-modal"
                  onClick={() => setShowPermanentRejectModal(true)}
                  className="inline-flex items-center space-x-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 hover:text-rose-800 border border-rose-300 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shadow-xs cursor-pointer"
                >
                  <Ban className="w-4 h-4 text-rose-600" />
                  <span>Reject</span>
                </button>

                <button
                  id="btn-open-reject-modal"
                  onClick={() => setShowRejectModal(true)}
                  className="inline-flex items-center space-x-1.5 bg-white hover:bg-slate-100 text-slate-900 border border-slate-300 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shadow-xs cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-slate-500" />
                  <span>Request Revisions</span>
                </button>

                <button
                  id="btn-open-approve-confirm"
                  onClick={() => setShowApproveConfirm(true)}
                  className="inline-flex items-center space-x-2 bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-[#FA7014]/20 cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>Approve & Auto-Publish</span>
                </button>
              </div>
            )
          ) : (
            /* NON-APPROVER (HR CREATOR) - NO REJECT / APPROVE BUTTONS CAN EVER BE SHOWN */
            <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
              <div className="flex items-center space-x-2 text-xs text-slate-400 bg-slate-800/80 px-3.5 py-1.5 rounded-xl border border-slate-700">
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  {version.status === VersionStatus.IN_REVIEW
                    ? 'Awaiting Approver Decision • Actions restricted to Approvers'
                    : `Status: ${version.status.replace('_', ' ')}`}
                </span>
              </div>
              <button
                id="btn-close-readonly-compare-modal"
                onClick={onClose}
                className="inline-flex items-center space-x-1.5 bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold px-5 py-2.5 rounded-xl text-xs transition-all shadow-md shadow-[#FA7014]/20 cursor-pointer"
              >
                <span>Close Comparison</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* APPROVAL CONFIRMATION MODAL */}
      {showApproveConfirm && isApprover && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-orange-50 border border-orange-200 text-[#FA7014] flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-slate-900">
              Confirm Publication of v{version.versionNumber}?
            </h3>

            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Approving version <strong className="text-slate-900">v{version.versionNumber}</strong> of{' '}
              <strong className="text-slate-900">"{version.documentTitle}"</strong> will execute the following automated governance actions:
            </p>

            <ul className="mt-3 space-y-2 text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <li className="flex items-start space-x-2">
                <Check className="w-3.5 h-3.5 text-[#FA7014] mt-0.5 shrink-0" />
                <span>
                  <strong>Append & Save Dynamic Header/Footer:</strong> Injects official corporate header (Amaavigo, Document Name, Version, Effective Date: {formatDDMMYYYY(version.effectiveFrom || new Date())}) and approval footer (Created by: {version.createdByName || master?.createdByName || 'Amee Shah'}, Approved by: {currentUser.name}, Approved Date: {formatDDMMYYYY(new Date())}) directly into the saved file.
                </span>
              </li>
              <li className="flex items-center space-x-2">
                <Check className="w-3.5 h-3.5 text-[#FA7014] shrink-0" />
                <span>Lock file and make version immutable with updated SHA-256 hash</span>
              </li>
              <li className="flex items-center space-x-2">
                <Check className="w-3.5 h-3.5 text-[#FA7014] shrink-0" />
                <span>
                  Supersede previous published version (
                  {master?.currentPublishedVersionNumber ? `v${master.currentPublishedVersionNumber}` : 'None'}
                  )
                </span>
              </li>
              <li className="flex items-start space-x-2">
                <Check className="w-3.5 h-3.5 text-[#FA7014] mt-0.5 shrink-0" />
                <span>
                  {master?.confidentiality === ConfidentialityLevel.INTERNAL
                    ? '🔒 Internal Company Document: Access restricted to HR & Approvers. No employee emails will be sent and document is hidden from Employee Portal.'
                    : master?.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT
                    ? master?.acknowledgementRequired
                      ? `📢 Department Policy (${master?.departmentName}): Broadcast mandatory compliance email to active ${master?.departmentName} employees and require portal sign-off.`
                      : `📢 Department Policy (${master?.departmentName}): Broadcast informational notice email to active ${master?.departmentName} employees (view/read only).`
                    : master?.acknowledgementRequired
                    ? '📢 Public Policy: Broadcast mandatory compliance email to active employees and require portal sign-off.'
                    : '📢 Public Policy: Broadcast informational notice email to active employees (view/read only, no acknowledgement required).'}
                </span>
              </li>
              <li className="flex items-center space-x-2">
                <Check className="w-3.5 h-3.5 text-[#FA7014] shrink-0" />
                <span>Write immutable audit logs with SHA-256 hash</span>
              </li>
            </ul>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Optional Approval Governance Notes
              </label>
              <textarea
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                rows={2}
                className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
                placeholder="Compliance review notes..."
              />
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-approve"
                disabled={isApproving}
                onClick={handleApprove}
                className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md shadow-[#FA7014]/20 flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isApproving ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Authorize & Publish Now</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REJECTION / MANDATORY COMMENTS MODAL */}
      {showRejectModal && isApprover && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-center mb-4">
              <AlertTriangle className="w-7 h-7 text-[#FA7014]" />
            </div>

            <h3 className="text-lg font-bold text-slate-900">
              Request Revisions for v{version.versionNumber}
            </h3>

            <p className="text-xs text-slate-600 mt-1">
              Per governance requirements, rejection requires specific comments detailing the required changes.
            </p>

            {/* Attached inline comments preview if any */}
            {inlineComments.length > 0 && (
              <div className="mt-3 bg-orange-50/70 border border-orange-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                  <span className="flex items-center space-x-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#FA7014]" />
                    <span>Attached Text Comments ({inlineComments.length}):</span>
                  </span>
                  <span className="text-[10px] text-[#FA7014] bg-white px-2 py-0.5 rounded-full border border-orange-200 font-bold">
                    Sent to HR
                  </span>
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {inlineComments.map((c, idx) => (
                    <div key={c.id || idx} className="bg-white p-2 rounded-lg border border-orange-100 text-[11px]">
                      <div className="text-slate-500 font-serif italic line-clamp-1 mb-0.5">
                        "{c.selectedText}"
                      </div>
                      <div className="font-semibold text-slate-900">{c.comment}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-800 mb-1" htmlFor="input-rejection-comments">
                Rejection Notes & Guidance {inlineComments.length > 0 ? '(Optional summary)' : <span className="text-[#FA7014]">*</span>}
              </label>
              <textarea
                id="input-rejection-comments"
                value={rejectionComments}
                onChange={(e) => {
                  setRejectionComments(e.target.value);
                  setRejectionError('');
                }}
                rows={3}
                className="w-full text-xs p-3 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
                placeholder={
                  inlineComments.length > 0
                    ? `Optional summary: The ${inlineComments.length} inline revision comment(s) above will automatically be returned to HR...`
                    : 'Example: Please clarify the manager approval requirements in Section 2 and update the daily overlap schedule...'
                }
              />
              {rejectionError && (
                <p className="text-xs text-orange-600 font-medium mt-1">{rejectionError}</p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-reject"
                disabled={isRejecting}
                onClick={handleReject}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isRejecting ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 text-[#FA7014]" />}
                <span>Send Revision Request to HR</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEFINITIVE / PERMANENT REJECTION MODAL */}
      {showPermanentRejectModal && isApprover && (
        <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mb-4">
              <Ban className="w-7 h-7 text-rose-600" />
            </div>

            <h3 className="text-lg font-bold text-slate-900">
              Are you sure you want to reject this document?
            </h3>

            <p className="text-xs text-rose-600 font-semibold mt-1">
              This action is permanent and irreversible.
            </p>

            <div className="mt-3 bg-rose-50/80 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-950 space-y-2">
              <div className="font-bold flex items-center space-x-1.5 text-rose-900">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>No further revision would be done for this rejected document</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Rejecting document <strong>"{version.documentTitle}"</strong> ({version.documentId}) version <strong>v{version.versionNumber}</strong> permanently terminates its governance lifecycle. No further revisions can be authored or submitted for this document.
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-800 mb-1" htmlFor="input-permanent-rejection-notes">
                Rejection Reason / Notes (Optional)
              </label>
              <textarea
                id="input-permanent-rejection-notes"
                value={permanentRejectReason}
                onChange={(e) => setPermanentRejectReason(e.target.value)}
                rows={3}
                className="w-full text-xs p-3 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-rose-500 placeholder:text-slate-400"
                placeholder="Explain why this document has been permanently rejected..."
              />
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowPermanentRejectModal(false)}
                disabled={isPermanentRejecting}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-permanent-reject"
                type="button"
                disabled={isPermanentRejecting}
                onClick={handlePermanentReject}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md shadow-rose-600/20 flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
              >
                {isPermanentRejecting ? (
                  <Clock className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Ban className="w-3.5 h-3.5 text-white" />
                )}
                <span>Yes, Reject Document</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
