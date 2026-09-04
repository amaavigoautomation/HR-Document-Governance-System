import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  GitCompare,
  GitBranch,
  Layers,
  Clock,
  Sparkles,
  Download,
  Lock,
  ArrowRight,
  Split,
  FileCode,
  Check,
  Building,
  UserCheck,
  Info,
} from 'lucide-react';
import {
  DocumentComparisonResult,
  DocumentMaster,
  DocumentVersion,
  ConfidentialityLevel,
  User,
  VersionStatus,
  VersionType,
  AuditAction,
} from '../types';
import { governanceEngine } from '../services/governance';
import { auditService } from '../services/audit';
import { DocumentViewer } from './DocumentViewer';
import { formatIST, formatISTDate } from '../utils/dateFormat';

interface ReviewDocumentModalProps {
  version: DocumentVersion;
  currentUser: User;
  onClose: () => void;
  onApproveSuccess: () => void;
  onRejectSuccess: () => void;
}

export const ReviewDocumentModal: React.FC<ReviewDocumentModalProps> = ({
  version,
  currentUser,
  onClose,
  onApproveSuccess,
  onRejectSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'sideBySide' | 'summary' | 'unified' | 'fullText'>('sideBySide');
  const [comparison, setComparison] = useState<DocumentComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);

  // Approval Modal State
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('Reviewed and verified compliance with corporate governance standards.');
  const [isApproving, setIsApproving] = useState(false);

  // Rejection Modal State
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionComments, setRejectionComments] = useState('');
  const [rejectionError, setRejectionError] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const master = governanceEngine.getDocumentMasterById(version.documentMasterId);
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

  useEffect(() => {
    if (!version.id) return;
    // Log immutable review inspection event
    auditService.logEvent(AuditAction.REVIEW_STARTED, currentUser, {
      documentMasterId: version.documentMasterId,
      documentId: version.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      reason: `Reviewer ${currentUser.name} (${currentUser.role}) initiated governance inspection on v${version.versionNumber}.`,
    });
  }, [version.id]);

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
    if (!rejectionComments.trim()) {
      setRejectionError('Rejection comments are mandatory. Please detail the required revisions.');
      return;
    }

    setIsRejecting(true);
    try {
      await governanceEngine.rejectVersion(currentUser, version.id, rejectionComments);
      setShowRejectModal(false);
      onRejectSuccess();
    } catch (err: any) {
      setRejectionError(err.message || 'Failed to reject document');
    } finally {
      setIsRejecting(false);
    }
  };

  const isAlreadyDecided = version.status !== VersionStatus.IN_REVIEW || !!version.reviewedAt;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
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
                Submitted by <span className="text-slate-200 font-semibold">{version.createdByName}</span> on{' '}
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
              id="tab-unified"
              onClick={() => setActiveTab('unified')}
              className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
                activeTab === 'unified'
                  ? 'border-[#FA7014] text-[#FA7014]'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Unified Diff</span>
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
                      {activeBaseline?.status === VersionStatus.REVISION_REQUIRED || activeBaseline?.status === VersionStatus.SUPERSEDED ? (
                        <span className="text-[11px] font-semibold text-[#FA7014] bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                          Addressing Revisions on v{activeBaseline.versionNumber}
                        </span>
                      ) : null}
                      <span>
                        Similarity: <strong className="text-slate-900">{comparison?.statistics.similarityPercentage}%</strong>
                      </span>
                    </div>
                  </div>

                  {/* Side-by-side table */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden font-mono text-xs">
                    <div className="grid grid-cols-2 bg-slate-900 text-white font-sans text-xs font-bold py-2.5 px-4 border-b border-slate-800">
                      <div className="flex items-center space-x-2">
                        <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] border border-slate-700 text-slate-300">
                          {activeBaseline?.id === master?.currentPublishedVersionId ? 'LIVE BASELINE' : 'PREVIOUS VERSION'}
                        </span>
                        <span>{activeBaseline ? `v${activeBaseline.versionNumber} (${activeBaseline.status.replace('_', ' ')})` : 'Baseline Not Set'}</span>
                      </div>
                      <div className="flex items-center space-x-2 pl-4 border-l border-slate-800">
                        <span className="bg-[#FA7014] px-2 py-0.5 rounded text-[11px] text-white">NEW VERSION</span>
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
                </div>
              )}

              {/* TAB 2: CHANGE SUMMARY & HIGHLIGHTS */}
              {activeTab === 'summary' && (
                <div className="space-y-6">
                  {/* Summary Card */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      Creator Change Summary
                    </h3>
                    <p className="text-sm text-slate-800 bg-slate-50 p-4 rounded-xl border border-slate-200 leading-relaxed">
                      {version.changeSummary || 'No explicit change summary submitted.'}
                    </p>
                  </div>

                  {/* Added Content Section */}
                  {comparison && comparison.addedContent.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                      <div className="flex items-center space-x-2 text-slate-900 font-bold text-sm mb-3">
                        <CheckCircle2 className="w-4 h-4 text-[#FA7014]" />
                        <span>Added Content ({comparison.addedContent.length} sections)</span>
                      </div>
                      <div className="space-y-3">
                        {comparison.addedContent.map((item, i) => (
                          <div key={i} className="bg-orange-50/50 p-3.5 rounded-xl border border-orange-200 text-xs text-slate-900 whitespace-pre-wrap font-mono">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Removed Content Section */}
                  {comparison && comparison.removedContent.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                      <div className="flex items-center space-x-2 text-slate-700 font-bold text-sm mb-3">
                        <XCircle className="w-4 h-4 text-slate-500" />
                        <span>Removed Content ({comparison.removedContent.length} sections)</span>
                      </div>
                      <div className="space-y-3">
                        {comparison.removedContent.map((item, i) => (
                          <div key={i} className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs text-slate-500 line-through whitespace-pre-wrap font-mono">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Modified Content Section */}
                  {comparison && comparison.modifiedContent.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
                      <div className="flex items-center space-x-2 text-slate-900 font-bold text-sm mb-3">
                        <GitCompare className="w-4 h-4 text-[#FA7014]" />
                        <span>Modified Sections ({comparison.modifiedContent.length})</span>
                      </div>
                      <div className="space-y-4">
                        {comparison.modifiedContent.map((item, i) => (
                          <div key={i} className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <div className="font-bold text-xs text-slate-900 mb-2">
                              Section: {item.section}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              <div className="bg-white p-3 rounded-xl border border-slate-200">
                                <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">
                                  {activeBaseline ? `Baseline (v${activeBaseline.versionNumber})` : 'Old Baseline'}
                                </div>
                                <div className="text-slate-600 font-mono whitespace-pre-wrap">{item.oldText}</div>
                              </div>
                              <div className="bg-white p-3 rounded-xl border border-orange-200">
                                <div className="text-[11px] font-bold text-[#FA7014] uppercase mb-1">
                                  New Revision (v{version.versionNumber})
                                </div>
                                <div className="text-slate-900 font-mono whitespace-pre-wrap">{item.newText}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: UNIFIED DIFF */}
              {activeTab === 'unified' && (
                <div className="bg-white border border-slate-200 text-slate-800 font-mono text-xs rounded-2xl p-4 shadow-sm overflow-x-auto max-h-[55vh]">
                  <div className="text-slate-400 mb-3 border-b border-slate-200 pb-2">
                    --- {activeBaseline ? `v${activeBaseline.versionNumber} (${activeBaseline.status})` : 'Baseline'}{'\n'}
                    +++ v{version.versionNumber} (In Review)
                  </div>
                  {comparison?.diffSegments.map((seg, i) => {
                    if (seg.type === 'added') {
                      return (
                        <div key={i} className="bg-orange-50 text-slate-900 py-0.5 px-2 font-medium">
                          + {seg.value}
                        </div>
                      );
                    }
                    if (seg.type === 'removed') {
                      return (
                        <div key={i} className="bg-slate-100 text-slate-500 py-0.5 px-2 line-through">
                          - {seg.value}
                        </div>
                      );
                    }
                    if (seg.type === 'modified') {
                      return (
                        <div key={i} className="bg-orange-50/50 text-[#FA7014] py-0.5 px-2 font-medium">
                          ~ {seg.newValue || seg.value}
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="text-slate-700 py-0.5 px-2">
                        &nbsp;&nbsp;{seg.value}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TAB 4: FULL DOCUMENT TEXT */}
              {activeTab === 'fullText' && (
                <div className="space-y-4">
                  <DocumentViewer
                    fileName={version.fileName}
                    rawContent={version.rawContent}
                    fileUrl={version.fileUrl}
                    mimeType={version.mimeType}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* DECISION ACTION BAR (Sticky Bottom) */}
        <div className="bg-slate-900 text-white px-6 py-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400">
            Approver: <span className="font-semibold text-white">{currentUser.name}</span> ({currentUser.title})
          </div>

          {isAlreadyDecided ? (
            <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
              <span className="inline-flex items-center space-x-1.5 bg-slate-800 text-slate-300 border border-slate-700 font-semibold px-4 py-2 rounded-xl text-xs">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Decision Finalized ({version.status.replace('_', ' ')})</span>
              </span>
              <button
                id="btn-close-decided-modal"
                onClick={onClose}
                className="inline-flex items-center space-x-1.5 bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold px-5 py-2 rounded-xl text-xs transition-all shadow-md shadow-[#FA7014]/20"
              >
                <span>Close Window</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
              <button
                id="btn-open-reject-modal"
                onClick={() => setShowRejectModal(true)}
                className="inline-flex items-center space-x-1.5 bg-white hover:bg-slate-100 text-slate-900 border border-slate-300 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shadow-xs"
              >
                <XCircle className="w-4 h-4 text-slate-500" />
                <span>Reject (Request Revisions)</span>
              </button>

              <button
                id="btn-open-approve-confirm"
                onClick={() => setShowApproveConfirm(true)}
                className="inline-flex items-center space-x-2 bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-md shadow-[#FA7014]/20"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Approve & Auto-Publish</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* APPROVAL CONFIRMATION MODAL */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
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

            <ul className="mt-3 space-y-1.5 text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>Lock file and make version immutable</span>
              </li>
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>
                  Supersede previous published version (
                  {master?.currentPublishedVersionNumber ? `v${master.currentPublishedVersionNumber}` : 'None'}
                  )
                </span>
              </li>
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>
                  {master?.confidentiality === ConfidentialityLevel.INTERNAL
                    ? '🔒 Internal Company Document: Access restricted to HR & Approvers. No employee emails will be sent and document is hidden from Employee Portal.'
                    : master?.acknowledgementRequired
                    ? '📢 Public Policy: Broadcast mandatory compliance email to active employees and require portal sign-off.'
                    : '📢 Public Policy: Broadcast informational notice email to active employees (view/read only, no acknowledgement required).'}
                </span>
              </li>
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-[#FA7014]" />
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
      {showRejectModal && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
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

            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-800 mb-1" htmlFor="input-rejection-comments">
                Mandatory Rejection Comments & Requested Changes <span className="text-[#FA7014]">*</span>
              </label>
              <textarea
                id="input-rejection-comments"
                value={rejectionComments}
                onChange={(e) => {
                  setRejectionComments(e.target.value);
                  setRejectionError('');
                }}
                rows={4}
                className="w-full text-xs p-3 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
                placeholder="Example: Please clarify the manager approval requirements in Section 2 and update the daily overlap schedule..."
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
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-md flex items-center space-x-1.5 disabled:opacity-50"
              >
                {isRejecting ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 text-[#FA7014]" />}
                <span>Return to Creator (Revision Required)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
