import React, { useState, useEffect, useMemo } from 'react';
import {
  AcknowledgementRecord,
  ConfidentialityLevel,
  DocumentMaster,
  DocumentVersion,
  User,
  UserRole,
  VersionStatus,
} from './types';
import { governanceEngine, isEmployeeInDepartment } from './services/governance';
import { auditService } from './services/audit';
import { defaultEmailProvider } from './services/email';
import { firestoreService } from './services/firestoreService';
import { HRHeader } from './components/HRHeader';
import { ApproverHeader } from './components/ApproverHeader';
import { EmployeeHeader } from './components/EmployeeHeader';
import { AuthScreen } from './components/AuthScreen';
import { PendingApprovalView } from './components/PendingApprovalView';
import { onSession, reloadSession, signOutUser, type SessionState } from './services/authService';
import { CreatorDashboard } from './components/CreatorDashboard';
import { ReviewerDashboard } from './components/ReviewerDashboard';
import { EmployeePortalView } from './components/EmployeePortalView';
import { EmployeeComplianceModule } from './components/EmployeeComplianceModule';
import { CreateDocumentModal } from './components/CreateDocumentModal';
import { CreateVersionModal } from './components/CreateVersionModal';
import { ReviewDocumentModal } from './components/ReviewDocumentModal';
import { DocumentDetailModal } from './components/DocumentDetailModal';
import { NotificationDrawer } from './components/NotificationDrawer';
import { DocumentViewer } from './components/DocumentViewer';
import { formatDDMMYYYY } from './utils/documentHeaderFooter';
import { downloadDocumentWithIntactFormat } from './utils/documentStamper';
import { FileText, X, Download, ExternalLink, Users, FileSpreadsheet, UserCheck } from 'lucide-react';
import { StatusBadge } from './components/StatusBadge';
import { HRAgentShell, HRAgentModule } from './components/HRAgentShell';
import { TalentAcquisitionHeader } from './components/TalentAcquisitionHeader';
import { lazyPage } from './utils/lazyPage';
import { isDepartmentHead } from './utils/requisitionPermissions';
import { hasModulePermission, normalizeAuthorizedModules } from './utils/authorization';
import { DocumentSuggestion } from './types';

// Big screens load when first opened, so the first page load stays small.
const PlatformAdminView = lazyPage(() => import('./components/PlatformAdminView').then((m) => m.PlatformAdminView));
const AdminModule = lazyPage(() => import('./components/AdminModule').then((m) => m.AdminModule));
const PolicySuggestionsDashboard = lazyPage(() => import('./components/PolicySuggestionsDashboard').then((m) => m.PolicySuggestionsDashboard));
const AuditLogView = lazyPage(() => import('./components/AuditLogView').then((m) => m.AuditLogView));
const TalentAcquisitionOverview = lazyPage(() => import('./components/TalentAcquisitionOverview').then((m) => m.TalentAcquisitionOverview));
const RequisitionsModule = lazyPage(() => import('./components/RequisitionsModule').then((m) => m.RequisitionsModule));
const OnboardingModule = lazyPage(() => import('./components/OnboardingModule').then((m) => m.OnboardingModule));
const ApplicationsModule = lazyPage(() => import('./components/ApplicationsModule').then((m) => m.ApplicationsModule));
const LeaveModule = lazyPage(() => import('./components/LeaveModule').then((m) => m.LeaveModule));
const PayrollModule = lazyPage(() => import('./components/PayrollModule').then((m) => m.PayrollModule));
const PeopleModule = lazyPage(() => import('./components/PeopleModule').then((m) => m.PeopleModule));

const ACTIVE_TAB_STORAGE_KEY = 'amaavigo_active_tab';
const HR_AGENT_MODULE_STORAGE_KEY = 'amaavigo_hr_agent_module';

