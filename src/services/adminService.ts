/** Client wrappers for the company-admin and platform-admin APIs (api/_lib/tenantAdmin.ts). */
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { apiJson } from './apiClient';
import { getCompanyId } from './tenant';
import type { Company, Department } from '../types';
import type { RoleDef } from '../../shared/permissions';

export function subscribeToDepartments(cb: (items: Department[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'departments'), where('companyId', '==', getCompanyId())),
    (snap) => cb(snap.docs.map((d) => d.data() as Department).sort((a, b) => a.name.localeCompare(b.name))),
    (err) => console.warn('[Admin] departments subscription note:', err?.message || err)
  );
}

export function subscribeToRoles(cb: (items: RoleDef[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'roles'), where('companyId', '==', getCompanyId())),
    (snap) =>
      cb(
        snap.docs
          .map((d) => d.data() as RoleDef)
          .sort((a, b) => Number(!!b.isAdmin) - Number(!!a.isAdmin) || a.name.localeCompare(b.name))
      ),
    (err) => console.warn('[Admin] roles subscription note:', err?.message || err)
  );
}

export interface CreateUserInput {
  name: string;
  email: string;
  title?: string;
  departmentId?: string;
  roleIds: string[];
}

export interface CreateUserResult {
  userId: string;
  empId: string;
  emailed: boolean;
  inviteLink?: string;
  /** Set when the account exists but no invite could be sent or linked. */
  inviteError?: string;
}

export const adminApi = {
  createUser: (input: CreateUserInput) => apiJson<CreateUserResult & { success: true }>('/api/tenant/create-user', input),

  importUsers: (rows: { name: string; email: string; department?: string; roles?: string; title?: string }[]) =>
    apiJson<{
      imported: number;
      failed: number;
      results: { row: number; email: string; ok: boolean; error?: string; emailed?: boolean; inviteLink?: string; inviteError?: string }[];
    }>('/api/tenant/import-users', { rows }),

  updateUser: (input: { userId: string; name?: string; title?: string; departmentId?: string; roleIds?: string[]; active?: boolean }) =>
    apiJson('/api/tenant/update-user', input),

  resendInvite: (userId: string) => apiJson<{ emailed: boolean; inviteLink?: string }>('/api/tenant/resend-invite', { userId }),

  saveDepartment: (input: { departmentId?: string; name: string; headUserId?: string }) => apiJson('/api/tenant/save-department', input),
  deleteDepartment: (departmentId: string) => apiJson('/api/tenant/delete-department', { departmentId }),

  saveRole: (input: { roleId?: string; name: string; description?: string; permissions: string[]; portal: string }) =>
    apiJson('/api/tenant/save-role', input),
  deleteRole: (roleId: string) => apiJson('/api/tenant/delete-role', { roleId }),
};

export const platformApi = {
  listCompanies: async (): Promise<Company[]> => (await apiJson<{ companies: Company[] }>('/api/tenant/companies')).companies,
  approve: (companyId: string, modules: string[], plan?: string) => apiJson('/api/tenant/approve-company', { companyId, modules, plan }),
  suspend: (companyId: string) => apiJson('/api/tenant/suspend-company', { companyId }),
  updateModules: (companyId: string, modules: string[], plan?: string) =>
    apiJson('/api/tenant/update-company-modules', { companyId, modules, plan }),
};

/** Minimal CSV parser (quoted fields, commas, newlines). Header names are matched case-insensitively. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}
