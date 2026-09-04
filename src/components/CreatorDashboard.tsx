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
} from 'lucide-react';
import { ConfidentialityLevel, DocumentCategory, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { governanceEngine } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';

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

  // Filter Documents
  const filteredDocs = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.documentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.departmentName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = selectedCategory === 'ALL' || doc.category === selectedCategory;
    const matchesStatus = selectedStatus === 'ALL' || doc.currentStatus === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Top Header & Welcome */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">HR Creator Studio</h1>
            <span className="bg-[#FA7014]/10 text-[#FA7014] text-xs px-3 py-0.5 rounded-full font-semibold border border-[#FA7014]/30">
              Authoring & Revisions
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5">
            Logged in as <span className="font-semibold text-slate-900">{currentUser.name}</span> ({currentUser.title}) • Maintain permanent Document Masters and draft structured version revisions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="btn-open-create-version"
            onClick={() => onOpenCreateVersion()}
            className="inline-flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition-all shadow-sm"
          >
            <GitBranch className="w-4 h-4 text-[#FA7014]" />
            <span>Create New Version</span>
          </button>

          <button
            id="btn-open-create-document"
            onClick={onOpenCreateDocument}
            className="inline-flex items-center space-x-2 bg-[#FA7014] hover:bg-[#E65A05] text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition-all shadow-md shadow-[#FA7014]/20 border border-orange-500/30"
          >
            <Plus className="w-4 h-4" />
            <span>New Document Master</span>
          </button>
        </div>
      </div>

      {/* METRICS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Total Masters</span>
            <FileText className="w-4 h-4 text-slate-900" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{totalDocs}</div>
          <div className="text-[11px] text-slate-500 mt-1">Permanent Logical Records</div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-slate-600 text-xs font-semibold uppercase tracking-wider">
            <span>Published (Live)</span>
            <CheckCircle2 className="w-4 h-4 text-[#FA7014]" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{publishedDocs}</div>
          <div className="text-[11px] text-slate-500 mt-1">Active Operational Copies</div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-slate-600 text-xs font-semibold uppercase tracking-wider">
            <span>In Review</span>
            <Clock className="w-4 h-4 text-slate-700" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{inReviewVersions.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Waiting in Reviewer Queue</div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-slate-600 text-xs font-semibold uppercase tracking-wider">
            <span>Revision Required</span>
            <AlertTriangle className="w-4 h-4 text-[#FA7014]" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-[#FA7014]">{revisionRequiredVersions.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Reviewer Feedback Pending</div>
        </div>

        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Superseded</span>
            <Layers className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{supersededVersions.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Preserved Historical Revisions</div>
        </div>
      </div>

      {/* REVISION REQUIRED CALLOUT BANNER IF ANY EXIST */}
      {revisionRequiredVersions.length > 0 && (
        <div id="banner-revision-required" className="bg-white border-l-4 border-l-[#FA7014] border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 w-full">
              <div className="w-9 h-9 rounded-xl bg-[#FA7014]/10 border border-[#FA7014]/30 flex items-center justify-center shrink-0 mt-0.5 text-[#FA7014]">
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
                            <span className="text-xs bg-[#FA7014]/10 text-[#FA7014] font-bold px-2 py-0.5 rounded border border-[#FA7014]/30">
                              v{rev.versionNumber} Revision Requested
                            </span>
                          </div>
                          {rev.reviewerComments && (
                            <div className="mt-2 text-xs text-slate-700 flex items-start space-x-2 bg-white p-2.5 rounded-lg border border-slate-200">
                              <MessageSquare className="w-3.5 h-3.5 text-[#FA7014] shrink-0 mt-0.5" />
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
                          className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-all flex items-center space-x-1.5 shrink-0 shadow-sm"
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
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="search-documents-creator"
            type="text"
            placeholder="Search by Document ID, Title, Category, Department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] placeholder:text-slate-400 transition-all"
          />
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>Category:</span>
            <select
              id="filter-category-creator"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent font-medium text-slate-900 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              {Object.values(DocumentCategory).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-600">
            <span>Status:</span>
            <select
              id="filter-status-creator"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent font-medium text-slate-900 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value={VersionStatus.PUBLISHED}>Published (Live)</option>
              <option value={VersionStatus.IN_REVIEW}>In Review</option>
              <option value={VersionStatus.REVISION_REQUIRED}>Revision Required</option>
              <option value={VersionStatus.SUPERSEDED}>Superseded</option>
            </select>
          </div>
        </div>
      </div>

      {/* PRIMARY DOCUMENT MASTERS TABLE */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-slate-900">Document Masters Directory</h2>
            <span className="bg-slate-100 text-slate-800 text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold border border-slate-200">
              {filteredDocs.length} records
            </span>
          </div>
          <span className="text-xs text-slate-500">Every revision creates a new version record</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 text-slate-700 text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th scope="col" className="px-6 py-3.5 text-left">Document ID</th>
                <th scope="col" className="px-6 py-3.5 text-left">Title & Category</th>
                <th scope="col" className="px-6 py-3.5 text-left">Current Published</th>
                <th scope="col" className="px-6 py-3.5 text-left">Status</th>
                <th scope="col" className="px-6 py-3.5 text-left">Department & Owner</th>
                <th scope="col" className="px-6 py-3.5 text-left">Last Updated</th>
                <th scope="col" className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
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

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg inline-block border border-slate-200">
                          {doc.documentId}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{doc.title}</div>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded font-medium border border-slate-200">
                            {doc.category}
                          </span>
                          {doc.confidentiality === ConfidentialityLevel.INTERNAL ? (
                            <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md font-medium">
                              🔒 Internal Company (HR/Approver Only)
                            </span>
                          ) : (
                            <span className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md font-medium">
                              📢 Public (All Employees)
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {doc.currentPublishedVersionNumber ? (
                          <div className="inline-flex items-center space-x-1.5 bg-slate-100 text-slate-900 border border-slate-200 px-2.5 py-1 rounded-full text-xs font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#FA7014]" />
                            <span>v{doc.currentPublishedVersionNumber} (Live)</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">None Published Yet</span>
                        )}
                        {inReview ? (
                          <div className="text-[11px] text-[#FA7014] mt-1 flex items-center space-x-1 font-medium">
                            <Clock className="w-3 h-3 text-[#FA7014]" />
                            <span>v{inReview.versionNumber} in review</span>
                          </div>
                        ) : needsRevision ? (
                          <div className="text-[11px] text-[#FA7014] mt-1 flex items-center space-x-1 font-semibold">
                            <AlertTriangle className="w-3 h-3 text-[#FA7014]" />
                            <span>v{needsRevision.versionNumber} revision requested</span>
                          </div>
                        ) : null}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge
                          status={
                            inReview
                              ? VersionStatus.IN_REVIEW
                              : needsRevision
                              ? VersionStatus.REVISION_REQUIRED
                              : doc.currentStatus
                          }
                        />
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-medium text-slate-900">{doc.departmentName}</div>
                        <div className="text-xs text-slate-500">Owner: {doc.processOwnerName}</div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                        {formatISTDate(doc.updatedAt)}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        <button
                          id={`btn-view-doc-${doc.id}`}
                          onClick={() => onOpenDocumentDetail(doc)}
                          className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-200"
                          title="View Complete Permanent Version History"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>History ({docVersions.length})</span>
                        </button>

                        <button
                          id={`btn-new-version-${doc.id}`}
                          onClick={() => onOpenCreateVersion(doc)}
                          disabled={!!inReview || doc.currentStatus === VersionStatus.IN_REVIEW}
                          className={`inline-flex items-center space-x-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors shadow-xs ${
                            inReview || doc.currentStatus === VersionStatus.IN_REVIEW
                              ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                              : needsRevision
                              ? 'text-white bg-[#FA7014] hover:bg-[#E65A05] ring-2 ring-[#FA7014]/20'
                              : 'text-white bg-slate-900 hover:bg-slate-800'
                          }`}
                          title={
                            inReview || doc.currentStatus === VersionStatus.IN_REVIEW
                              ? `Cannot revise: Version v${inReview?.versionNumber || ''} is currently under review`
                              : needsRevision
                              ? `Author next revision addressing reviewer feedback on v${needsRevision.versionNumber}`
                              : 'Create New Revision (Minor/Major)'
                          }
                        >
                          <GitBranch
                            className={`w-3.5 h-3.5 ${
                              inReview || doc.currentStatus === VersionStatus.IN_REVIEW
                                ? 'text-slate-400'
                                : needsRevision
                                ? 'text-white'
                                : 'text-[#FA7014]'
                            }`}
                          />
                          <span>{needsRevision ? `Author v${needsRevision.versionNumber} Fix` : 'Revise'}</span>
                        </button>

                        {onDeleteDocument && (
                          <button
                            id={`btn-delete-doc-${doc.id}`}
                            onClick={() => setConfirmDeleteId(doc.id)}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100 px-2.5 py-1.5 rounded-lg transition-colors border border-rose-200"
                            title="Delete this Document Master and revisions"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
