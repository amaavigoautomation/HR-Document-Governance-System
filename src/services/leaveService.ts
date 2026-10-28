import { apiJson } from './apiClient';

const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return apiJson<T>(`/api/leave/${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`/api/leave/${action}`, body);

export const leaveService = {
  me: () => get('me'),
  calc: (b: unknown) => post('calc', b),
  apply: (b: unknown) => post('apply', b),
  myRequests: () => get('my-requests'),
  myLedger: () => get('my-ledger'),
  cancel: (id: string) => post('cancel', { id }),
  inbox: () => get('inbox'),
  delegation: () => get('delegation'),
  setDelegation: (b: { delegateUid: string; from: string; to: string; managerUid?: string }) => post('set-delegation', b),
  clearDelegation: (managerUid?: string) => post('clear-delegation', { managerUid }),
  decide: (id: string, decision: 'APPROVE' | 'REJECT', comment = '') => post('decide', { id, decision, comment }),
  teamCalendar: (from: string, to: string) => get('team-calendar', { from, to }),
  checkIn: (remarks = '') => post('check-in', { remarks }),
  checkOut: (remarks = '') => post('check-out', { remarks }),
  attendance: (month: string, uid?: string) => get('attendance', { month, uid }),
  applyAttendance: (b: unknown) => post('apply-attendance', b),
  attendanceReport: (p: { from: string; to: string; uid?: string }) => get('attendance-report', p as Record<string, string | undefined>),
  pendingApplications: () => get('pending-applications'),
  attendancePeople: () => get('attendance-people'),
  regularize: (b: unknown) => post('regularize', b),
  myRegularizations: () => get('my-regularizations'),
  decideRegularization: (id: string, decision: 'APPROVE' | 'REJECT', comment = '') => post('decide-regularization', { id, decision, comment }),
  // HR
  settings: () => get('settings'),
  saveSettings: (settings: unknown) => post('save-settings', { settings }),
  applyStarter: (b: unknown) => post('apply-starter', b),
  people: () => get('people'),
  saveProfiles: (profiles: unknown[]) => post('save-profiles', { profiles }),
  importProfiles: (rows: unknown[]) => post('import-profiles', { rows }),
  hidePerson: (uid: string) => post('hide-person', { uid }),
  balancesOf: (uid: string) => get('balances-of', { uid }),
  adjust: (b: unknown) => post('adjust', b),
  importBalances: (rows: unknown[]) => post('import-balances', { rows }),
  allRequests: (p: Record<string, string | undefined> = {}) => get('all-requests', p),
  hrCreate: (b: unknown) => post('hr-create', b),
  hrCancel: (id: string, note = '') => post('hr-cancel', { id, note }),
  markAttendance: (b: unknown) => post('mark-attendance', b),
  runAccrual: () => post('run-accrual'),
  reportAttendance: (month: string) => get('report-attendance', { month }),
  reportBalances: () => get('report-balances'),
};

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
