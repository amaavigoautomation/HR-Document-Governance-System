import React, { useState, useEffect } from 'react';
import {
  AcknowledgementRecord,
  DocumentMaster,
  DocumentVersion,
  User,
  UserRole,
  VersionStatus,
} from './types';
import { governanceEngine } from './services/governance';
import { auditService } from './services/audit';
import { defaultEmailProvider } from './services/email';
import { firestoreService } from './services/firestoreService';
import { HRHeader } from './components/HRHeader';
import { ApproverHeader } from './components/ApproverHeader';
import { EmployeeHeader } from './components/EmployeeHeader';
import { LoginView } from './components/LoginView';
import { CreatorDashboard } from './components/CreatorDashboard';
import { ReviewerDashboard } from './components/ReviewerDashboard';
import { EmployeePortalView } from './components/EmployeePortalView';
import { EmployeeComplianceModule } from './components/EmployeeComplianceModule';
import { AuditLogView } from './components/AuditLogView';
import { CreateDocumentModal } from './components/CreateDocumentModal';
import { CreateVersionModal } from './components/CreateVersionModal';
import { ReviewDocumentModal } from './components/ReviewDocumentModal';
import { DocumentDetailModal } from './components/DocumentDetailModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { DocumentViewer } from './components/DocumentViewer';
import { formatDDMMYYYY } from './utils/documentHeaderFooter';
import { downloadDocumentWithIntactFormat } from './utils/documentStamper';
import { FileText, X, Download } from 'lucide-react';
import { StatusBadge } from './components/StatusBadge';

