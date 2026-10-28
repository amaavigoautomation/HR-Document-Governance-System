import { apiJson } from './apiClient';

// People lifecycle shares the leave serverless function: /api/leave/lifecycle-<action>
const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return apiJson<T>(`/api/leave/lifecycle-${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`/api/leave/lifecycle-${action}`, body);

export const lifecycleService = {
  me: () => get('me'),
  settings: () => get('settings'),
  saveSettings: (settings: unknown) => post('save-settings', { settings }),
  // onboarding
  onboarding: () => get('onboarding'),
  onboardingMy: () => get('onboarding-my'),
  startChecklist: (uid: string, joinDate?: string) => post('onboarding-start', { uid, joinDate }),
  updateTask: (b: unknown) => post('task-update', b),
  addTask: (b: unknown) => post('task-add', b),
  deleteTask: (id: string) => post('task-delete', { id }),
  submitBank: (b: unknown) => post('submit-bank', b),
  // exit
  exitMy: () => get('exit-my'),
  resign: (b: unknown) => post('exit-resign', b),
  withdraw: () => post('exit-withdraw'),
  exits: () => get('exits'),
  exitCase: (uid: string) => get('exit', { uid }),
  startExit: (b: unknown) => post('exit-start', b),
  decideExit: (b: unknown) => post('exit-decide', b),
  setExitDates: (b: unknown) => post('exit-dates', b),
  cancelExit: (uid: string, note?: string) => post('exit-cancel', { uid, note }),
  clear: (b: unknown) => post('exit-clear', b),
  completeExit: (uid: string, early = false) => post('exit-complete', { uid, early }),
  // letters
  previewLetter: (b: unknown) => post('letter-preview', b),
  issueLetter: (b: unknown) => post('letter-issue', b),
  letters: (uid?: string) => get('letters', { uid }),
  myLetters: () => get('my-letters'),
  letter: (id: string) => get('letter', { id }),
  // employee profile
  profile: (uid?: string) => get('profile', { uid }),
  saveProfile: (uid: string, fields: Record<string, string>) => post('profile-save', { uid, fields }),
  // directory
  directory: (all = false) => get('directory', { all: all ? '1' : undefined }),
  setManager: (uid: string, managerUid: string) => post('set-manager', { uid, managerUid }),
};
