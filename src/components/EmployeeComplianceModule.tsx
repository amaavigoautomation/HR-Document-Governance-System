import React, { useState, useMemo } from 'react';
import {
  Users,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Search,
  Filter,
  Mail,
  Send,
  FileCheck,
  Building,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  PenTool,
  RefreshCw,
  Sparkles,
  Info,
  Check,
  X,
  FileText,
  User as UserIcon,
} from 'lucide-react';
import {
  User,
  DocumentMaster,
  DocumentVersion,
  AcknowledgementRecord,
  ConfidentialityLevel,
  UserRole,
  VersionStatus,
} from '../types';
import { governanceEngine, isEmployeeInDepartment } from '../services/governance';
import { formatIST, formatISTDate } from '../utils/dateFormat';

interface EmployeeComplianceModuleProps {
  currentUser: User;
  users?: User[];
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  onOpenDocumentView?: (version: DocumentVersion) => void;
  onRefreshData?: () => void;
}

const isOfflineSignOff = (ack?: AcknowledgementRecord | null): boolean => {
  if (!ack) return false;
  if (ack.offlineSignOff === true || ack.signOffType === 'OFFLINE') return true;
  if (ack.signatureReference && ack.signatureReference.startsWith('MANUAL-ATTEST')) return true;
  const n = (ack.notes || '').toLowerCase();
  return n.includes('offline') || n.includes('manual') || n.includes('attested by') || n.includes('paper attestation');
};

