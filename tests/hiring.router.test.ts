import assert from 'node:assert/strict';
import { routeHiring } from '../api/_lib/hiringRouter.ts';

/**
 * The hiring routes share one serverless function (Vercel Hobby allows only 12). These checks make sure each old route
 * still lands in the right place after being folded into /api/recruitment/<action>, and that nothing answers without a login.
 */
const base = { query: {}, headers: {} as Record<string, any> };

async function main() {
  // Routes that were POST-only keep refusing other methods (before any login check or database access).
  assert.equal((await routeHiring({ ...base, method: 'GET', action: 'generate-jd' })).status, 405);
  assert.equal((await routeHiring({ ...base, method: 'GET', action: 'careers-publish' })).status, 405);

  // Candidate applications, the overview and job-description routes all need a signed-in user.
  for (const action of ['app-list', 'app-stages', 'app-settings', 'overview', 'config', 'ai-evaluation']) {
    const res = await routeHiring({ ...base, method: 'GET', action });
    assert.ok(res.status === 401 || res.status === 403, `${action} answered ${res.status} without a login`);
  }
  for (const action of ['app-add', 'app-import', 'app-update', 'app-delete', 'app-rotate-key', 'app-save-settings', 'jd-save']) {
    const res = await routeHiring({ ...base, method: 'POST', body: {}, action });
    assert.ok(res.status === 401 || res.status === 403, `${action} answered ${res.status} without a login`);
  }
  const gen = await routeHiring({ ...base, method: 'POST', body: { positionTitle: 'X', departmentName: 'Y' }, action: 'generate-jd' });
  assert.ok(gen.status === 401 || gen.status === 403, `generate-jd answered ${gen.status} without a login`);

  console.log('hiring router ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
