import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { DocumentMaster, DocumentVersion, User, VersionStatus, VersionType } from '../types';
import { governanceEngine } from '../services/governance';
import { parseUploadedFile, extractTextFromRawPdfStream, isRawPdfStream } from '../utils/fileParser';

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
  const [fileName, setFileName] = useState('');
  const [fileDataUrl, setFileDataUrl] = useState<string>('');
  const [mimeType, setMimeType] = useState<string>('');
  const [parsingFile, setParsingFile] = useState<boolean>(false);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedMaster = documents.find((d) => d.id === selectedDocId);

  // Check if target document has an active version in review
  const inReviewVersion = versions.find(
    (v) => (v.documentMasterId === selectedMaster?.id || v.documentId === selectedMaster?.documentId) && v.status === VersionStatus.IN_REVIEW
  );
  const isInReview = !!inReviewVersion || selectedMaster?.currentStatus === VersionStatus.IN_REVIEW;

  // Baseline version is the currently published version or latest version
  const baselineVersion = selectedMaster?.currentPublishedVersionId
    ? versions.find((v) => v.id === selectedMaster.currentPublishedVersionId)
    : versions.find((v) => v.documentMasterId === selectedMaster?.id);

  const baselineVersionNumber = baselineVersion ? baselineVersion.versionNumber : '1.0';

  // Calculate next version
  const calculatedNextVersion = governanceEngine.calculateNextVersionNumber(
    baselineVersionNumber,
    revisionType
  );

  // When selected document changes, populate rawContent with baseline text
  useEffect(() => {
    if (baselineVersion) {
      const cleanContent = isRawPdfStream(baselineVersion.rawContent)
        ? extractTextFromRawPdfStream(baselineVersion.rawContent)
        : baselineVersion.rawContent;
      setRawContent(cleanContent || '');
      setFileName(`${selectedMaster?.documentId}_revised_v${calculatedNextVersion}.md`);
      setFileDataUrl('');
      setMimeType('text/markdown');
      setUploadStatus('');
    }
  }, [selectedDocId, calculatedNextVersion]);

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
    const isAllowed = lowerName.endsWith(".pdf") || lowerName.endsWith(".docx");
    if (!isAllowed) {
      setError("Invalid file format. Only .pdf and .docx documents are supported.");
      return;
    }

    setParsingFile(true);
    setError("");
    setFileName(file.name);

    try {
      const parsed = await parseUploadedFile(file);
      setRawContent(parsed.extractedText || '');
      setFileDataUrl(parsed.fileDataUrl || '');
      setMimeType(parsed.mimeType || 'text/plain');
      if (parsed.isPdf) {
        setUploadStatus(`PDF document loaded (${(file.size / 1024).toFixed(1)} KB) • Text extracted`);
      } else {
        setUploadStatus(`Document loaded (${(file.size / 1024).toFixed(1)} KB)`);
      }
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
        rawContent,
        fileName: fileName || `${selectedMaster?.documentId}_v${calculatedNextVersion}.txt`,
        changeSummary: changeSummary.trim(),
        effectiveFrom,
        fileDataUrl,
        mimeType: mimeType || (fileName.endsWith('.pdf') ? 'application/pdf' : 'text/markdown'),
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create revision');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
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

                return (
                  <option key={doc.id} value={doc.id} className="bg-white text-slate-900 py-1">
                    {doc.documentId} — {doc.title} {isDocInReview ? `[⚠️ In Review: v${docInReviewVer?.versionNumber || ''} - Blocked]` : `(Published: v${doc.currentPublishedVersionNumber || 'None'})`}
                  </option>
                );
              })}
            </select>
          </div>

          {/* BASELINE & CALCULATED VERSION CARD */}
          {selectedMaster && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  Document ID
                </span>
                <div className="font-mono text-sm font-bold text-slate-900 mt-0.5">
                  {selectedMaster.documentId}
                </div>
                <span className="text-slate-500">{selectedMaster.category}</span>
              </div>

              <div>
                <span className="text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  Current Published Baseline
                </span>
                <div className="font-bold text-sm text-slate-900 mt-0.5">
                  v{selectedMaster.currentPublishedVersionNumber || '1.0'}
                </div>
                <span className="text-slate-500">Operational Version</span>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
                <span className="text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                  Calculated New Version
                </span>
                <div className="font-mono text-base font-extrabold text-slate-900 mt-0.5 flex items-center space-x-1.5">
                  <span className="text-[#FA7014]">v{calculatedNextVersion}</span>
                  <span className="text-xs font-normal font-sans text-slate-500">({revisionType})</span>
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

          {/* REVISED CONTENT EDITOR / UPLOAD */}
          <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider">
                Revised Document Content (Loaded from Baseline v{baselineVersionNumber}) <span className="text-[#FA7014]">*</span>
              </label>

              <label className="cursor-pointer inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-xs hover:bg-slate-50 transition-colors">
                <UploadCloud className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>Upload Revised File</span>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {parsingFile && (
              <div className="text-xs text-slate-700 mb-2 font-mono bg-white p-2.5 rounded-xl border border-slate-200 flex items-center space-x-2">
                <Clock className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                <span>Parsing file and extracting readable document content...</span>
              </div>
            )}

            {fileName && !parsingFile && uploadStatus && (
              <div className="text-xs text-slate-800 mb-2 font-mono bg-white p-2.5 rounded-xl border border-slate-200 flex items-center justify-between">
                <span className="truncate max-w-[70%]">Selected File: {fileName}</span>
                <span className="text-[11px] text-[#FA7014] font-sans font-semibold flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{uploadStatus}</span>
                </span>
              </div>
            )}

            <textarea
              id="textarea-revised-content"
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              rows={10}
              placeholder="Edit or paste revised Markdown / text here..."
              className="w-full text-xs font-mono p-3 bg-white border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] leading-relaxed placeholder:text-slate-400"
              required
            />
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
              disabled={submitting || isInReview}
              className={`text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-md flex items-center space-x-2 transition-all ${
                isInReview
                  ? 'bg-slate-400 opacity-60 cursor-not-allowed shadow-none'
                  : 'bg-[#FA7014] hover:bg-[#E65A05] shadow-[#FA7014]/20'
              }`}
              title={isInReview ? 'Cannot submit revision while a version of this document is still in review' : undefined}
            >
              {submitting ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : isInReview ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>
                {isInReview
                  ? 'Revision Blocked (Document in Review)'
                  : `Submit Revision v${calculatedNextVersion} for Review`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
