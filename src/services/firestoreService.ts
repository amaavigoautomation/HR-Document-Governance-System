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
} from '../types';

// Collection references
const DOCS_COLLECTION = 'documents';
const VERSIONS_COLLECTION = 'versions';
const AUDIT_COLLECTION = 'auditLogs';
const ACKS_COLLECTION = 'acknowledgments';
const NOTIFS_COLLECTION = 'notifications';

export const firestoreService = {
  // Sync initial seeds if collection is empty
  async seedFirestoreIfEmpty(
    seedDocs: DocumentMaster[],
    seedVersions: DocumentVersion[],
    seedAuditLogs: AuditLogEntry[],
    seedAcks: AcknowledgementRecord[]
  ) {
    try {
      const snap = await getDocs(collection(db, DOCS_COLLECTION));
      if (snap.empty) {
        console.log('[Firestore] Seeding initial HR governance data...');
        for (const docMaster of seedDocs) {
          await setDoc(doc(db, DOCS_COLLECTION, docMaster.id), docMaster);
        }
        for (const ver of seedVersions) {
          await setDoc(doc(db, VERSIONS_COLLECTION, ver.id), ver);
        }
        for (const log of seedAuditLogs) {
          await setDoc(doc(db, AUDIT_COLLECTION, log.id), log);
        }
        for (const ack of seedAcks) {
          await setDoc(doc(db, ACKS_COLLECTION, ack.id), ack);
        }
        console.log('[Firestore] Seeding completed.');
      }
    } catch (e) {
      console.warn('[Firestore] Seed error / offline fallback:', e);
    }
  },

  // Document Masters
  async getDocuments(): Promise<DocumentMaster[]> {
    const snap = await getDocs(collection(db, DOCS_COLLECTION));
    return snap.docs.map((d) => d.data() as DocumentMaster);
  },

  async saveDocument(docMaster: DocumentMaster): Promise<void> {
    await setDoc(doc(db, DOCS_COLLECTION, docMaster.id), docMaster);
  },

  // Versions
  async getVersions(): Promise<DocumentVersion[]> {
    const snap = await getDocs(collection(db, VERSIONS_COLLECTION));
    return snap.docs.map((d) => d.data() as DocumentVersion);
  },

  async saveVersion(version: DocumentVersion): Promise<void> {
    await setDoc(doc(db, VERSIONS_COLLECTION, version.id), version);
  },

  async updateVersion(versionId: string, updates: Partial<DocumentVersion>): Promise<void> {
    await updateDoc(doc(db, VERSIONS_COLLECTION, versionId), updates);
  },

  // Audit Logs
  async getAuditLogs(): Promise<AuditLogEntry[]> {
    const snap = await getDocs(collection(db, AUDIT_COLLECTION));
    return snap.docs.map((d) => d.data() as AuditLogEntry);
  },

  async saveAuditLog(log: AuditLogEntry): Promise<void> {
    await setDoc(doc(db, AUDIT_COLLECTION, log.id), log);
  },

  // Acknowledgments
  async getAcknowledgements(): Promise<AcknowledgementRecord[]> {
    const snap = await getDocs(collection(db, ACKS_COLLECTION));
    return snap.docs.map((d) => d.data() as AcknowledgementRecord);
  },

  async saveAcknowledgement(ack: AcknowledgementRecord): Promise<void> {
    await setDoc(doc(db, ACKS_COLLECTION, ack.id), ack);
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
};
