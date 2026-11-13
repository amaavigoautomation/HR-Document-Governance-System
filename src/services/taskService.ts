import { apiJson } from './apiClient';

const base = '/api/tasks/';
const qs = (p: Record<string, string | undefined>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return s ? `?${s}` : '';
};

/** Every Task Management call. Server side: api/_lib/taskApi.ts. */
export const taskService = {
  get: <T = any>(action: string, params: Record<string, string | undefined> = {}) => apiJson<T>(`${base}${action}${qs(params)}`),
  post: <T = any>(action: string, body: unknown = {}) => apiJson<T>(`${base}${action}`, body),

  /**
   * Attaches a file: the server signs a one-file upload ticket, the browser sends the file straight to the file store,
   * then the server checks what arrived and adds it to the task.
   */
  async attach(taskId: string, file: File): Promise<any> {
    const { publicId, ticket } = await taskService.post<any>('attach-sign', { id: taskId, name: file.name, bytes: file.size });
    const form = new FormData();
    for (const [k, v] of Object.entries(ticket.fields as Record<string, string>)) form.append(k, v);
    form.append('api_key', ticket.apiKey);
    form.append('file', file);
    const res = await fetch(ticket.uploadUrl, { method: 'POST', body: form });
    const up: any = await res.json().catch(() => null);
    if (!res.ok || !up?.public_id) throw new Error(up?.error?.message || 'The file could not be uploaded. Try again.');
    return taskService.post('attach-add', { id: taskId, publicId: up.public_id, resourceType: up.resource_type, name: file.name });
  },
};
