import { apiJson } from './apiClient';
import type { FlowDoc, FlowStep, Problem } from '../../shared/flowEngine';

const base = '/api/recruitment/';
const post = <T = any>(a: string, body: unknown = {}) => apiJson<T>(`${base}${a}`, body);
const get = <T = any>(a: string, q: Record<string, string> = {}) => {
  const s = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return apiJson<T>(`${base}${a}${s ? `?${s}` : ''}`);
};

export interface FlowVersionRow { id: string; version: number; status: string; name: string; activatedAt: string; activatedBy: string; note: string; steps: number }
export interface FamilyView {
  familyId: string; name: string; isDefault: boolean; designations: string[];
  active: FlowDoc | null; draft: FlowDoc | null; versions: FlowVersionRow[]; inFlight: number;
}
export interface FlowState {
  families: FamilyView[]; designationOptions: string[];
  canManage: boolean; active: FlowDoc | null; draft: FlowDoc | null; people: { uid: string; name: string; title: string }[];
  versions: { id: string; version: number; status: string; name: string; activatedAt: string; activatedBy: string; note: string; steps: number }[];
  counts: Record<string, number>; myOpen: number; me: { uid: string; name: string };
}
export interface FlowRunRow {
  id: string; applicationId: string; candidateName: string; designation: string; status: string; stuckReason: string; flowVersion: number;
  flowName: string; familyId: string; stepId: string; stepNumber: number; stepTitle: string; since: string; waitUntil: string; owner: string; dueOn: string; late: boolean; updatedAt: string;
}
export interface FlowTask {
  id: string; runId: string; applicationId: string; candidateName: string; designation: string; stepId: string; stepType: string; stepTitle: string;
  ownerUid: string; ownerName: string; instruction: string; question: string; decide: boolean; link: string; dueOn: string; status: string; late: boolean; resolution?: string; doneAt?: string;
}

/** Every hiring-flow call. Server side: api/_lib/flowApi.ts. */
export const flowService = {
  state: () => get<{ success: true } & FlowState>('flow-state'),
  startStandard: (familyId: string) => post<{ draft: FlowDoc }>('flow-start-standard', { familyId }),
  edit: (familyId: string) => post<{ draft: FlowDoc }>('flow-edit', { familyId }),
  save: (familyId: string, name: string, steps: FlowStep[]) => post<{ draft: FlowDoc; problems: Problem[] }>('flow-save', { familyId, name, steps }),
  discard: (familyId: string) => post('flow-discard', { familyId }),
  activate: (familyId: string, note?: string) => post<{ version: number }>('flow-activate', { familyId, note }),
  newFlow: (b: { name?: string; designations: string[]; from: 'standard' | 'copy' | 'empty'; copyFrom?: string }) => post<{ familyId: string }>('flow-new', b),
  setDesignations: (familyId: string, designations: string[], name?: string) => post('flow-set-designations', { familyId, designations, name }),
  retire: (familyId: string) => post('flow-retire', { familyId }),
  runs: (status?: string) => get<{ items: FlowRunRow[] }>('flow-runs', status ? { status } : {}),
  run: (id: string) => get<{ run: any; flow: { steps: FlowStep[]; version: number } | null }>('flow-run', { id }),
  enroll: (applicationIds: string[]) => post<{ added: number; already: number; skipped: number }>('flow-enroll', { applicationIds }),
  checkNow: (runId?: string) => post<{ checked: number; enrolled: number }>('flow-check-now', { runId }),
  runAction: (runId: string, action: 'retry' | 'skip' | 'reject' | 'stop' | 'reassign', extra: { note?: string; ownerUid?: string } = {}) => post('flow-run-action', { runId, action, ...extra }),
  tasks: (all = false) => get<{ open: FlowTask[]; recent: FlowTask[] }>('flow-my-tasks', all ? { all: '1' } : {}),
  decide: (taskId: string, decision: 'yes' | 'no', note?: string) => post('flow-task-decide', { taskId, decision, note }),
};

export interface SkillQuestion { id: string; q: string; options: string[]; answer: number; topic?: string }
export interface SkillTestRow { designation: string; designationKey: string; count: number; source: string; updatedAt: string }
export interface SkillTest { designation: string; source: string; questions: SkillQuestion[]; updatedAt: string; updatedBy: string }

export const skillTestService = {
  list: () => get<{ aiOn: boolean; tests: SkillTestRow[] }>('stest-list'),
  get: (designation: string) => get<{ aiOn: boolean; hasJd: boolean; test: SkillTest | null }>('stest-get', { designation }),
  generate: (designation: string, count: number) => post<{ test: SkillTest }>('stest-generate', { designation, count }),
  save: (designation: string, questions: SkillQuestion[]) => post<{ test: SkillTest }>('stest-save', { designation, questions }),
  remove: (designation: string) => post('stest-delete', { designation }),
  // candidate (no sign-in, the token is the credential)
  publicGet: (token: string) => get<any>('stest-public-get', { token }),
  publicStart: (token: string) => post<any>('stest-public-start', { token }),
  publicSubmit: (token: string, answers: Record<string, number>) => post<any>('stest-public-submit', { token, answers }),
};