export default function App() {
  // Who is signed in comes from Firebase Authentication (see authService.ts). Nothing about the user is
  // read back from localStorage, so editing browser storage cannot change someone's role.
  const [session, setSession] = useState<SessionState>({ kind: 'loading' });
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [activeTab, setActiveTab] = useState<'creator' | 'reviewer' | 'employee' | 'compliance' | 'suggestions' | 'audit' | 'notifications'>('creator');

  // HR AI Agent Shell Module State (Defaults to 'document-version-control')
  const [hrAgentModule, setHrAgentModule] = useState<HRAgentModule>('document-version-control');

  // Desktop sidebar collapse/open state with persistent storage
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('amaavigo_hr_agent_sidebar_open');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch (e) {}
    return true;
  });

  const handleToggleSidebar = () => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('amaavigo_hr_agent_sidebar_open', String(next));
      } catch (e) {}
      return next;
    });
  };

  const handleSelectHRAgentModule = (module: HRAgentModule) => {
    const isTalentModule =
      module === 'talent-acquisition' ||
      module === 'talent-acquisition-overview' ||
      module === 'talent-acquisition-requisitions' ||
      module === 'talent-acquisition-applications' ||
      module === 'talent-acquisition-onboarding';
    const hasTalent = hasModulePermission(currentUser, 'talent-acquisition');
    const hasDocGov = hasModulePermission(currentUser, 'document-version-control');

    // If user is not authorized for Talent Acquisition
    if (isTalentModule && !hasTalent) {
      if (hasDocGov) {
        setHrAgentModule('document-version-control');
        try {
          localStorage.setItem(HR_AGENT_MODULE_STORAGE_KEY, 'document-version-control');
        } catch (e) {}
      }
      return;
    }

    // If user is not authorized for Document Version Control
    if (module === 'document-version-control' && !hasDocGov) {
      if (hasTalent) {
        setHrAgentModule('talent-acquisition-overview');
        try {
          localStorage.setItem(HR_AGENT_MODULE_STORAGE_KEY, 'talent-acquisition-overview');
        } catch (e) {}
      }
      return;
    }

    setHrAgentModule(module);
    try {
      localStorage.setItem(HR_AGENT_MODULE_STORAGE_KEY, module);
    } catch (e) {}
  };

  // URL Routing synchronization to maintain clean URLs across roles
  useEffect(() => {
    try {
      const currentPath = window.location.pathname;
      let targetPath = currentPath;

      if (!currentUser) {
        if (currentPath !== '/login' && currentPath !== '/') {
          targetPath = '/login';
        }
      } else if (currentUser.role === UserRole.EMPLOYEE) {
        targetPath = '/employee';
      } else if (currentUser.role === UserRole.CREATOR) {
        if (hrAgentModule === 'talent-acquisition') {
          targetPath = '/hr/talent-acquisition';
        } else {
          targetPath = '/hr/document-version-control';
        }
      } else if (currentUser.role === UserRole.REVIEWER) {
        targetPath = '/approver/document-version-control';
      }

      if (targetPath && targetPath !== currentPath) {
        window.history.replaceState({}, '', targetPath);
      }
    } catch (e) {
      console.warn('URL routing sync note:', e);
    }
  }, [currentUser, hrAgentModule]);

  // Browser navigation popstate listener
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path.includes('/talent-acquisition')) {
        if (currentUser?.role === UserRole.CREATOR) {
          setHrAgentModule('talent-acquisition');
        } else {
          setHrAgentModule('document-version-control');
        }
      } else if (path.includes('/document-version-control')) {
        setHrAgentModule('document-version-control');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentUser]);

  // Governance Data State
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [showHiringRequests, setShowHiringRequests] = useState(false);
  const [documents, setDocuments] = useState<DocumentMaster[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [acknowledgements, setAcknowledgements] = useState<AcknowledgementRecord[]>(() =>
    governanceEngine.getAcknowledgements()
  );
  const [suggestions, setSuggestions] = useState<DocumentSuggestion[]>(() =>
    governanceEngine.getDocumentSuggestions()
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
  const [employeeTab, setEmployeeTab] = useState<'acknowledgements' | 'all-documents'>('acknowledgements');
  const [employeeSection, setEmployeeSection] = useState<'policies' | 'leave' | 'payroll' | 'people'>('policies');

  // Pending compliance documents count for logged in Employee
  const employeePendingCount = useMemo(() => {
    if (!currentUser || currentUser.role !== UserRole.EMPLOYEE) return 0;
    const userIdentifiers = [currentUser.id, currentUser.empId, currentUser.loginId, currentUser.email]
      .filter(Boolean)
      .map((s) => s!.toLowerCase());

    const matchedUser =
      governanceEngine.findUserByIdentifiers(currentUser.id) ||
      governanceEngine.findUserByIdentifiers(currentUser.empId) ||
      governanceEngine.findUserByIdentifiers(currentUser.email);
    if (matchedUser) {
      [matchedUser.id, matchedUser.empId, matchedUser.loginId, matchedUser.email].forEach((id) => {
        if (id && !userIdentifiers.includes(id.toLowerCase())) {
          userIdentifiers.push(id.toLowerCase());
        }
      });
    }

    const effectiveAcks = acknowledgements.length > 0 ? acknowledgements : governanceEngine.getAcknowledgements();
    const userAcks = effectiveAcks.filter(
      (a) =>
        (a.employeeId && userIdentifiers.includes(a.employeeId.toLowerCase())) ||
        (a.employeeEmail && userIdentifiers.includes(a.employeeEmail.toLowerCase()))
    );

    const publishedDocs = documents.filter((d) => {
      if (!d.active || d.currentStatus !== VersionStatus.PUBLISHED || !d.acknowledgementRequired) return false;
      if (d.confidentiality === ConfidentialityLevel.PUBLIC) return true;
      if (d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
        return isEmployeeInDepartment(currentUser, d.departmentName, d.departmentId);
      }
      return false;
    });

    return publishedDocs.filter((doc) => {
      const verNumber = doc.currentPublishedVersionNumber || '1.0';
      const ack = userAcks.find(
        (a) =>
          a.documentId.toLowerCase() === doc.documentId.toLowerCase() &&
          a.versionNumber === verNumber &&
          a.status === 'ACKNOWLEDGED'
      );
      return !ack;
    }).length;
  }, [currentUser, documents, acknowledgements]);

  const employeeTotalDocsCount = useMemo(() => {
    if (!currentUser || currentUser.role !== UserRole.EMPLOYEE) return 0;
    return documents.filter((d) => {
      if (!d.active || d.currentStatus !== VersionStatus.PUBLISHED) return false;
      if (d.confidentiality === ConfidentialityLevel.PUBLIC) return true;
      if (d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
        return isEmployeeInDepartment(currentUser, d.departmentName, d.departmentId);
      }
      return false;
    }).length;
  }, [currentUser, documents]);

  // Published document identifiers (strictly for published policies authorized and published by Approver)
  const publishedDocIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    documents.forEach((d) => {
      const hasPublishedVer =
        Boolean(d.currentPublishedVersionId) ||
        versions.some(
          (v) =>
            (v.documentMasterId === d.id || v.documentId === d.documentId) &&
            v.status === VersionStatus.PUBLISHED
        );
      if (d.active && d.currentStatus === VersionStatus.PUBLISHED && hasPublishedVer) {
        if (d.id) ids.add(d.id.toLowerCase().trim());
        if (d.documentId) ids.add(d.documentId.toLowerCase().trim());
      }
    });
    return ids;
  }, [documents, versions]);

  const activeSuggestions = useMemo(() => {
    return suggestions.filter((s) => {
      const docLogicalId = (s.documentId || '').toLowerCase().trim();
      const docMasterId = (s.documentMasterId || '').toLowerCase().trim();
      return (
        (docLogicalId && publishedDocIdentifiers.has(docLogicalId)) ||
        (docMasterId && publishedDocIdentifiers.has(docMasterId))
      );
    });
  }, [suggestions, publishedDocIdentifiers]);

  // Sync data from governance engine
  const refreshData = () => {
    const users = [...governanceEngine.getUsers()];
    setAllUsers(users);
    // Keep the signed-in user's profile fresh, but never change who they are or what they may do:
    // role, permissions and admin flag come from the verified sign-in token, not from the profile list.
    setCurrentUser((prev) => {
      if (!prev) return prev;
      const match = users.find((u) => u.id === prev.id);
      if (!match) return prev;
      return {
        ...match,
        role: prev.role,
        perms: prev.perms,
        isCompanyAdmin: prev.isCompanyAdmin,
        authUid: prev.authUid,
        companyId: prev.companyId,
        companyName: prev.companyName,
        authorizedModules: prev.authorizedModules,
      };
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
    allVers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setVersions([...allVers]);
    setNotificationCount(defaultEmailProvider.getNotifications().length);
    const acks = governanceEngine.getAcknowledgements();
    setAcknowledgements([...acks]);
    setPendingComplianceCount(acks.filter((a) => a.status === 'PENDING').length);
    const sugs = governanceEngine.getDocumentSuggestions();
    setSuggestions([...sugs]);
  };

  // Company data is only loaded once the person is signed in AND their company is approved.
  const sessionReady = session.kind === 'ready';
  useEffect(() => {
    if (!sessionReady) return;
    refreshData();
    // Dynamically hydrate from Firestore database
    const hydrateFromFirestore = async () => {
      try {
        const [cloudEmps, cloudDocs, cloudVers, cloudAcks, cloudLogs, cloudSugs] = await Promise.all([
          firestoreService.getEmployees(),
          firestoreService.getDocuments(),
          firestoreService.getVersions(),
          firestoreService.getAcknowledgements(),
          firestoreService.getAuditLogs(),
          firestoreService.getSuggestions(),
        ]);

        if (cloudEmps && cloudEmps.length > 0) {
          governanceEngine.setEmployees(cloudEmps);
        }
        if (Array.isArray(cloudDocs)) {
          (governanceEngine as any).documentMasters = cloudDocs;
        }
        if (Array.isArray(cloudVers)) {
          (governanceEngine as any).documentVersions = cloudVers;
          governanceEngine.syncVersionsToStorage(cloudVers);
        }
        if (Array.isArray(cloudAcks)) {
          governanceEngine.setAcknowledgements(cloudAcks);
        }
        if (cloudLogs && cloudLogs.length > 0) {
          auditService.syncCloudLogs(cloudLogs);
        }
        if (Array.isArray(cloudSugs)) {
          governanceEngine.setDocumentSuggestions(cloudSugs);
        }
        refreshData();

        // Automatically verify and dispatch 2-day re-review reminders to HR Creators
        try {
          await governanceEngine.checkAndDispatchReReviewReminders();
        } catch (e) {
          console.warn('Auto re-review reminder note:', e);
        }
      } catch (e) {
        console.warn('Firestore hydration note:', e);
      }
    };

    hydrateFromFirestore();

    // Periodic check for upcoming 2-day re-review dates
    const reminderTimer = setInterval(() => {
      governanceEngine.checkAndDispatchReReviewReminders().catch(() => {});
    }, 15 * 60 * 1000);

    // Real-time synchronization listeners
    const unsubEmployees = firestoreService.subscribeToEmployees((cloudEmployees) => {
      if (cloudEmployees && cloudEmployees.length > 0) {
        governanceEngine.setEmployees(cloudEmployees);
        refreshData();
      }
    });

    const unsubDocs = firestoreService.subscribeToDocuments((cloudDocs) => {
      if (Array.isArray(cloudDocs)) {
        (governanceEngine as any).documentMasters = cloudDocs;
        refreshData();
      }
    });

    const unsubVers = firestoreService.subscribeToVersions((cloudVers) => {
      if (Array.isArray(cloudVers)) {
        (governanceEngine as any).documentVersions = cloudVers;
        governanceEngine.syncVersionsToStorage(cloudVers);
        refreshData();
      }
    });

    const unsubAcks = firestoreService.subscribeToAcknowledgements((cloudAcks) => {
      if (Array.isArray(cloudAcks)) {
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

    const unsubSuggestions = firestoreService.subscribeToSuggestions((cloudSugs) => {
      if (Array.isArray(cloudSugs)) {
        governanceEngine.setDocumentSuggestions(cloudSugs);
        refreshData();
      }
    });

    return () => {
      clearInterval(reminderTimer);
      unsubEmployees();
      unsubDocs();
      unsubVers();
      unsubAcks();
      unsubAudit();
      unsubAuditLocal();
      unsubSuggestions();
    };
  }, [sessionReady]);

  useEffect(() => {
    try {
      if (activeTab) {
        localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
      }
    } catch (e) {
      console.warn('Error saving active tab to localStorage:', e);
    }
  }, [activeTab]);

  // Land the person on the right screen the first time their session becomes ready.
  const applySessionUser = (user: User) => {
    setCurrentUser(user);
    const targetTab = user.role === UserRole.REVIEWER ? 'reviewer' : user.role === UserRole.EMPLOYEE ? 'employee' : 'creator';
    setActiveTab(targetTab);
    const hasTalent = hasModulePermission(user, 'talent-acquisition');
    const hasDocGov = hasModulePermission(user, 'document-version-control');
    let defaultModule: HRAgentModule = 'document-version-control';
    if (!hasDocGov && hasTalent) defaultModule = 'talent-acquisition-overview';
    else if (!hasDocGov && !hasTalent) {
      const canAdmin = (user.perms || []).some((p) => ['users.manage', 'departments.manage', 'roles.manage'].includes(p));
      defaultModule = canAdmin ? 'administration' : 'leave-management';
    }
    setHrAgentModule(defaultModule);
  };

  useEffect(() => {
    return onSession((state) => {
      setSession(state);
      if (state.kind === 'ready') {
        setCurrentUser((prev) => {
          if (prev && prev.id === state.user.id) return { ...prev, perms: state.user.perms, isCompanyAdmin: state.user.isCompanyAdmin };
          applySessionUser(state.user);
          return state.user;
        });
      } else {
        setCurrentUser(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    await signOutUser();
    // A full reload drops every in-memory cache (the governance engine is a singleton) so the next
    // person to sign in on this browser can never see the previous company's data.
    window.location.assign('/login');
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
    <>
      {session.kind === 'loading' ? (
        <div className="h-screen flex items-center justify-center bg-[#F8FAFC] text-sm font-bold text-slate-400">Loading…</div>
      ) : session.kind === 'platformAdmin' ? (
        <PlatformAdminView email={session.email} onLogout={handleLogout} />
      ) : session.kind === 'pending' || session.kind === 'suspended' ? (
        <PendingApprovalView
          company={session.company}
          email={session.email}
          suspended={session.kind === 'suspended'}
          onLogout={handleLogout}
          onCheckAgain={async () => {
            const next = await reloadSession();
            setSession(next);
            // The listener only fires on sign-in changes, so promote the user here once approved.
            if (next.kind === 'ready') applySessionUser(next.user);
          }}
        />
      ) : session.kind === 'error' ? (
        <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#F8FAFC] px-6 text-center">
          <p className="max-w-md text-sm font-bold text-slate-700">{session.message}</p>
          <button onClick={handleLogout} className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-black text-white">Sign out</button>
        </div>
      ) : !currentUser || session.kind === 'signedOut' ? (
        <AuthScreen />
      ) : currentUser.role === UserRole.EMPLOYEE ? (
        /* 2. Employee Portal: Remained 100% untouched as required */
        <div className="min-h-screen bg-[#F8FAFC] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(250,112,20,0.05),rgba(255,255,255,0))] flex flex-col font-sans text-slate-900">
          <EmployeeHeader
            currentUser={currentUser}
            onLogout={handleLogout}
            activeTab={employeeTab}
            onTabChange={setEmployeeTab}
            pendingCount={employeePendingCount}
            totalDocsCount={employeeTotalDocsCount}
          />
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {isDepartmentHead(currentUser) && (
              <div className="mb-6 rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setShowHiringRequests((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-black text-slate-900"
                >
                  <span>Hiring requests (department head)</span>
                  <span className="text-xs font-bold text-[#FA7014]">{showHiringRequests ? 'Hide' : 'Open'}</span>
                </button>
                {showHiringRequests && (
                  <div className="border-t border-slate-100">
                    <RequisitionsModule currentUser={currentUser} users={allUsers} embedded />
                  </div>
                )}
              </div>
            )}
            <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold">
              {([['policies', 'Policies'], ['leave', 'Leave & Attendance'], ['payroll', 'Payroll'], ['people', 'People']] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEmployeeSection(k)}
                  className={`px-4 py-2 rounded-lg transition-colors ${employeeSection === k ? 'bg-[#FA7014] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {employeeSection === 'leave' ? (
              <LeaveModule currentUser={currentUser} inlineNav />
            ) : employeeSection === 'payroll' ? (
              <PayrollModule currentUser={currentUser} inlineNav />
            ) : employeeSection === 'people' ? (
              <PeopleModule currentUser={currentUser} inlineNav />
            ) : (
            <EmployeePortalView
              currentUser={currentUser}
              documents={documents}
              versions={versions}
              acknowledgements={acknowledgements}
              onOpenDocumentView={(ver) => setReaderVersion(ver)}
              activeTab={employeeTab}
              onTabChange={setEmployeeTab}
            />
            )}
          </main>
        </div>
      ) : (
        /* 3. HR AI Agent Platform Shell for HR and Approver roles */
        <HRAgentShell
          currentUser={currentUser}
          activeModule={hrAgentModule}
          onSelectModule={handleSelectHRAgentModule}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onLogout={handleLogout}
          onRefreshData={refreshData}
        >
          {hrAgentModule === 'leave-management' && currentUser && (
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <LeaveModule currentUser={currentUser} />
            </div>
          )}

          {hrAgentModule === 'payroll' && currentUser && (
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <PayrollModule currentUser={currentUser} />
            </div>
          )}

          {hrAgentModule === 'people' && currentUser && (
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <PeopleModule currentUser={currentUser} />
            </div>
          )}

          {hrAgentModule === 'administration' && (
            <AdminModule currentUser={currentUser} company={session.kind === 'ready' ? session.company : (null as any)} />
          )}

          {/* Selected Module: Document Version Control (Default) */}
          {hrAgentModule === 'document-version-control' && (
            <div className="flex-1 flex flex-col min-w-0">
              {currentUser.role === UserRole.CREATOR ? (
                <HRHeader
                  currentUser={currentUser}
                  onLogout={handleLogout}
                  activeTab={activeTab === 'compliance' || activeTab === 'audit' || activeTab === 'suggestions' ? activeTab : 'creator'}
                  setActiveTab={(tab) => setActiveTab(tab)}
                  pendingComplianceCount={pendingComplianceCount}
                  suggestionsCount={activeSuggestions.length}
                  isSidebarOpen={isSidebarOpen}
                  onToggleSidebar={handleToggleSidebar}
                />
              ) : (
                <ApproverHeader
                  currentUser={currentUser}
                  onLogout={handleLogout}
                  activeTab={activeTab === 'compliance' || activeTab === 'audit' || activeTab === 'suggestions' ? activeTab : 'reviewer'}
                  setActiveTab={(tab) => setActiveTab(tab)}
                  pendingComplianceCount={pendingComplianceCount}
                  suggestionsCount={activeSuggestions.length}
                  isSidebarOpen={isSidebarOpen}
                  onToggleSidebar={handleToggleSidebar}
                />
              )}

              <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
                {currentUser.role === UserRole.CREATOR ? (
                  <>
                    {/* Policy Suggestions Dashboard (Beside Compliance Tracker) */}
                    {activeTab === 'suggestions' && (
                      <PolicySuggestionsDashboard
                        currentUser={currentUser}
                        documents={documents}
                        versions={versions}
                        suggestions={activeSuggestions}
                        onOpenCreateVersion={handleOpenCreateVersion}
                        onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
                        onRefreshData={refreshData}
                      />
                    )}

                    {activeTab === 'compliance' && (
                      <EmployeeComplianceModule
                        currentUser={currentUser}
                        users={allUsers}
                        documents={documents}
                        versions={versions}
                        onOpenDocumentView={(ver) => setReaderVersion(ver)}
                        onRefreshData={refreshData}
                      />
                    )}

                    {activeTab === 'audit' && <AuditLogView users={allUsers} />}

                    {(activeTab === 'creator' ||
                      (activeTab !== 'compliance' && activeTab !== 'audit' && activeTab !== 'suggestions')) && (
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
                  </>
                ) : (
                  <>
                    {/* Policy Suggestions Dashboard (For Founder / Approver panel) */}
                    {activeTab === 'suggestions' && (
                      <PolicySuggestionsDashboard
                        currentUser={currentUser}
                        documents={documents}
                        versions={versions}
                        suggestions={activeSuggestions}
                        onOpenCreateVersion={handleOpenCreateVersion}
                        onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
                        onRefreshData={refreshData}
                      />
                    )}

                    {activeTab === 'compliance' && (
                      <EmployeeComplianceModule
                        currentUser={currentUser}
                        users={allUsers}
                        documents={documents}
                        versions={versions}
                        onOpenDocumentView={(ver) => setReaderVersion(ver)}
                        onRefreshData={refreshData}
                      />
                    )}

                    {activeTab === 'audit' && <AuditLogView users={allUsers} />}

                    {(activeTab === 'reviewer' ||
                      (activeTab !== 'compliance' && activeTab !== 'audit' && activeTab !== 'suggestions')) && (
                      <ReviewerDashboard
                        currentUser={currentUser}
                        documents={documents}
                        versions={versions}
                        users={allUsers}
                        onOpenReviewModal={(ver) => setReviewVersion(ver)}
                        onOpenDocumentDetail={(doc) => setDetailDocument(doc)}
                        onOpenComplianceTracker={() => setActiveTab('compliance')}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Module: Talent Acquisition Overview Dashboard (HR & Approver) */}
          {(hrAgentModule === 'talent-acquisition' || hrAgentModule === 'talent-acquisition-overview') && currentUser && (
            <div className="flex-1 flex flex-col min-w-0">
              <TalentAcquisitionHeader
                currentUser={currentUser}
                onLogout={handleLogout}
                isSidebarOpen={isSidebarOpen}
                onToggleSidebar={handleToggleSidebar}
              />
              <TalentAcquisitionOverview
                currentUser={currentUser}
                onLogout={handleLogout}
                onOpenRequisitions={() => handleSelectHRAgentModule('talent-acquisition-requisitions')}
                onOpenOnboarding={() => handleSelectHRAgentModule('talent-acquisition-onboarding')}
              />
            </div>
          )}

          {/* Module: Talent Acquisition - Hiring Requisitions workflow (HR & Approver) */}
          {hrAgentModule === 'talent-acquisition-requisitions' && currentUser && (
            <div className="flex-1 flex flex-col min-w-0">
              <TalentAcquisitionHeader
                currentUser={currentUser}
                onLogout={handleLogout}
                isSidebarOpen={isSidebarOpen}
                onToggleSidebar={handleToggleSidebar}
              />
              <RequisitionsModule currentUser={currentUser} users={allUsers} />
            </div>
          )}

          {/* Module: Talent Acquisition - Applications (per company) */}
          {hrAgentModule === 'talent-acquisition-applications' && currentUser && (
            <div className="flex-1 flex flex-col min-w-0">
              <TalentAcquisitionHeader
                currentUser={currentUser}
                onLogout={handleLogout}
                isSidebarOpen={isSidebarOpen}
                onToggleSidebar={handleToggleSidebar}
              />
              <ApplicationsModule currentUser={currentUser} />
            </div>
          )}

          {/* Module: Talent Acquisition - Onboarding (HR) */}
          {hrAgentModule === 'talent-acquisition-onboarding' && currentUser && (
            <div className="flex-1 flex flex-col min-w-0">
              <TalentAcquisitionHeader
                currentUser={currentUser}
                onLogout={handleLogout}
                isSidebarOpen={isSidebarOpen}
                onToggleSidebar={handleToggleSidebar}
              />
              <OnboardingModule currentUser={currentUser} />
            </div>
          )}
        </HRAgentShell>
      )}

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
          users={allUsers}
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
                      reReviewDate: formatDDMMYYYY(readerVersion.reviewDueDate, ''),
                      creationDate: formatDDMMYYYY(readerVersion.createdAt),
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
                      fileUrl: readerVersion.fileUrl || readerVersion.originalFileUrl,
                      versionId: readerVersion.id,
                      documentId: readerVersion.documentId,
                    })
                  }
                  className="inline-flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors border border-slate-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
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
                fileUrl={readerVersion.fileUrl || readerVersion.originalFileUrl}
                mimeType={readerVersion.mimeType}
                versionId={readerVersion.id}
                documentId={readerVersion.documentId}
                headerFooterData={{
                  companyName: 'Amaavigo',
                  documentTitle: readerVersion.documentTitle,
                  versionNumber: readerVersion.versionNumber,
                  effectiveDate: formatDDMMYYYY(readerVersion.effectiveFrom || readerVersion.createdAt),
                  reReviewDate: formatDDMMYYYY(readerVersion.reviewDueDate, ''),
                  creationDate: formatDDMMYYYY(readerVersion.createdAt),
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
    </>
  );
}
