/**
 * Client helper for /api/assess/*.
 * HR calls and the employee's own tests send the signed-in user's token; a candidate's test link is public
 * and authorised only by the private token in the link.
 */
import { apiFetch } from './apiClient';
import type { AssessmentResult, Comparison, SkillBlueprint, DifficultyPreset } from '../../shared/assessment';

export type AssessmentKind = 'PRE_HIRE' | 'RETEST' | 'GENERAL';
export type AssessmentStatus = 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export interface AssessmentSummary {
  id: string;
  kind: AssessmentKind;
  status: AssessmentStatus;
  subject: { type: 'CANDIDATE' | 'EMPLOYEE'; name: string; email: string; onboardingId: string | null; employeeUid: string | null };
  skills: string[];
  blueprint: SkillBlueprint[];
  questionCount: number;
  durationMinutes: number;
  showResultToTaker: boolean;
  baselineId: string | null;
  createdAt: string;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  result: AssessmentResult | null;
}

export interface ReviewRow {
  skill: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  text: string;
  options: string[];
  chosenIndex: number | null;
  correctIndex: number;
  correct: boolean;
  explanation: string;
}

export interface AssessmentDetail extends AssessmentSummary {
  tabSwitches: number;
  lateBySeconds: number;
  events: { at: string; text: string }[];
  review: ReviewRow[];
  comparison: Comparison | null;
  baseline: { id: string; completedAt: string; kind: AssessmentKind } | null;
}

export interface BankQuestionRow {
  id: string;
  skill: string;
  skillKey: string;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  status: 'ACTIVE' | 'DISABLED';
  timesUsed: number;
}

export interface TakerAssessment {
  id: string;
  status: AssessmentStatus;
  kind: AssessmentKind;
  name: string;
  companyName?: string;
  skills: string[];
  questionCount: number;
  durationMinutes: number;
  expiresAt: string;
  startedAt: string | null;
  deadline: string | null;
  secondsLeft: number | null;
  result: AssessmentResult | null;
  resultHidden: boolean;
  questions?: { id: string; skill: string; text: string; options: string[] }[];
}

export interface MyAssessment {
  id: string;
  kind: AssessmentKind;
  status: AssessmentStatus;
  skills: string[];
  questionCount: number;
  durationMinutes: number;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  result: AssessmentResult | null;
  resultHidden: boolean;
  comparison: Comparison | null;
}

export interface SkillRequest {
  skill: string;
  count: number;
  preset: DifficultyPreset;
}

export interface CreateAssessmentInput {
  kind?: AssessmentKind;
  // A candidate...
  name?: string;
  email?: string;
  role?: string;
  onboardingId?: string;
  // ...or an employee
  employeeUid?: string;
  skills: SkillRequest[];
  durationMinutes: number;
  expiresInDays: number;
  showResultToTaker: boolean;
  sendEmail: boolean;
}

async function request<T = any>(path: string, opts: { body?: unknown; method?: string; auth?: boolean } = {}): Promise<T> {
  const method = opts.method || (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = opts.auth === false ? await fetch(path, { method, headers, body }) : await apiFetch(path, { method, headers, body });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || json?.success === false) throw new Error(json?.error || `Request failed (HTTP ${res.status}).`);
  return json as T;
}

const q = encodeURIComponent;

export const assessmentService = {
  // ---- HR
  list: (params: { onboardingId?: string; email?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.onboardingId) qs.set('onboardingId', params.onboardingId);
    if (params.email) qs.set('email', params.email);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ items: AssessmentSummary[] }>(`/api/assess/list${suffix}`);
  },
  get: (id: string) => request<{ item: AssessmentDetail }>(`/api/assess/get?id=${q(id)}`),
  history: (p: { email?: string; employeeUid?: string }) =>
    request<{ items: (AssessmentSummary & { comparisonToFirst: Comparison | null })[] }>(
      `/api/assess/history?${p.employeeUid ? `employeeUid=${q(p.employeeUid)}` : `email=${q(p.email || '')}`}`
    ),
  create: (input: CreateAssessmentInput) => request<{ id: string; emailSent: boolean; link: string }>('/api/assess/create', { body: input }),
  retest: (input: { employeeUid: string; baselineId?: string; skills?: string[]; durationMinutes?: number; expiresInDays?: number; showResultToTaker?: boolean; sendEmail?: boolean }) =>
    request<{ id: string; emailSent: boolean; link: string; baselineId: string }>('/api/assess/retest', { body: input }),
  resend: (id: string) => request<{ emailSent: boolean; link: string }>('/api/assess/resend', { body: { id } }),
  cancel: (id: string) => request('/api/assess/cancel', { body: { id } }),
  bank: (skill?: string) =>
    request<{ skills: { skill: string; total: number; active: number }[]; items: BankQuestionRow[] }>(
      `/api/assess/bank${skill ? `?skill=${q(skill)}` : ''}`
    ),
  setQuestionStatus: (id: string, status: 'ACTIVE' | 'DISABLED') => request('/api/assess/bank-toggle', { body: { id, status } }),

  // ---- the person taking a test: by private link (no sign-in) or as a signed-in employee
  mine: () => request<{ items: MyAssessment[] }>('/api/assess/mine'),
  takerInfo: (ref: { token?: string; id?: string }) =>
    request<{ assessment: TakerAssessment }>(
      `/api/assess/public-info?${ref.token ? `token=${q(ref.token)}` : `id=${q(ref.id || '')}`}`,
      { auth: !ref.token }
    ),
  start: (ref: { token?: string; id?: string }) =>
    request<{ assessment: TakerAssessment }>('/api/assess/start', { body: ref.token ? { token: ref.token } : { id: ref.id }, auth: !ref.token }),
  submit: (ref: { token?: string; id?: string }, answers: Record<string, number>, tabSwitches: number) =>
    request<{ assessment: TakerAssessment }>('/api/assess/submit', {
      body: { ...(ref.token ? { token: ref.token } : { id: ref.id }), answers, tabSwitches },
      auth: !ref.token,
    }),
};
