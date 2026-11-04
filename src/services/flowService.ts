import { apiJson } from './apiClient';
import type { FlowDoc, FlowStep, Problem } from '../../shared/flowEngine';

const base = '/api/recruitment/';
const post = <T = any>(a: string, body: unknown = {}) => apiJson<T>(`${base}${a}`, body);
const get = <T = any>(a: string, q: Record<string, string> = {}) => {
  const s = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return apiJson<T>(`${base}${a}${s ? `?${s}` : ''}`);
};

export interface FlowState {
  canManage: boolean; active: FlowDoc | null; draft: FlowDoc | null; people: { uid: string; name: string; title: string }[];
  versions: { id: string; version: number; status: string; name: string; activatedAt: string; activatedBy: string; note: string; steps: number }[];
  counts: Record<string, number>; myOpen: number; me: { uid: string; name: string };
}
export interface FlowRunRow {
  id: string; applicationId: string; candidateName: string; designation: string; status: string; stuckReason: string; flowVersion: number;
  stepId: string; stepNumber: number; stepTitle: string; since: string; waitUntil: string; owner: string; dueOn: string; late: boolean; updatedAt: string;
}
export interface FlowTask {
  id: string; runId: string; applicationId: string; candidateName: string; designation: string; stepId: string; stepType: string; stepTitle: string;
  ownerUid: string; ownerName: string; instruction: string; question: string; decide: boolean; link: string; dueOn: string; status: string; late: boolean; resolution?: string; doneAt?: string;
}

/** Every hiring-flow call. Server side: api/_lib/flowApi.ts. */
export const flowService = {
  state: () => get<{ success: true } & FlowState>('flow-state'),
  startStandard: () => post<{ draft: FlowDoc }>('flow-start-standard'),
  edit: () => post<{ draft: FlowDoc }>('flow-edit'),
  save: (name: string, steps: FlowStep[]) => post<{ draft: FlowDoc; problems: Problem[] }>('flow-save', { name, steps }),
  discard: () => post('flow-discard'),
  activate: (note?: string) => post<{ version: number }>('flow-activate', { note }),
  runs: (status?: string) => get<{ items: FlowRunRow[] }>('flow-runs', status ? { status } : {}),
  run: (id: string) => get<{ run: any; flow: { steps: FlowStep[]; version: number } | null }>('flow-run', { id }),
  enroll: (applicationIds: string[]) => post<{ added: number; already: number; skipped: number }>('flow-enroll', { applicationIds }),
  checkNow: (runId?: string) => post<{ checked: number }>('flow-check-now', { runId }),
  runAction: (runId: string, action: 'retry' | 'skip' | 'reject' | 'stop' | 'reassign', extra: { note?: string; ownerUid?: string } = {}) => post('flow-run-action', { runId, action, ...extra }),
  tasks: (all = false) => get<{ open: FlowTask[]; recent: FlowTask[] }>('flow-my-tasks', all ? { all: '1' } : {}),
  decide: (taskId: string, decision: 'yes' | 'no', note?: string) => post('flow-task-decide', { taskId, decision, note }),
};
