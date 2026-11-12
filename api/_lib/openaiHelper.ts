/**
 * One place that talks to OpenAI for the hiring features. It adds three things the other callers do not need:
 *  - a monthly call limit per company (AI_MONTHLY_CALLS, default 500), so a loop or a busy week cannot run up a bill
 *  - a cache keyed by the exact input, so the same resume or the same dashboard is never paid for twice
 *  - a quiet "off" state when OPENAI_API_KEY is not set: callers then fall back to the rule-based answer
 * Env: OPENAI_API_KEY, OPENAI_HIRING_MODEL (or OPENAI_MODEL, default gpt-4o-mini), OPENAI_BASE_URL, AI_MONTHLY_CALLS.
 */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';

export const aiKey = (): string => {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return !k || k === 'MY_OPENAI_API_KEY' ? '' : k;
};
export const aiEnabled = () => !!aiKey();
export const monthlyCap = () => { const n = Number(process.env.AI_MONTHLY_CALLS); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500; };
const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
const usageId = (cid: string) => `aiu_${cid}_${thisMonth()}`;
const db = () => adminDb();

export async function aiUsage(cid: string): Promise<{ month: string; used: number; cap: number; enabled: boolean }> {
  const s = await db().collection('hiringItems').doc(usageId(cid)).get();
  return { month: thisMonth(), used: s.exists ? Number((s.data() as any).calls || 0) : 0, cap: monthlyCap(), enabled: aiEnabled() };
}

/** Reserves one call, or says why not. Done in a transaction so parallel requests cannot all slip under the limit. */
async function reserve(cid: string): Promise<string> {
  const ref = db().collection('hiringItems').doc(usageId(cid));
  return db().runTransaction(async (tx: any) => {
    const s = await tx.get(ref);
    const calls = s.exists ? Number((s.data() as any).calls || 0) : 0;
    if (calls >= monthlyCap()) return `The monthly AI limit (${monthlyCap()} calls) has been reached. It resets next month, or an admin can raise AI_MONTHLY_CALLS.`;
    tx.set(ref, { id: ref.id, companyId: cid, kind: 'aiUsage', month: thisMonth(), calls: calls + 1, updatedAt: new Date().toISOString() });
    return '';
  });
}

/** Same monthly company limit, for features that make their own OpenAI calls (the Ask HR assistant). Returns '' when allowed, otherwise the reason. */
export const reserveAiCall = (cid: string): Promise<string> => reserve(cid);

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'file'; file: { filename: string; file_data: string } };

export interface AiResult { data?: any; error?: string; off?: boolean; cached?: boolean }

export async function aiJson(o: { cid: string; feature: string; system: string; user: string | Part[]; cacheKey?: string; maxTokens?: number }): Promise<AiResult> {
  if (!aiEnabled()) return { off: true };
  const hash = o.cacheKey ? createHash('sha256').update(`${o.cid}|${o.feature}|${o.cacheKey}`).digest('hex').slice(0, 40) : '';
  const cacheRef = hash ? db().collection('hiringItems').doc(`aic_${hash}`) : null;
  if (cacheRef) {
    const hit = await cacheRef.get();
    if (hit.exists && (hit.data() as any).companyId === o.cid) return { data: (hit.data() as any).result, cached: true };
  }
  const limited = await reserve(o.cid);
  if (limited) return { error: limited };
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey()}` }, signal: controller.signal,
      body: JSON.stringify({
        model: (process.env.OPENAI_HIRING_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(), temperature: 0.2, max_tokens: o.maxTokens ?? 1200, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }],
      }),
    });
    const raw = await res.text();
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* handled below */ }
    if (!res.ok) return { error: `OpenAI error (HTTP ${res.status}): ${body?.error?.message || raw.slice(0, 150)}` };
    let data: any;
    try { data = JSON.parse(String(body?.choices?.[0]?.message?.content || '')); } catch { return { error: 'The AI returned an answer that could not be read. Try again.' }; }
    if (cacheRef) await cacheRef.set({ id: cacheRef.id, companyId: o.cid, kind: 'aiCache', feature: o.feature, result: data, at: new Date().toISOString() });
    return { data };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'The AI took too long to answer. Try again.' : `AI request failed: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
