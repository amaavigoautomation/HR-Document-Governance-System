import assert from 'node:assert/strict';
import { DEFAULT_WEIGHTS, cleanWeights, experienceRating, portfolioRating, salaryFitRating, skillsRating, stabilityRating, weightedScore, weightsError } from '../shared/hiringScore.ts';
import { DEFAULT_CRITERIA, blindView, buildIcs, reminderTimes, summarise, validateScorecard, type Scorecard } from '../shared/interviewEngine.ts';

// defaults add up to 100
assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 100);

// all parts judged
{
  const s = weightedScore({ skills: 80, experience: 100, portfolio: 60, communication: 70, stability: 100, salaryFit: 100 });
  assert.equal(s.complete, true);
  assert.equal(s.earned, 24 + 25 + 9 + 7 + 10 + 10);
  assert.equal(s.normalised, 85);
}
// pending parts are left out, never zero
{
  const s = weightedScore({ skills: 100, experience: 100 });
  assert.equal(s.complete, false);
  assert.equal(s.earned, 55);
  assert.equal(s.judgedWeight, 55);
  assert.equal(s.normalised, 100);
  assert.equal(s.lines.filter((l) => l.pending).length, 4);
  assert.equal(s.lines.find((l) => l.part === 'portfolio')!.points, null);
}
assert.equal(weightedScore({}).normalised, null);
assert.equal(weightedScore({ skills: 250, experience: -5 }).lines[0].rating, 100);

