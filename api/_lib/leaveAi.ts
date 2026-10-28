/**
 * Optional wording layer for the leave helpers. It only rephrases an answer the code has already worked out; it
 * never decides anything. With no OPENAI_API_KEY, or if the call fails or changes any number or date, the original
 * wording is returned unchanged. Same env names as the other AI features: OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_LEAVE_MODEL.
 */
const apiKey = () => {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return !k || k === 'MY_OPENAI_API_KEY' || (process.env.LEAVE_AI_WORDING || '').trim().toLowerCase() === 'off' ? '' : k;
};

export const aiWordingOn = () => !!apiKey();

const facts = (s: string) => (s.match(/\d+(?:[.\-/]\d+)*/g) || []).sort().join('|');

export async function polishWording(text: string): Promise<{ text: string; ai: boolean }> {
  const key = apiKey();
  if (!key || !text) return { text, ai: false };
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: (process.env.OPENAI_LEAVE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: 'Rewrite the text in clear, friendly plain English for an employee. Keep every number, date and rule exactly as given. Add nothing. Do not give advice or make decisions. Reply with the rewritten text only.' },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok) return { text, ai: false };
    const out = String((await res.json())?.choices?.[0]?.message?.content || '').trim();
    // Anything that changes a figure or a date is thrown away.
    if (!out || out.length > text.length * 3 + 80 || facts(out) !== facts(text)) return { text, ai: false };
    return { text: out, ai: true };
  } catch {
    return { text, ai: false };
  } finally {
    clearTimeout(timer);
  }
}
