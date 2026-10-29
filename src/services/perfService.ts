import { apiJson } from './apiClient';

const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return apiJson<T>(`/api/perf/${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`/api/perf/${action}`, body);

export const perfService = {
  me: () => get('me'),
  // setup
  settings: () => get('settings'),
  saveSettings: (b: unknown) => post('settings-save', b),
  rotateWebhook: () => post('webhook-rotate'),
  applyStarter: () => post('apply-starter'),
  frameworks: () => get('frameworks'),
  saveFramework: (b: unknown) => post('framework-save', b),
  cloneFramework: (id: string) => post('framework-clone', { id }),
  approveFramework: (id: string) => post('framework-approve', { id }),
  retireFramework: (id: string) => post('framework-retire', { id }),
  cycles: () => get('cycles'),
  saveCycle: (b: unknown) => post('cycle-save', b),
  openCycle: (id: string) => post('cycle-open', { id }),
  lockCycle: (id: string, force = false) => post('cycle-lock', { id, force }),
  templates: () => get('templates'),
  saveTemplate: (b: unknown) => post('template-save', b),
  approveTemplate: (id: string) => post('template-approve', { id }),
  // SOPs
  sops: () => get('sops'),
  sopSources: () => get('sop-sources'),
  saveSop: (b: unknown) => post('sop-save', b),
  deleteSop: (id: string) => post('sop-delete', { id }),
  syncSops: () => post('sop-sync'),
  assignments: (scope?: string, uid?: string) => get('sop-assignments', { scope, uid }),
  ackSop: (id: string) => post('sop-ack', { id }),
  verifySop: (id: string) => post('sop-verify', { id }),
  // plans and evidence
  generatePlans: (uid?: string) => post('plan-generate', { uid }),
  plans: (scope: 'me' | 'team' | 'all') => get('plans', { scope }),
  plan: (id: string) => get('plan', { id }),
  savePlan: (id: string, kras: unknown) => post('plan-save', { id, kras }),
  submitPlan: (id: string, note?: string) => post('plan-submit', { id, note }),
  decidePlan: (id: string, decision: 'APPROVE' | 'RETURN', note?: string) => post('plan-decide', { id, decision, note }),
  ackPlan: (id: string) => post('plan-ack', { id }),
  addEvidence: (b: unknown) => post('evidence-add', b),
  evidence: (uid?: string) => get('evidence-list', { uid }),
  verifyEvidence: (id: string, decision: 'VERIFY' | 'REJECT', note?: string) => post('evidence-verify', { id, decision, note }),
  // reviews
  reviews: (scope: 'me' | 'team' | 'all', cycleId?: string) => get('reviews', { scope, cycleId }),
  review: (id: string) => get('review', { id }),
  selfSave: (b: unknown) => post('review-self-save', b),
  selfSubmit: (b: unknown) => post('review-self-submit', b),
  mgrSave: (b: unknown) => post('review-mgr-save', b),
  mgrSubmit: (b: unknown) => post('review-mgr-submit', b),
  discussion: (id: string, note: string) => post('review-discussion', { id, note }),
  hrSave: (b: unknown) => post('review-hr-save', b),
  hrForward: (b: unknown) => post('review-hr-forward', b),
  returnReview: (id: string, note: string) => post('review-return', { id, note }),
  approveReview: (id: string, finalComments?: string) => post('review-approve', { id, finalComments }),
  respond: (id: string, decision: 'ACKNOWLEDGE' | 'DISAGREE', comment?: string) => post('review-respond', { id, decision, comment }),
  resolveDispute: (id: string, outcome: 'UPHELD' | 'AMENDED', resolution: string) => post('review-dispute-resolve', { id, outcome, resolution }),
  amend: (id: string, adjustments: unknown) => post('review-amend', { id, adjustments }),
  defer: (id: string, resume: boolean, note?: string) => post('review-defer', { id, resume, note }),
  referral: (id: string) => post('review-referral', { id }),
  // check-ins, development
  checkins: (scope: 'me' | 'team' | 'all') => get('checkins', { scope }),
  saveCheckin: (b: unknown) => post('checkin-save', b),
  devPlans: (scope: 'me' | 'team' | 'all') => get('devplans', { scope }),
  saveDevPlan: (b: unknown) => post('devplan-save', b),
  updateDevPlan: (b: unknown) => post('devplan-update', b),
  // dashboards, AI, governance
  dashboard: (scope: string, cycleId?: string) => get('dashboard', { scope, cycleId }),
  aiDraft: (id: string) => post('ai-review-draft', { id }),
  aiKpiWording: (text: string) => post('ai-kpi-wording', { text }),
  auditLog: (entity?: string, entityId?: string) => get('audit-log', { entity, entityId }),
  exceptions: (status?: string) => get('exceptions', { status }),
  resolveException: (id: string, resolution: string) => post('exception-resolve', { id, resolution }),
  moodMe: () => get('mood-me'),
  saveMood: (mood: string) => post('mood-save', { mood }),
  moodReport: (days: number, scope: 'team' | 'company') => get('mood-report', { days: String(days), scope }),
  notifications: () => get('notifications'),
  readNotifications: (ids?: string[]) => post('notifications-read', { ids }),
};

export const RATINGS = [
  { value: 1, label: 'Below Standard' }, { value: 2, label: 'Developing' }, { value: 3, label: 'Meets Standard' }, { value: 4, label: 'Exceeds Standard' }, { value: 5, label: 'Exemplary' },
];
