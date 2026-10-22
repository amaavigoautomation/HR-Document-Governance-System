import assert from 'node:assert/strict';
import { parseCsv, csvToObjects } from '../shared/csv.ts';
import { isPrivateAddress } from '../api/_lib/safeFetch.ts';
import { normalizeApplicationInput, defaultPrefix, cleanPrefix } from '../api/_lib/recruitmentData.ts';

// CSV: quotes, commas, newlines inside quotes, header mapping
assert.deepEqual(parseCsv('a,b\n"x,1","he said ""hi"""\n'), [['a', 'b'], ['x,1', 'he said "hi"']]);
const rows = csvToObjects('Name,Email\nAsha,asha@x.com\n\nRavi,ravi@x.com\n');
assert.equal(rows.length, 2);
assert.equal(rows[1].Email, 'ravi@x.com');

// SSRF address checks
for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', 'fc00::1']) {
  assert.ok(isPrivateAddress(ip), ip);
}
for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);

// webhook payload normalisation: aliases, validation, unsafe resume links
const good = normalizeApplicationInput({ full_name: 'Asha Rao', Email: 'ASHA@x.com', phone: '9999999999', position: 'sales executive', resume: 'https://x.com/cv.pdf' });
assert.ok(good.value, good.error);
assert.equal(good.value!.email.toLowerCase(), 'asha@x.com');
assert.equal(good.value!.resumeUrl, 'https://x.com/cv.pdf');
assert.ok(normalizeApplicationInput({ name: 'A', email: 'not-an-email', designation: 'X' }).error);
assert.ok(normalizeApplicationInput('nope').error);
const bad = normalizeApplicationInput({ name: 'A B', email: 'a@b.com', designation: 'X', resumeUrl: 'javascript:alert(1)' });
assert.ok(bad.error || !bad.value?.resumeUrl);

// employee-ID prefixes
assert.equal(defaultPrefix('Acme Cloud Marketing'), 'ACM');
assert.equal(defaultPrefix('Zenith'), 'ZEN');
assert.equal(cleanPrefix('ab-c1!xyz'), 'ABC1X');

console.log('recruitment tests passed');
