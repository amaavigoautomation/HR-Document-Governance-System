import { AuditAction, AuditLogEntry, UserRole } from '../types';

export class AuditService {
  private logs: AuditLogEntry[] = [];

  public logEvent(
    action: AuditAction,
    user: { id: string; name: string; role: UserRole },
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
      performedById: user.id,
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

    this.logs.unshift(entry);
    return entry;
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

  public seedLogs(initialLogs: AuditLogEntry[]) {
    this.logs = [...initialLogs];
  }
}

export const auditService = new AuditService();
