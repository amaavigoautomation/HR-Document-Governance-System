import { apiJson } from './apiClient';

const base = '/api/pm/';
const qs = (p: Record<string, string | undefined>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return s ? `?${s}` : '';
};

/** Every Performance Management call. Server side: api/_lib/pmApi.ts. */
export const pmService = {
  get: <T = any>(action: string, params: Record<string, string | undefined> = {}) => apiJson<T>(`${base}${action}${qs(params)}`),
  post: <T = any>(action: string, body: unknown = {}) => apiJson<T>(`${base}${action}`, body),
};