const CURRENT_USER_STORAGE_KEY = 'amaavigo_current_user_id';
const CURRENT_USER_DATA_KEY = 'amaavigo_current_user_data';
const CURRENT_USER_ROLE_KEY = 'amaavigo_current_user_role';
const ACTIVE_TAB_STORAGE_KEY = 'amaavigo_active_tab';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const savedRole = localStorage.getItem(CURRENT_USER_ROLE_KEY);
      // 1. First priority: restore full cached user object from localStorage
      const savedUserData = localStorage.getItem(CURRENT_USER_DATA_KEY);
      if (savedUserData) {
        const parsed = JSON.parse(savedUserData);
        if (parsed && (parsed.id || parsed.loginId || parsed.empId)) {
          if (savedRole && (savedRole === UserRole.CREATOR || savedRole === UserRole.REVIEWER || savedRole === UserRole.EMPLOYEE)) {
            parsed.role = savedRole as UserRole;
          }
          return parsed as User;
        }
      }

      // 2. Second priority: lookup user strictly by stored unique ID / login ID
      const savedUserId = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
      if (savedUserId) {
        const users = governanceEngine.getUsers();
        const found = users.find(
          (u) =>
            (!savedRole || u.role === savedRole) &&
            (u.id === savedUserId ||
              (u.loginId && u.loginId.toUpperCase() === savedUserId.toUpperCase()) ||
              (u.empId && u.empId.toUpperCase() === savedUserId.toUpperCase()))
        );
        if (found) {
          return savedRole ? { ...found, role: savedRole as UserRole } : found;
        }
      }
    } catch (e) {
      console.warn('Could not restore user from localStorage', e);
    }
    return null;
  });

  const [activeTab, setActiveTab] = useState<'creator' | 'reviewer' | 'employee' | 'compliance' | 'audit' | 'notifications'>(() => {
    try {
      const savedTab = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      const savedRole = localStorage.getItem(CURRENT_USER_ROLE_KEY);

      if (savedRole === UserRole.CREATOR) {
        if (savedTab && ['creator', 'compliance', 'audit'].includes(savedTab)) {
          return savedTab as any;
        }
        return 'creator';
      }
      if (savedRole === UserRole.REVIEWER) {
        if (savedTab && ['reviewer', 'compliance', 'audit'].includes(savedTab)) {
          return savedTab as any;
        }
        return 'reviewer';
      }
      if (savedRole === UserRole.EMPLOYEE) {
        return 'employee';
      }

      if (savedTab && ['creator', 'reviewer', 'employee', 'compliance', 'audit', 'notifications'].includes(savedTab)) {
        return savedTab as any;
      }
    } catch (e) {
      console.warn('Could not read activeTab from localStorage', e);
    }
    return 'creator';
  });

  // Governance Data State
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [documents, setDocuments] = useState<DocumentMaster[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgementRecord[]>(() =>
    governanceEngine.getAcknowledgements()
  );
  const [notificationCount, setNotificationCount] = useState(0);
  const [pendingComplianceCount, setPendingComplianceCount] = useState(0);

  // Modals
  const [showCreateDocModal, setShowCreateDocModal] = useState(false);
  const [showCreateVerModal, setShowCreateVerModal] = useState(false);
  const [targetDocForVersion, setTargetDocForVersion] = useState<DocumentMaster | undefined>(undefined);
  const [reviewVersion, setReviewVersion] = useState<DocumentVersion | null>(null);
  const [detailDocument, setDetailDocument] = useState<DocumentMaster | null>(null);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [readerVersion, setReaderVersion] = useState<DocumentVersion | null>(null);

  // Sync data from governance engine
  const refreshData = () => {
    const users = [...governanceEngine.getUsers()];
    setAllUsers(users);
    setCurrentUser((prev) => {
      const savedRole = localStorage.getItem(CURRENT_USER_ROLE_KEY);
      if (prev) {
        const roleToKeep = (prev.role || savedRole || UserRole.EMPLOYEE) as UserRole;
        // Strictly match users by unique immutable ID (id, loginId, empId). Never match by role-only or shared email!
        const match = users.find(
          (u) =>
            u.role === roleToKeep &&
            (u.id === prev.id ||
              (prev.loginId && u.loginId && u.loginId.toUpperCase() === prev.loginId.toUpperCase()) ||
              (prev.empId && u.empId && u.empId.toUpperCase() === prev.empId.toUpperCase()))
        );
        const updated = match ? { ...match, role: roleToKeep } : prev;
        try {
          localStorage.setItem(CURRENT_USER_STORAGE_KEY, updated.id);
          localStorage.setItem(CURRENT_USER_DATA_KEY, JSON.stringify(updated));
          localStorage.setItem(CURRENT_USER_ROLE_KEY, updated.role);
        } catch (e) {}
        return updated;
      }

      try {
        const savedUserData = localStorage.getItem(CURRENT_USER_DATA_KEY);
        if (savedUserData) {
          const parsed = JSON.parse(savedUserData);
          if (parsed && (parsed.id || parsed.loginId || parsed.empId)) {
            const roleToKeep = (savedRole || parsed.role || UserRole.EMPLOYEE) as UserRole;
            const match = users.find(
              (u) =>
                u.role === roleToKeep &&
                (u.id === parsed.id ||
                  (parsed.loginId && u.loginId && u.loginId.toUpperCase() === parsed.loginId.toUpperCase()) ||
                  (parsed.empId && u.empId && u.empId.toUpperCase() === parsed.empId.toUpperCase()))
            );
            return match ? { ...match, role: roleToKeep } : parsed;
          }
        }
        const savedUserId = localStorage.getItem(CURRENT_USER_STORAGE_KEY);
        if (savedUserId) {
          const roleToKeep = (savedRole || UserRole.EMPLOYEE) as UserRole;
          const match = users.find(
            (u) =>
              (!savedRole || u.role === roleToKeep) &&
              (u.id === savedUserId ||
                (u.loginId && u.loginId.toUpperCase() === savedUserId.toUpperCase()) ||
                (u.empId && u.empId.toUpperCase() === savedUserId.toUpperCase()))
          );
          if (match) {
            const resolved = { ...match, role: roleToKeep };
            localStorage.setItem(CURRENT_USER_DATA_KEY, JSON.stringify(resolved));
            if (savedRole) localStorage.setItem(CURRENT_USER_ROLE_KEY, savedRole);
            return resolved;
          }
        }
      } catch (e) {}
      return null;
    });
    const docs = [...governanceEngine.getDocumentMasters()];
    setDocuments(docs);
    const allVers: DocumentVersion[] = [];
    docs.forEach((doc) => {
      allVers.push(...governanceEngine.getDocumentVersions(doc.id));
    });
    const existingIds = new Set(allVers.map((v) => v.id));
    for (const v of (governanceEngine as any).documentVersions || []) {
      if (!existingIds.has(v.id)) {
        allVers.push(v);
      }
    }
    setVersions([...allVers]);
    setNotificationCount(defaultEmailProvider.getNotifications().length);
    const acks = governanceEngine.getAcknowledgements();
    setAcknowledgements([...acks]);
    setPendingComplianceCount(acks.filter((a) => a.status === 'PENDING').length);
  };

  useEffect(() => {
    refreshData();
    // Dynamically hydrate from Firestore database
    const hydrateFromFirestore = async () => {
      try {
        const [cloudEmps, cloudDocs, cloudVers, cloudAcks, cloudLogs] = await Promise.all([
          firestoreService.getEmployees(),
          firestoreService.getDocuments(),
          firestoreService.getVersions(),
          firestoreService.getAcknowledgements(),
          firestoreService.getAuditLogs(),
        ]);

        if (cloudEmps && cloudEmps.length > 0) {
          governanceEngine.setEmployees(cloudEmps);
        }
        if (cloudDocs !== undefined) {
          (governanceEngine as any).documentMasters = cloudDocs;
        }
        if (cloudVers !== undefined) {
          (governanceEngine as any).documentVersions = cloudVers;
          governanceEngine.syncVersionsToStorage(cloudVers);
        }
        if (cloudAcks !== undefined) {
          governanceEngine.setAcknowledgements(cloudAcks);
        }
        if (cloudLogs && cloudLogs.length > 0) {
          auditService.syncCloudLogs(cloudLogs);
        }
        refreshData();
      } catch (e) {
        console.warn('Firestore hydration note:', e);
      }
    };

    hydrateFromFirestore();

    // Real-time synchronization listeners
    const unsubEmployees = firestoreService.subscribeToEmployees((cloudEmployees) => {
      if (cloudEmployees && cloudEmployees.length > 0) {
        governanceEngine.setEmployees(cloudEmployees);
        refreshData();
      }
    });

    const unsubDocs = firestoreService.subscribeToDocuments((cloudDocs) => {
      if (cloudDocs !== undefined) {
        (governanceEngine as any).documentMasters = cloudDocs;
        refreshData();
      }
    });

    const unsubVers = firestoreService.subscribeToVersions((cloudVers) => {
      if (cloudVers !== undefined) {
        (governanceEngine as any).documentVersions = cloudVers;
        governanceEngine.syncVersionsToStorage(cloudVers);
        refreshData();
      }
    });

    const unsubAcks = firestoreService.subscribeToAcknowledgements((cloudAcks) => {
      if (cloudAcks !== undefined) {
        governanceEngine.setAcknowledgements(cloudAcks);
        refreshData();
      }
    });

    const unsubAudit = firestoreService.subscribeToAuditLogs((cloudLogs) => {
      if (cloudLogs && cloudLogs.length > 0) {
        auditService.syncCloudLogs(cloudLogs);
        refreshData();
      }
    });

    const unsubAuditLocal = auditService.subscribe(() => {
      refreshData();
    });

    return () => {
      unsubEmployees();
      unsubDocs();
      unsubVers();
      unsubAcks();
      unsubAudit();
      unsubAuditLocal();
    };
  }, []);

  // Synchronize state changes to localStorage
  useEffect(() => {
    try {
      if (currentUser) {
        localStorage.setItem(CURRENT_USER_STORAGE_KEY, currentUser.id);
        localStorage.setItem(CURRENT_USER_DATA_KEY, JSON.stringify(currentUser));
        localStorage.setItem(CURRENT_USER_ROLE_KEY, currentUser.role);
      }
    } catch (e) {
      console.warn('Error saving user to localStorage:', e);
    }
  }, [currentUser]);

  useEffect(() => {
    try {
      if (activeTab) {
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
      }
    } catch (e) {
      console.warn('Error saving active tab to localStorage:', e);
    }
  }, [activeTab]);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    try {
      localStorage.setItem(CURRENT_USER_STORAGE_KEY, user.id);
      localStorage.setItem(CURRENT_USER_DATA_KEY, JSON.stringify(user));
      localStorage.setItem(CURRENT_USER_ROLE_KEY, user.role);
    } catch (e) {}
    let targetTab: 'creator' | 'reviewer' | 'employee' | 'compliance' | 'audit' = 'creator';
    if (user.role === UserRole.CREATOR) {
      targetTab = 'creator';
    } else if (user.role === UserRole.REVIEWER) {
      targetTab = 'reviewer';
    } else if (user.role === UserRole.EMPLOYEE) {
      targetTab = 'employee';
    }
    setActiveTab(targetTab);
    try {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, targetTab);
    } catch (e) {}
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem(CURRENT_USER_STORAGE_KEY);
      localStorage.removeItem(CURRENT_USER_DATA_KEY);
      localStorage.removeItem(CURRENT_USER_ROLE_KEY);
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    } catch (e) {}
  };

  const handleResetSeed = async () => {
    if (window.confirm('Reset all HR document masters, versions, and audit logs to clean seed state?')) {
      await governanceEngine.restoreDefaultSeed();
      refreshData();
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    await governanceEngine.deleteDocument(docId, currentUser || undefined);
    refreshData();
  };

  const handleClearAllDocuments = async () => {
    await governanceEngine.clearAllDocuments(currentUser || undefined);
    refreshData();
  };

  const handleRestoreSeedDocuments = async () => {
    await governanceEngine.restoreDefaultSeed();
    refreshData();
  };

  const handleOpenCreateVersion = (doc?: DocumentMaster) => {
    setTargetDocForVersion(doc);
    setShowCreateVerModal(true);
  };

  const handleOpenComparison = (versionId: string) => {
    const ver = versions.find((v) => v.id === versionId);
    if (ver) {
      setReviewVersion(ver);
    }
  };

  return (
    <div className={!currentUser ? "h-screen max-h-screen overflow-hidden bg-[#F8FAFC] flex flex-col font-sans text-slate-900" : "min-h-screen bg-[#F8FAFC] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(250,112,20,0.05),rgba(255,255,255,0))] flex flex-col font-sans text-slate-900"}>
      {/* Separate Isolated Header for each dashboard */}
      {!currentUser ? null : currentUser.role === UserRole.CREATOR ? (
        <HRHeader
          currentUser={currentUser}
          onLogout={handleLogout}
          activeTab={activeTab === 'compliance' || activeTab === 'audit' ? activeTab : 'creator'}
          setActiveTab={(tab) => setActiveTab(tab)}
          pendingComplianceCount={pendingComplianceCount}
        />
      ) : currentUser.role === UserRole.REVIEWER ? (
        <ApproverHeader
          currentUser={currentUser}
          onLogout={handleLogout}
          activeTab={activeTab === 'compliance' || activeTab === 'audit' ? activeTab : 'reviewer'}
          setActiveTab={(tab) => setActiveTab(tab)}
          notificationCount={notificationCount}
          pendingComplianceCount={pendingComplianceCount}
          onOpenNotifications={() => setIsNotifDrawerOpen(true)}
        />
      ) : (
        <EmployeeHeader
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}

      {/* Main Screen Content */}
      <main className={currentUser ? "flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6" : "flex-1 w-full h-full p-0 flex flex-col overflow-hidden"}>
        {!currentUser ? (
          /* Dual Creator / Reviewer / Employee Login Screen */
          <LoginView users={allUsers} onSelectUser={handleLogin} />
        ) : currentUser.role === UserRole.CREATOR ? (
          <>
            {(activeTab === 'creator' || (activeTab !== 'compliance' && activeTab !== 'audit')) && (
              <CreatorDashboard
                currentUser={currentUser}
                documents={documents}
                versions={versions}
                onOpenCreateDocument={() => setShowCreateDocModal(true)}
                onOpenCreateVersion={handleOpenCreateVersion}
                onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
                onOpenComparison={handleOpenComparison}
                onOpenComplianceTracker={() => setActiveTab('compliance')}
                onDeleteDocument={handleDeleteDocument}
                onClearAllDocuments={handleClearAllDocuments}
                onRestoreSeedDocuments={handleRestoreSeedDocuments}
              />
            )}

            {activeTab === 'compliance' && (
              <EmployeeComplianceModule
                currentUser={currentUser}
                users={allUsers}
                documents={documents}
                versions={versions}
                onOpenDocumentView={(ver) => setReaderVersion(ver)}
              />
            )}

            {activeTab === 'audit' && <AuditLogView users={allUsers} />}
          </>
        ) : currentUser.role === UserRole.REVIEWER ? (
          <>
            {(activeTab === 'reviewer' || (activeTab !== 'compliance' && activeTab !== 'audit')) && (
              <ReviewerDashboard
                currentUser={currentUser}
                documents={documents}
                versions={versions}
                onOpenReviewModal={(ver) => setReviewVersion(ver)}
                onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
                onOpenComplianceTracker={() => setActiveTab('compliance')}
              />
            )}

            {activeTab === 'compliance' && (
              <EmployeeComplianceModule
                currentUser={currentUser}
                users={allUsers}
                documents={documents}
                versions={versions}
                onOpenDocumentView={(ver) => setReaderVersion(ver)}
              />
            )}

            {activeTab === 'audit' && <AuditLogView users={allUsers} />}
          </>
        ) : (
          <EmployeePortalView
            currentUser={currentUser}
            documents={documents}
            versions={versions}
            acknowledgements={acknowledgements}
            onOpenDocumentView={(ver) => setReaderVersion(ver)}
          />
        )}
      </main>

      {/* MODAL: CREATE DOCUMENT MASTER */}
      {showCreateDocModal && currentUser && (
        <CreateDocumentModal
          currentUser={currentUser}
          onClose={() => setShowCreateDocModal(false)}
          onSuccess={() => {
            setShowCreateDocModal(false);
            refreshData();
          }}
        />
      )}

      {/* MODAL: DOCUMENT DETAIL & VERSION TIMELINE */}
      {detailDocument && currentUser && (
        <DocumentDetailModal
          document={documents.find((d) => d.id === detailDocument.id || d.documentId === detailDocument.documentId) || detailDocument}
          currentUser={currentUser}
          onClose={() => setDetailDocument(null)}
          onOpenCreateVersion={handleOpenCreateVersion}
          onOpenComparison={handleOpenComparison}
          onDeleteDocument={handleDeleteDocument}
        />
      )}

      {/* MODAL: CREATE NEW VERSION */}
      {showCreateVerModal && currentUser && (
        <CreateVersionModal
          currentUser={currentUser}
          initialDocument={targetDocForVersion}
          documents={documents}
          versions={versions}
          onClose={() => setShowCreateVerModal(false)}
          onSuccess={() => {
            setShowCreateVerModal(false);
            refreshData();
          }}
        />
      )}

      {/* MODAL: REVIEWER DECISION & SIDE-BY-SIDE DIFF / BASELINE COMPARISON */}
      {reviewVersion && currentUser && (
        <ReviewDocumentModal
          version={reviewVersion}
          currentUser={currentUser}
          onClose={() => setReviewVersion(null)}
          onApproveSuccess={() => {
            setReviewVersion(null);
            refreshData();
          }}
          onRejectSuccess={() => {
            setReviewVersion(null);
            refreshData();
          }}
        />
      )}

      {/* MODAL: SIMPLE EMPLOYEE DOCUMENT READER */}
      {readerVersion && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
          <div className="bg-slate-900 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="bg-slate-900/90 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <FileText className="w-6 h-6 text-blue-400" />
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-blue-300 bg-blue-900/60 px-2 py-0.5 rounded border border-blue-700">
                      {readerVersion.documentId}
                    </span>
                    <h2 className="text-base font-bold text-white">{readerVersion.documentTitle}</h2>
                    <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2 py-0.5 rounded font-bold border border-emerald-500/30">
                      v{readerVersion.versionNumber}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Effective: {readerVersion.effectiveFrom} • SHA-256: {readerVersion.contentHash.substring(0, 16)}...
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadDocumentWithIntactFormat({
                      fileName: readerVersion.fileName,
                      documentTitle: readerVersion.documentTitle,
                      versionNumber: readerVersion.versionNumber,
                      effectiveDate: formatDDMMYYYY(readerVersion.effectiveFrom || readerVersion.createdAt),
                      createdByName: readerVersion.createdByName || 'Amee Shah',
                      approvedByName:
                        readerVersion.status === VersionStatus.PUBLISHED
                          ? (readerVersion.reviewedByName || readerVersion.publishedByName || 'Vishal Shah')
                          : 'Not yet approved',
                      approvedDate:
                        readerVersion.status === VersionStatus.PUBLISHED && (readerVersion.reviewedAt || readerVersion.publishedAt)
                          ? formatDDMMYYYY(readerVersion.reviewedAt || readerVersion.publishedAt!)
                          : 'Not yet approved',
                      companyName: 'Amaavigo',
                      rawContent: readerVersion.rawContent,
                      fileUrl: readerVersion.fileUrl,
                    })
                  }
                  className="inline-flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-slate-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Intact</span>
                </button>
                <button
                  onClick={() => setReaderVersion(null)}
                  className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
              <DocumentViewer
                fileName={readerVersion.fileName}
                rawContent={readerVersion.rawContent}
                fileUrl={readerVersion.fileUrl}
                mimeType={readerVersion.mimeType}
                headerFooterData={{
                  companyName: 'Amaavigo',
                  documentTitle: readerVersion.documentTitle,
                  versionNumber: readerVersion.versionNumber,
                  effectiveDate: formatDDMMYYYY(readerVersion.effectiveFrom || readerVersion.createdAt),
                  createdByName: readerVersion.createdByName || 'Amee Shah',
                  approvedByName:
                    readerVersion.status === VersionStatus.PUBLISHED
                      ? (readerVersion.reviewedByName || readerVersion.publishedByName || 'Authorized Approver')
                      : 'Not yet approved',
                  approvedDate:
                    readerVersion.status === VersionStatus.PUBLISHED && (readerVersion.reviewedAt || readerVersion.publishedAt)
                      ? formatDDMMYYYY(readerVersion.reviewedAt || readerVersion.publishedAt!)
                      : 'Not yet approved',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATION LOG DRAWER */}
      <NotificationDrawer
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
      />
    </div>
  );
}
