import { apiJson } from './apiClient';

export interface ApplicationItem {
  id: string;
  name: string;
  email: string;
  mobile: string;
  city: string;
  designation: string;
  experience: string;
  noticePeriod: string;
  status: string;
  interviewDate: string;
  interviewComment: string;
  message: string;
  resumeUrl: string;
  source: string;
  createdAt: string;
  reappliedAt: string | null;
  extra: Record<string, string>;
}

export interface ApplicationSettings {
  webhookUrl: string;
  allowedOrigins: string[];
  employeeIdPrefix: string;
  lastReceivedAt: string | null;
  keyRotatedAt: string;
  /** Only present right after the key is created or rotated. */
  secret?: string | null;
}

export const applicationsService = {
  stages: () => apiJson<{ stages: string[]; legacy: boolean }>('/api/recruitment/app-stages'),
  list: () => apiJson<{ legacy: boolean; items: ApplicationItem[] }>('/api/recruitment/app-list'),
  settings: () => apiJson<{ legacy: boolean } & Partial<ApplicationSettings>>('/api/recruitment/app-settings'),
  saveSettings: (allowedOrigins: string[], employeeIdPrefix: string) =>
    apiJson<ApplicationSettings>('/api/recruitment/app-save-settings', { allowedOrigins, employeeIdPrefix }),
  rotateKey: () => apiJson<ApplicationSettings>('/api/recruitment/app-rotate-key', {}),
  add: (data: Record<string, string>) => apiJson<{ id: string; duplicate: boolean }>('/api/recruitment/app-add', data),
  importRows: (rows: Record<string, string>[]) =>
    apiJson<{ created: number; duplicates: number; errors: { row: number; error: string }[] }>('/api/recruitment/app-import', { rows }),
  update: (id: string, patch: { status?: string; interviewDate?: string; interviewComment?: string }) =>
    apiJson('/api/recruitment/app-update', { id, ...patch }),
  syncWebsite: () => apiJson<{ skipped?: boolean; seen: number; created: number; existing: number; invalid: number }>('/api/recruitment/website-sync', {}),
  remove: (id: string) => apiJson('/api/recruitment/app-delete', { id }),
};
