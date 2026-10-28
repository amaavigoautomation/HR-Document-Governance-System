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
  // identity documents
  identities: (uid?: string) => get('identity', { uid }),
  saveIdentity: (b: { uid?: string; type: string; number: string }) => post('identity-save', b),
  addIdentityFile: (b: { uid?: string; type: string; dataUrl: string }) => post('identity-file-add', b),
  identityFile: (id: string, uid?: string) => get('identity-file', { id, uid }),
  deleteIdentityFile: (b: { uid?: string; id: string }) => post('identity-file-delete', b),
  decideIdentity: (b: { uid: string; type: string; approve: boolean; note?: string }) => post('identity-decide', b),
  // personal information
  personal: (uid?: string) => get('personal', { uid }),
  savePersonal: (uid: string | undefined, values: Record<string, string | boolean>) => post('personal-save', { uid, values }),
  // family
  family: (uid?: string) => get('family', { uid }),
  saveFamily: (b: { uid?: string; id?: string; member: unknown }) => post('family-save', b),
  deleteFamily: (b: { uid?: string; id: string }) => post('family-delete', b),
  // qualifications
  qualifications: (uid?: string) => get('qualifications', { uid }),
  saveQualification: (b: { uid?: string; id?: string; item: unknown }) => post('qualification-save', b),
  deleteQualification: (b: { uid?: string; id: string }) => post('qualification-delete', b),
  setQualificationDoc: (b: { uid?: string; id: string; dataUrl: string }) => post('qualification-doc-set', b),
  qualificationDoc: (id: string, uid?: string) => get('qualification-doc', { id, uid }),
  deleteQualificationDoc: (b: { uid?: string; id: string }) => post('qualification-doc-delete', b),
  // directory
  directory: (all = false) => get('directory', { all: all ? '1' : undefined }),
  setManager: (uid: string, managerUid: string) => post('set-manager', { uid, managerUid }),
};