export const EmployeeComplianceModule: React.FC<EmployeeComplianceModuleProps> = ({
  currentUser,
  users,
  documents,
  versions,
  onOpenDocumentView,
  onRefreshData,
}) => {
  const [viewMode, setViewMode] = useState<'employees' | 'documents'>('employees');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'PENDING' | 'ACKNOWLEDGED'>('ALL');
  const [selectedDocId, setSelectedDocId] = useState<string>('ALL');
  
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  // Live state from governance engine
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgementRecord[]>(
    governanceEngine.getAcknowledgements()
  );
  
  // Action state
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Manual sign-off modal state
  const [manualSignOffAck, setManualSignOffAck] = useState<AcknowledgementRecord | null>(null);
  const [manualSignOffNotes, setManualSignOffNotes] = useState('');

  // Refresh acknowledgements from engine
  const refreshAcks = () => {
    setAcknowledgements(governanceEngine.getAcknowledgements());
  };

  React.useEffect(() => {
    refreshAcks();
  }, [users, documents, versions]);

  const allEmployees = useMemo(() => {
    const rawUsers = users && users.length > 0 ? users : governanceEngine.getUsers();
    const filtered = rawUsers.filter((u) => {
      const r = (u.role || '').toString().toUpperCase();
      return r === 'EMPLOYEE' && u.active !== false;
    });

    // Deduplicate by canonical employee ID / login ID / email
    const seen = new Set<string>();
    const uniqueEmployees: User[] = [];

    for (const emp of filtered) {
      const key = (emp.empId || emp.loginId || emp.email || emp.id || '').toString().toUpperCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      uniqueEmployees.push(emp);
    }

    return uniqueEmployees;
  }, [users]);

  const publishedDocs = useMemo(() => {
    return documents.filter(
      (d) =>
        d.active &&
        d.currentStatus === VersionStatus.PUBLISHED &&
        d.acknowledgementRequired &&
        (d.confidentiality === ConfidentialityLevel.PUBLIC || d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT)
    );
  }, [documents]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    allEmployees.forEach((e) => {
      if (e.departmentName) set.add(e.departmentName);
    });
    return Array.from(set);
  }, [allEmployees]);

  // Aggregate stats per employee strictly derived from active published policies applicable to them
  const employeeStats = useMemo(() => {
    return allEmployees.map((emp) => {
      const empIdentifiers = [emp.id, emp.empId, emp.loginId, emp.email].filter(Boolean).map((s) => s!.toLowerCase());

      const relevantDocs = publishedDocs.filter((doc) => {
        if (doc.confidentiality === ConfidentialityLevel.PUBLIC) return true;
        if (doc.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
          return isEmployeeInDepartment(emp, doc.departmentName, doc.departmentId);
        }
        return false;
      });

      const records: AcknowledgementRecord[] = relevantDocs.map((doc) => {
        const activeVer =
          versions.find((v) => v.id === doc.currentPublishedVersionId) ||
          versions.filter((v) => v.documentMasterId === doc.id && v.status === VersionStatus.PUBLISHED).pop();
        const activeVerNum = activeVer ? activeVer.versionNumber : doc.currentPublishedVersionNumber || '1.0';

        // Check if there is an existing acknowledged record for this specific active version
        const existingAck = acknowledgements.find(
          (a) =>
            a.documentId === doc.documentId &&
            ((a.employeeId && empIdentifiers.includes(a.employeeId.toLowerCase())) ||
             (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase()))) &&
            (a.versionNumber === activeVerNum || (activeVer && a.documentVersionId === activeVer.id)) &&
            a.status === 'ACKNOWLEDGED'
        );

        if (existingAck) {
          return {
            ...existingAck,
            documentTitle: doc.title,
            versionNumber: existingAck.versionNumber || activeVerNum,
          };
        }

        // Check if there is an existing pending record in database for this specific active version
        const existingPending = acknowledgements.find(
          (a) =>
            a.documentId === doc.documentId &&
            ((a.employeeId && empIdentifiers.includes(a.employeeId.toLowerCase())) ||
             (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase()))) &&
            (a.versionNumber === activeVerNum || (activeVer && a.documentVersionId === activeVer.id)) &&
            a.status === 'PENDING'
        );

        if (existingPending) {
          return {
            ...existingPending,
            documentTitle: doc.title,
            versionNumber: existingPending.versionNumber || activeVerNum,
            status: 'PENDING' as const,
          };
        }

        const cleanEmpId = (emp.empId || emp.id || emp.loginId || emp.email || 'emp').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const cleanDocId = doc.documentId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const cleanVer = activeVerNum.replace(/\./g, '_');
        const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;

        return {
          id: deterministicId,
          documentId: doc.documentId,
          documentTitle: doc.title,
          versionNumber: activeVerNum,
          documentVersionId: activeVer ? activeVer.id : '',
          employeeId: emp.empId || emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          departmentName: emp.departmentName,
          status: 'PENDING' as const,
        };
      });

      const totalAssigned = records.length;
      const acked = records.filter((a) => a.status === 'ACKNOWLEDGED').length;
      const pending = totalAssigned - acked;
      const rate = totalAssigned > 0 ? Math.round((acked / totalAssigned) * 100) : 100;

      return {
        employee: emp,
        totalAssigned,
        acknowledgedCount: acked,
        pendingCount: pending,
        complianceRate: rate,
        records,
      };
    });
  }, [allEmployees, acknowledgements, publishedDocs, versions]);

  // Aggregate stats per document (synthesized across employees in scope)
  const documentStats = useMemo(() => {
    return publishedDocs.map((doc) => {
      const activeVer =
        versions.find((v) => v.id === doc.currentPublishedVersionId) ||
        versions.filter((v) => v.documentMasterId === doc.id && v.status === VersionStatus.PUBLISHED).pop();
      const activeVerNum = activeVer ? activeVer.versionNumber : doc.currentPublishedVersionNumber || '1.0';

      const targetEmployees = allEmployees.filter((emp) => {
        if (doc.confidentiality === ConfidentialityLevel.PUBLIC) return true;
        if (doc.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
          return isEmployeeInDepartment(emp, doc.departmentName, doc.departmentId);
        }
        return false;
      });

      const completeDocRecords: AcknowledgementRecord[] = targetEmployees.map((emp) => {
        const empIdentifiers = [emp.id, emp.empId, emp.loginId, emp.email].filter(Boolean).map((s) => s!.toLowerCase());

        const existingAck = acknowledgements.find(
          (a) =>
            a.documentId === doc.documentId &&
            ((a.employeeId && empIdentifiers.includes(a.employeeId.toLowerCase())) ||
             (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase()))) &&
            (a.versionNumber === activeVerNum || (activeVer && a.documentVersionId === activeVer.id)) &&
            a.status === 'ACKNOWLEDGED'
        );

        if (existingAck) {
          return {
            ...existingAck,
            documentTitle: doc.title,
            versionNumber: existingAck.versionNumber || activeVerNum,
          };
        }

        const existingPending = acknowledgements.find(
          (a) =>
            a.documentId === doc.documentId &&
            ((a.employeeId && empIdentifiers.includes(a.employeeId.toLowerCase())) ||
             (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase()))) &&
            (a.versionNumber === activeVerNum || (activeVer && a.documentVersionId === activeVer.id)) &&
            a.status === 'PENDING'
        );

        if (existingPending) {
          return {
            ...existingPending,
            documentTitle: doc.title,
            versionNumber: existingPending.versionNumber || activeVerNum,
            status: 'PENDING' as const,
          };
        }

        const cleanEmpId = (emp.empId || emp.id || emp.loginId || emp.email || 'emp').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const cleanDocId = doc.documentId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const cleanVer = activeVerNum.replace(/\./g, '_');
        const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;

        return {
          id: deterministicId,
          documentId: doc.documentId,
          documentTitle: doc.title,
          versionNumber: activeVerNum,
          documentVersionId: activeVer ? activeVer.id : '',
          employeeId: emp.empId || emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          departmentName: emp.departmentName,
          status: 'PENDING' as const,
        };
      });

      const totalAssigned = completeDocRecords.length;
      const acked = completeDocRecords.filter((a) => a.status === 'ACKNOWLEDGED').length;
      const pending = totalAssigned - acked;
      const rate = totalAssigned > 0 ? Math.round((acked / totalAssigned) * 100) : 100;

      return {
        document: doc,
        totalAssigned,
        acknowledgedCount: acked,
        pendingCount: pending,
        complianceRate: rate,
        records: completeDocRecords,
      };
    });
  }, [publishedDocs, allEmployees, acknowledgements, versions]);

  // Global KPI totals
  const totalAssignedGlobal = useMemo(() => {
    return employeeStats.reduce((sum, s) => sum + s.totalAssigned, 0);
  }, [employeeStats]);

  const totalAckedGlobal = useMemo(() => {
    return employeeStats.reduce((sum, s) => sum + s.acknowledgedCount, 0);
  }, [employeeStats]);

  const totalPendingGlobal = totalAssignedGlobal - totalAckedGlobal;
  const globalComplianceRate = totalAssignedGlobal > 0 ? Math.round((totalAckedGlobal / totalAssignedGlobal) * 100) : 100;

  // Filtered employee records
  const filteredEmployeeStats = useMemo(() => {
    return employeeStats.filter((item) => {
      const { employee, records, pendingCount } = item;
      const q = searchTerm.toLowerCase();

      // Search filter
      const matchesSearch =
        employee.name.toLowerCase().includes(q) ||
        employee.email.toLowerCase().includes(q) ||
        (employee.empId || employee.loginId || '').toLowerCase().includes(q) ||
        (employee.departmentName || '').toLowerCase().includes(q) ||
        records.some((r) => r.documentTitle.toLowerCase().includes(q) || r.documentId.toLowerCase().includes(q));

      // Dept filter
      const matchesDept = selectedDept === 'ALL' || employee.departmentName === selectedDept;

      // Status filter
      let matchesStatus = true;
      if (selectedStatus === 'PENDING') matchesStatus = pendingCount > 0;
      if (selectedStatus === 'ACKNOWLEDGED') matchesStatus = pendingCount === 0 && item.totalAssigned > 0;

      // Doc filter
      const matchesDoc = selectedDocId === 'ALL' || records.some((r) => r.documentId === selectedDocId);

      return matchesSearch && matchesDept && matchesStatus && matchesDoc;
    });
  }, [employeeStats, searchTerm, selectedDept, selectedStatus, selectedDocId]);

  // Filtered document matrix
  const filteredDocumentStats = useMemo(() => {
    return documentStats.filter((item) => {
      const { document, records } = item;
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        document.title.toLowerCase().includes(q) ||
        document.documentId.toLowerCase().includes(q) ||
        document.category.toLowerCase().includes(q) ||
        document.departmentName.toLowerCase().includes(q) ||
        records.some((r) => r.employeeName.toLowerCase().includes(q) || r.employeeEmail.toLowerCase().includes(q));

      const matchesDept = selectedDept === 'ALL' || document.departmentName === selectedDept;
      const matchesDoc = selectedDocId === 'ALL' || document.documentId === selectedDocId;

      let matchesStatus = true;
      if (selectedStatus === 'PENDING') matchesStatus = item.pendingCount > 0;
      if (selectedStatus === 'ACKNOWLEDGED') matchesStatus = item.pendingCount === 0 && item.totalAssigned > 0;

      return matchesSearch && matchesDept && matchesDoc && matchesStatus;
    });
  }, [documentStats, searchTerm, selectedDept, selectedDocId, selectedStatus]);

  // Handle single reminder dispatch
  const handleSendReminder = async (ack: AcknowledgementRecord) => {
    setActionLoadingId(ack.id);
    setFeedbackMessage(null);
    try {
      const res = await governanceEngine.sendComplianceReminder(ack, currentUser);
      refreshAcks();
      setFeedbackMessage({
        type: res.success ? 'success' : 'error',
        text: res.message || `Compliance reminder dispatched to ${ack.employeeEmail}`,
      });
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to dispatch reminder',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle batch reminders
  const handleBatchRemind = async (docId?: string) => {
    setActionLoadingId('batch');
    setFeedbackMessage(null);
    try {
      const res = await governanceEngine.sendBatchReminders(currentUser, docId);
      refreshAcks();
      setFeedbackMessage({
        type: 'success',
        text: res.message,
      });
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to dispatch batch reminders',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Handle manual sign-off
  const handleConfirmManualSignOff = async () => {
    if (!manualSignOffAck) return;
    try {
      setActionLoadingId(manualSignOffAck.id);
      await governanceEngine.recordManualSignOff(manualSignOffAck, manualSignOffNotes, currentUser);
      refreshAcks();
      onRefreshData?.();
      setFeedbackMessage({
        type: 'success',
        text: `Offline sign-off recorded and permanently saved for ${manualSignOffAck.employeeName} (${manualSignOffAck.documentId})`,
      });
      setManualSignOffAck(null);
      setManualSignOffNotes('');
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to record manual sign-off',
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER & CONTROLS */}
      <div className="bg-white rounded-2xl p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border border-slate-200">
        <div>
          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
            <div className="p-2.5 bg-[#FA7014]/10 border border-[#FA7014]/30 rounded-xl text-[#FA7014]">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
                <span>Employee Compliance & Acknowledgements</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#FA7014]/10 text-[#FA7014] font-semibold border border-[#FA7014]/30">
                  Live Audit Roster
                </span>
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                Monitor mandatory policy sign-offs, track individual employee acknowledgement status, and dispatch live compliance reminders.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
          <button
            id="btn-batch-remind-pending"
            onClick={() => handleBatchRemind()}
            disabled={totalPendingGlobal === 0 || actionLoadingId === 'batch'}
            className="px-4 py-2 rounded-xl bg-[#FA7014] hover:bg-[#E65A05] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-[#FA7014]/20 flex items-center space-x-2 transition-all"
          >
            {actionLoadingId === 'batch' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Mail className="w-4 h-4" />
            )}
            <span>Remind All Pending ({totalPendingGlobal})</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK TOAST */}
      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
            feedbackMessage.type === 'success'
              ? 'bg-slate-50 border-slate-200 text-slate-900'
              : 'bg-orange-50 border-orange-200 text-orange-950'
          }`}
        >
          <div className="flex items-center space-x-3">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-[#FA7014] shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-orange-600 shrink-0" />
            )}
            <span className="text-sm font-medium">{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-slate-400 hover:text-slate-700 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Workforce</span>
            <Users className="w-4 h-4 text-slate-900" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{allEmployees.length}</span>
            <span className="text-xs text-slate-500 font-medium">Employees</span>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">Active assigned personnel</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Overall Compliance</span>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-900 border border-slate-200">
              {globalComplianceRate}%
            </span>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{globalComplianceRate}%</span>
            <span className="text-xs text-slate-500 font-medium">Signed</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 bg-[#FA7014]"
              style={{ width: `${globalComplianceRate}%` }}
            />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Assignments</span>
            <FileText className="w-4 h-4 text-slate-900" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{totalAssignedGlobal}</span>
            <span className="text-xs text-slate-500 font-medium">Required sign-offs</span>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">Across {publishedDocs.length} mandatory policies</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">Acknowledged</span>
            <CheckCircle2 className="w-4 h-4 text-[#FA7014]" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-slate-900">{totalAckedGlobal}</span>
            <span className="text-xs text-slate-500 font-medium">Completed</span>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">Electronically verified</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">Pending Sign-off</span>
            <Clock className="w-4 h-4 text-[#FA7014]" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-[#FA7014]">{totalPendingGlobal}</span>
            <span className="text-xs text-slate-500 font-medium">Awaiting action</span>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">Actionable reminders ready</p>
        </div>
      </div>

      {/* FILTER & VIEW TOGGLE BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* View Switcher Tabs */}
          <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200">
            <button
              id="tab-view-employees"
              onClick={() => setViewMode('employees')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${
                viewMode === 'employees'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Employee Roster View ({allEmployees.length})</span>
            </button>
            <button
              id="tab-view-documents"
              onClick={() => setViewMode('documents')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${
                viewMode === 'documents'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileCheck className="w-4 h-4" />
              <span>Policy Matrix View ({publishedDocs.length})</span>
            </button>
          </div>

          {/* Quick Stats Pill */}
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <Info className="w-4 h-4 text-slate-400" />
            <span>
              Showing {viewMode === 'employees' ? filteredEmployeeStats.length : filteredDocumentStats.length} matching records
            </span>
          </div>
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="input-search-compliance"
              type="text"
              placeholder={viewMode === 'employees' ? 'Search employee, email, ID...' : 'Search policy, SOP title...'}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white transition-colors"
            />
          </div>

          {/* Compliance Status Filter */}
          <div>
            <select
              id="select-status-filter"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] transition-colors"
            >
              <option value="ALL">All Statuses (Pending & Acked)</option>
              <option value="PENDING">Pending Sign-off Only</option>
              <option value="ACKNOWLEDGED">100% Fully Compliant Only</option>
            </select>
          </div>

          {/* Specific Document Filter */}
          <div>
            <select
              id="select-doc-filter"
              value={selectedDocId}
              onChange={(e) => setSelectedDocId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] transition-colors truncate"
            >
              <option value="ALL">All Mandatory Policies</option>
              {publishedDocs.map((doc) => (
                <option key={doc.id} value={doc.documentId}>
                  {doc.documentId} - {doc.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* VIEW 1: EMPLOYEE ROSTER VIEW */}
      {viewMode === 'employees' && (
        <div className="space-y-3">
          {filteredEmployeeStats.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl text-center border border-slate-200 shadow-sm">
              <Users className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-800">No employees match your filter criteria</h3>
              <p className="text-xs text-slate-500 mt-1">Try resetting your search query or department filter.</p>
            </div>
          ) : (
            filteredEmployeeStats.map((item) => {
              const { employee, totalAssigned, acknowledgedCount, pendingCount, complianceRate, records } = item;
              const isExpanded = expandedEmployeeId === employee.id;

              return (
                <div
                  key={employee.id}
                  id={`emp-card-${employee.id}`}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all hover:border-slate-300"
                >
                  {/* Summary Row */}
                  <div
                    onClick={() => setExpandedEmployeeId(isExpanded ? null : employee.id)}
                    className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
                  >
                    {/* Employee Profile */}
                    <div className="flex items-center space-x-3.5">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                        <UserIcon className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="text-base font-bold text-slate-900">{employee.name}</span>
                          <span className="bg-slate-100 text-slate-800 text-[11px] font-mono px-2 py-0.5 rounded border border-slate-200 font-semibold">
                            {employee.empId || employee.loginId || employee.id}
                          </span>
                          <span className="text-xs text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 font-medium">
                            {employee.departmentName || 'General Staff'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center space-x-2">
                          <span>{employee.email}</span>
                          <span>•</span>
                          <span>{employee.title || 'Staff Member'}</span>
                        </p>
                      </div>
                    </div>

                    {/* Status & Progress */}
                    <div className="flex items-center space-x-4">
                      {/* Progress Bar Mini */}
                      <div className="w-32 hidden sm:block">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 mb-1">
                          <span>Progress</span>
                          <span className="text-slate-900">{acknowledgedCount}/{totalAssigned}</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300 bg-[#FA7014]"
                            style={{ width: `${complianceRate}%` }}
                          />
                        </div>
                      </div>

                      {/* Status Badge */}
                      {pendingCount === 0 ? (
                        <div className="bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl flex items-center space-x-1.5 text-xs font-semibold text-slate-900">
                          <CheckCircle2 className="w-4 h-4 text-[#FA7014]" />
                          <span>100% Compliant</span>
                        </div>
                      ) : (
                        <div className="bg-[#FA7014]/10 border border-[#FA7014]/30 px-3 py-1.5 rounded-xl flex items-center space-x-1.5 text-xs font-semibold text-[#FA7014]">
                          <Clock className="w-4 h-4 text-[#FA7014]" />
                          <span>{pendingCount} Pending</span>
                        </div>
                      )}

                      {/* Expand Chevron */}
                      <div className="p-1 text-slate-400 hover:text-slate-700">
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50/70 p-5 space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
                        <span>Mandatory Assigned Policies & Status</span>
                        <span>{records.length} {records.length === 1 ? 'Policy' : 'Policies'} Tracked</span>
                      </div>

                      {records.length === 0 ? (
                        <div className="bg-white p-6 rounded-xl border border-slate-200 text-center">
                          <p className="text-xs text-slate-500">
                            No mandatory public policies are currently published. When policies requiring acknowledgement are published, compliance tracking will automatically sync here.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-xs">
                          {records.map((ack) => {
                          const isAcked = ack.status === 'ACKNOWLEDGED';
                          const matchingVer = versions.find((v) => v.id === ack.documentVersionId);
                          const prevAck = !isAcked ? acknowledgements.find(
                            (a) =>
                              a.documentId === ack.documentId &&
                              ((a.employeeId && a.employeeId.toLowerCase() === (ack.employeeId || '').toLowerCase()) ||
                               (a.employeeEmail && a.employeeEmail.toLowerCase() === (ack.employeeEmail || '').toLowerCase())) &&
                              a.status === 'ACKNOWLEDGED' &&
                              a.versionNumber !== ack.versionNumber
                          ) : null;

                          return (
                            <div
                              key={ack.id}
                              id={`ack-row-${ack.id}`}
                              className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hover:bg-slate-50/80 transition-colors"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                  <span className="font-mono text-xs text-slate-900 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                    {ack.documentId}
                                  </span>
                                  <span className="text-sm font-semibold text-slate-900">{ack.documentTitle}</span>
                                  <span className="text-xs text-slate-600 font-mono bg-slate-100 px-1.5 py-0.5 rounded">v{ack.versionNumber}</span>
                                  {prevAck && (
                                    <span className="text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full inline-flex items-center space-x-1">
                                      <span>Revised Document (v{prevAck.versionNumber} signed on {formatISTDate(prevAck.acknowledgedAt || '')})</span>
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex items-center space-x-3 text-xs text-slate-500">
                                  {isAcked ? (
                                    <span className="text-slate-900 flex items-center space-x-1 font-medium">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-[#FA7014]" />
                                      <span>
                                        {isOfflineSignOff(ack)
                                          ? `Record Offline Sign-off on ${formatIST(ack.acknowledgedAt || '')}`
                                          : `Signed on ${formatIST(ack.acknowledgedAt || '')}`}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-[#FA7014] flex items-center space-x-1 font-medium">
                                      <Clock className="w-3.5 h-3.5" />
                                      <span>
                                        {prevAck
                                          ? `Action Required • Revision v${ack.versionNumber} pending re-acknowledgement`
                                          : 'Action Required • Pending electronic acknowledgement'}
                                      </span>
                                    </span>
                                  )}

                                  {ack.signatureReference && (
                                    <span className="text-slate-400 font-mono">
                                      Ref: {ack.signatureReference}
                                    </span>
                                  )}

                                  {ack.reminderSentAt && (
                                    <span className="text-slate-600">
                                      • Last reminded: {formatISTDate(ack.reminderSentAt)}
                                    </span>
                                  )}
                                </div>

                                {ack.notes && (
                                  <p className="text-xs text-slate-600 italic bg-slate-50 px-2.5 py-1 rounded border border-slate-200 inline-block mt-1">
                                    Note: {ack.notes}
                                  </p>
                                )}
                                {ack.recordedBy && (
                                  <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
                                    Recorder: {ack.recordedBy}
                                  </span>
                                )}
                              </div>

                              {/* Row Actions */}
                              <div className="flex items-center space-x-2 shrink-0">
                                {!isAcked && (
                                  <>
                                    <button
                                      id={`btn-remind-${ack.id}`}
                                      onClick={() => handleSendReminder(ack)}
                                      disabled={actionLoadingId === ack.id}
                                      className="px-3 py-1.5 rounded-lg bg-[#FA7014]/10 hover:bg-[#FA7014]/20 text-[#FA7014] text-xs font-semibold border border-[#FA7014]/30 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
                                      title="Send an automated email reminder"
                                    >
                                      {actionLoadingId === ack.id ? (
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Mail className="w-3.5 h-3.5" />
                                      )}
                                      <span>Send Reminder</span>
                                    </button>

                                    <button
                                      id={`btn-manual-sign-${ack.id}`}
                                      onClick={() => {
                                        setManualSignOffAck(ack);
                                        setManualSignOffNotes('');
                                      }}
                                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold border border-slate-200 flex items-center space-x-1.5 transition-colors"
                                      title="Record offline paper or physical attestation"
                                    >
                                      <PenTool className="w-3.5 h-3.5 text-slate-600" />
                                      <span>Record Offline Sign-off</span>
                                    </button>
                                  </>
                                )}

                                {isAcked && (
                                  <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200 flex items-center space-x-1">
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>{isOfflineSignOff(ack) ? 'Offline Sign-off Verified' : 'Verified'}</span>
                                  </span>
                                )}

                                {matchingVer && onOpenDocumentView && (
                                  <button
                                    onClick={() => onOpenDocumentView(matchingVer)}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
                                    title="View Policy Document"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW 2: POLICY MATRIX VIEW */}
      {viewMode === 'documents' && (
        <div className="space-y-3">
          {filteredDocumentStats.length === 0 ? (
            <div className="bg-white p-12 rounded-2xl text-center border border-slate-200 shadow-sm">
              <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-800">No policy documents match your criteria</h3>
              <p className="text-xs text-slate-500 mt-1">Try changing your search keywords or department filter.</p>
            </div>
          ) : (
            filteredDocumentStats.map((item) => {
              const { document, totalAssigned, acknowledgedCount, pendingCount, complianceRate, records } = item;
              const isExpanded = expandedDocId === document.id;

              return (
                <div
                  key={document.id}
                  id={`doc-card-${document.id}`}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all hover:border-slate-300"
                >
                  {/* Summary Row */}
                  <div
                    onClick={() => setExpandedDocId(isExpanded ? null : document.id)}
                    className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition-colors"
                  >
                    <div>
                      <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
                        <span className="font-mono text-xs text-slate-900 font-bold bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200">
                          {document.documentId}
                        </span>
                        <span className="text-base font-bold text-slate-900">{document.title}</span>
                        <span className="text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-semibold border border-slate-200">
                          {document.category}
                        </span>
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium border border-slate-200">
                          {document.departmentName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Live Policy Version: <span className="font-mono text-slate-700">{document.currentPublishedVersionId ? `Active` : 'v1.0'}</span> • Mandated for all corporate employees
                      </p>
                    </div>

                    {/* Progress and Actions */}
                    <div className="flex items-center space-x-4">
                      <div className="w-36 text-right">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
                          <span>Compliance</span>
                          <span className="text-slate-900">{acknowledgedCount}/{totalAssigned} ({complianceRate}%)</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300 bg-[#FA7014]"
                            style={{ width: `${complianceRate}%` }}
                          />
                        </div>
                      </div>

                      {pendingCount > 0 && (
                        <button
                          id={`btn-remind-policy-${document.documentId}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBatchRemind(document.documentId);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#FA7014]/10 hover:bg-[#FA7014]/20 text-[#FA7014] text-xs font-semibold border border-[#FA7014]/30 flex items-center space-x-1.5 transition-colors"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          <span>Remind Pending ({pendingCount})</span>
                        </button>
                      )}

                      <div className="p-1 text-slate-400 hover:text-slate-700">
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Employee Breakdown */}
                  {isExpanded && (
                    <div className="border-t border-slate-200 bg-slate-50/70 p-5 space-y-3">
                      <div className="text-xs text-slate-500 font-semibold mb-2">
                        Employee Roster Acknowledgement Status ({records.length} Employees)
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {records.map((ack) => {
                          const isAcked = ack.status === 'ACKNOWLEDGED';
                          const prevAck = !isAcked ? acknowledgements.find(
                            (a) =>
                              a.documentId === ack.documentId &&
                              ((a.employeeId && a.employeeId.toLowerCase() === (ack.employeeId || '').toLowerCase()) ||
                               (a.employeeEmail && a.employeeEmail.toLowerCase() === (ack.employeeEmail || '').toLowerCase())) &&
                              a.status === 'ACKNOWLEDGED' &&
                              a.versionNumber !== ack.versionNumber
                          ) : null;

                          return (
                            <div
                              key={ack.id}
                              className="p-3 rounded-xl border flex items-center justify-between gap-3 bg-white border-slate-200 shadow-xs"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900 truncate">{ack.employeeName}</p>
                                <p className="text-[11px] text-slate-500 truncate">{ack.employeeEmail}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  {isAcked
                                    ? `Signed v${ack.versionNumber}: ${formatISTDate(ack.acknowledgedAt || '')}`
                                    : prevAck
                                    ? `Signed v${prevAck.versionNumber} • Needs v${ack.versionNumber} Sign-off`
                                    : `Awaiting v${ack.versionNumber} Sign-off`}
                                </p>
                              </div>

                              <div className="shrink-0">
                                {isAcked ? (
                                  <span className="p-1 rounded-full bg-slate-100 text-[#FA7014] inline-block border border-slate-200" title={`Signed v${ack.versionNumber}`}>
                                    <CheckCircle2 className="w-4 h-4" />
                                  </span>
                                ) : (
                                  <button
                                    id={`btn-remind-emp-${ack.id}`}
                                    onClick={() => handleSendReminder(ack)}
                                    disabled={actionLoadingId === ack.id}
                                    className="p-1.5 rounded-lg bg-[#FA7014]/10 hover:bg-[#FA7014]/20 text-[#FA7014] text-xs border border-[#FA7014]/30 transition-colors"
                                    title={`Send Email Reminder for v${ack.versionNumber}`}
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MANUAL SIGN-OFF MODAL */}
      {manualSignOffAck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center space-x-2 text-slate-900">
                <PenTool className="w-5 h-5 text-[#FA7014]" />
                <h3 className="text-base font-bold text-slate-900">Record Manual Physical Sign-Off</h3>
              </div>
              <button
                onClick={() => setManualSignOffAck(null)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Record an offline or physical acknowledgement attestation on behalf of{' '}
              <strong className="text-slate-900">{manualSignOffAck.employeeName}</strong> ({manualSignOffAck.employeeEmail}).
            </p>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-1">
              <div><strong>Document:</strong> {manualSignOffAck.documentTitle} (v{manualSignOffAck.versionNumber})</div>
              <div><strong>Document ID:</strong> {manualSignOffAck.documentId}</div>
              <div>
                <strong>Recorder Name:</strong> {currentUser.name} ({currentUser.title || (currentUser.role === 'REVIEWER' ? 'Compliance Approver' : 'HR Policy & Governance Lead')})
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Attestation Notes / Verification Reference (Optional):
              </label>
              <textarea
                id="input-manual-notes"
                rows={3}
                placeholder="e.g., Physical signature signed on onboarding paper packet / Confirmed during orientation."
                value={manualSignOffNotes}
                onChange={(e) => setManualSignOffNotes(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white"
              />
            </div>

            <div className="flex items-center justify-end space-x-2.5 pt-2">
              <button
                onClick={() => setManualSignOffAck(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-manual-signoff"
                onClick={handleConfirmManualSignOff}
                disabled={actionLoadingId === manualSignOffAck.id}
                className="px-4 py-2 rounded-xl bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-semibold shadow-md shadow-[#FA7014]/20 flex items-center space-x-1.5 transition-colors disabled:opacity-50"
              >
                {actionLoadingId === manualSignOffAck.id ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Confirm & Record Sign-off</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
