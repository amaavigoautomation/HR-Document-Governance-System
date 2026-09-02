import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  DocumentMaster,
  DocumentVersion,
  AuditLogEntry,
  AcknowledgementRecord,
  EmailNotification,
  User,
  UserRole,
} from '../types';

// Collection references
const EMPLOYEES_COLLECTION = 'employees';
const DOCS_COLLECTION = 'documents';
const VERSIONS_COLLECTION = 'versions';
const AUDIT_COLLECTION = 'auditLogs';
const ACKS_COLLECTION = 'acknowledgments';
const NOTIFS_COLLECTION = 'notifications';

// Helper to strip undefined values so Firestore does not reject writes
function cleanFirestoreData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(cleanFirestoreData) as unknown as T;
  }
  if (typeof obj === 'object') {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirestoreData(value);
      }
    }
    return cleaned;
  }
  return obj;
}

export const firestoreService = {
  // Sync initial employee users only if collection is empty
  async seedFirestoreIfEmpty(
    _seedDocs: DocumentMaster[],
    _seedVersions: DocumentVersion[],
    _seedAuditLogs: AuditLogEntry[],
    _seedAcks: AcknowledgementRecord[],
    seedEmployees?: User[]
  ) {
    try {
      // ONLY check and seed Employees collection if empty so default login accounts exist
      if (seedEmployees && seedEmployees.length > 0) {
        const empSnap = await getDocs(collection(db, EMPLOYEES_COLLECTION));
        if (empSnap.empty) {
          console.log('[Firestore] Initializing employees directory...');
          for (const emp of seedEmployees) {
            await setDoc(doc(db, EMPLOYEES_COLLECTION, emp.id), cleanFirestoreData(emp));
          }
          console.log('[Firestore] Employees directory initialized.');
        }
      }
      // Note: Documents, versions, and acknowledgments are NEVER auto-seeded automatically.
      // If a user deletes them, the database remains completely clean and empty across page refreshes.
    } catch (e) {
      console.warn('[Firestore] Employee seed note:', e);
    }
  },

  // Explicitly write sample documents & versions to Firestore (only when requested by user action)
  async saveAllDocumentsAndVersions(
    seedDocs: DocumentMaster[],
    seedVersions: DocumentVersion[],
    seedAuditLogs: AuditLogEntry[],
    seedAcks: AcknowledgementRecord[]
  ) {
    try {
      console.log('[Firestore] Writing seed documents and versions to Firestore...');
      for (const docMaster of seedDocs) {
        await setDoc(doc(db, DOCS_COLLECTION, docMaster.id), cleanFirestoreData(docMaster));
      }
      for (const ver of seedVersions) {
        await setDoc(doc(db, VERSIONS_COLLECTION, ver.id), cleanFirestoreData(ver));
      }
      for (const log of seedAuditLogs) {
        await setDoc(doc(db, AUDIT_COLLECTION, log.id), cleanFirestoreData(log));
      }
      for (const ack of seedAcks) {
        await setDoc(doc(db, ACKS_COLLECTION, ack.id), cleanFirestoreData(ack));
      }
      console.log('[Firestore] Seed write complete.');
    } catch (e) {
      console.error('[Firestore] Error writing seed data:', e);
      throw e;
    }
  },

  // Employees & Users Directory & Records
  async getEmployees(): Promise<User[]> {
    try {
      const [empSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, EMPLOYEES_COLLECTION)),
        getDocs(collection(db, 'users')).catch(() => ({ docs: [] } as any)),
      ]);

      const allDocs = [...empSnap.docs, ...usersSnap.docs];
      const seen = new Set<string>();

      const users: User[] = [];
      for (const d of allDocs) {
        const data = d.data() as any;
        const docId = data.id || d.id;
        if (seen.has(docId)) continue;
        seen.add(docId);

        const rawRole = (data.role || '').toString().toUpperCase().trim();
        const rawLoginId = (data.loginId || data.empId || docId || '').toString().toUpperCase().trim();
        const rawTitle = (data.title || data.designation || '').toString().toUpperCase();
        const rawDept = (data.departmentName || data.department || data.departmentId || '').toString().toUpperCase();
        const lowerDocId = docId.toLowerCase();

        let role = UserRole.EMPLOYEE;
        if (
          rawRole === 'CREATOR' ||
          rawRole === 'HR' ||
          rawRole === 'AUTHOR' ||
          rawRole.includes('CREATOR') ||
          rawRole.includes('HR') ||
          lowerDocId.includes('creator') ||
          lowerDocId.includes('hr') ||
          rawLoginId.startsWith('HR') ||
          rawLoginId === 'CREATOR' ||
          rawDept.includes('HUMAN RESOURCES') ||
          rawDept === 'HR' ||
          rawTitle.includes('HR') ||
          rawTitle.includes('CREATOR')
        ) {
          role = UserRole.CREATOR;
        } else if (
          rawRole === 'REVIEWER' ||
          rawRole === 'APPROVER' ||
          rawRole.includes('REVIEWER') ||
          rawRole.includes('APPROVER') ||
          lowerDocId.includes('reviewer') ||
          lowerDocId.includes('approver') ||
          lowerDocId.includes('app') ||
          rawLoginId.startsWith('AMA') ||
          rawLoginId.startsWith('APP') ||
          rawLoginId.startsWith('REV') ||
          rawLoginId === 'APPROVER' ||
          rawLoginId === 'REVIEWER' ||
          rawTitle.includes('APPROVER') ||
          rawTitle.includes('REVIEWER')
        ) {
          role = UserRole.REVIEWER;
        }

        const empId = data.empId || data.employeeId || data.loginId || docId;
        const loginId = data.loginId || data.empId || data.employeeId || docId;
        const name =
          data.name ||
          data.fullName ||
          data.employeeName ||
          (role === UserRole.CREATOR ? 'HR Creator' : role === UserRole.REVIEWER ? 'Approver' : 'Employee');
        const email =
          data.email ||
          (empId ? `${empId.toLowerCase()}@amaavigo.com` : 'employee@amaavigo.com');

        users.push({
          id: docId,
          empId,
          loginId,
          name,
          email,
          role,
          title:
            data.title ||
            data.designation ||
            (role === UserRole.CREATOR
              ? 'HR Policy & Governance Lead'
              : role === UserRole.REVIEWER
              ? 'VP of Human Resources & Governance'
              : 'Staff Member'),
          departmentName:
            data.departmentName ||
            data.department ||
            (role === UserRole.CREATOR || role === UserRole.REVIEWER
              ? 'Human Resources'
              : 'Operations'),
          companyName: data.companyName || 'Amaavigo Group',
          password:
            data.password ||
            (role === UserRole.CREATOR ? 'HR001' : role === UserRole.REVIEWER ? 'AMA001' : 'Parth!123'),
          active: data.active !== false && data.status !== 'INACTIVE',
          avatar: data.avatar || data.avatarUrl,
          ...data,
        } as User);
      }

      return users;
    } catch (e) {
      console.warn('[Firestore] Error getting employees/users:', e);
      return [];
    }
  },

  async saveEmployee(employee: User): Promise<void> {
    await setDoc(doc(db, EMPLOYEES_COLLECTION, employee.id), cleanFirestoreData(employee));
  },

  async updateEmployee(employeeId: string, updates: Partial<User>): Promise<void> {
    await updateDoc(doc(db, EMPLOYEES_COLLECTION, employeeId), cleanFirestoreData(updates));
  },

  async deleteEmployee(employeeId: string): Promise<void> {
    await deleteDoc(doc(db, EMPLOYEES_COLLECTION, employeeId));
  },

  // Document Masters
  async getDocuments(): Promise<DocumentMaster[]> {
    const snap = await getDocs(collection(db, DOCS_COLLECTION));
    return snap.docs.map((d) => d.data() as DocumentMaster);
  },

  async saveDocument(docMaster: DocumentMaster): Promise<void> {
    await setDoc(doc(db, DOCS_COLLECTION, docMaster.id), cleanFirestoreData(docMaster));
  },

  // Versions
  async getVersions(): Promise<DocumentVersion[]> {
    const snap = await getDocs(collection(db, VERSIONS_COLLECTION));
    return snap.docs.map((d) => d.data() as DocumentVersion);
  },

  async saveVersion(version: DocumentVersion): Promise<void> {
    await setDoc(doc(db, VERSIONS_COLLECTION, version.id), cleanFirestoreData(version));
  },

  async updateVersion(versionId: string, updates: Partial<DocumentVersion>): Promise<void> {
    await updateDoc(doc(db, VERSIONS_COLLECTION, versionId), cleanFirestoreData(updates));
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLogEntry[]> {
    const snap = await getDocs(collection(db, AUDIT_COLLECTION));
    return snap.docs.map((d) => d.data() as AuditLogEntry);
  },

  async saveAuditLog(log: AuditLogEntry): Promise<void> {
    await setDoc(doc(db, AUDIT_COLLECTION, log.id), cleanFirestoreData(log));
  },

  // Acknowledgments
  async getAcknowledgements(): Promise<AcknowledgementRecord[]> {
    const snap = await getDocs(collection(db, ACKS_COLLECTION));
    return snap.docs.map((d) => d.data() as AcknowledgementRecord);
  },

  async saveAcknowledgement(ack: AcknowledgementRecord): Promise<void> {
    await setDoc(doc(db, ACKS_COLLECTION, ack.id), cleanFirestoreData(ack));
  },

  // Delete a single document master and its associated versions & acknowledgements
  async deleteDocument(documentId: string): Promise<void> {
    try {
      // 1. Delete document master (by ID or matching documentId)
      const dSnap = await getDocs(collection(db, DOCS_COLLECTION));
      let logicalDocId = documentId;
      for (const d of dSnap.docs) {
        const data = d.data() as any;
        if (d.id === documentId || data.id === documentId || data.documentId === documentId) {
          if (data.documentId) logicalDocId = data.documentId;
          await deleteDoc(doc(db, DOCS_COLLECTION, d.id));
        }
      }

      // 2. Delete all matching versions
      const vSnap = await getDocs(collection(db, VERSIONS_COLLECTION));
      for (const d of vSnap.docs) {
        const data = d.data() as DocumentVersion;
        if (
          d.id === documentId ||
          data.documentMasterId === documentId ||
          data.documentId === documentId ||
          data.documentId === logicalDocId
        ) {
          await deleteDoc(doc(db, VERSIONS_COLLECTION, d.id));
        }
      }

      // 3. Delete all matching acknowledgments
      const aSnap = await getDocs(collection(db, ACKS_COLLECTION));
      for (const d of aSnap.docs) {
        const data = d.data() as AcknowledgementRecord;
        if (data.documentId === documentId || data.documentId === logicalDocId) {
          await deleteDoc(doc(db, ACKS_COLLECTION, d.id));
        }
      }
    } catch (err) {
      console.error('[Firestore] Error deleting document:', err);
      throw err;
    }
  },

  // Clear all documents, versions, and acknowledgments from Firestore database
  async clearAllDocuments(): Promise<void> {
    try {
      console.log('[Firestore] Clearing all documents, versions, and acknowledgements...');
      const dSnap = await getDocs(collection(db, DOCS_COLLECTION));
      for (const d of dSnap.docs) {
        await deleteDoc(doc(db, DOCS_COLLECTION, d.id));
      }

      const vSnap = await getDocs(collection(db, VERSIONS_COLLECTION));
      for (const d of vSnap.docs) {
        await deleteDoc(doc(db, VERSIONS_COLLECTION, d.id));
      }

      const aSnap = await getDocs(collection(db, ACKS_COLLECTION));
      for (const d of aSnap.docs) {
        await deleteDoc(doc(db, ACKS_COLLECTION, d.id));
      }
      console.log('[Firestore] All document collections cleared successfully.');
    } catch (err) {
      console.error('[Firestore] Error clearing document collections:', err);
      throw err;
    }
  },

  // Real-time listener for employees and users
  subscribeToEmployees(callback: (employees: User[]) => void) {
    return onSnapshot(collection(db, EMPLOYEES_COLLECTION), (snap) => {
      const items = snap.docs.map((d) => {
        const data = d.data() as any;
        const docId = data.id || d.id;
        const rawRole = (data.role || '').toString().toUpperCase().trim();
        const rawLoginId = (data.loginId || data.empId || docId || '').toString().toUpperCase().trim();
        const rawTitle = (data.title || data.designation || '').toString().toUpperCase();
        const rawDept = (data.departmentName || data.department || data.departmentId || '').toString().toUpperCase();
        const lowerDocId = docId.toLowerCase();

        let role = UserRole.EMPLOYEE;
        if (
          rawRole === 'CREATOR' ||
          rawRole === 'HR' ||
          rawRole === 'AUTHOR' ||
          rawRole.includes('CREATOR') ||
          rawRole.includes('HR') ||
          lowerDocId.includes('creator') ||
          lowerDocId.includes('hr') ||
          rawLoginId.startsWith('HR') ||
          rawLoginId === 'CREATOR' ||
          rawDept.includes('HUMAN RESOURCES') ||
          rawDept === 'HR' ||
          rawTitle.includes('HR') ||
          rawTitle.includes('CREATOR')
        ) {
          role = UserRole.CREATOR;
        } else if (
          rawRole === 'REVIEWER' ||
          rawRole === 'APPROVER' ||
          rawRole.includes('REVIEWER') ||
          rawRole.includes('APPROVER') ||
          lowerDocId.includes('reviewer') ||
          lowerDocId.includes('approver') ||
          lowerDocId.includes('app') ||
          rawLoginId.startsWith('AMA') ||
          rawLoginId.startsWith('APP') ||
          rawLoginId.startsWith('REV') ||
          rawLoginId === 'APPROVER' ||
          rawLoginId === 'REVIEWER' ||
          rawTitle.includes('APPROVER') ||
          rawTitle.includes('REVIEWER')
        ) {
          role = UserRole.REVIEWER;
        }

        const empId = data.empId || data.employeeId || data.loginId || docId;
        const loginId = data.loginId || data.empId || data.employeeId || docId;
        const name =
          data.name ||
          data.fullName ||
          data.employeeName ||
          (role === UserRole.CREATOR ? 'HR Creator' : role === UserRole.REVIEWER ? 'Approver' : 'Employee');
        const email =
          data.email ||
          (empId ? `${empId.toLowerCase()}@amaavigo.com` : 'employee@amaavigo.com');

        return {
          id: docId,
          empId,
          loginId,
          name,
          email,
          role,
          title:
            data.title ||
            data.designation ||
            (role === UserRole.CREATOR
              ? 'HR Policy & Governance Lead'
              : role === UserRole.REVIEWER
              ? 'VP of Human Resources & Governance'
              : 'Staff Member'),
          departmentName:
            data.departmentName ||
            data.department ||
            (role === UserRole.CREATOR || role === UserRole.REVIEWER
              ? 'Human Resources'
              : 'Operations'),
          companyName: data.companyName || 'Amaavigo Group',
          password:
            data.password ||
            (role === UserRole.CREATOR ? 'HR001' : role === UserRole.REVIEWER ? 'AMA001' : 'Parth!123'),
          active: data.active !== false && data.status !== 'INACTIVE',
          avatar: data.avatar || data.avatarUrl,
          ...data,
        } as User;
      });
      callback(items);
    });
  },

  // Real-time listener for document changes
  subscribeToDocuments(callback: (docs: DocumentMaster[]) => void) {
    return onSnapshot(collection(db, DOCS_COLLECTION), (snap) => {
      const items = snap.docs.map((d) => d.data() as DocumentMaster);
      callback(items);
    });
  },

  // Real-time listener for versions
  subscribeToVersions(callback: (versions: DocumentVersion[]) => void) {
    return onSnapshot(collection(db, VERSIONS_COLLECTION), (snap) => {
      const items = snap.docs.map((d) => d.data() as DocumentVersion);
      callback(items);
    });
  },

  // Real-time listener for acknowledgments
  subscribeToAcknowledgements(callback: (acks: AcknowledgementRecord[]) => void) {
    return onSnapshot(collection(db, ACKS_COLLECTION), (snap) => {
      const items = snap.docs.map((d) => d.data() as AcknowledgementRecord);
      callback(items);
    });
  },

  // Real-time listener for audit logs
  subscribeToAuditLogs(callback: (logs: AuditLogEntry[]) => void) {
    return onSnapshot(collection(db, AUDIT_COLLECTION), (snap) => {
      const items = snap.docs.map((d) => d.data() as AuditLogEntry);
      callback(items);
    });
  },
};
