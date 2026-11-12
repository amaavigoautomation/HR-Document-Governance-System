import { apiJson } from './apiClient';

export interface AssistantSource { kind: 'data' | 'policy'; label: string }
export interface AssistantReply { success: boolean; id: string; answer: string; sources: AssistantSource[]; unsure: boolean; off?: boolean; limited?: boolean; error?: string }

/** Ask HR calls. Server side: api/_lib/assistantApi.ts. */
export const assistantService = {
  ask: (question: string, history: { role: 'user' | 'assistant'; content: string }[]) => apiJson<AssistantReply>('/api/assistant/ask', { question, history }),
  feedback: (id: string, helpful: boolean) => apiJson('/api/assistant/feedback', { id, helpful }),
  askHr: (question: string, id?: string) => apiJson<{ success: boolean; sent: boolean; message: string; error?: string }>('/api/assistant/ask-hr', { question, id }),
};
