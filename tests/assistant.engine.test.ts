import assert from 'node:assert/strict';
import { chunkText, rankPassages, unverifiedNumbers, cleanHistory } from '../shared/assistantEngine';

const docs = [
  { id: 'a', title: 'Leave Policy', version: '2', text: 'Casual leave may be carried forward up to 5 days.\n\nSick leave needs a medical certificate after 3 days.' },
  { id: 'b', title: 'Travel Policy', version: '1', text: 'Flights are booked by the admin team. Hotel limit is per city.' },
];
const hits = rankPassages('carry forward casual leave', docs, 2);
assert.equal(hits[0].title, 'Leave Policy');
assert.ok(hits[0].text.includes('carried forward'));
assert.equal(rankPassages('zzzz qqqq', docs, 2).length, 0);
assert.ok(chunkText('x'.repeat(2500), 900).length >= 2);

assert.deepEqual(unverifiedNumbers('You have 7 days left.', ['{"balanceDays":7}']), []);
assert.deepEqual(unverifiedNumbers('You have 9 days left.', ['{"balanceDays":7}']), ['9']);
assert.deepEqual(unverifiedNumbers('You have 1 request and 0 pending.', ['{}']), []);
assert.deepEqual(unverifiedNumbers('You have 9 days.', ['{}'], ).length, 1);

const h = cleanHistory([{ role: 'system', content: 'x' }, ...Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm'.repeat(900) }))]);
assert.ok(h.length <= 6 && h.every((t) => t.role !== ('system' as any) && t.content.length <= 600));
console.log('assistant engine ok');
