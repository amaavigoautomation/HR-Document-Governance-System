import assert from 'node:assert/strict';
import { answerPolicyQuestion, coverageGaps, misSummary, parseLeaveText, requestSummary } from '../shared/leaveAssist.ts';
import { starterSettings } from '../shared/leaveEngine.ts';

const types = [{ id: 'cl', name: 'Casual leave', code: 'CL' }, { id: 'sl', name: 'Sick leave', code: 'SL' }, { id: 'el', name: 'Earned leave', code: 'EL' }];
// 2026-10-28 is a Wednesday
const today = '2026-10-28';

// "Monday and Tuesday off" -> the coming Monday to Tuesday
let p = parseLeaveText('I need Monday and Tuesday off', today, types);
assert.equal(p.draft?.from, '2026-11-02');
assert.equal(p.draft?.to, '2026-11-03');
assert.ok(p.missing.some((m) => /leave type/i.test(m)), 'the type is left for the employee to choose');

p = parseLeaveText('sick leave tomorrow, fever', today, types);
assert.deepEqual([p.draft?.from, p.draft?.to, p.draft?.typeId], ['2026-10-29', '2026-10-29', 'sl']);
assert.equal(p.missing.length, 0);

p = parseLeaveText('half day casual leave on Friday morning', today, types);
assert.equal(p.draft?.from, '2026-10-30');
assert.equal(p.draft?.halfFrom, true);
assert.equal(p.draft?.halfPart, 'FIRST');
assert.equal(p.draft?.typeId, 'cl');

p = parseLeaveText('earned leave from 12 nov to 14 nov', today, types);
assert.deepEqual([p.draft?.from, p.draft?.to, p.draft?.typeId], ['2026-11-12', '2026-11-14', 'el']);
p = parseLeaveText('leave on 5 jan', today, types);
assert.equal(p.draft?.from, '2027-01-05', 'a date already past this year means next year');
p = parseLeaveText('3 days off from next monday', today, types);
assert.deepEqual([p.draft?.from, p.draft?.to], ['2026-11-02', '2026-11-04']);
p = parseLeaveText('emergency, hospital today', today, types);
assert.equal(p.draft?.emergency, true);
p = parseLeaveText('', today, types);
assert.equal(p.draft, null);
p = parseLeaveText('I want some time off', today, types);
assert.equal(p.draft, null, 'no dates, no draft');
assert.ok(p.missing.length > 0);

// policy answers come from the policy and quote its version
const s = starterSettings(2026);
s.policyVersion = 3; s.effectiveFrom = '2026-04-01'; s.governanceRef = 'AMA-HR-LEAVE-001';
const cl = s.types.find((t) => t.code === 'CL')!;
const polId = s.policies[0].id;
const a1 = answerPolicyQuestion('How many casual leave days do I get?', s, polId);
assert.ok(a1.answered && /day/.test(a1.answer));
assert.match(a1.reference, /v3/);
assert.match(a1.reference, /AMA-HR-LEAVE-001/);
assert.ok(answerPolicyQuestion('how much notice for casual leave', s, polId).answered);
assert.ok(answerPolicyQuestion('can casual leave be carried forward?', s, polId).answered);
assert.ok(/Casual/.test(answerPolicyQuestion('is casual leave paid', s, polId).answer));
assert.equal(answerPolicyQuestion('what is the CEO salary', s, polId).answered, false, 'unknown things are referred to HR');
assert.equal(answerPolicyQuestion('how many days of crypto leave', s, polId).answered, false);
assert.ok(cl.name);

// approver summary: facts only
const sum = requestSummary({ name: 'Esha', typeName: 'Casual leave', from: '2026-11-02', to: '2026-11-03', days: 2, daysNotice: 5, balanceAfter: 3, teamAway: ['Omar'], hasDocument: false });
assert.match(sum, /Esha asks for 2 days of Casual leave/);
assert.match(sum, /Also away then: Omar/);
assert.match(requestSummary({ name: 'E', typeName: 'Sick', from: '2026-10-20', to: '2026-10-20', days: 1, daysNotice: -8, balanceAfter: -1, teamAway: [], hasDocument: true }), /after the leave started.*below zero.*document/);

// team cover
const away = new Map<string, string[]>([['2026-11-02', ['A', 'B']], ['2026-11-03', ['A']], ['2026-11-04', ['B']]]);
const gaps = coverageGaps(6, away, '2026-11-01', '2026-11-05');
assert.deepEqual(gaps.map((g) => g.date), ['2026-11-02'], 'one of six is not a gap, two are');
assert.deepEqual(coverageGaps(2, away, '2026-11-01', '2026-11-05').map((g) => g.date), ['2026-11-02', '2026-11-03', '2026-11-04'], 'a small team is short with one away');
assert.deepEqual(coverageGaps(0, away, '2026-11-01', '2026-11-05'), []);

// monthly summary is built from numbers only
const mis = misSummary({ month: '2026-10', headcount: 12, approvedDays: 20, byType: [{ type: 'Casual', days: 12 }, { type: 'Sick', days: 8 }], pending: 2, overdue: 1, openExceptions: 3, unpaidDays: 2, emergency: 1, busiestDay: { date: '2026-10-15', away: 4 }, previousApprovedDays: 15 });
assert.match(mis, /20 days of leave were approved across 12 employees/);
assert.match(mis, /up 5 from the month before/);
assert.match(mis, /2 requests still waiting.*1 overdue/);
assert.match(mis, /3 open exceptions/);

console.log('leave assist tests passed');
