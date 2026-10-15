import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  GitBranch,
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Layers,
  ArrowRight,
  Sparkles,
  Calendar,
  MessageSquare,
  Ban,
} from 'lucide-react';
import { DocumentMaster, DocumentVersion, User, VersionStatus, VersionType } from '../types';
import { governanceEngine } from '../services/governance';
import { parseUploadedFile, extractTextFromRawPdfStream, isRawPdfStream } from '../utils/fileParser';
import { stripPolicyMetadataHeader, extractCleanBody, formatDDMMYYYY, DocumentHeaderTable } from '../utils/documentHeaderFooter';
import { WysiwygDocumentEditor } from './WysiwygDocumentEditor';
import { DocumentViewer } from './DocumentViewer';
import { stampPdfWithHeaderFooter, stampDocxWithHeaderFooter } from '../utils/documentStamper';

interface CreateVersionModalProps {
  currentUser: User;
  initialDocument?: DocumentMaster;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  onClose: () => void;
  onSuccess: () => void;
}

export const CreateVersionModal: React.FC<CreateVersionModalProps> = ({
  currentUser,
  initialDocument,
  documents,
  versions,
  onClose,
  onSuccess,
}) => {
  // Prefer selecting an available (not in review) document by default if initialDocument not set
  const defaultDocId = useMemo(() => {
    if (initialDocument?.id) return initialDocument.id;
    const available = documents.find((doc) => {
      const hasInReview = versions.some(
        (v) => (v.documentMasterId === doc.id || v.documentId === doc.documentId) && v.status === VersionStatus.IN_REVIEW
      );
      return !hasInReview && doc.currentStatus !== VersionStatus.IN_REVIEW;
    });
    return available?.id || documents[0]?.id || '';
  }, [initialDocument, documents, versions]);

  const [selectedDocId, setSelectedDocId] = useState<string>(defaultDocId);
  const [revisionType, setRevisionType] = useState<VersionType>(VersionType.MINOR);
  const [changeSummary, setChangeSummary] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fileName, setFileName] = useState('');
  const [fileDataUrl, setFileDataUrl] = useState<string>('');
  const [mimeType, setMimeType] = useState<string>('');
  const [parsingFile, setParsingFile] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [contentTab, setContentTab] = useState<'preview' | 'editor'>('preview');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [reviewDueDate, setReviewDueDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split('T')[0];
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEffectiveFromChange = (newDate: string) => {
    setEffectiveFrom(newDate);
    if (newDate) {
      try {
        const d = new Date(newDate);
        d.setFullYear(d.getFullYear() + 1);
        setReviewDueDate(d.toISOString().split('T')[0]);
      } catch {}
    }
  };

  const selectedMaster = documents.find((d) => d.id === selectedDocId);

  // Check if target document has an active version in review
  const inReviewVersion = versions.find(
    (v) => (v.documentMasterId === selectedMaster?.id || v.documentId === selectedMaster?.documentId) && v.status === VersionStatus.IN_REVIEW
  );
  const isInReview = !!inReviewVersion || selectedMaster?.currentStatus === VersionStatus.IN_REVIEW;

  // Check if target document has a rejected / revision required version
  const rejectedVersion = versions.find(
    (v) => (v.documentMasterId === selectedMaster?.id || v.documentId === selectedMaster?.documentId) && v.status === VersionStatus.REVISION_REQUIRED
  );

  // Check if target document has been permanently rejected (no further revisions permitted)
  const isDocumentPermanentlyRejected =
    selectedMaster?.currentStatus === VersionStatus.REJECTED ||
    (versions.some(
      (v) =>
        (v.documentMasterId === selectedMaster?.id || v.documentId === selectedMaster?.documentId) &&
        v.status === VersionStatus.REJECTED
    ) &&
      !selectedMaster?.currentPublishedVersionId);

  // Baseline version is the currently published version or latest version
  const baselineVersion = selectedMaster?.currentPublishedVersionId
    ? versions.find((v) => v.id === selectedMaster.currentPublishedVersionId)
    : versions.find((v) => v.documentMasterId === selectedMaster?.id);

  const baselineVersionNumber = baselineVersion ? baselineVersion.versionNumber : '1.0';

  const docVersions = useMemo(() => {
    return versions.filter((v) => v.documentMasterId === selectedMaster?.id || v.documentId === selectedMaster?.documentId);
  }, [versions, selectedMaster]);

  // Calculate next version taking all existing versions into account
  const calculatedNextVersion = governanceEngine.calculateNextVersionNumber(
    baselineVersionNumber,
    revisionType,
    docVersions
  );

  const lastLoadedDocIdRef = useRef<string | null>(null);

  // When selected document changes, ensure Document Content / File Upload comes empty
  useEffect(() => {
    if (!selectedDocId) return;

    // Only re-initialize when switching to a different document master
    if (lastLoadedDocIdRef.current === selectedDocId) {
      return;
    }
    lastLoadedDocIdRef.current = selectedDocId;

    // Ensure the Document Content / Upload File section comes completely empty for the new version
    setRawContent('');
    setFileName('');
    setFileDataUrl('');
    setMimeType('');
    setUploadStatus('');

    // Default effective date for this new revision to today's date (or rejected draft's date if future)
    const todayStr = new Date().toISOString().split('T')[0];
    const defaultReviewDate = () => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().split('T')[0];
    };
    if (rejectedVersion?.effectiveFrom && rejectedVersion.effectiveFrom >= todayStr) {
      setEffectiveFrom(rejectedVersion.effectiveFrom);
      setReviewDueDate(rejectedVersion.reviewDueDate || defaultReviewDate());
    } else {
      setEffectiveFrom(todayStr);
      setReviewDueDate(defaultReviewDate());
    }

    if (rejectedVersion?.reviewerComments) {
      setChangeSummary(`Addressed reviewer feedback on v${rejectedVersion.versionNumber}: ${rejectedVersion.reviewerComments.slice(0, 100)}`);
    } else {
      setChangeSummary('');
    }
  }, [selectedDocId, rejectedVersion]);

  const handleClearContent = () => {
    setRawContent('');
    setFileName('');
    setFileDataUrl('');
    setMimeType('');
    setUploadStatus('');
  };

  // Quick Revision Mutator for demo testing
  const applyQuickRevisionExample = (kind: 'broadband' | 'parental' | 'remoteDays') => {
    if (!rawContent) return;

    if (kind === 'broadband') {
      setChangeSummary('Added $75/mo hybrid remote broadband reimbursement stipend & MFA security requirements.');
      const updated = rawContent + '\n\n## 5. Expense Reimbursement\nA monthly remote broadband stipend of $75.00 will be provided to authorized hybrid employees upon quarterly expense verification.\n\n## 6. Cybersecurity & CrowdStrike\nAll home workstations must run CrowdStrike endpoint agents.';
      setRawContent(updated);
    } else if (kind === 'parental') {
      setChangeSummary('Expanded Parental Leave to 16 fully paid weeks and increased annual PTO to 22 days.');
      const updated = rawContent
        .replace('18 days of paid vacation', '22 days of paid vacation')
        .replace('10 paid sick days', '12 paid sick and wellness days') +
        '\n\n## 5. Parental Leave Expansion\nEligible new parents receive 16 weeks of fully paid bonding leave.';
      setRawContent(updated);
    } else {
      setChangeSummary('Updated eligibility from 90 days to 60 days and clarified Department Head approval.');
      const updated = rawContent
        .replace('90-day probationary period', '60-day onboarding period with Department Head written approval');
      setRawContent(updated);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isAllowed =
      lowerName.endsWith(".docx") ||
      lowerName.endsWith(".doc") ||
      file.type.startsWith("video/") ||
      Boolean(lowerName.match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/));
    if (!isAllowed) {
      setError("Invalid file format. Supported upload formats: Word (.docx) and Video (.mp4, .webm, .mov, etc.).");
      return;
    }

    setParsingFile(true);
    setError("");
    setFileName(file.name);
    const docTitle = selectedMaster?.title || file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");

    try {
      const parsed = await parseUploadedFile(file);
      setRawContent(parsed.extractedText || '');
      let effectiveUrl = parsed.fileDataUrl || '';
      const effectiveMime =
        parsed.mimeType ||
        (lowerName.endsWith('.pdf')
          ? 'application/pdf'
          : lowerName.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'text/plain');
      setMimeType(effectiveMime);

      const isPdfFile = parsed.isPdf || lowerName.endsWith('.pdf');
      const isDocxFile = lowerName.endsWith('.docx') || effectiveMime.includes('wordprocessingml');

      // Pre-stamp PDF / DOCX with revision corporate Header & Footer while keeping 100% of original pages, layout, and structure intact
      if (isPdfFile && effectiveUrl) {
        try {
          const stamped = await stampPdfWithHeaderFooter(effectiveUrl, {
            documentTitle: docTitle,
            versionNumber: calculatedNextVersion || '1.1',
            effectiveDate: effectiveFrom || new Date().toISOString().split('T')[0],
            reReviewDate: reviewDueDate,
            creationDate: formatDDMMYYYY(selectedMaster?.createdAt, formatDDMMYYYY(new Date())),
            createdByName: currentUser.name,
            approvedByName: 'Not yet approved',
            approvedDate: 'Not yet approved',
            companyName: selectedMaster?.companyName || currentUser.companyName || 'Amaavigo',
          });
          effectiveUrl = stamped.dataUrl;
          setUploadStatus(`Revision PDF ready (${(file.size / 1024).toFixed(1)} KB) • Multi-page structure intact • Header & footer applied`);
        } catch (stampErr) {
          console.warn('Revision PDF stamping note:', stampErr);
          setUploadStatus(`Revision PDF loaded (${(file.size / 1024).toFixed(1)} KB) • Structure intact`);
        }
      } else if (isDocxFile && effectiveUrl) {
        try {
          const stamped = await stampDocxWithHeaderFooter(effectiveUrl, {
            documentTitle: docTitle,
            versionNumber: calculatedNextVersion || '1.1',
            effectiveDate: effectiveFrom || new Date().toISOString().split('T')[0],
            reReviewDate: reviewDueDate,
            creationDate: formatDDMMYYYY(selectedMaster?.createdAt, formatDDMMYYYY(new Date())),
            createdByName: currentUser.name,
            approvedByName: 'Not yet approved',
            approvedDate: 'Not yet approved',
            companyName: selectedMaster?.companyName || currentUser.companyName || 'Amaavigo',
          });
          effectiveUrl = stamped.dataUrl;
          setUploadStatus(`Revision Word (.docx) ready (${(file.size / 1024).toFixed(1)} KB) • Layout intact • Header & footer applied`);
        } catch (stampErr) {
          console.warn('Revision DOCX stamping note:', stampErr);
          setUploadStatus(`Revision Word document loaded (${(file.size / 1024).toFixed(1)} KB) • Structure intact`);
        }
      } else if (parsed.isVideo) {
        setUploadStatus(`Video media loaded (${(file.size / (1024 * 1024)).toFixed(1)} MB) • Media intact`);
      } else {
        setUploadStatus(`Document loaded (${(file.size / 1024).toFixed(1)} KB)`);
      }

      setFileDataUrl(effectiveUrl);
      setContentTab('preview');
    } catch (err: any) {
      console.error('File parse error in revision:', err);
      setError('Could not parse file format. You can manually edit the content below.');
    } finally {
      setParsingFile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocId) {
      setError('Please select a target Document Master.');
      return;
    }
    if (isInReview) {
      setError(`Cannot create revision: Document [${selectedMaster?.documentId}] currently has version v${inReviewVersion?.versionNumber || ''} in review. Please wait for the reviewer's approval or revision request.`);
      return;
    }
    if (!changeSummary.trim()) {
      setError('Please provide a brief change summary of what was revised.');
      return;
    }
    if (!effectiveFrom || !effectiveFrom.trim()) {
      setError('Effective Date for Revision is mandatory.');
      return;
    }
    if (!reviewDueDate || !reviewDueDate.trim()) {
      setError('Re-review date is mandatory. Please select a re-review date.');
      return;
    }
    if (!rawContent.trim()) {
      setError('Document content is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await governanceEngine.createNewVersion(currentUser, {
        documentMasterId: selectedDocId,
        revisionType,
        rawContent: extractCleanBody(rawContent),
        fileName:
          fileName ||
          `${selectedMaster?.documentId}_v${calculatedNextVersion}.${
            mimeType?.startsWith('video/') || fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)
              ? 'mp4'
              : 'pdf'
          }`,
        changeSummary: changeSummary.trim(),
        effectiveFrom: effectiveFrom || new Date().toISOString().split('T')[0],
        reviewDueDate: reviewDueDate || new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
        fileDataUrl,
        mimeType:
          mimeType ||
          (fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)
            ? 'video/mp4'
            : fileName?.endsWith('.pdf')
            ? 'application/pdf'
            : /<[a-z][\s\S]*>/i.test(rawContent)
            ? 'text/html'
            : 'text/markdown'),
        previousVersionId: rejectedVersion?.id || selectedMaster?.currentPublishedVersionId || docVersions[0]?.id,
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create revision');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* HEADER */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/20 border border-[#FA7014]/40 flex items-center justify-center shadow-inner">
              <GitBranch className="w-5 h-5 text-[#FA7014]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Create New Document Version</h2>
              <p className="text-xs text-slate-400">
                Author a new revision against the operational published baseline without modifying old versions
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* FORM */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 bg-white">
          {error && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-xs text-orange-950 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-[#FA7014] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* IN-REVIEW WARNING BANNER */}
          {isInReview && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-xs text-amber-950 flex items-start space-x-3 shadow-xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-900 text-sm">
                  Revision Blocked: Document is Currently in Review
                </div>
                <p className="text-amber-800 mt-1 leading-relaxed">
                  <strong>{selectedMaster?.documentId} ({selectedMaster?.title})</strong> currently has version{' '}
                  <span className="font-mono font-bold text-amber-950 bg-amber-200/80 px-1.5 py-0.5 rounded">
                    v{inReviewVersion?.versionNumber || selectedMaster?.currentPublishedVersionNumber || 'under review'}
                  </span>{' '}
                  pending approval by the Document Reviewer / Approver. Under governance rules, you cannot author a new revision until the pending review is completed.
                </p>
              </div>
            </div>
          )}

          {/* PERMANENTLY REJECTED WARNING BANNER */}
          {isDocumentPermanentlyRejected && !isInReview && (
            <div className="bg-rose-50 border border-rose-300 rounded-xl p-4 text-xs text-rose-950 flex items-start space-x-3 shadow-xs">
              <Ban className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-900 text-sm">
                  Revision Blocked: Document Permanently Rejected
                </div>
                <p className="text-rose-800 mt-1 leading-relaxed">
                  <strong>{selectedMaster?.documentId} ({selectedMaster?.title})</strong> has been formally rejected by the Approver. Under governance protocols, <strong>no further revisions can be created or submitted for this rejected document</strong>.
                </p>
              </div>
            </div>
          )}

          {/* TARGET DOCUMENT SELECTOR */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="select-target-document">
              Select Document Master to Revise <span className="text-[#FA7014]">*</span>
            </label>
            <select
              id="select-target-document"
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
              className="w-full text-sm p-3 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] font-medium cursor-pointer"
            >
              {documents.map((doc) => {
                const docInReviewVer = versions.find(
                  (v) => (v.documentMasterId === doc.id || v.documentId === doc.documentId) && v.status === VersionStatus.IN_REVIEW
                );
                const isDocInReview = !!docInReviewVer || doc.currentStatus === VersionStatus.IN_REVIEW;
                const docNeedsRevision = versions.find(
                  (v) => (v.documentMasterId === doc.id || v.documentId === doc.documentId) && v.status === VersionStatus.REVISION_REQUIRED
                );
                const isDocRejected =
                  doc.currentStatus === VersionStatus.REJECTED ||
                  versions.some(
                    (v) => (v.documentMasterId === doc.id || v.documentId === doc.documentId) && v.status === VersionStatus.REJECTED
                  );

                return (
                  <option key={doc.id} value={doc.id} className="bg-white text-slate-900 py-1">
                    {doc.documentId} — {doc.title}{' '}
                    {isDocInReview
                      ? `[⚠️ In Review: v${docInReviewVer?.versionNumber || ''} - Blocked]`
                      : isDocRejected
                      ? `[❌ Rejected - No Revisions Allowed]`
                      : docNeedsRevision
                      ? `[⚠️ Revision Requested on v${docNeedsRevision.versionNumber}]`
                      : `(Published: v${doc.currentPublishedVersionNumber || 'None'})`}
                  </option>
                );
              })}
            </select>
          </div>

          {/* REVISION REQUESTED / REVIEWER FEEDBACK BANNER */}
          {rejectedVersion && !isInReview && (
            <div className="bg-[#FA7014]/5 border-l-4 border-l-[#FA7014] border-slate-200 rounded-2xl p-4 text-xs shadow-xs space-y-2">
              <div className="flex items-center space-x-2 text-slate-900 font-bold">
                <AlertTriangle className="w-4 h-4 text-[#FA7014]" />
                <span>Addressing Reviewer Feedback on v{rejectedVersion.versionNumber}</span>
              </div>
              {rejectedVersion.reviewerComments && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 text-slate-800 flex items-start space-x-2">
                  <span className="font-semibold text-slate-900 shrink-0">Reviewer Note:</span>
                  <span className="italic">"{rejectedVersion.reviewerComments}"</span>
                </div>
              )}

              {rejectedVersion.inlineComments && rejectedVersion.inlineComments.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-xs flex items-center space-x-1.5">
                      <MessageSquare className="w-4 h-4 text-[#FA7014]" />
                      <span>Approver's Text Selection Comments ({rejectedVersion.inlineComments.length}):</span>
                    </span>
                    <span className="text-[10px] text-[#FA7014] bg-orange-50 border border-orange-200 font-bold px-2 py-0.5 rounded-md">
                      Changes Required
                    </span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {rejectedVersion.inlineComments.map((c, ci) => (
                      <div key={c.id || ci} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 text-xs flex items-start space-x-2.5">
                        <span className="bg-[#FA7014] text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                          #{ci + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-500 font-serif italic text-[11px] line-clamp-2">
                            "{c.selectedText}"
                          </div>
                          <div className="text-slate-900 font-bold mt-0.5">
                            {c.comment}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-1">
                            By {c.createdByName || 'Approver'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-500">
                The content below is pre-loaded with your draft. Revise the text or upload an updated Word document to address the feedback, and submit v{calculatedNextVersion} for approval.
              </p>
            </div>
          )}

          {/* EFFECTIVE DATE (TAKEN & ADDED FIRST FOR REVISION AS REQUESTED) */}
          <div className="bg-orange-50/40 border-2 border-orange-200/90 rounded-2xl p-4 space-y-3 shadow-xs">
            <div>
              <div className="flex items-center space-x-2">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-1.5" htmlFor="input-revision-effective-date">
                  <Calendar className="w-4 h-4 text-[#FA7014]" />
                  <span>Effective Date for Revision</span>
                  <span className="text-[#FA7014] font-black">*</span>
                </label>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Specify when this revision becomes effective. This will be stamped into the official document header.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center pt-1">
              <div className="sm:col-span-6">
                <input
                  id="input-revision-effective-date"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => handleEffectiveFromChange(e.target.value)}
                  className="w-full text-sm font-semibold p-2.5 bg-white border border-slate-300 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] shadow-xs cursor-pointer"
                  required
                />
              </div>

              {/* Quick presets */}
              <div className="sm:col-span-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleEffectiveFromChange(new Date().toISOString().split('T')[0])}
                  className="text-[11px] font-semibold px-2.5 py-1.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 7);
                    handleEffectiveFromChange(d.toISOString().split('T')[0]);
                  }}
                  className="text-[11px] font-semibold px-2.5 py-1.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
                >
                  +7 Days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setMonth(d.getMonth() + 1, 1);
                    handleEffectiveFromChange(d.toISOString().split('T')[0]);
                  }}
                  className="text-[11px] font-semibold px-2.5 py-1.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] border border-slate-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
                >
                  1st Next Month
                </button>
              </div>
            </div>

            {/* RE-REVIEW DATE (JUST BELOW EFFECTIVE FROM DATE) */}
            <div className="pt-3 border-t border-orange-200/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-1.5" htmlFor="input-revision-rereview-date">
                  <Calendar className="w-4 h-4 text-[#FA7014]" />
                  <span>Re-review Date</span>
                  <span className="text-[#FA7014] font-black">*</span>
                </label>
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const base = effectiveFrom ? new Date(effectiveFrom) : new Date();
                      base.setMonth(base.getMonth() + 6);
                      setReviewDueDate(base.toISOString().split('T')[0]);
                    }}
                    className="text-[10px] font-semibold px-2 py-0.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] border border-slate-200 rounded-md transition-colors cursor-pointer shadow-2xs"
                  >
                    +6 Months
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const base = effectiveFrom ? new Date(effectiveFrom) : new Date();
                      base.setFullYear(base.getFullYear() + 1);
                      setReviewDueDate(base.toISOString().split('T')[0]);
                    }}
                    className="text-[10px] font-semibold px-2 py-0.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] border border-slate-200 rounded-md transition-colors cursor-pointer shadow-2xs"
                  >
                    +1 Year (Annual)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const base = effectiveFrom ? new Date(effectiveFrom) : new Date();
                      base.setFullYear(base.getFullYear() + 2);
                      setReviewDueDate(base.toISOString().split('T')[0]);
                    }}
                    className="text-[10px] font-semibold px-2 py-0.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] border border-slate-200 rounded-md transition-colors cursor-pointer shadow-2xs"
                  >
                    +2 Years
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mb-2 ml-0 sm:ml-5.5">
                Specify the date by which this revised policy must undergo mandatory compliance re-review.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-6">
                  <input
                    id="input-revision-rereview-date"
                    type="date"
                    value={reviewDueDate}
                    onChange={(e) => setReviewDueDate(e.target.value)}
                    className="w-full text-sm font-semibold p-2.5 bg-white border border-slate-300 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] shadow-xs cursor-pointer"
                    required
                  />
                </div>
                <div className="sm:col-span-6">
                  <span className="text-[11px] text-slate-500">
                    Recommended: 1 year from effective date for corporate policies, or 6 months for dynamic operating guidelines.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BASELINE & CALCULATED VERSION CARD */}
          {selectedMaster && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  Document ID & Category
                </span>
                <div className="font-mono text-sm font-bold text-slate-900 mt-0.5">
                  {selectedMaster.documentId}
                </div>
                <span className="text-slate-500">{selectedMaster.category}</span>
              </div>

              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  {rejectedVersion ? 'Predecessor Draft' : 'Baseline Version'}
                </span>
                <div className="font-bold text-sm text-slate-900 mt-0.5">
                  {rejectedVersion
                    ? `v${rejectedVersion.versionNumber} (Revision Required)`
                    : `v${selectedMaster.currentPublishedVersionNumber || '1.0'}`}
                </div>
                <span className="text-slate-500">
                  {baselineVersion?.effectiveFrom ? `Effective: ${formatDDMMYYYY(baselineVersion.effectiveFrom)}` : 'Operational Baseline'}
                </span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                  New Revision Target
                </span>
                <div className="font-mono text-base font-extrabold text-slate-900 mt-0.5 flex items-center space-x-1.5">
                  <span className="text-[#FA7014]">v{calculatedNextVersion}</span>
                  <span className="text-xs font-normal font-sans text-slate-500">({revisionType})</span>
                </div>
                <div className="text-[11px] text-[#FA7014] font-semibold mt-0.5">
                  Effective: {formatDDMMYYYY(effectiveFrom)}
                </div>
              </div>
            </div>
          )}

          {/* REVISION TYPE SELECTOR (Minor vs Major) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Revision Magnitude <span className="text-[#FA7014]">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start space-x-3 ${
                  revisionType === VersionType.MINOR
                    ? 'border-[#FA7014] bg-orange-50/40 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="revisionType"
                  value={VersionType.MINOR}
                  checked={revisionType === VersionType.MINOR}
                  onChange={() => setRevisionType(VersionType.MINOR)}
                  className="mt-1 text-[#FA7014] focus:ring-[#FA7014] cursor-pointer"
                />
                <div>
                  <div className="font-bold text-xs text-slate-900">
                    Minor Revision (v{governanceEngine.calculateNextVersionNumber(baselineVersionNumber, VersionType.MINOR)})
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Incremental adjustments, procedural updates, typographical or operational clarifications.
                  </p>
                </div>
              </label>

              <label
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start space-x-3 ${
                  revisionType === VersionType.MAJOR
                    ? 'border-[#FA7014] bg-orange-50/40 shadow-xs'
                    : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="revisionType"
                  value={VersionType.MAJOR}
                  checked={revisionType === VersionType.MAJOR}
                  onChange={() => setRevisionType(VersionType.MAJOR)}
                  className="mt-1 text-[#FA7014] focus:ring-[#FA7014] cursor-pointer"
                />
                <div>
                  <div className="font-bold text-xs text-slate-900">
                    Major Revision (v{governanceEngine.calculateNextVersionNumber(baselineVersionNumber, VersionType.MAJOR)})
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Substantial restructuring, legal mandate changes, compensation or core policy revamps.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* CHANGE SUMMARY */}
          <div>
            <div className="mb-1.5">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider" htmlFor="input-change-summary">
                Change Summary / Release Notes <span className="text-[#FA7014]">*</span>
              </label>
            </div>

            <textarea
              id="input-change-summary"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              rows={2}
              placeholder="Detail specifically what was changed from the previous published baseline..."
              className="w-full text-xs p-3 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
              required
            />
          </div>

          {/* UPDATED DOCUMENT HEADER & FOOTER PREVIEW FOR REVISION */}
          {selectedMaster && (
            <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-[#FA7014]" />
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Updated Document Header for v{calculatedNextVersion}
                  </span>
                </div>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  Auto-Updated
                </span>
              </div>

              {/* Dynamic Header Table */}
              {mimeType?.startsWith('video/') || fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/) ? (
                <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start space-x-2.5">
                  <Sparkles className="w-4 h-4 text-[#FA7014] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-slate-900">Video Asset Version Governance</span>
                    <p className="text-slate-600 text-[11px] mt-0.5">
                      This video revision will progress through the standard multi-level review and approval workflow. In accordance with media governance rules, headers and footers are omitted from video files.
                    </p>
                  </div>
                </div>
              ) : (
                <DocumentHeaderTable
                  data={{
                    companyName: selectedMaster.companyName || 'Amaavigo',
                    documentTitle: selectedMaster.title,
                    versionNumber: calculatedNextVersion,
                    effectiveDate: formatDDMMYYYY(effectiveFrom),
                    reReviewDate: formatDDMMYYYY(reviewDueDate, ''),
                    creationDate: formatDDMMYYYY(selectedMaster.createdAt, formatDDMMYYYY(new Date())),
                    createdByName: currentUser.name,
                    approvedByName: 'Pending Review',
                    approvedDate: 'Pending Approval',
                  }}
                  className="!my-0 scale-95 sm:scale-100 origin-top"
                />
              )}

              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  Effective Date: <strong className="text-slate-800 font-mono">{formatDDMMYYYY(effectiveFrom)}</strong>
                </span>
                <span className="text-[10px] font-medium text-slate-400">
                  Version Creator: {currentUser.name}
                </span>
              </div>
            </div>
          )}

          {/* REVISED CONTENT EDITOR / UPLOAD */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider" htmlFor="textarea-revised-content">
                Document Content / File (Word DOCX, Video) <span className="text-[#FA7014]">*</span>
              </label>

              <div className="flex items-center space-x-2">
                {(rawContent || fileName) && (
                  <button
                    type="button"
                    onClick={handleClearContent}
                    className="inline-flex items-center space-x-1 text-xs font-medium text-slate-500 hover:text-rose-600 bg-white border border-slate-200 px-2.5 py-1.5 rounded-xl shadow-2xs hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Clear content and uploaded file"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}

                <label className="cursor-pointer inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-xs hover:bg-slate-50 transition-colors">
                  <UploadCloud className="w-3.5 h-3.5 text-[#FA7014]" />
                  <span>Upload File</span>
                  <input
                    type="file"
                    accept=".docx,.doc,video/*,.mp4,.webm,.mov,.m4v,.mkv,.avi"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {parsingFile && (
              <div className="text-xs text-slate-700 font-mono bg-white p-3 rounded-xl border border-slate-200 flex items-center space-x-2 shadow-xs">
                <Clock className="w-4 h-4 animate-spin text-[#FA7014]" />
                <span>Parsing file, applying corporate header/footer, and preparing intact multi-page preview...</span>
              </div>
            )}

            {fileName && !parsingFile && (
              <div className="space-y-3">
                <div className="text-xs text-slate-800 font-mono bg-white p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 shadow-xs">
                  <div className="flex items-center space-x-2 truncate max-w-[75%]">
                    <FileText className="w-4 h-4 text-[#FA7014] shrink-0" />
                    <span className="font-bold text-slate-900 truncate">{fileName}</span>
                  </div>
                  <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 font-sans font-bold flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{uploadStatus || 'Multi-Page Structure Intact'}</span>
                  </span>
                </div>

                {/* Content Header */}
                <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
                  <div className="text-xs font-bold px-3.5 py-1.5 rounded-xl bg-slate-900 text-white shadow-xs flex items-center space-x-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#FA7014]" />
                    <span>Intact Revision Preview (Header & Footer Applied)</span>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-900/5 p-2">
                  <DocumentViewer
                    fileName={fileName}
                    rawContent={rawContent}
                    fileUrl={fileDataUrl}
                    mimeType={mimeType}
                    headerFooterData={{
                      documentTitle: selectedMaster?.title || fileName.replace(/\.[^/.]+$/, ''),
                      versionNumber: calculatedNextVersion || '1.1',
                      effectiveDate: effectiveFrom || new Date().toISOString().split('T')[0],
                      reReviewDate: reviewDueDate,
                      creationDate: formatDDMMYYYY(selectedMaster?.createdAt, formatDDMMYYYY(new Date())),
                      createdByName: currentUser.name,
                      approvedByName: 'Not yet approved',
                      approvedDate: 'Not yet approved',
                      companyName: selectedMaster?.companyName || currentUser.companyName || 'Amaavigo',
                    }}
                  />
                </div>
              </div>
            )}

            {!fileName && !parsingFile && (
              <WysiwygDocumentEditor
                id="textarea-revised-content"
                value={rawContent}
                onChange={setRawContent}
                placeholder="Upload a PDF / DOCX file above, or type, paste, and format new revision text directly here like in Microsoft Word..."
                minHeight="280px"
                required
              />
            )}
          </div>

          {/* BUTTONS */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
            >
              Cancel
            </button>
            <button
              id="btn-submit-create-version"
              type="submit"
              disabled={submitting || isInReview || isDocumentPermanentlyRejected}
              className={`text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md flex items-center space-x-2 transition-all ${
                isInReview || isDocumentPermanentlyRejected
                  ? 'bg-slate-400 opacity-60 cursor-not-allowed shadow-none'
                  : 'bg-[#FA7014] hover:bg-[#E65A05] shadow-[#FA7014]/20'
              }`}
              title={
                isInReview
                  ? 'Cannot submit revision while a version of this document is still in review'
                  : isDocumentPermanentlyRejected
                  ? 'Document has been permanently rejected. No further revisions permitted.'
                  : undefined
              }
            >
              {submitting ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : isInReview ? (
                <AlertTriangle className="w-4 h-4" />
              ) : isDocumentPermanentlyRejected ? (
                <Ban className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>
                {isInReview
                  ? 'Revision Blocked (Document in Review)'
                  : isDocumentPermanentlyRejected
                  ? 'Revision Blocked (Document Permanently Rejected)'
                  : `Submit Revision v${calculatedNextVersion} for Review`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
