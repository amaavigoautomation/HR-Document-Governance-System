import { AuditAction, AuditLogEntry, UserRole } from '../types';
import { firestoreService } from './firestoreService';

const AUDIT_STORAGE_KEY = 'ama_audit_logs_v1';

export class AuditService {
  private logs: AuditLogEntry[] = [];
  private listeners: Array<(logs: AuditLogEntry[]) => void> = [];

  constructor() {
    this.initFromStorage();
  }

  private initFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(AUDIT_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.logs = parsed;
            return;
          }
        }
      }
    } catch (e) {
      console.warn('[AuditService] LocalStorage read note:', e);
    }

    // Default initialization: purely dynamic to database
    this.logs = [];
    this.persistToLocalStorage();
  }

  private persistToLocalStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(this.logs));
      }
    } catch (e) {
      console.warn('[AuditService] LocalStorage save note:', e);
    }
  }

  private notifyListeners(): void {
    const copy = [...this.logs];
    for (const listener of this.listeners) {
      try {
        listener(copy);
      } catch (err) {
        console.error('[AuditService] Listener error:', err);
      }
    }
  }

  public subscribe(listener: (logs: AuditLogEntry[]) => void): () => void {
    this.listeners.push(listener);
    // Call immediately with current logs
    try {
      listener([...this.logs]);
    } catch (err) {
      console.error('[AuditService] Initial subscribe error:', err);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public logEvent(
    action: AuditAction,
    user: { id?: string; empId?: string; loginId?: string; name: string; role: UserRole },
    details: {
      documentMasterId?: string;
      documentId?: string;
      documentVersionId?: string;
      versionNumber?: string;
      oldValue?: string;
      newValue?: string;
      reason?: string;
      source?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      action,
      performedById: user.id || user.empId || user.loginId || 'sys-user',
      performedByName: user.name,
      performedByRole: user.role,
      performedAt: new Date().toISOString(),
      documentMasterId: details.documentMasterId,
      documentId: details.documentId,
      documentVersionId: details.documentVersionId,
      versionNumber: details.versionNumber,
      oldValue: details.oldValue,
      newValue: details.newValue,
      reason: details.reason,
      source: details.source || 'WEB_APP',
      ipAddress: details.ipAddress || '192.168.1.100',
      userAgent: details.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Node-Express-Server'),
    };

    // Immutable append-only in memory (deduplicating by ID)
    this.logs = [entry, ...this.logs.filter((l) => l.id !== entry.id)];
    this.persistToLocalStorage();

    // Persist immediately to Cloud Firestore
    try {
      firestoreService.saveAuditLog(entry).catch((e) => {
        console.warn('[AuditService] Firestore audit log save note:', e);
      });
    } catch (e) {
      console.warn('[AuditService] Firestore invocation note:', e);
    }

    this.notifyListeners();
    return entry;
  }

  public syncCloudLogs(cloudLogs: AuditLogEntry[]): void {
    if (!cloudLogs || cloudLogs.length === 0) return;

    // Deduplicate and merge by log ID
    const logMap = new Map<string, AuditLogEntry>();

    // Add existing logs first
    for (const log of this.logs) {
      logMap.set(log.id, log);
    }
    // Merge cloud logs
    for (const log of cloudLogs) {
      logMap.set(log.id, log);
    }

    // Sort chronologically descending (newest first)
    this.logs = Array.from(logMap.values()).sort(
      (a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()
    );

    this.persistToLocalStorage();
    this.notifyListeners();
  }

  public getLogs(filter?: {
    documentId?: string;
    action?: AuditAction;
    userId?: string;
  }): AuditLogEntry[] {
    let result = [...this.logs];
    if (filter?.documentId) {
      result = result.filter((l) => l.documentId === filter.documentId);
    }
    if (filter?.action) {
      result = result.filter((l) => l.action === filter.action);
    }
    if (filter?.userId) {
      result = result.filter((l) => l.performedById === filter.userId);
    }
    return result;
  }

  public seedLogs(initialLogs: AuditLogEntry[]): void {
    this.syncCloudLogs(initialLogs);
  }
}

export const auditService = new AuditService();

