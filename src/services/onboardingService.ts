/**
 * Client helper for the /api/onboarding/* endpoints.
 * HR calls send the x-user-role header (same stopgap as the other APIs); the candidate
 * upload calls are public and authorised only by the private token in the link.
 */
import type { User } from '../types';

export type CandidateStatus = 'PENDING' | 'ON_HOLD' | 'REJECTED';

export interface OnboardingListItem {
  id: string;
  applicationId: string;
  employeeId: string;
  name: string;
  email: string;
  designation: string;
  onboardingDate: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocDef {
  key: string;
  label: string;
  required: boolean;
}

export interface AccountItemDef {
  key: string;
  label: string;
  fields: string[];
}

export const STATUS_LABELS: Record<string, string> = {
  PRIOR_EMPLOYEE_REVIEW: 'Waiting for HR decision',
  HR_STOPPED: 'Stopped by HR',
  DOCS_REQUESTED: 'Waiting for candidate documents',
  DOCS_SUBMITTED: 'Documents to verify',
  REJECTED: 'Rejected',
  ACCOUNTS_PENDING: 'Create accounts',
  READY_FOR_JOINING: 'Ready for joining day',
  ONBOARDED: 'Onboarded',
};

async function call<T = any>(
  path: string,
  user: Pick<User, 'role'> | null,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (user) headers['x-user-role'] = user.role;
  let body: BodyInit | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method: init.method || 'GET', headers, body });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new Error(`Unexpected server response (HTTP ${res.status}).`);
  }
  const json = await res.json();
  if (!res.ok || json.success === false) {
    const err: any = new Error(json.error || `Request failed (HTTP ${res.status}).`);
    err.payload = json;
    throw err;
  }
  return json as T;
}

const hr = (user: User) => ({ hrName: user.name, hrEmail: user.email });

export const onboardingService = {
  candidateStatuses: (user: User) =>
    call<{ statuses: Record<string, CandidateStatus>; onboardings: Record<string, { id: string; status: string; employeeId: string }> }>(
      '/api/onboarding/candidate-statuses',
      user
    ),

  setCandidateStatus: (user: User, applicationId: string, status: CandidateStatus) =>
    call('/api/onboarding/set-status', user, { method: 'POST', body: { applicationId, status, ...hr(user) } }),

  start: (user: User, applicationId: string, onboardingDate: string) =>
    call<{ onboardingId: string; employeeId: string; status: string; priorMatches?: any[]; emailSent?: boolean }>(
      '/api/onboarding/start',
      user,
      { method: 'POST', body: { applicationId, onboardingDate, ...hr(user) } }
    ),

  list: (user: User) =>
    call<{ items: OnboardingListItem[]; documents: DocDef[]; accountItems: AccountItemDef[] }>('/api/onboarding/list', user),

  get: (user: User, id: string) => call<{ item: any }>(`/api/onboarding/get?id=${encodeURIComponent(id)}`, user),

  decidePrior: (user: User, onboardingId: string, decision: 'PROCEED' | 'STOP') =>
    call('/api/onboarding/decide-prior', user, { method: 'POST', body: { onboardingId, decision, ...hr(user) } }),

  resendDocs: (user: User, onboardingId: string) =>
    call('/api/onboarding/resend-docs', user, { method: 'POST', body: { onboardingId, ...hr(user) } }),

  reviewDocs: (user: User, onboardingId: string, decision: 'VERIFY' | 'REJECT', reason?: string) =>
    call('/api/onboarding/review-docs', user, { method: 'POST', body: { onboardingId, decision, reason, ...hr(user) } }),

  saveAccounts: (user: User, onboardingId: string, accounts: Record<string, Record<string, string>>) =>
    call<{ status: string; complete: boolean }>('/api/onboarding/save-accounts', user, {
      method: 'POST',
      body: { onboardingId, accounts, ...hr(user) },
    }),

  updateDate: (user: User, onboardingId: string, onboardingDate: string) =>
    call('/api/onboarding/update-date', user, { method: 'POST', body: { onboardingId, onboardingDate, ...hr(user) } }),

  /** Fetches a candidate document (needs the HR role header, so it cannot be a plain link) and opens it. */
  async openFile(user: User, onboardingId: string, docKey: string): Promise<void> {
    const res = await fetch(`/api/onboarding/file?id=${encodeURIComponent(onboardingId)}&key=${encodeURIComponent(docKey)}`, {
      headers: { 'x-user-role': user.role },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Could not open the file (HTTP ${res.status}).`);
    }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  // ---- candidate (public)
  publicInfo: (token: string) =>
    call<{
      name: string;
      designation: string;
      employeeId: string;
      status: string;
      open: boolean;
      documents: (DocDef & { uploaded: { fileName: string; uploadedAt: string } | null })[];
    }>(`/api/onboarding/public-info?token=${encodeURIComponent(token)}`, null),

  async uploadDocument(token: string, docKey: string, file: File): Promise<void> {
    const url = `/api/onboarding/upload?token=${encodeURIComponent(token)}&docKey=${encodeURIComponent(docKey)}&fileName=${encodeURIComponent(file.name)}`;
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error(json.error || `Upload failed (HTTP ${res.status}).`);
  },

  submit: (token: string) => call('/api/onboarding/submit', null, { method: 'POST', body: { token } }),
};
