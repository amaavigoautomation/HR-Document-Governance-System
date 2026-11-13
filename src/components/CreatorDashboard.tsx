import React, { useState, useMemo } from 'react';
import {
  Plus,
  FilePlus,
  Search,
  Filter,
  FileText,
  Clock,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Eye,
  History,
  Building2,
  ChevronRight,
  Shield,
  Layers,
  ArrowUpRight,
  MessageSquare,
  Users,
  Trash2,
  RotateCcw,
  Ban,
  Tag,
  SlidersHorizontal,
  Folder,
  CalendarDays,
} from 'lucide-react';
import { ConfidentialityLevel, DocumentCategory, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { Chip, KpiCard, KpiGrid, tbl } from './common/pageChrome';
import { governanceEngine } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';
import { formatDDMMYYYY } from '../utils/documentHeaderFooter';

interface CreatorDashboardProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  onOpenCreateDocument: () => void;
  onOpenCreateVersion: (doc?: DocumentMaster) => void;
  onOpenDocumentDetail: (doc: DocumentMaster) => void;
  onOpenComparison: (versionId: string) => void;
  onOpenComplianceTracker?: () => void;
  onDeleteDocument?: (docId: string) => void;
  onClearAllDocuments?: () => void;
  onRestoreSeedDocuments?: () => void;
}

