import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  ShieldCheck,
  AlertCircle,
  Building,
  Check,
  ExternalLink,
} from 'lucide-react';
import { AcknowledgementRecord, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { governanceEngine } from '../services/governance';

interface EmployeePortalViewProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  onOpenDocumentView: (version: DocumentVersion) => void;
}

export const EmployeePortalView: React.FC<EmployeePortalViewProps> = ({
  currentUser,
  documents,
  versions,
  onOpenDocumentView,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgementRecord[]>(
    governanceEngine.getAcknowledgements(currentUser.id)
  );

  // Employee only sees PUBLISHED documents (Section 34)
  const publishedDocs = documents.filter((d) => d.currentStatus === VersionStatus.PUBLISHED);

  const filtered = publishedDocs.filter((doc) => {
    const q = searchTerm.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.documentId.toLowerCase().includes(q) ||
      doc.category.toLowerCase().includes(q) ||
      doc.departmentName.toLowerCase().includes(q)
    );
  });

  const handleAcknowledge = (doc: DocumentMaster, verNumber: string) => {
    governanceEngine.acknowledgeDocument(currentUser, doc.documentId, verNumber);
    setAcknowledgements(governanceEngine.getAcknowledgements(currentUser.id));
  };

  const pendingAcksCount = acknowledgements.filter((a) => a.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="glass-panel-dark rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">Employee Document Portal</h1>
            <span className="bg-indigo-500/15 text-indigo-300 text-xs px-3 py-0.5 rounded-full font-semibold border border-indigo-500/30">
              Live Company Policies & SOPs
            </span>
            <span className="bg-slate-800 text-slate-300 text-xs px-2.5 py-0.5 rounded-md font-mono border border-slate-700">
              emp_id: {currentUser.empId || currentUser.loginId || currentUser.id}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1.5">
            Logged in as <span className="font-semibold text-slate-200">{currentUser.name}</span> ({currentUser.email}) • Access operational published policies and complete required compliance acknowledgements.
          </p>
        </div>

        {pendingAcksCount > 0 ? (
          <div className="bg-amber-950/50 border border-amber-800/60 px-4 py-2.5 rounded-xl flex items-center space-x-2.5 text-xs text-amber-300 shadow-inner">
            <Clock className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
            <span>
              You have <strong>{pendingAcksCount} document(s)</strong> awaiting your compliance acknowledgement.
            </span>
          </div>
        ) : (
          <div className="bg-emerald-950/50 border border-emerald-800/60 px-4 py-2.5 rounded-xl flex items-center space-x-2.5 text-xs text-emerald-300 shadow-inner">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>All active policy acknowledgements up to date!</span>
          </div>
        )}
      </div>

      {/* SEARCH BAR */}
      <div className="glass-panel-dark p-4 rounded-2xl border border-slate-800/80 shadow-md">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="search-employee-docs"
            type="text"
            placeholder="Search active policies, SOPs, forms, or guidelines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* PUBLISHED DOCUMENTS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-2 glass-panel-dark rounded-2xl p-12 text-center text-slate-500 border border-slate-800">
            <BookOpen className="w-12 h-12 mx-auto mb-2 text-slate-600" />
            <p>No published documents found matching your search.</p>
          </div>
        ) : (
          filtered.map((doc) => {
            const pubVersion = versions.find((v) => v.id === doc.currentPublishedVersionId);
            const verNumber = doc.currentPublishedVersionNumber || '1.0';

            const ack = acknowledgements.find(
              (a) => a.documentId === doc.documentId && a.versionNumber === verNumber
            );
            const isAcked = ack?.status === 'ACKNOWLEDGED';

            return (
              <div
                key={doc.id}
                className="glass-panel-dark rounded-2xl border border-slate-800/80 p-5 shadow-lg hover:border-slate-700 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-blue-300 bg-blue-950/60 px-2.5 py-0.5 rounded-lg border border-blue-800/60">
                        {doc.documentId}
                      </span>
                      <span className="font-bold text-xs text-emerald-300 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-800/60">
                        v{verNumber} Live
                      </span>
                    </div>

                    <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md font-medium border border-slate-700">
                      {doc.category}
                    </span>
                  </div>

                  <h2 className="text-base font-bold text-white leading-snug">{doc.title}</h2>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {doc.description || pubVersion?.changeSummary || 'Official corporate HR operational policy.'}
                  </p>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase font-bold">Department</span>
                      <span className="text-slate-300 font-medium">{doc.departmentName}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px] uppercase font-bold">Effective Date</span>
                      <span className="text-slate-300 font-medium">{pubVersion?.effectiveFrom || '2026-08-01'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  {/* Acknowledgement Status / Action */}
                  {doc.acknowledgementRequired ? (
                    isAcked ? (
                      <span className="inline-flex items-center space-x-1 text-xs font-semibold text-emerald-300 bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-800/60">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Acknowledged v{verNumber}</span>
                      </span>
                    ) : (
                      <button
                        id={`btn-ack-${doc.id}`}
                        onClick={() => handleAcknowledge(doc, verNumber)}
                        className="inline-flex items-center justify-center space-x-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-md shadow-amber-900/30 border border-amber-400/30"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Acknowledge Policy v{verNumber}</span>
                      </button>
                    )
                  ) : (
                    <span className="text-[11px] text-slate-500">Acknowledgement not required</span>
                  )}

                  {/* Read Document Button */}
                  {pubVersion && (
                    <button
                      id={`btn-employee-read-${doc.id}`}
                      onClick={() => onOpenDocumentView(pubVersion)}
                      className="inline-flex items-center justify-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors border border-slate-700"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      <span>Read Document</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
