import React, { useEffect, useState } from 'react';
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
import { AcknowledgementRecord, ConfidentialityLevel, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { governanceEngine } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';

interface EmployeePortalViewProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  acknowledgements?: AcknowledgementRecord[];
  onOpenDocumentView: (version: DocumentVersion) => void;
}

const isOfflineSignOff = (ack?: AcknowledgementRecord | null): boolean => {
  if (!ack) return false;
  if (ack.offlineSignOff === true || ack.signOffType === 'OFFLINE') return true;
  if (ack.signatureReference && ack.signatureReference.startsWith('MANUAL-ATTEST')) return true;
  const n = (ack.notes || '').toLowerCase();
  return n.includes('offline') || n.includes('manual') || n.includes('attested by') || n.includes('paper attestation');
};

export const EmployeePortalView: React.FC<EmployeePortalViewProps> = ({
  currentUser,
  documents,
  versions,
  acknowledgements,
  onOpenDocumentView,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [localAcks, setLocalAcks] = useState<AcknowledgementRecord[]>(() => {
    return acknowledgements && acknowledgements.length > 0
      ? acknowledgements
      : governanceEngine.getAcknowledgements();
  });

  useEffect(() => {
    if (acknowledgements && acknowledgements.length > 0) {
      setLocalAcks(acknowledgements);
    } else {
      setLocalAcks(governanceEngine.getAcknowledgements());
    }
  }, [acknowledgements, documents, versions, currentUser]);

  // Employee only sees PUBLISHED documents that are Public (All Employees)
  // Internal Company documents are strictly restricted to HR & Approvers
  const publishedDocs = documents.filter(
    (d) =>
      d.active &&
      d.currentStatus === VersionStatus.PUBLISHED &&
      d.confidentiality === ConfidentialityLevel.PUBLIC
  );

  const filtered = publishedDocs.filter((doc) => {
    const q = searchTerm.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.documentId.toLowerCase().includes(q) ||
      doc.category.toLowerCase().includes(q) ||
      doc.departmentName.toLowerCase().includes(q)
    );
  });

  const userIdentifiers = [currentUser.id, currentUser.empId, currentUser.loginId, currentUser.email]
    .filter(Boolean)
    .map((s) => s!.toLowerCase());

  const matchedUser = governanceEngine.findUserByIdentifiers(currentUser.id) ||
                      governanceEngine.findUserByIdentifiers(currentUser.empId) ||
                      governanceEngine.findUserByIdentifiers(currentUser.email);
  if (matchedUser) {
    [matchedUser.id, matchedUser.empId, matchedUser.loginId, matchedUser.email].forEach((id) => {
      if (id && !userIdentifiers.includes(id.toLowerCase())) {
        userIdentifiers.push(id.toLowerCase());
      }
    });
  }

  const handleAcknowledge = async (doc: DocumentMaster, verNumber: string) => {
    governanceEngine.acknowledgeDocument(currentUser, doc.documentId, verNumber);
    setLocalAcks(governanceEngine.getAcknowledgements());
  };

  const effectiveAcks = localAcks.length > 0 ? localAcks : (acknowledgements || []);
  const userAcks = effectiveAcks.filter(
    (a) =>
      (a.employeeId && userIdentifiers.includes(a.employeeId.toLowerCase())) ||
      (a.employeeEmail && userIdentifiers.includes(a.employeeEmail.toLowerCase()))
  );

  const pendingAcksCount = publishedDocs.filter((doc) => {
    if (!doc.acknowledgementRequired) return false;
    const verNumber = doc.currentPublishedVersionNumber || '1.0';
    const ack = userAcks.find(
      (a) =>
        a.documentId.toLowerCase() === doc.documentId.toLowerCase() &&
        a.versionNumber === verNumber &&
        a.status === 'ACKNOWLEDGED'
    );
    return !ack;
  }).length;

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="bg-white rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Employee Document Portal</h1>
            <span className="bg-[#FA7014]/10 text-[#FA7014] text-xs px-3 py-0.5 rounded-full font-semibold border border-[#FA7014]/30">
              Live Company Policies & SOPs
            </span>
          </div>
        </div>

        {pendingAcksCount > 0 ? (
          <div className="bg-[#FA7014]/10 border border-[#FA7014]/30 px-4 py-2.5 rounded-xl flex items-center space-x-2.5 text-xs text-[#FA7014]">
            <Clock className="w-4 h-4 text-[#FA7014] animate-pulse shrink-0" />
            <span>
              You have <strong>{pendingAcksCount} document(s)</strong> awaiting your compliance acknowledgement.
            </span>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl flex items-center space-x-2.5 text-xs text-slate-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>All active policy acknowledgements up to date!</span>
          </div>
        )}
      </div>

      {/* SEARCH BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="search-employee-docs"
            type="text"
            placeholder="Search active policies, SOPs, forms, or guidelines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
          />
        </div>
      </div>

      {/* PUBLISHED DOCUMENTS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-2 bg-white rounded-2xl p-12 text-center text-slate-500 border border-slate-200 shadow-sm">
            <BookOpen className="w-12 h-12 mx-auto mb-2 text-slate-400" />
            <p>No published documents found matching your search.</p>
          </div>
        ) : (
          filtered.map((doc) => {
            const pubVersion = versions.find((v) => v.id === doc.currentPublishedVersionId);
            const verNumber = doc.currentPublishedVersionNumber || '1.0';

            const ack = userAcks.find(
              (a) =>
                a.documentId === doc.documentId &&
                a.versionNumber === verNumber &&
                a.status === 'ACKNOWLEDGED'
            );
            const isAcked = !!ack;

            return (
              <div
                key={doc.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-slate-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                        {doc.documentId}
                      </span>
                      <span className="font-bold text-xs text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                        v{verNumber} Live
                      </span>
                    </div>

                    <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-medium border border-slate-200">
                      {doc.category}
                    </span>
                  </div>

                  <h2 className="text-base font-bold text-slate-900 leading-snug">{doc.title}</h2>

                  <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Department</span>
                      <span className="text-slate-700 font-medium">{doc.departmentName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Effective Date</span>
                      <span className="text-slate-700 font-medium">{pubVersion?.effectiveFrom || '2026-08-01'}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  {/* Acknowledgement Status / Action */}
                  {doc.acknowledgementRequired ? (
                    isAcked ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>
                            {isOfflineSignOff(ack)
                              ? `Acknowledged (Record Offline Sign-off)`
                              : `Acknowledged (v${verNumber})`}
                            {ack?.acknowledgedAt ? ` • ${formatISTDate(ack.acknowledgedAt)}` : ''}
                          </span>
                        </span>
                        {isOfflineSignOff(ack) && ack?.recordedBy && (
                          <span className="text-[11px] text-slate-500 font-medium pl-1">
                            Recorded by: {ack.recordedBy}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        id={`btn-ack-${doc.id}`}
                        onClick={() => handleAcknowledge(doc, verNumber)}
                        className="inline-flex items-center justify-center space-x-1.5 bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-md shadow-[#FA7014]/20 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>Acknowledge Policy v{verNumber}</span>
                      </button>
                    )
                  ) : (
                    <span className="text-[11px] text-slate-400">Acknowledgement optional</span>
                  )}

                  {/* Read Document Button */}
                  {pubVersion && (
                    <button
                      id={`btn-employee-read-${doc.id}`}
                      onClick={() => onOpenDocumentView(pubVersion)}
                      className="inline-flex items-center justify-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors border border-slate-200 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-600" />
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