export const CreatorDashboard: React.FC<CreatorDashboardProps> = ({
  currentUser,
  documents,
  versions,
  onOpenCreateDocument,
  onOpenCreateVersion,
  onOpenDocumentDetail,
  onOpenComparison,
  onOpenComplianceTracker,
  onDeleteDocument,
  onClearAllDocuments,
  onRestoreSeedDocuments,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);

  const acks = governanceEngine.getAcknowledgements();
  const pendingAcks = acks.filter((a) => a.status === 'PENDING').length;
  const totalAcks = acks.length;
  const compliantPercent = totalAcks > 0 ? Math.round(((totalAcks - pendingAcks) / totalAcks) * 100) : 100;

  // Compute Metrics
  const totalDocs = documents.length;
  const publishedDocs = documents.filter((d) => d.currentStatus === VersionStatus.PUBLISHED).length;
  const inReviewVersions = versions.filter((v) => v.status === VersionStatus.IN_REVIEW);

  // Active revision requests awaiting creator action (filters out requests where next version is already authored/submitted)
  const revisionRequiredVersions = useMemo(() => {
    return versions.filter((v) => {
      if (v.status !== VersionStatus.REVISION_REQUIRED) return false;
      const vTime = new Date(v.createdAt).getTime();
      const relatedVersions = versions.filter(
        (rv) => (rv.documentMasterId === v.documentMasterId || rv.documentId === v.documentId) && rv.id !== v.id
      );
      // A revision request is addressed ONLY if a SUBSEQUENT version was authored after this revision was requested
      const isAlreadyAddressed = relatedVersions.some((rv) => {
        const rvTime = new Date(rv.createdAt).getTime();
        if (rvTime > vTime) {
          return (
            rv.status === VersionStatus.IN_REVIEW ||
            rv.status === VersionStatus.PUBLISHED ||
            rv.status === VersionStatus.SUPERSEDED
          );
        }
        return false;
      });
      return !isAlreadyAddressed;
    });
  }, [versions, documents]);

  const supersededVersions = versions.filter((v) => v.status === VersionStatus.SUPERSEDED);

  // Filter and Sort Documents:
  // Newly created document entries or documents with newly created versions ALWAYS COME ABOVE (at the top of the directory)
  const filteredDocs = useMemo(() => {
    return documents
      .filter((doc) => {
        const matchesSearch =
          doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          doc.documentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
          doc.departmentName.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesCategory = selectedCategory === 'ALL' || doc.category === selectedCategory;
        const matchesStatus = selectedStatus === 'ALL' || doc.currentStatus === selectedStatus;

        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((a, b) => {
        // Calculate latest activity timestamp for document a
        const aVersions = versions.filter(
          (v) => v.documentMasterId === a.id || v.documentId === a.documentId
        );
        const aVersionTimes = aVersions.map((v) => new Date(v.createdAt).getTime()).filter((t) => !isNaN(t));
        const aDocUpdate = new Date(a.updatedAt || a.createdAt).getTime();
        const aDocCreate = new Date(a.createdAt).getTime();
        const aLatest = Math.max(aDocUpdate || 0, aDocCreate || 0, ...aVersionTimes);

        // Calculate latest activity timestamp for document b
        const bVersions = versions.filter(
          (v) => v.documentMasterId === b.id || v.documentId === b.documentId
        );
        const bVersionTimes = bVersions.map((v) => new Date(v.createdAt).getTime()).filter((t) => !isNaN(t));
        const bDocUpdate = new Date(b.updatedAt || b.createdAt).getTime();
        const bDocCreate = new Date(b.createdAt).getTime();
        const bLatest = Math.max(bDocUpdate || 0, bDocCreate || 0, ...bVersionTimes);

        return bLatest - aLatest;
      });
  }, [documents, versions, searchTerm, selectedCategory, selectedStatus]);

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="relative overflow-hidden bg-gradient-to-r from-white via-white to-violet-50 rounded-2xl p-6 border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="relative z-10 min-w-0 max-w-2xl">
          <div className="flex items-center flex-wrap gap-3">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">HR Creator Studio</h1>
            <span className="bg-violet-100 text-violet-700 text-xs px-3 py-1 rounded-full font-bold">Authoring &amp; Versioning</span>
          </div>
          <p className="text-sm text-slate-600 mt-2">
            Logged in as <span className="font-bold text-slate-900">{currentUser.name}</span> ({currentUser.title}) • Maintain permanent Document Masters and draft controlled version releases.
          </p>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-3 lg:ml-auto">
          <svg aria-hidden="true" viewBox="0 0 150 120" className="hidden xl:block w-36 h-28 shrink-0">
            <g transform="rotate(-8 60 60)">
              <rect x="20" y="14" width="78" height="96" rx="9" fill="#ede9fe" stroke="#ddd6fe" />
              <rect x="30" y="26" width="58" height="9" rx="4" fill="#c4b5fd" opacity=".7" />
              <rect x="30" y="44" width="58" height="5" rx="2.5" fill="#c4b5fd" opacity=".55" />
              <rect x="30" y="56" width="46" height="5" rx="2.5" fill="#c4b5fd" opacity=".55" />
              <rect x="30" y="68" width="52" height="5" rx="2.5" fill="#c4b5fd" opacity=".55" />
            </g>
            <circle cx="104" cy="82" r="22" fill="#6d4cf0" />
            <path d="M94 82a10 10 0 1 0 3-7.2M94 70v6h6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <button
            id="btn-open-create-version"
            onClick={() => onOpenCreateVersion()}
            className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-900 font-bold px-5 py-3 rounded-xl text-sm transition-all border border-slate-300 cursor-pointer"
          >
            <GitBranch className="w-4 h-4" />
            <span>Create New Version</span>
          </button>
          <button
            id="btn-open-create-document"
            onClick={onOpenCreateDocument}
            className="inline-flex items-center gap-2 bg-[#6d4cf0] hover:bg-[#5b3be0] text-white font-bold px-5 py-3 rounded-xl text-sm transition-all shadow-md shadow-violet-500/30 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Document Master</span>
          </button>
        </div>
      </div>

      {/* Number cards */}
      <KpiGrid cols={5}>
        <KpiCard tone="violet" icon={Layers} label="Total Masters" value={totalDocs} hint="Permanent document records" />
        <KpiCard tone="green" icon={CheckCircle2} label="Published (Live)" value={publishedDocs} hint="Active versions (in use)" />
        <KpiCard tone="blue" icon={Eye} label="In Review" value={inReviewVersions.length} hint="Waiting for review & approval" />
        <KpiCard tone="amber" icon={AlertTriangle} label="Revision Required" value={revisionRequiredVersions.length} hint="Needs changes before publishing" />
        <KpiCard tone="rose" icon={RotateCcw} label="Superseded" value={supersededVersions.length} hint="Previous versions (not in use)" />
      </KpiGrid>

      {/* REVISION REQUIRED CALLOUT BANNER IF ANY EXIST */}
      {revisionRequiredVersions.length > 0 && (
        <div id="banner-revision-required" className="bg-white border-l-4 border-l-orange-400 border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 w-full">
              <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0 mt-0.5 text-orange-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h2 className="text-base font-bold text-slate-900">
                  Action Required: Reviewer Requested Revisions ({revisionRequiredVersions.length})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  The reviewer returned the following drafts for clarification. Original published copies remain operational until a new version is approved.
                </p>

                <div className="mt-3.5 space-y-2.5">
                  {revisionRequiredVersions.map((rev) => {
                    const parentMaster = documents.find((d) => d.id === rev.documentMasterId);
                    return (
                      <div
                        key={rev.id}
                        className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                              {rev.documentId}
                            </span>
                            <span className="font-semibold text-sm text-slate-900">{rev.documentTitle}</span>
                            <span className="text-xs bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-lg">
                              v{rev.versionNumber} Revision Requested
                            </span>
                          </div>
                          {rev.reviewerComments && (
                            <div className="mt-2 text-xs text-slate-700 flex items-start space-x-2 bg-white p-2.5 rounded-lg border border-slate-200">
                              <MessageSquare className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-slate-900">
                                  Reviewer {rev.reviewedByName ? `(${rev.reviewedByName})` : ''} Comment:
                                </span>{' '}
                                "{rev.reviewerComments}"
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          id={`btn-revise-${rev.id}`}
                          onClick={() => onOpenCreateVersion(parentMaster)}
                          className="bg-[#6d4cf0] hover:bg-[#5b3be0] text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all flex items-center space-x-1.5 shrink-0 shadow-sm"
                        >
                          <GitBranch className="w-3.5 h-3.5" />
                          <span>Author Next Version</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FILTER & SEARCH BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)] flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="search-documents-creator"
            type="text"
            placeholder="Search by Document ID, Title, Category, Department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-11 pl-10 pr-4 bg-white border border-slate-300 rounded-xl text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#6d4cf0]/25 focus:border-[#6d4cf0] placeholder:text-slate-400 transition-all"
          />
        </div>

        <label className="flex items-center gap-2 h-11 bg-white border border-slate-300 rounded-xl px-3.5 text-sm text-slate-600 focus-within:border-[#6d4cf0]">
          <Tag className="w-4 h-4 text-slate-500" />
          <span>Category:</span>
          <select
            id="filter-category-creator"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            {Object.values(DocumentCategory).map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 h-11 bg-white border border-slate-300 rounded-xl px-3.5 text-sm text-slate-600 focus-within:border-[#6d4cf0]">
          <SlidersHorizontal className="w-4 h-4 text-slate-500" />
          <span>Status:</span>
          <select
            id="filter-status-creator"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value={VersionStatus.PUBLISHED}>Published (Live)</option>
            <option value={VersionStatus.IN_REVIEW}>In Review</option>
            <option value={VersionStatus.REVISION_REQUIRED}>Revision Required</option>
            <option value={VersionStatus.SUPERSEDED}>Superseded</option>
          </select>
        </label>
      </div>

      {/* PRIMARY DOCUMENT MASTERS TABLE */}
      <div className={tbl.wrap}>
        <div className="px-6 pt-5 pb-3 flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-extrabold text-slate-900">Document Masters Directory</h2>
          <span className="bg-slate-100 text-slate-700 text-xs px-3 py-1 rounded-full font-bold">
            {filteredDocs.length} {filteredDocs.length === 1 ? 'record' : 'records'}
          </span>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          <table className={tbl.table}>
            <thead>
              <tr className={tbl.headRow}>
                <th scope="col" className={`${tbl.th} rounded-l-xl uppercase tracking-wide`}>Document ID</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Title &amp; Category</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Current Published</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Status</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Department &amp; Owner</th>
                <th scope="col" className={`${tbl.th} uppercase tracking-wide`}>Last Updated</th>
                <th scope="col" className={`${tbl.th} rounded-r-xl uppercase tracking-wide text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className={tbl.body}>
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <FileText className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                    No documents found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => {
                  const docVersions = versions.filter((v) => v.documentMasterId === doc.id || v.documentId === doc.documentId);
                  const inReview = docVersions.find((v) => v.status === VersionStatus.IN_REVIEW);
                  const needsRevision = revisionRequiredVersions.find(
                    (v) => v.documentMasterId === doc.id || v.documentId === doc.documentId
                  );
                  const isDocRejected =
                    doc.currentStatus === VersionStatus.REJECTED ||
                    docVersions.some((v) => v.status === VersionStatus.REJECTED && !doc.currentPublishedVersionId);
                  const reviseBlocked = !!inReview || doc.currentStatus === VersionStatus.IN_REVIEW || isDocRejected;
                  const owner = doc.processOwnerName || '';
                  const initials = owner.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '–';
                  const iconBtn = 'w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 flex items-center justify-center transition-colors cursor-pointer';

                  return (
                    <tr key={doc.id} className={tbl.row}>
                      <td className={`${tbl.td} whitespace-nowrap`}>
                        <Chip tone="violet">{doc.documentId}</Chip>
                      </td>

                      <td className={tbl.td}>
                        <div className="font-bold text-slate-900">{doc.title}</div>
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1.5"><Folder className="w-3.5 h-3.5 text-slate-500" />{doc.category}</span>
                          {doc.confidentiality === ConfidentialityLevel.INTERNAL ? (
                            <span className="text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md font-medium">Internal (HR/Approver only)</span>
                          ) : (
                            <span className="text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md font-medium">Public (all employees)</span>
                          )}
                        </div>
                      </td>

                      <td className={`${tbl.td} whitespace-nowrap`}>
                        {doc.currentPublishedVersionNumber ? (
                          <Chip tone="violet">v{doc.currentPublishedVersionNumber}</Chip>
                        ) : (
                          <span className="text-xs text-slate-500 italic">None published yet</span>
                        )}
                        {inReview ? (
                          <div className="text-[11px] text-violet-700 mt-1.5 flex items-center gap-1 font-semibold">
                            <Clock className="w-3 h-3" />
                            <span>
                              v{inReview.versionNumber} in review{' '}
                              <span className="text-slate-500 font-normal">(Eff: {formatDDMMYYYY(inReview.effectiveFrom || inReview.createdAt)})</span>
                            </span>
                          </div>
                        ) : needsRevision ? (
                          <div className="text-[11px] text-orange-600 mt-1.5 flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>v{needsRevision.versionNumber} revision requested</span>
                          </div>
                        ) : isDocRejected ? (
                          <div className="text-[11px] text-rose-600 mt-1.5 flex items-center gap-1 font-semibold">
                            <Ban className="w-3 h-3" />
                            <span>Permanently rejected (closed)</span>
                          </div>
                        ) : null}
                      </td>

                      <td className={`${tbl.td} whitespace-nowrap`}>
                        <StatusBadge
                          status={
                            inReview
                              ? VersionStatus.IN_REVIEW
                              : needsRevision
                              ? VersionStatus.REVISION_REQUIRED
                              : isDocRejected
                              ? VersionStatus.REJECTED
                              : doc.currentStatus
                          }
                        />
                      </td>

                      <td className={`${tbl.td} whitespace-nowrap`}>
                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800"><Users className="w-4 h-4 text-slate-500" />{doc.departmentName}</div>
                        <div className="flex items-center gap-2 mt-1.5 text-sm text-slate-700">
                          <span className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold flex items-center justify-center">{initials}</span>
                          {owner}
                        </div>
                      </td>

                      <td className={`${tbl.td} whitespace-nowrap text-sm text-slate-700`}>
                        <span className="inline-flex items-center gap-2"><CalendarDays className="w-4 h-4 text-slate-500" />{formatISTDate(doc.updatedAt)}</span>
                      </td>

                      <td className={`${tbl.td} whitespace-nowrap`}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            id={`btn-view-doc-${doc.id}`}
                            onClick={() => onOpenDocumentDetail(doc)}
                            className={iconBtn}
                            title={`View complete version history (${docVersions.length})`}
                            aria-label="View version history"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            id={`btn-new-version-${doc.id}`}
                            onClick={() => onOpenCreateVersion(doc)}
                            disabled={reviseBlocked}
                            className={`${iconBtn} ${
                              reviseBlocked
                                ? 'opacity-50 cursor-not-allowed hover:bg-white text-slate-400'
                                : needsRevision
                                ? '!bg-[#6d4cf0] !text-white !border-[#6d4cf0] hover:!bg-[#5b3be0] ring-2 ring-violet-200'
                                : ''
                            }`}
                            aria-label={needsRevision ? `Author v${needsRevision.versionNumber} fix` : 'Create new version'}
                            title={
                              isDocRejected
                                ? 'Document has been permanently rejected. No further revisions permitted.'
                                : reviseBlocked
                                ? `Cannot revise: Version v${inReview?.versionNumber || ''} is currently under review`
                                : needsRevision
                                ? `Author next revision addressing reviewer feedback on v${needsRevision.versionNumber}`
                                : 'Create new revision (minor/major)'
                            }
                          >
                            {isDocRejected ? <Ban className="w-4 h-4" /> : <GitBranch className="w-4 h-4" />}
                          </button>

                          {onDeleteDocument && (
                            <button
                              id={`btn-delete-doc-${doc.id}`}
                              onClick={() => setConfirmDeleteId(doc.id)}
                              className={`${iconBtn} hover:!bg-rose-50 hover:!text-rose-600 hover:!border-rose-200`}
                              title="Delete this Document Master and revisions"
                              aria-label="Delete document master"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Confirm Delete Single Document */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete Document Master?</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Are you sure you want to permanently delete this document master, all its version revisions, and associated compliance acknowledgment records from Firestore?
            </p>
            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onDeleteDocument && confirmDeleteId) {
                    onDeleteDocument(confirmDeleteId);
                    setConfirmDeleteId(null);
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

      {/* MODAL: Confirm Clear All Documents */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Remove All Documents?</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              This will completely remove <span className="font-bold text-slate-900">{documents.length} document masters</span>, all version records, and all employee policy sign-offs from your Cloud Firestore database.
            </p>
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 p-2.5 rounded-xl mt-3">
              Note: Employee records in the directory will remain intact. You can upload clean policies or restore sample documents at any time.
            </p>
            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                onClick={() => setShowClearModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onClearAllDocuments) {
                    onClearAllDocuments();
                    setShowClearModal(false);
                  }
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs transition-colors shadow-sm"
              >
                Yes, Remove All Documents
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
