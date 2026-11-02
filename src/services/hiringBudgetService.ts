import { apiJson } from './apiClient';
import { RequisitionBudgetCheck } from '../types';

export interface DepartmentBudgetRow {
  departmentName: string;
  approvedHeadcount: number | null;
  maxCtcLpa: number | null;
  currentHeadcount: number;
  committedVacancies: number;
  updatedBy: string;
  updatedAt: string;
}

export async function listBudgets(): Promise<DepartmentBudgetRow[]> {
  const res = await apiJson<{ items: DepartmentBudgetRow[] }>('/api/recruitment/budget-list');
  return res.items || [];
}

export async function saveBudget(input: { departmentName: string; approvedHeadcount: number | string | null; maxCtcLpa: number | string | null }): Promise<void> {
  await apiJson('/api/recruitment/budget-save', input);
}

export async function checkBudget(requisitionId: string): Promise<RequisitionBudgetCheck> {
  const res = await apiJson<{ check: RequisitionBudgetCheck }>(`/api/recruitment/budget-check?requisitionId=${encodeURIComponent(requisitionId)}`);
  return res.check;
}
