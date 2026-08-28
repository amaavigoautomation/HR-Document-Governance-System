import React, { useState, useEffect } from 'react';
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
  User,
  VersionStatus,
  VersionType,
} from '../types';
import { governanceEngine } from '../services/governance';
import { DocumentViewer } from './DocumentViewer';

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
  const baselineVersion = version.previousVersionId
    ? governanceEngine.getVersionById(version.previousVersionId)
    : master?.currentPublishedVersionId
    ? governanceEngine.getVersionById(master.currentPublishedVersionId)
    : null;

  useEffect(() => {
    try {
      const comp = governanceEngine.getComparison(version.id);
      setComparison(comp);
    } catch (e) {
      console.error('Error generating comparison:', e);
    } finally {
      setLoading(false);
    }
  }, [version.id]);

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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="glass-panel-dark rounded-2xl shadow-2xl border border-slate-800 w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* MODAL HEADER */}
        <div className="bg-slate-900/90 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600/30 border border-emerald-500/40 flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold text-blue-300 bg-blue-950/80 px-2.5 py-0.5 rounded-lg border border-blue-800/80">
                  {version.documentId}
                </span>
                <h2 className="text-lg font-bold text-white">{version.documentTitle}</h2>
                <span className="bg-amber-500/20 text-amber-300 text-xs px-2.5 py-0.5 rounded-full font-bold border border-amber-500/30">
                  v{version.versionNumber} (In Review)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Submitted by <span className="text-slate-200 font-semibold">{version.createdByName}</span> on{' '}
                {new Date(version.createdAt).toLocaleDateString()} • Baseline:{' '}
                <span className="text-emerald-300 font-semibold">
                  {baselineVersion ? `v${baselineVersion.versionNumber} (${baselineVersion.status})` : 'Initial Baseline'}
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

        {/* METADATA & HASH VERIFICATION BAR */}
        <div className="bg-slate-950/70 px-6 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 shrink-0 gap-2">
          <div className="flex items-center space-x-4">
            <div>
              <span className="text-slate-500">Category:</span> <span className="font-semibold text-slate-200">{master?.category}</span>
            </div>
            <div>
              <span className="text-slate-500">Department:</span> <span className="font-semibold text-slate-200">{master?.departmentName}</span>
            </div>
            <div>
              <span className="text-slate-500">Confidentiality:</span> <span className="font-semibold text-slate-200">{master?.confidentiality}</span>
            </div>
            <div>
              <span className="text-slate-500">Acknowledgement:</span>{' '}
              <span className="font-semibold text-slate-200">{master?.acknowledgementRequired ? 'Mandatory' : 'Optional'}</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center space-x-1.5 font-mono text-[11px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/80 px-2.5 py-0.5 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>SHA-256 Verified: {version.contentHash.substring(0, 16)}...</span>
            </span>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <div className="bg-slate-900/60 border-b border-slate-800 px-6 pt-3 flex items-center justify-between shrink-0">
          <div className="flex space-x-4">
            <button
              id="tab-side-by-side"
              onClick={() => setActiveTab('sideBySide')}
              className={`pb-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
                activeTab === 'sideBySide'
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
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
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
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
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
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
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Full Submitted Document</span>
            </button>
          </div>

          {comparison && (
            <div className="hidden sm:flex items-center space-x-2 text-xs font-medium text-slate-300 mb-2">
              <span className="text-emerald-300 bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 rounded font-bold">
                +{comparison.statistics.additions} added
              </span>
              <span className="text-rose-300 bg-rose-950/80 border border-rose-800/80 px-2 py-0.5 rounded font-bold">
                -{comparison.statistics.removals} removed
              </span>
              <span className="text-amber-300 bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 rounded font-bold">
                ~{comparison.statistics.modifications} modified
              </span>
            </div>
          )}
        </div>

        {/* MAIN COMPARISON CONTENT CONTAINER */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
          {loading ? (
            <div className="py-20 text-center text-slate-400">
              <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-400" />
              <span>Analyzing version differences and extracting diffs...</span>
            </div>
          ) : (
            <>
              {/* TAB 1: SIDE-BY-SIDE DIFF */}
              {activeTab === 'sideBySide' && (
                <div className="space-y-4">
                  {/* Baseline Header Notice */}
                  <div className="bg-blue-950/40 border border-blue-900/60 rounded-xl p-3 text-xs text-blue-300 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Info className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>
                        Comparing against <strong>Published Baseline ({baselineVersion ? `v${baselineVersion.versionNumber}` : 'Initial'})</strong>. Red highlights removals, Green highlights additions, Amber highlights modifications.
                      </span>
                    </div>
                    <span className="text-slate-400 font-mono">
                      Similarity: {comparison?.statistics.similarityPercentage}%
                    </span>
                  </div>

                  {/* Side-by-side table */}
                  <div className="glass-panel-dark rounded-2xl border border-slate-800 shadow-xl overflow-hidden font-mono text-xs">
                    <div className="grid grid-cols-2 bg-slate-900 text-white font-sans text-xs font-bold py-2.5 px-4 border-b border-slate-800">
                      <div className="flex items-center space-x-2">
                        <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] border border-slate-700">OLD BASELINE</span>
                        <span>{baselineVersion ? `v${baselineVersion.versionNumber} (${baselineVersion.status})` : 'Baseline Not Set'}</span>
                      </div>
                      <div className="flex items-center space-x-2 pl-4 border-l border-slate-800">
                        <span className="bg-emerald-800 px-2 py-0.5 rounded text-[11px] border border-emerald-600">NEW VERSION</span>
                        <span>v{version.versionNumber} (In Review)</span>
                      </div>
                    </div>

                    <div className="divide-y divide-slate-800/80 overflow-x-auto max-h-[55vh]">
                      {comparison?.sideBySideLines.map((row, idx) => {
                        const left = row.left;
                        const right = row.right;

                        const leftBg =
                          left?.type === 'removed'
                            ? 'bg-rose-950/40 text-rose-200 font-medium'
                            : left?.type === 'modified'
                            ? 'bg-amber-950/40 text-amber-200 font-medium'
                            : 'bg-slate-950/60 text-slate-300';

                        const rightBg =
                          right?.type === 'added'
                            ? 'bg-emerald-950/40 text-emerald-200 font-medium'
                            : right?.type === 'modified'
                            ? 'bg-amber-950/40 text-amber-200 font-medium'
                            : 'bg-slate-950/60 text-slate-300';

                        return (
                          <div key={idx} className="grid grid-cols-2 text-[12px] leading-relaxed">
                            {/* Left Line */}
                            <div className={`p-2 flex items-start space-x-3 border-r border-slate-800 ${leftBg}`}>
                              <span className="text-slate-500 select-none text-[10px] w-6 text-right shrink-0">
                                {left?.lineNumber || ''}
                              </span>
                              <pre className="font-mono whitespace-pre-wrap break-words flex-1">
                                {left?.content || (left?.type === 'empty' ? ' ' : '')}
                              </pre>
                            </div>

                            {/* Right Line */}
                            <div className={`p-2 flex items-start space-x-3 ${rightBg}`}>
                              <span className="text-slate-500 select-none text-[10px] w-6 text-right shrink-0">
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
                  <div className="glass-panel-dark p-5 rounded-2xl border border-slate-800 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                      Creator Change Summary
                    </h3>
                    <p className="text-sm text-slate-200 bg-slate-950 p-4 rounded-xl border border-slate-800 leading-relaxed">
                      {version.changeSummary || 'No explicit change summary submitted.'}
                    </p>
                  </div>

                  {/* Added Content Section */}
                  {comparison && comparison.addedContent.length > 0 && (
                    <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-2xl p-5 shadow-xs">
                      <div className="flex items-center space-x-2 text-emerald-300 font-bold text-sm mb-3">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>Added Content ({comparison.addedContent.length} sections)</span>
                      </div>
                      <div className="space-y-3">
                        {comparison.addedContent.map((item, i) => (
                          <div key={i} className="bg-slate-950 p-3.5 rounded-xl border border-emerald-800/80 text-xs text-emerald-200 whitespace-pre-wrap font-mono">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Removed Content Section */}
                  {comparison && comparison.removedContent.length > 0 && (
                    <div className="bg-rose-950/30 border border-rose-800/60 rounded-2xl p-5 shadow-xs">
                      <div className="flex items-center space-x-2 text-rose-300 font-bold text-sm mb-3">
                        <XCircle className="w-4 h-4 text-rose-400" />
                        <span>Removed Content ({comparison.removedContent.length} sections)</span>
                      </div>
                      <div className="space-y-3">
                        {comparison.removedContent.map((item, i) => (
                          <div key={i} className="bg-slate-950 p-3.5 rounded-xl border border-rose-800/80 text-xs text-rose-300 line-through whitespace-pre-wrap font-mono">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Modified Content Section */}
                  {comparison && comparison.modifiedContent.length > 0 && (
                    <div className="bg-amber-950/30 border border-amber-800/60 rounded-2xl p-5 shadow-xs">
                      <div className="flex items-center space-x-2 text-amber-300 font-bold text-sm mb-3">
                        <GitCompare className="w-4 h-4 text-amber-400" />
                        <span>Modified Sections ({comparison.modifiedContent.length})</span>
                      </div>
                      <div className="space-y-4">
                        {comparison.modifiedContent.map((item, i) => (
                          <div key={i} className="glass-panel-dark p-4 rounded-xl border border-amber-800/60">
                            <div className="font-bold text-xs text-amber-200 mb-2">
                              Section: {item.section}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              <div className="bg-rose-950/40 p-3 rounded-xl border border-rose-900/60">
                                <div className="text-[11px] font-bold text-rose-400 uppercase mb-1">Old Baseline</div>
                                <div className="text-slate-300 font-mono whitespace-pre-wrap">{item.oldText}</div>
                              </div>
                              <div className="bg-emerald-950/40 p-3 rounded-xl border border-emerald-900/60">
                                <div className="text-[11px] font-bold text-emerald-400 uppercase mb-1">New Revision</div>
                                <div className="text-slate-300 font-mono whitespace-pre-wrap">{item.newText}</div>
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
                <div className="bg-slate-900 border border-slate-800 text-slate-200 font-mono text-xs rounded-2xl p-4 shadow-sm overflow-x-auto max-h-[55vh]">
                  <div className="text-slate-400 mb-3 border-b border-slate-800 pb-2">
                    --- {baselineVersion ? `v${baselineVersion.versionNumber}` : 'Baseline'}{'\n'}
                    +++ v{version.versionNumber} (In Review)
                  </div>
                  {comparison?.diffSegments.map((seg, i) => {
                    if (seg.type === 'added') {
                      return (
                        <div key={i} className="bg-emerald-950/60 text-emerald-300 py-0.5 px-2">
                          + {seg.value}
                        </div>
                      );
                    }
                    if (seg.type === 'removed') {
                      return (
                        <div key={i} className="bg-rose-950/60 text-rose-300 py-0.5 px-2">
                          - {seg.value}
                        </div>
                      );
                    }
                    if (seg.type === 'modified') {
                      return (
                        <div key={i} className="bg-amber-950/50 text-amber-200 py-0.5 px-2">
                          ~ {seg.newValue || seg.value}
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="text-slate-400 py-0.5 px-2">
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
        <div className="bg-slate-900/90 px-6 py-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400">
            Approver: <span className="font-semibold text-slate-200">{currentUser.name}</span> ({currentUser.title})
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto justify-end">
            <button
              id="btn-open-reject-modal"
              onClick={() => setShowRejectModal(true)}
              className="inline-flex items-center space-x-1.5 bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border border-rose-800/80 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors shadow-xs"
            >
              <XCircle className="w-4 h-4" />
              <span>Reject (Request Revisions)</span>
            </button>

            <button
              id="btn-open-approve-confirm"
              onClick={() => setShowApproveConfirm(true)}
              className="inline-flex items-center space-x-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold px-6 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-emerald-600/30 border border-emerald-400/30"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Approve & Auto-Publish</span>
            </button>
          </div>
        </div>
      </div>

      {/* APPROVAL CONFIRMATION MODAL */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel-dark rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-800 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-white">
              Confirm Publication of v{version.versionNumber}?
            </h3>

            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              Approving version <strong className="text-white">v{version.versionNumber}</strong> of{' '}
              <strong className="text-white">"{version.documentTitle}"</strong> will execute the following automated governance actions:
            </p>

            <ul className="mt-3 space-y-1.5 text-xs text-slate-300 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Lock file and make version immutable</span>
              </li>
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  Supersede previous published version (
                  {master?.currentPublishedVersionNumber ? `v${master.currentPublishedVersionNumber}` : 'None'}
                  )
                </span>
              </li>
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {master?.acknowledgementRequired
                    ? 'Broadcast mandatory compliance email to active employees'
                    : 'Publish to portal (No employee email needed as acknowledgement not required)'}
                </span>
              </li>
              <li className="flex items-center space-x-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Write immutable audit logs with SHA-256 hash</span>
              </li>
            </ul>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Optional Approval Governance Notes
              </label>
              <textarea
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                rows={2}
                className="w-full text-xs p-2.5 bg-slate-950 border border-slate-700 text-white rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500 placeholder:text-slate-500"
                placeholder="Compliance review notes..."
              />
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-approve"
                disabled={isApproving}
                onClick={handleApprove}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-600/30 flex items-center space-x-1.5 disabled:opacity-50 border border-emerald-400/30"
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
        <div className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel-dark rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-800 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-xl bg-rose-600/20 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <h3 className="text-lg font-bold text-white">
              Request Revisions for v{version.versionNumber}
            </h3>

            <p className="text-xs text-slate-300 mt-1">
              Per governance requirements, rejection requires specific comments detailing the required changes.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-200 mb-1" htmlFor="input-rejection-comments">
                Mandatory Rejection Comments & Requested Changes <span className="text-rose-400">*</span>
              </label>
              <textarea
                id="input-rejection-comments"
                value={rejectionComments}
                onChange={(e) => {
                  setRejectionComments(e.target.value);
                  setRejectionError('');
                }}
                rows={4}
                className="w-full text-xs p-3 bg-slate-950 border border-slate-700 text-white rounded-xl focus:outline-hidden focus:ring-2 focus:ring-rose-500 placeholder:text-slate-500"
                placeholder="Example: Please clarify the manager approval requirements in Section 2 and update the daily overlap schedule..."
              />
              {rejectionError && (
                <p className="text-xs text-rose-400 font-medium mt-1">{rejectionError}</p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-reject"
                disabled={isRejecting}
                onClick={handleReject}
                className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-rose-600/30 flex items-center space-x-1.5 disabled:opacity-50 border border-rose-400/30"
              >
                {isRejecting ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                <span>Return to Creator (Revision Required)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
