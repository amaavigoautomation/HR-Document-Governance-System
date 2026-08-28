import React, { useState, useEffect } from 'react';
import {
  DocumentMaster,
  DocumentVersion,
  User,
  UserRole,
  VersionStatus,
} from './types';
import { governanceEngine } from './services/governance';
import { defaultEmailProvider } from './services/email';
import { firestoreService } from './services/firestoreService';
import { SEED_DOCUMENTS, SEED_VERSIONS, SEED_AUDIT_LOGS } from './data/seedData';
import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { CreatorDashboard } from './components/CreatorDashboard';
import { ReviewerDashboard } from './components/ReviewerDashboard';
import { EmployeePortalView } from './components/EmployeePortalView';
import { AuditLogView } from './components/AuditLogView';
import { CreateDocumentModal } from './components/CreateDocumentModal';
import { CreateVersionModal } from './components/CreateVersionModal';
import { ReviewDocumentModal } from './components/ReviewDocumentModal';
import { DocumentDetailModal } from './components/DocumentDetailModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { DemoWorkflowModal } from './components/DemoWorkflowModal';
import { DocumentViewer } from './components/DocumentViewer';
import { FileText, X, Download } from 'lucide-react';
import { StatusBadge } from './components/StatusBadge';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'creator' | 'reviewer' | 'employee' | 'audit' | 'notifications'>('creator');

  // Governance Data State
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [documents, setDocuments] = useState<DocumentMaster[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);

  // Modals
  const [showCreateDocModal, setShowCreateDocModal] = useState(false);
  const [showCreateVerModal, setShowCreateVerModal] = useState(false);
  const [targetDocForVersion, setTargetDocForVersion] = useState<DocumentMaster | undefined>(undefined);
  const [reviewVersion, setReviewVersion] = useState<DocumentVersion | null>(null);
  const [detailDocument, setDetailDocument] = useState<DocumentMaster | null>(null);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [isDemoTourOpen, setIsDemoTourOpen] = useState(false);
  const [readerVersion, setReaderVersion] = useState<DocumentVersion | null>(null);

  // Sync data from governance engine
  const refreshData = () => {
    setAllUsers(governanceEngine.getUsers());
    setDocuments(governanceEngine.getDocumentMasters());
    const allVers: DocumentVersion[] = [];
    governanceEngine.getDocumentMasters().forEach((doc) => {
      allVers.push(...governanceEngine.getDocumentVersions(doc.id));
    });
    setVersions(allVers);
    setNotificationCount(defaultEmailProvider.getNotifications().length);
  };

  useEffect(() => {
    refreshData();
    // Seed and sync with Firestore cloud database
    firestoreService.seedFirestoreIfEmpty(
      SEED_DOCUMENTS,
      SEED_VERSIONS,
      SEED_AUDIT_LOGS,
      governanceEngine.getAcknowledgements()
    ).then(async () => {
      try {
        const cloudDocs = await firestoreService.getDocuments();
        const cloudVers = await firestoreService.getVersions();
        if (cloudDocs && cloudDocs.length > 0) {
          // Hydrate in-memory engine from Firestore
          (governanceEngine as any).documentMasters = cloudDocs;
        }
        if (cloudVers && cloudVers.length > 0) {
          (governanceEngine as any).documentVersions = cloudVers;
        }
        refreshData();
      } catch (e) {
        console.warn('Firestore hydration note:', e);
      }
    });
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    if (user.role === UserRole.CREATOR) {
      setActiveTab('creator');
    } else if (user.role === UserRole.REVIEWER) {
      setActiveTab('reviewer');
    } else {
      setActiveTab('employee');
    }
  };

  const handleSwitchUser = (user: User) => {
    setCurrentUser(user);
    if (user.role === UserRole.CREATOR) {
      setActiveTab('creator');
    } else if (user.role === UserRole.REVIEWER) {
      setActiveTab('reviewer');
    } else if (user.role === UserRole.EMPLOYEE) {
      setActiveTab('employee');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  const handleResetSeed = () => {
    if (window.confirm('Reset all HR document masters, versions, and audit logs to clean seed state?')) {
      governanceEngine.resetToSeed();
      refreshData();
    }
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
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(59,130,246,0.08),rgba(255,255,255,0))] flex flex-col font-sans text-slate-100">
      {/* Top Application Header with 1-Click Role Switcher */}
      <Header
        currentUser={currentUser}
        onSwitchUser={handleSwitchUser}
        allUsers={allUsers}
        onLogout={handleLogout}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        notificationCount={notificationCount}
        onOpenNotifications={() => setIsNotifDrawerOpen(true)}
        onResetSeed={handleResetSeed}
        onOpenDemoTour={() => setIsDemoTourOpen(true)}
      />

      {/* Main Screen Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {!currentUser ? (
          /* Dual Creator / Reviewer Login Screen */
          <LoginView users={allUsers} onSelectUser={handleLogin} />
        ) : (
          <>
            {activeTab === 'creator' && (
              <CreatorDashboard
                currentUser={currentUser}
                documents={documents}
                versions={versions}
                onOpenCreateDocument={() => setShowCreateDocModal(true)}
                onOpenCreateVersion={handleOpenCreateVersion}
                onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
                onOpenComparison={handleOpenComparison}
              />
            )}

            {activeTab === 'reviewer' && (
              <ReviewerDashboard
                currentUser={currentUser}
                documents={documents}
                versions={versions}
                onOpenReviewModal={(ver) => setReviewVersion(ver)}
                onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
              />
            )}

            {activeTab === 'employee' && (
              <EmployeePortalView
                currentUser={currentUser}
                documents={documents}
                versions={versions}
                onOpenDocumentView={(ver) => setReaderVersion(ver)}
              />
            )}

            {activeTab === 'audit' && <AuditLogView />}
          </>
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

      {/* MODAL: REVIEWER DECISION & SIDE-BY-SIDE DIFF */}
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

      {/* MODAL: DOCUMENT DETAIL & VERSION TIMELINE */}
      {detailDocument && currentUser && (
        <DocumentDetailModal
          document={detailDocument}
          currentUser={currentUser}
          onClose={() => setDetailDocument(null)}
          onOpenCreateVersion={handleOpenCreateVersion}
          onOpenComparison={handleOpenComparison}
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
                <a
                  href={readerVersion.fileUrl}
                  download={readerVersion.fileName}
                  className="inline-flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-slate-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
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

      {/* DEMO WORKFLOW GUIDE */}
      <DemoWorkflowModal
        isOpen={isDemoTourOpen}
        onClose={() => setIsDemoTourOpen(false)}
        users={allUsers}
        onSwitchUser={handleSwitchUser}
        onRefreshData={refreshData}
      />
    </div>
  );
}
