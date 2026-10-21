import assert from 'node:assert/strict';
import {
  ALL_PERMISSION_KEYS, DEFAULT_ROLE_TEMPLATES, canGrantPermissions, claimsFitLimit,
  effectivePermissions, modulesForPerms, portalForRoles, isKnownPermission,
} from '../shared/permissions.ts';

const mods = ['document-version-control', 'talent-acquisition'];

// every template permission is a known key
for (const t of DEFAULT_ROLE_TEMPLATES) for (const p of t.permissions) assert.ok(isKnownPermission(p), `${t.slug}:${p}`);

// admin claims fit the token limit
const adminPerms = effectivePermissions([{ permissions: [], isAdmin: true }], mods);
assert.equal(adminPerms.length, ALL_PERMISSION_KEYS.length);
assert.ok(claimsFitLimit({ cid: 'c_' + 'x'.repeat(28), cs: 'ACTIVE', perms: adminPerms, adm: true }), 'admin claims too large');

// disabled module strips its permissions
const docOnly = effectivePermissions([{ permissions: ALL_PERMISSION_KEYS }], ['document-version-control']);
assert.ok(!docOnly.some((p) => p.startsWith('req.')));
assert.ok(docOnly.includes('doc.create'));
assert.deepEqual(modulesForPerms(docOnly), ['document-version-control']);

// portal ranking
assert.equal(portalForRoles([{ portal: 'EMPLOYEE' }, { portal: 'REVIEWER' }]), 'REVIEWER');
assert.equal(portalForRoles([{ portal: 'EMPLOYEE' }, { portal: 'CREATOR' }, { portal: 'REVIEWER' }]), 'CREATOR');
assert.equal(portalForRoles([]), 'EMPLOYEE');

// no privilege escalation
assert.equal(canGrantPermissions(['users.manage', 'roles.manage'], false, ['doc.review']), false);
assert.equal(canGrantPermissions(['users.manage', 'roles.manage'], false, ['users.manage']), true);
assert.equal(canGrantPermissions([], true, ['doc.review']), true);
assert.equal(canGrantPermissions([], true, ['not.a.perm']), false);

console.log('permissions tests passed; admin claims bytes =',
  JSON.stringify({ cid: 'c_' + 'x'.repeat(28), cs: 'ACTIVE', perms: adminPerms, adm: true }).length);