// weights
assert.equal(weightsError(DEFAULT_WEIGHTS), null);
assert.ok(weightsError({ ...DEFAULT_WEIGHTS, skills: 40 }));
assert.ok(weightsError({ ...DEFAULT_WEIGHTS, skills: -1 }));
{
  const w = cleanWeights({ skills: 50, experience: 50, portfolio: 0, communication: 0, stability: 0, salaryFit: 0 });
  assert.equal(Object.values(w).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(cleanWeights(null), DEFAULT_WEIGHTS);
  assert.equal(Object.values(cleanWeights({ skills: 1, experience: 1, portfolio: 1, communication: 1, stability: 1, salaryFit: 1 })).reduce((a, b) => a + b, 0), 100);
}
// custom weights are used
assert.equal(weightedScore({ skills: 100 }, { skills: 60, experience: 10, portfolio: 10, communication: 10, stability: 5, salaryFit: 5 }).earned, 60);

// ratings
assert.equal(experienceRating(5, 3, 6), 100);
assert.equal(experienceRating(2, 3, 6), 80);
assert.equal(experienceRating(0, 3, 6), 40);
assert.equal(experienceRating(null, 3, 6), null);
assert.equal(skillsRating(['React', 'SQL'], 'I know react and Node'), 50);
assert.equal(skillsRating([], 'x'), null);
assert.equal(skillsRating(['a'], ''), null);
assert.equal(stabilityRating(10, 2), 100);
assert.equal(stabilityRating(2, 4), 40);
assert.equal(stabilityRating(4, 2), 70);
assert.equal(stabilityRating(null, 2), null);
assert.equal(salaryFitRating(8, 10), 100);
assert.equal(salaryFitRating(11, 10), 75);
assert.equal(salaryFitRating(20, 10), 0);
assert.equal(salaryFitRating(null, 10), null);
assert.equal(portfolioRating('https://x.dev'), 60);
assert.equal(portfolioRating('https://x.dev', 90), 90);
assert.equal(portfolioRating(''), null);

// scorecards
const good = (over: any = {}) => ({ ratings: Object.fromEntries(DEFAULT_CRITERIA.map((c) => [c, 4])), recommendation: 'YES', strengths: 'Solid', concerns: '', ...over });
assert.ok(validateScorecard(good(), DEFAULT_CRITERIA).value);
assert.ok(validateScorecard(good({ ratings: { 'Technical skills': 9 } }), DEFAULT_CRITERIA).error);
assert.ok(validateScorecard(good({ recommendation: 'MAYBE' }), DEFAULT_CRITERIA).error);
assert.ok(validateScorecard(good({ strengths: '', concerns: '' }), DEFAULT_CRITERIA).error);

const card = (id: string, rec: Scorecard['recommendation'], r = 4): Scorecard => ({ interviewerId: id, interviewerName: id, ratings: { a: r }, recommendation: rec, strengths: 's', concerns: '', submittedAt: 'x' });
{
  const cards = [card('i1', 'YES'), card('i2', 'NO', 2)];
  // i3 has not submitted: i1 sees only their own, i3 sees nothing, nobody sees the average yet
  const v1 = blindView(cards, ['i1', 'i2', 'i3'], 'i1', false);
  assert.deepEqual(v1.visible.map((c) => c.interviewerId), ['i1']);
  assert.equal(v1.hiddenCount, 1);
  assert.equal(v1.summary, null);
  assert.equal(blindView(cards, ['i1', 'i2', 'i3'], 'i3', false).visible.length, 0);
  // HR who is not on the panel sees nothing until the panel is done
  assert.equal(blindView(cards, ['i1', 'i2', 'i3'], 'hr', true).visible.length, 0);
  // panel complete: everyone who submitted sees all, HR too
  const all = [...cards, card('i3', 'STRONG_YES', 5)];
  assert.equal(blindView(all, ['i1', 'i2', 'i3'], 'i1', false).visible.length, 3);
  assert.equal(blindView(all, ['i1', 'i2', 'i3'], 'hr', true).visible.length, 3);
  assert.ok(blindView(all, ['i1', 'i2', 'i3'], 'hr', true).summary);
  // someone outside the panel who never submitted sees nothing even when it is complete
  assert.equal(blindView(all, ['i1', 'i2', 'i3'], 'zed', false).visible.length, 0);
}
assert.equal(summarise([card('a', 'STRONG_YES'), card('b', 'YES')]).recommendation, 'Strong yes');
assert.equal(summarise([card('a', 'YES'), card('b', 'NO')]).recommendation, 'Split / lean no');
assert.equal(summarise([card('a', 'STRONG_NO')]).recommendation, 'No');

// invite
{
  const ics = buildIcs({ uid: 'int1@amaavigo', startIso: '2026-11-10T04:30:00.000Z', durationMinutes: 45, title: 'Interview: A, B', description: 'Line1\nLine2', location: 'Meet', organizerName: 'HR', organizerEmail: 'hr@x.com', attendees: [{ name: 'C', email: 'c@x.com' }], now: '2026-11-02T00:00:00Z' });
  assert.ok(ics.includes('DTSTART:20261110T043000Z'));
  assert.ok(ics.includes('DTEND:20261110T051500Z'));
  assert.ok(ics.includes('SUMMARY:Interview: A\\, B'));
  assert.ok(ics.includes('DESCRIPTION:Line1\\nLine2'));
  assert.ok(ics.includes('METHOD:REQUEST'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
  assert.ok(buildIcs({ uid: 'u', startIso: '2026-11-10T04:30:00Z', durationMinutes: 30, title: 't', description: '', location: '', organizerName: 'o', organizerEmail: 'o@x.com', attendees: [], cancel: true, sequence: 2 }).includes('METHOD:CANCEL'));
  assert.throws(() => buildIcs({ uid: 'u', startIso: 'nope', durationMinutes: 30, title: 't', description: '', location: '', organizerName: 'o', organizerEmail: 'o@x.com', attendees: [] }));
  assert.deepEqual(reminderTimes('2026-11-10T04:30:00Z', '2026-11-02T00:00:00Z').map((r) => r.kind), ['24h', '1h']);
  assert.deepEqual(reminderTimes('2026-11-02T10:00:00Z', '2026-11-02T09:30:00Z'), []);
  assert.deepEqual(reminderTimes('2026-11-02T20:00:00Z', '2026-11-02T10:00:00Z').map((r) => r.kind), ['1h', '24h'].filter((k) => k === '1h'));
}
console.log('hiring score + interview ok');
