import {
  collection,
  doc,
  getDoc,
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
import { ensurePersistentMedia } from './mediaStorage';
import { normalizeAuthorizedModules, ModuleAuthorizationCode } from '../utils/authorization';
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
  // Parse raw Firestore document into typed User profile

  // Parse any Firestore employee document safely and robustly
  parseEmployeeDoc(d: any): User {
    const data = (typeof d?.data === 'function' ? d.data() : d) || {};
    const docId = data.id || d?.id || data.empId || data.loginId || 'EMP';

    const rawRole = (data.role || '').toString().toUpperCase().trim();
    const rawLoginId = (data.loginId || data.empId || docId || '').toString().toUpperCase().trim();
    const rawTitle = (data.title || data.designation || '').toString().toUpperCase();
    const rawDept = (data.departmentName || data.department || data.departmentId || '').toString().toUpperCase();
    const lowerDocId = String(docId).toLowerCase();

    // Explicit database role is respected with highest priority
    let role = UserRole.EMPLOYEE;
    if (rawRole === 'EMPLOYEE') {
      role = UserRole.EMPLOYEE;
    } else if (rawRole === 'CREATOR' || rawRole === 'HR' || rawRole === 'AUTHOR') {
      role = UserRole.CREATOR;
    } else if (rawRole === 'REVIEWER' || rawRole === 'APPROVER') {
      role = UserRole.REVIEWER;
    } else if (
      rawRole.includes('CREATOR') ||
      rawRole.includes('HR') ||
      lowerDocId.includes('creator') ||
      rawLoginId.startsWith('HR') ||
      rawLoginId === 'CREATOR' ||
      rawDept.includes('HUMAN RESOURCES') ||
      rawTitle.includes('HR POLICY') ||
      rawTitle.includes('CREATOR')
    ) {
      role = UserRole.CREATOR;
    } else if (
      rawRole.includes('REVIEWER') ||
      rawRole.includes('APPROVER') ||
      lowerDocId.includes('reviewer') ||
      rawLoginId.startsWith('REV') ||
      rawLoginId === 'APPROVER' ||
      rawLoginId === 'REVIEWER' ||
      rawTitle.includes('GOVERNANCE APPROVER')
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
      (empId ? `${String(empId).toLowerCase()}@amaavigo.com` : 'employee@amaavigo.com');

    const isActive =
      data.active !== false &&
      String(data.active).toLowerCase() !== 'false' &&
      data.status !== 'INACTIVE' &&
      data.status !== 'inactive';

    const rawAuth =
      data.authorizedModules ||
      data.allowedModules ||
      data.moduleAccess ||
      data.modules ||
      data.moduleAuthorization;
    const authorizedModules = normalizeAuthorizedModules(rawAuth);

    return {
      ...data,
      id: docId,
      empId: String(empId),
      loginId: String(loginId),
      name,
      email: String(email).trim(),
      role,
      authorizedModules,
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
      password: data.password !== undefined && data.password !== null ? String(data.password) : '',
      active: isActive,
      avatar: data.avatar || data.avatarUrl,
    } as User;
  },

  // Employees & Users Directory & Records
  async getEmployees(): Promise<User[]> {
    try {
      const empSnap = await getDocs(collection(db, EMPLOYEES_COLLECTION));
      const seen = new Set<string>();
      const users: User[] = [];

      for (const d of empSnap.docs) {
        const user = this.parseEmployeeDoc(d);
        const docKey = (user.empId || user.loginId || user.id || user.email).toUpperCase().trim();
        if (seen.has(docKey)) continue;
        seen.add(docKey);
        users.push(user);
      }

      return users;
    } catch (e) {
      console.warn('[Firestore] Error getting employees directory:', e);
      return [];
    }
  },

  // Find a specific user in Firestore directly in real-time (instant fallback for newly created DB employees)
  async findEmployeeInDatabase(identifier: string): Promise<User | null> {
    if (!identifier) return null;
    const cleanId = identifier.trim();
    const upperId = cleanId.toUpperCase();
    const lowerId = cleanId.toLowerCase();

    try {
      // 1. Direct document lookup by ID
      const directRef = doc(db, EMPLOYEES_COLLECTION, cleanId);
      const directSnap = await getDoc(directRef);
      if (directSnap.exists()) {
        return this.parseEmployeeDoc(directSnap);
      }

      if (upperId !== cleanId) {
        const upperRef = doc(db, EMPLOYEES_COLLECTION, upperId);
        const upperSnap = await getDoc(upperRef);
        if (upperSnap.exists()) {
          return this.parseEmployeeDoc(upperSnap);
        }
      }

      // 2. Query by empId
      const empQ = query(collection(db, EMPLOYEES_COLLECTION), where('empId', '==', cleanId));
      const empSnap = await getDocs(empQ);
      if (!empSnap.empty) {
        return this.parseEmployeeDoc(empSnap.docs[0]);
      }
      if (upperId !== cleanId) {
        const upperEmpQ = query(collection(db, EMPLOYEES_COLLECTION), where('empId', '==', upperId));
        const upperEmpSnap = await getDocs(upperEmpQ);
        if (!upperEmpSnap.empty) {
          return this.parseEmployeeDoc(upperEmpSnap.docs[0]);
        }
      }

      // 3. Query by loginId
      const loginQ = query(collection(db, EMPLOYEES_COLLECTION), where('loginId', '==', cleanId));
      const loginSnap = await getDocs(loginQ);
      if (!loginSnap.empty) {
        return this.parseEmployeeDoc(loginSnap.docs[0]);
      }
      if (upperId !== cleanId) {
        const upperLoginQ = query(collection(db, EMPLOYEES_COLLECTION), where('loginId', '==', upperId));
        const upperLoginSnap = await getDocs(upperLoginQ);
        if (!upperLoginSnap.empty) {
          return this.parseEmployeeDoc(upperLoginSnap.docs[0]);
        }
      }

      // 4. Query by email
      const emailQ = query(collection(db, EMPLOYEES_COLLECTION), where('email', '==', lowerId));
      const emailSnap = await getDocs(emailQ);
      if (!emailSnap.empty) {
        return this.parseEmployeeDoc(emailSnap.docs[0]);
      }

      // 5. Query-scan fallback for any field case-insensitively
      const allSnap = await getDocs(collection(db, EMPLOYEES_COLLECTION));
      for (const d of allSnap.docs) {
        const user = this.parseEmployeeDoc(d);
        if (
          user.empId.toLowerCase() === lowerId ||
          user.loginId.toLowerCase() === lowerId ||
          user.id.toLowerCase() === lowerId ||
          user.email.toLowerCase() === lowerId
        ) {
          return user;
        }
      }
    } catch (err) {
      console.warn('[Firestore] Error finding employee in live database:', err);
    }
    return null;
  },

  async saveEmployee(employee: User): Promise<void> {
    await setDoc(doc(db, EMPLOYEES_COLLECTION, employee.id), cleanFirestoreData(employee));
  },

  async updateEmployee(employeeId: string, updates: Partial<User>): Promise<void> {
    await updateDoc(doc(db, EMPLOYEES_COLLECTION, employeeId), cleanFirestoreData(updates));
  },

  async updateUserModuleAuthorization(
    employeeId: string,
    authorizedModules: ModuleAuthorizationCode | string
  ): Promise<void> {
    const normalized = normalizeAuthorizedModules(authorizedModules);
    await updateDoc(
      doc(db, EMPLOYEES_COLLECTION, employeeId),
      cleanFirestoreData({
        authorizedModules: normalized,
        updatedAt: new Date().toISOString(),
      })
    );
  },

  async deleteEmployee(employeeId: string): Promise<void> {
    await deleteDoc(doc(db, EMPLOYEES_COLLECTION, employeeId));
  },

  // Document Masters
  async getDocuments(): Promise<DocumentMaster[]> {
    try {
      const snap = await getDocs(collection(db, DOCS_COLLECTION));
      const docs = snap.docs.map((d) => d.data() as DocumentMaster);
      return docs.sort((a, b) => {
        const aTime = Math.max(new Date(a.updatedAt || 0).getTime(), new Date(a.createdAt || 0).getTime());
        const bTime = Math.max(new Date(b.updatedAt || 0).getTime(), new Date(b.createdAt || 0).getTime());
        return bTime - aTime;
      });
    } catch (e) {
      console.warn('[Firestore] Error getting documents (using local cache):', e);
      return [];
    }
  },

  async saveDocument(docMaster: DocumentMaster): Promise<void> {
    try {
      await setDoc(doc(db, DOCS_COLLECTION, docMaster.id), cleanFirestoreData(docMaster));
    } catch (e) {
      console.warn('[Firestore] Save document offline note:', e);
    }
  },

  // Versions
  async getVersions(): Promise<DocumentVersion[]> {
    try {
      const snap = await getDocs(collection(db, VERSIONS_COLLECTION));
      const vers = snap.docs.map((d) => d.data() as DocumentVersion);
      return vers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.warn('[Firestore] Error getting versions (using local cache):', e);
      return [];
    }
  },

  async saveVersion(version: DocumentVersion): Promise<void> {
    try {
      // Ensure large media payloads (e.g. video base64) are stored in server/IndexedDB storage rather than crashing Firestore with >1MB payload
      const sanitizedVersion = { ...version };
      if (sanitizedVersion.fileUrl && sanitizedVersion.fileUrl.startsWith('data:')) {
        try {
          sanitizedVersion.fileUrl = await ensurePersistentMedia(
            sanitizedVersion.fileUrl,
            sanitizedVersion.fileName,
            sanitizedVersion.mimeType,
            sanitizedVersion.documentId,
            sanitizedVersion.id
          );
        } catch (e) {
          console.warn('[Firestore] Media upload fallback for saveVersion:', e);
        }
      }
      if (sanitizedVersion.originalFileUrl && sanitizedVersion.originalFileUrl.startsWith('data:')) {
        sanitizedVersion.originalFileUrl = sanitizedVersion.fileUrl;
      }
      await setDoc(doc(db, VERSIONS_COLLECTION, sanitizedVersion.id), cleanFirestoreData(sanitizedVersion));
    } catch (e) {
      console.warn('[Firestore] Save version offline note:', e);
    }
  },

  async updateVersion(versionId: string, updates: Partial<DocumentVersion>): Promise<void> {
    try {
      const sanitizedUpdates = { ...updates };
      if (sanitizedUpdates.fileUrl && sanitizedUpdates.fileUrl.startsWith('data:')) {
        try {
          sanitizedUpdates.fileUrl = await ensurePersistentMedia(
            sanitizedUpdates.fileUrl,
            sanitizedUpdates.fileName || 'media_asset',
            sanitizedUpdates.mimeType || 'video/mp4',
            sanitizedUpdates.documentId,
            versionId
          );
        } catch (e) {
          console.warn('[Firestore] Media upload fallback for updateVersion:', e);
        }
      }
      if (sanitizedUpdates.originalFileUrl && sanitizedUpdates.originalFileUrl.startsWith('data:')) {
        sanitizedUpdates.originalFileUrl = sanitizedUpdates.fileUrl;
      }
      await updateDoc(doc(db, VERSIONS_COLLECTION, versionId), cleanFirestoreData(sanitizedUpdates));
    } catch (e) {
      console.warn('[Firestore] Update version offline note:', e);
    }
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLogEntry[]> {
    try {
      const snap = await getDocs(collection(db, AUDIT_COLLECTION));
      return snap.docs.map((d) => d.data() as AuditLogEntry);
    } catch (e) {
      console.warn('[Firestore] Error getting audit logs (using local cache):', e);
      return [];
    }
  },

  async saveAuditLog(log: AuditLogEntry): Promise<void> {
    try {
      await setDoc(doc(db, AUDIT_COLLECTION, log.id), cleanFirestoreData(log));
    } catch (e) {
      console.warn('[Firestore] Save audit log offline note:', e);
    }
  },

  // Acknowledgments
  async getAcknowledgements(): Promise<AcknowledgementRecord[]> {
    try {
      const snap = await getDocs(collection(db, ACKS_COLLECTION));
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AcknowledgementRecord);
      // Deduplicate in case multiple records exist for (docId, ver, empId)
      const canonicalMap = new Map<string, AcknowledgementRecord>();
      for (const item of items) {
        if (!item.documentId) continue;
        const emp = (item.employeeId || item.employeeEmail || '').toLowerCase().trim();
        const ver = (item.versionNumber || '1.0').trim();
        const key = `${item.documentId.toLowerCase()}_${ver}_${emp}`;
        const existing = canonicalMap.get(key);
        if (!existing || (item.status === 'ACKNOWLEDGED' && existing.status !== 'ACKNOWLEDGED')) {
          canonicalMap.set(key, item);
        }
      }
      return Array.from(canonicalMap.values());
    } catch (e) {
      console.warn('[Firestore] Error getting acknowledgements (using local cache):', e);
      return [];
    }
  },

  async saveAcknowledgement(ack: AcknowledgementRecord): Promise<void> {
    try {
      const cleanEmpId = (ack.employeeId || ack.employeeEmail || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const cleanDocId = (ack.documentId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const cleanVer = (ack.versionNumber || '1.0').replace(/\./g, '_');
      const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;
      const docRef = doc(db, ACKS_COLLECTION, deterministicId);

      // If writing a PENDING record, verify that an existing ACKNOWLEDGED record is never downgraded
      if (ack.status === 'PENDING') {
        const existingSnap = await getDoc(docRef);
        if (existingSnap.exists()) {
          const existingData = existingSnap.data();
          if (existingData?.status === 'ACKNOWLEDGED') {
            return;
          }
        }
      }

      const record: AcknowledgementRecord = {
        ...ack,
        id: deterministicId,
        offlineSignOff: ack.offlineSignOff ?? (ack.signOffType === 'OFFLINE' || (ack.signatureReference?.startsWith('MANUAL-ATTEST') ?? false)),
      };
      await setDoc(docRef, cleanFirestoreData(record), { merge: true });
    } catch (e) {
      console.warn('[Firestore] Save acknowledgement offline note:', e);
    }
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
    return onSnapshot(
      collection(db, EMPLOYEES_COLLECTION),
      (snap) => {
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
            password: data.password !== undefined && data.password !== null ? String(data.password) : '',
            active: data.active !== false && data.status !== 'INACTIVE',
            avatar: data.avatar || data.avatarUrl,
            ...data,
          } as User;
        });
        callback(items);
      },
      (error) => {
        console.warn('[Firestore] Employees subscription offline/retry note:', error?.message || error);
      }
    );
  },

  // Real-time listener for document changes
  subscribeToDocuments(callback: (docs: DocumentMaster[]) => void) {
    return onSnapshot(
      collection(db, DOCS_COLLECTION),
      (snap) => {
        const items = snap.docs.map((d) => d.data() as DocumentMaster);
        callback(items);
      },
      (error) => {
        console.warn('[Firestore] Documents subscription offline/retry note:', error?.message || error);
      }
    );
  },

  // Real-time listener for versions
  subscribeToVersions(callback: (versions: DocumentVersion[]) => void) {
    return onSnapshot(
      collection(db, VERSIONS_COLLECTION),
      (snap) => {
        const items = snap.docs.map((d) => d.data() as DocumentVersion);
        callback(items);
      },
      (error) => {
        console.warn('[Firestore] Versions subscription offline/retry note:', error?.message || error);
      }
    );
  },

  // Real-time listener for acknowledgments
  subscribeToAcknowledgements(callback: (acks: AcknowledgementRecord[]) => void) {
    return onSnapshot(
      collection(db, ACKS_COLLECTION),
      (snap) => {
        const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AcknowledgementRecord);
        const canonicalMap = new Map<string, AcknowledgementRecord>();
        for (const item of items) {
          if (!item.documentId) continue;
          const emp = (item.employeeId || item.employeeEmail || '').toLowerCase().trim();
          const ver = (item.versionNumber || '1.0').trim();
          const key = `${item.documentId.toLowerCase()}_${ver}_${emp}`;
          const existing = canonicalMap.get(key);
          if (!existing || (item.status === 'ACKNOWLEDGED' && existing.status !== 'ACKNOWLEDGED')) {
            canonicalMap.set(key, item);
          }
        }
        callback(Array.from(canonicalMap.values()));
      },
      (error) => {
        console.warn('[Firestore] Acknowledgements subscription offline/retry note:', error?.message || error);
      }
    );
  },

  // Real-time listener for audit logs
  subscribeToAuditLogs(callback: (logs: AuditLogEntry[]) => void) {
    return onSnapshot(
      collection(db, AUDIT_COLLECTION),
      (snap) => {
        const items = snap.docs.map((d) => d.data() as AuditLogEntry);
        callback(items);
      },
      (error) => {
        console.warn('[Firestore] Audit logs subscription offline/retry note:', error?.message || error);
      }
    );
  },
};
