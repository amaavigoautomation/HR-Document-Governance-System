import test from 'node:test';
import assert from 'node:assert/strict';

let calls: string[] = [];
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  calls.push(`${init.method || 'GET'} ${url}`);
  await new Promise((r) => setTimeout(r, 5));
  return { ok: true, json: async () => ({ success: true, n: calls.length }) };
};

test('repeat leave reads are cached, shared while in flight, and cleared by a change', async () => {
  const { apiJson } = await import('../src/services/apiClient');
  const [a, b] = await Promise.all([apiJson('/api/leave/me'), apiJson('/api/leave/me')]);
  assert.equal(calls.length, 1, 'two reads at once share one request');
  assert.deepEqual(a, b);
  a.n = 999; // callers may change what they get without breaking the cache
  const c = await apiJson('/api/leave/me');
  assert.equal(calls.length, 1, 'second read comes from memory');
  assert.notEqual(c.n, 999);
  await apiJson('/api/leave/apply', { x: 1 });
  await apiJson('/api/leave/me');
  assert.equal(calls.filter((x) => x.startsWith('GET')).length, 2, 'a change clears the cache');
});

test('other endpoints are never cached', async () => {
  const { apiJson } = await import('../src/services/apiClient');
  calls = [];
  await apiJson('/api/applications/list');
  await apiJson('/api/applications/list');
  assert.equal(calls.length, 2);
});
