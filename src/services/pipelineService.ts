import { apiJson } from './apiClient';

const base = '/api/recruitment/';
const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return apiJson<T>(`${base}${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`${base}${action}`, body);

/** Everything the hiring pipeline screens call. One method per server action in api/_lib/pipelineApi.ts and interviewApi.ts. */
export const pipelineService = {
  // JD library
  jdLib: () => get('jdlib-list'),
  jdLibSave: (b: unknown) => post('jdlib-save', b),
  jdLibDelete: (id: string) => post('jdlib-delete', { id }),
  // postings
  postKit: (requisitionId: string) => get('post-kit', { requisitionId }),
  postings: (requisitionId?: string) => get('post-list', { requisitionId }),
  postSave: (b: unknown) => post('post-save', b),
  postDelete: (id: string) => post('post-delete', { id }),
  // referrals
  refJobs: () => get('ref-jobs'),
  refSubmit: (b: unknown) => post('ref-submit', b),
  refList: () => get('ref-list'),
  // candidates
  board: () => get('pipe-board'),
  candidate: (applicationId: string) => get('cand-detail', { applicationId }),
  candSave: (b: unknown) => post('cand-save', b),
  extractResume: (applicationId: string) => post('resume-extract', { applicationId }),
  // scoring
  scoreSettings: () => get('score-settings'),
  scoreSettingsSave: (weights: unknown) => post('score-settings-save', { weights }),
  scoreRate: (b: unknown) => post('score-rate', b),
  // screening and assessments
  screenSave: (b: unknown) => post('screen-save', b),
  assessAssign: (b: unknown) => post('assess-assign', b),
  assessResult: (b: unknown) => post('assess-result', b),
  // interviews
  interviews: (applicationId?: string) => get('int-list', { applicationId }),
  schedule: (b: unknown) => post('int-schedule', b),
  reschedule: (b: unknown) => post('int-reschedule', b),
  cancel: (id: string, reason: string) => post('int-cancel', { id, reason }),
  feedback: (interviewId: string) => get('int-feedback-get', { interviewId }),
  submitFeedback: (interviewId: string, scorecard: unknown) => post('int-feedback-submit', { interviewId, scorecard }),
  aiSummary: (id: string) => post('int-ai-summary', { id }),
  sendReminders: () => post('int-send-reminders'),
};
