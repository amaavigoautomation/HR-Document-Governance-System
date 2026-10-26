import { apiJson } from './apiClient';
import type { DashboardWidget } from '../../shared/dashboard';

export interface DashboardResponse {
  success: boolean;
  today: string;
  name: string;
  widgets: DashboardWidget[];
}

// The dashboard shares the leave serverless function: /api/leave/dashboard-<action>
export const dashboardService = {
  me: () => apiJson<DashboardResponse>('/api/leave/dashboard-me'),
};
