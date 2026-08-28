import React, { useState, useEffect } from 'react';
import {
  X,
  GitBranch,
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { DocumentMaster, DocumentVersion, User, VersionType } from '../types';
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
  const [selectedDocId, setSelectedDocId] = useState<string>(initialDocument?.id || documents[0]?.id || '');
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

    setParsingFile(true);
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="glass-panel-dark rounded-2xl shadow-2xl border border-slate-800 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* HEADER */}
        <div className="bg-slate-900/90 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/30 border border-blue-500/40 flex items-center justify-center shadow-inner">
              <GitBranch className="w-5 h-5 text-blue-400" />
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-950">
          {error && (
            <div className="bg-rose-950/50 border border-rose-800/60 rounded-xl p-3 text-xs text-rose-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TARGET DOCUMENT SELECTOR */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5" htmlFor="select-target-document">
              Select Document Master to Revise <span className="text-rose-400">*</span>
            </label>
            <select
              id="select-target-document"
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
              className="w-full text-sm p-3 bg-slate-900 border border-slate-700 text-white rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium cursor-pointer"
            >
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id} className="bg-slate-900 text-white py-1">
                  {doc.documentId} — {doc.title} (Published: v{doc.currentPublishedVersionNumber || 'None'})
                </option>
              ))}
            </select>
          </div>

          {/* BASELINE & CALCULATED VERSION CARD */}
          {selectedMaster && (
            <div className="glass-panel-dark border border-slate-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Document ID
                </span>
                <div className="font-mono text-sm font-bold text-blue-400 mt-0.5">
                  {selectedMaster.documentId}
                </div>
                <span className="text-slate-400">{selectedMaster.category}</span>
              </div>

              <div>
                <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Current Published Baseline
                </span>
                <div className="font-bold text-sm text-emerald-400 mt-0.5">
                  v{selectedMaster.currentPublishedVersionNumber || '1.0'}
                </div>
                <span className="text-slate-500">Operational Version</span>
              </div>

              <div className="bg-blue-950/70 p-3 rounded-xl border border-blue-800/80">
                <span className="text-blue-300 font-bold uppercase tracking-wider text-[10px]">
                  Calculated New Version
                </span>
                <div className="font-mono text-base font-extrabold text-white mt-0.5 flex items-center space-x-1.5">
                  <span className="text-blue-300">v{calculatedNextVersion}</span>
                  <span className="text-xs font-normal font-sans text-slate-300">({revisionType})</span>
                </div>
              </div>
            </div>
          )}

          {/* REVISION TYPE SELECTOR (Minor vs Major) */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Revision Magnitude <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start space-x-3 ${
                  revisionType === VersionType.MINOR
                    ? 'border-blue-500 bg-blue-950/40 shadow-lg shadow-blue-900/20'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
                }`}
              >
                <input
                  type="radio"
                  name="revisionType"
                  value={VersionType.MINOR}
                  checked={revisionType === VersionType.MINOR}
                  onChange={() => setRevisionType(VersionType.MINOR)}
                  className="mt-1 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <div>
                  <div className="font-bold text-xs text-white">
                    Minor Revision (v{governanceEngine.calculateNextVersionNumber(baselineVersionNumber, VersionType.MINOR)})
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Incremental adjustments, procedural updates, typographical or operational clarifications.
                  </p>
                </div>
              </label>

              <label
                className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-start space-x-3 ${
                  revisionType === VersionType.MAJOR
                    ? 'border-blue-500 bg-blue-950/40 shadow-lg shadow-blue-900/20'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
                }`}
              >
                <input
                  type="radio"
                  name="revisionType"
                  value={VersionType.MAJOR}
                  checked={revisionType === VersionType.MAJOR}
                  onChange={() => setRevisionType(VersionType.MAJOR)}
                  className="mt-1 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <div>
                  <div className="font-bold text-xs text-white">
                    Major Revision (v{governanceEngine.calculateNextVersionNumber(baselineVersionNumber, VersionType.MAJOR)})
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Substantial restructuring, legal mandate changes, compensation or core policy revamps.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* CHANGE SUMMARY */}
          <div>
            <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider" htmlFor="input-change-summary">
                Change Summary / Release Notes <span className="text-rose-400">*</span>
              </label>
              <div className="flex items-center space-x-1.5 text-[11px] text-blue-400 font-semibold">
                <Sparkles className="w-3 h-3" />
                <span>Quick demo fill:</span>
                <button
                  type="button"
                  onClick={() => applyQuickRevisionExample('broadband')}
                  className="underline hover:text-blue-200 ml-1"
                >
                  Add Broadband & Security
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={() => applyQuickRevisionExample('parental')}
                  className="underline hover:text-blue-200"
                >
                  Expand PTO
                </button>
              </div>
            </div>

            <textarea
              id="input-change-summary"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              rows={2}
              placeholder="Detail specifically what was changed from the previous published baseline..."
              className="w-full text-xs p-3 bg-slate-900 border border-slate-700 text-white rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 placeholder:text-slate-500"
              required
            />
          </div>

          {/* REVISED CONTENT EDITOR / UPLOAD */}
          <div className="border border-slate-800 rounded-2xl p-4 bg-slate-900/80">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider">
                Revised Document Content (Loaded from Baseline v{baselineVersionNumber}) <span className="text-rose-400">*</span>
              </label>

              <label className="cursor-pointer inline-flex items-center space-x-1.5 text-xs font-semibold text-blue-300 hover:text-white bg-blue-950/70 border border-blue-800/80 px-3 py-1.5 rounded-xl shadow-xs hover:bg-blue-900/80 transition-colors">
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Upload Revised File</span>
                <input
                  type="file"
                  accept=".txt,.md,.doc,.docx,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {parsingFile && (
              <div className="text-xs text-blue-300 mb-2 font-mono bg-blue-950/60 p-2.5 rounded-xl border border-blue-800/60 flex items-center space-x-2">
                <Clock className="w-3.5 h-3.5 animate-spin text-blue-400" />
                <span>Parsing file and extracting readable document content...</span>
              </div>
            )}

            {fileName && !parsingFile && uploadStatus && (
              <div className="text-xs text-slate-300 mb-2 font-mono bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="truncate max-w-[70%]">Selected File: {fileName}</span>
                <span className="text-[11px] text-emerald-400 font-sans font-semibold flex items-center space-x-1">
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
              className="w-full text-xs font-mono p-3 bg-slate-950 border border-slate-800 text-slate-100 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500 leading-relaxed placeholder:text-slate-600"
              required
            />
          </div>

          {/* BUTTONS */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              id="btn-submit-create-version"
              type="submit"
              disabled={submitting}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-blue-600/30 flex items-center space-x-2 disabled:opacity-50 border border-blue-400/30 transition-all"
            >
              {submitting ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Submit Revision v{calculatedNextVersion} for Review</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
