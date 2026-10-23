import { apiJson } from './apiClient';

// Payroll shares the leave serverless function: /api/leave/payroll-<action>
const get = <T = any>(action: string, params: Record<string, string | undefined> = {}) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return apiJson<T>(`/api/leave/payroll-${action}${qs ? `?${qs}` : ''}`);
};
const post = <T = any>(action: string, body: unknown = {}) => apiJson<T>(`/api/leave/payroll-${action}`, body);

export const payrollService = {
  me: () => get('me'),
  myPayslips: () => get('my-payslips'),
  payslip: (month: string, uid?: string) => get('payslip', { month, uid }),
  settings: () => get('settings'),
  saveSettings: (settings: unknown) => post('save-settings', { settings }),
  applyStarter: () => post('apply-starter'),
  structures: () => get('structures'),
  structure: (uid: string) => get('structure', { uid }),
  saveStructure: (b: unknown) => post('save-structure', b),
  splitCtc: (annualCtc: number) => post('split-ctc', { annualCtc }),
  importStructures: (rows: unknown[]) => post('import-structures', { rows }),
  inputs: (month: string) => get('inputs', { month }),
  adjustments: (month: string) => get('adjustments', { month }),
  saveAdjustment: (b: unknown) => post('save-adjustment', b),
  deleteAdjustment: (id: string) => post('delete-adjustment', { id }),
  loans: () => get('loans'),
  saveLoan: (b: unknown) => post('save-loan', b),
  closeLoan: (id: string) => post('close-loan', { id }),
  runs: () => get('runs'),
  run: (month: string) => get('run', { month }),
  calculate: (month: string) => post('calculate', { month }),
  setOverride: (b: unknown) => post('set-override', b),
  approve: (month: string, expectedNet: number, force = false) => post('approve', { month, expectedNet, force }),
  reopen: (month: string) => post('reopen', { month }),
  lock: (month: string) => post('lock', { month }),
  markPaid: (month: string, paidOn?: string, ref?: string) => post('mark-paid', { month, paidOn, ref }),
  deleteRun: (month: string) => post('delete-run', { month }),
  exportRun: (month: string, kind: string) => get('export', { month, kind }),
};

export const inr = (n: number | undefined | null) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(n) || 0);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m: string) => `${MONTHS[parseInt(m.slice(5, 7), 10) - 1] || m} ${m.slice(0, 4)}`;
export const shiftMonth = (m: string, delta: number) =>
  new Date(Date.UTC(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1 + delta, 1)).toISOString().slice(0, 7);
export const previousMonth = () => shiftMonth(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7), -1);
