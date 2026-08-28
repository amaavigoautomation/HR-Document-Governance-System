import React, { useState } from 'react';
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
} from 'lucide-react';
import { DocumentCategory, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';

interface CreatorDashboardProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  onOpenCreateDocument: () => void;
  onOpenCreateVersion: (doc?: DocumentMaster) => void;
  onOpenDocumentDetail: (doc: DocumentMaster) => void;
  onOpenComparison: (versionId: string) => void;
}

export const CreatorDashboard: React.FC<CreatorDashboardProps> = ({
  currentUser,
  documents,
  versions,
  onOpenCreateDocument,
  onOpenCreateVersion,
  onOpenDocumentDetail,
  onOpenComparison,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Compute Metrics
  const totalDocs = documents.length;
  const publishedDocs = documents.filter((d) => d.currentStatus === VersionStatus.PUBLISHED).length;
  const inReviewVersions = versions.filter((v) => v.status === VersionStatus.IN_REVIEW);
  const revisionRequiredVersions = versions.filter((v) => v.status === VersionStatus.REVISION_REQUIRED);
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
      <div className="glass-panel-dark rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-white tracking-tight">HR Creator Studio</h1>
            <span className="bg-blue-500/15 text-blue-300 text-xs px-3 py-0.5 rounded-full font-semibold border border-blue-500/30">
              Authoring & Revisions
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1.5">
            Logged in as <span className="font-semibold text-slate-200">{currentUser.name}</span> ({currentUser.title}) • Maintain permanent Document Masters and draft structured version revisions.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            id="btn-open-create-version"
            onClick={() => onOpenCreateVersion()}
            className="inline-flex items-center space-x-2 bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 border border-slate-700 font-semibold px-4 py-2.5 rounded-xl text-xs transition-all shadow-sm"
          >
            <GitBranch className="w-4 h-4 text-slate-400" />
            <span>Create New Version</span>
          </button>

          <button
            id="btn-open-create-document"
            onClick={onOpenCreateDocument}
            className="inline-flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold px-4 py-2.5 rounded-xl text-xs transition-all shadow-md shadow-blue-600/30 border border-blue-400/30"
          >
            <Plus className="w-4 h-4" />
            <span>New Document Master</span>
          </button>
        </div>
      </div>

      {/* METRICS CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Total Masters</span>
            <FileText className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-white">{totalDocs}</div>
          <div className="text-[11px] text-slate-400 mt-1">Permanent Logical Records</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-emerald-900/30">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            <span>Published (Live)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-emerald-400">{publishedDocs}</div>
          <div className="text-[11px] text-emerald-500/80 mt-1">Active Operational Copies</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-amber-900/30">
          <div className="flex items-center justify-between text-amber-400 text-xs font-semibold uppercase tracking-wider">
            <span>In Review</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-amber-400">{inReviewVersions.length}</div>
          <div className="text-[11px] text-amber-500/80 mt-1">Waiting in Reviewer Queue</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-rose-900/30">
          <div className="flex items-center justify-between text-rose-400 text-xs font-semibold uppercase tracking-wider">
            <span>Revision Required</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-rose-400">{revisionRequiredVersions.length}</div>
          <div className="text-[11px] text-rose-500/80 mt-1">Reviewer Feedback Pending</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Superseded</span>
            <Layers className="w-4 h-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-300">{supersededVersions.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Preserved Historical Revisions</div>
        </div>
      </div>

      {/* REVISION REQUIRED CALLOUT BANNER IF ANY EXIST */}
      {revisionRequiredVersions.length > 0 && (
        <div id="banner-revision-required" className="bg-rose-950/40 border border-rose-800/60 rounded-2xl p-5 shadow-lg backdrop-blur-md">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-900/60 border border-rose-700/60 flex items-center justify-center shrink-0 mt-0.5 shadow-inner">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-rose-200">
                  Action Required: Reviewer Requested Revisions ({revisionRequiredVersions.length})
                </h2>
                <p className="text-xs text-rose-300/80 mt-0.5">
                  The reviewer returned the following drafts for clarification. Original published copies remain operational until a new version is approved.
                </p>

                <div className="mt-3.5 space-y-2.5">
                  {revisionRequiredVersions.map((rev) => {
                    const parentMaster = documents.find((d) => d.id === rev.documentMasterId);
                    return (
                      <div
                        key={rev.id}
                        className="bg-slate-900/90 rounded-xl p-3.5 border border-rose-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm"
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs font-bold text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                              {rev.documentId}
                            </span>
                            <span className="font-semibold text-sm text-white">{rev.documentTitle}</span>
                            <span className="text-xs bg-rose-950 text-rose-300 font-bold px-2 py-0.5 rounded border border-rose-800/60">
                              v{rev.versionNumber} Rejected
                            </span>
                          </div>
                          {rev.reviewerComments && (
                            <div className="mt-2 text-xs text-rose-200 flex items-start space-x-2 bg-rose-950/50 p-2.5 rounded-lg border border-rose-900/60">
                              <MessageSquare className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-rose-300">Reviewer Comment:</span> "{rev.reviewerComments}"
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          id={`btn-revise-${rev.id}`}
                          onClick={() => onOpenCreateVersion(parentMaster)}
                          className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-3.5 py-2 rounded-xl transition-all flex items-center space-x-1.5 shrink-0 shadow-sm"
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
      <div className="glass-panel-dark p-4 rounded-2xl shadow-md border border-slate-800/80 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="search-documents-creator"
            type="text"
            placeholder="Search by Document ID, Title, Category, Department..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-500"
          />
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Category:</span>
            <select
              id="filter-category-creator"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent font-medium text-slate-200 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900 text-white">All Categories</option>
              {Object.values(DocumentCategory).map((cat) => (
                <option key={cat} value={cat} className="bg-slate-900 text-white">
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-1.5 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-400">
            <span>Status:</span>
            <select
              id="filter-status-creator"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-transparent font-medium text-slate-200 focus:outline-hidden cursor-pointer"
            >
              <option value="ALL" className="bg-slate-900 text-white">All Statuses</option>
              <option value={VersionStatus.PUBLISHED} className="bg-slate-900 text-white">Published (Live)</option>
              <option value={VersionStatus.IN_REVIEW} className="bg-slate-900 text-white">In Review</option>
              <option value={VersionStatus.REVISION_REQUIRED} className="bg-slate-900 text-white">Revision Required</option>
              <option value={VersionStatus.SUPERSEDED} className="bg-slate-900 text-white">Superseded</option>
            </select>
          </div>
        </div>
      </div>

      {/* PRIMARY DOCUMENT MASTERS TABLE */}
      <div className="glass-panel-dark rounded-2xl border border-slate-800/80 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-white">Document Masters Directory</h2>
            <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-0.5 rounded-full font-mono font-medium border border-slate-700">
              {filteredDocs.length} records
            </span>
          </div>
          <span className="text-xs text-slate-400">Every revision creates a new version record</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800/80">
            <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase tracking-wider font-semibold">
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
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {filteredDocs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <FileText className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                    No documents found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredDocs.map((doc) => {
                  const docVersions = versions.filter((v) => v.documentMasterId === doc.id);
                  const inReview = docVersions.find((v) => v.status === VersionStatus.IN_REVIEW);
                  const needsRevision = docVersions.find((v) => v.status === VersionStatus.REVISION_REQUIRED);

                  return (
                    <tr key={doc.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-mono text-xs font-bold text-blue-300 bg-blue-950/60 px-2.5 py-1 rounded-lg inline-block border border-blue-800/60">
                          {doc.documentId}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="font-semibold text-white">{doc.title}</div>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded font-medium">
                            {doc.category}
                          </span>
                          <span className="text-xs text-slate-500">{doc.confidentiality}</span>
                        </div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {doc.currentPublishedVersionNumber ? (
                          <div className="inline-flex items-center space-x-1.5 bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 px-2.5 py-1 rounded-full text-xs font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>v{doc.currentPublishedVersionNumber} (Live)</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">None Published Yet</span>
                        )}
                        {inReview && (
                          <div className="text-[11px] text-amber-400 mt-1 flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-amber-400" />
                            <span>v{inReview.versionNumber} in review</span>
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={doc.currentStatus} />
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-medium text-slate-300">{doc.departmentName}</div>
                        <div className="text-xs text-slate-500">Owner: {doc.processOwnerName}</div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-400">
                        {new Date(doc.updatedAt).toLocaleDateString()}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                        <button
                          id={`btn-view-doc-${doc.id}`}
                          onClick={() => onOpenDocumentDetail(doc)}
                          className="inline-flex items-center space-x-1 text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-950/60 hover:bg-blue-900/60 px-2.5 py-1.5 rounded-lg transition-colors border border-blue-900/50"
                          title="View Complete Permanent Version History"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>History ({docVersions.length})</span>
                        </button>

                        <button
                          id={`btn-new-version-${doc.id}`}
                          onClick={() => onOpenCreateVersion(doc)}
                          className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-colors border border-slate-700"
                          title="Create New Revision (Minor/Major)"
                        >
                          <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                          <span>Revise</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
