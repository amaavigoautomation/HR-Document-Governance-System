import assert from 'node:assert/strict';
import {
  evalCondition, makeStep, nextTarget, renderText, simulate, standardSteps, unknownPlaceholders, validateFlow, reachable, interviewRound,
  type FlowStep,
} from '../shared/flowEngine.ts';

const owner = { ownerUid: 'u1', ownerName: 'Priya' };
const build = (...types: Parameters<typeof makeStep>[0][]): FlowStep[] => { const out: FlowStep[] = []; for (const t of types) out.push(makeStep(t, out, ['screen', 'interview', 'review', 'approval', 'offer', 'onboard', 'test'].includes(t) ? owner : {})); return out; };
const msgs = (steps: FlowStep[], name = 'Flow') => validateFlow({ name, steps }).map((p) => p.message);

// ---- the standard flow is valid and mirrors today's process
const std = standardSteps('u1', 'Priya');
assert.deepEqual(std.map((s) => s.type), ['ai_score', 'screen', 'interview', 'offer', 'onboard']);
assert.deepEqual(msgs(std), [], 'the standard flow has no problems');

// ---- plain-language problems
assert.ok(msgs([]).some((m) => /no steps/i.test(m)));
assert.ok(msgs(std, '').some((m) => /name/i.test(m)));
const noOwner = standardSteps(); // no owners
assert.ok(msgs(noOwner).filter((m) => /choose the person/i.test(m)).length >= 3, 'every manual step needs an owner');
assert.ok(msgs(build('ai_score', 'screen')).some((m) => /last step must be/i.test(m)), 'must end in joining or rejection');
assert.ok(msgs(build('ai_score', 'onboard')).some((m) => /no Offer step/i.test(m)), 'cannot onboard without an offer');
assert.ok(msgs(build('offer', 'onboard', 'offer')).length > 0);
const six = build('interview', 'interview', 'interview', 'interview', 'interview', 'interview', 'offer', 'onboard');
assert.ok(msgs(six).some((m) => /most allowed is 5/.test(m)), 'at most five interview rounds');
const five = build('interview', 'interview', 'interview', 'interview', 'interview', 'offer', 'onboard');
assert.deepEqual(msgs(five), []);
assert.equal(interviewRound({ steps: five }, five[2].id), 3);

// ---- email wording
const em = build('email', 'offer', 'onboard'); em[0].settings = { subject: 'Hi {{nmae}}', body: 'Hello {{name}}' };
assert.ok(msgs(em).some((m) => /nmae/.test(m)), 'a typo in a placeholder is caught before it reaches a candidate');
assert.deepEqual(unknownPlaceholders('Hi {{name}} {{ position }} {{oops}} {{'), ['oops', '{{']);
assert.equal(renderText('Hi {{name}} for {{position}}', { name: 'Asha', position: 'Designer' }), 'Hi Asha for Designer');
const em2 = build('email', 'offer', 'onboard'); em2[0].settings = { subject: '', body: '' };
assert.ok(msgs(em2).some((m) => /Subject/.test(m)) && msgs(em2).some((m) => /Message/.test(m)));
const rj = build('offer', 'onboard', 'reject'); rj[2].settings = { sendEmail: true, subject: '', body: '' };
assert.ok(msgs(rj).some((m) => /you chose to send an email/.test(m)));

// ---- conditions: forward only, no loops, no dead steps
const flow = build('ai_score', 'condition', 'screen', 'review', 'offer', 'onboard', 'reject');
const [score, cond, screen, review, offer, onb, rej] = flow;
cond.settings = { field: 'aiScore', op: '>=', value: 60 };
cond.ifYes = 'next'; cond.ifNo = rej.id;
assert.deepEqual(msgs(flow), []);
assert.deepEqual(nextTarget({ steps: flow }, cond.id, 'no'), { to: rej.id });
assert.deepEqual(nextTarget({ steps: flow }, cond.id, 'yes'), { to: screen.id });
assert.deepEqual(nextTarget({ steps: flow }, screen.id, 'fail'), { to: rej.id }, 'a failure goes to the reject step by default');
assert.deepEqual(nextTarget({ steps: flow }, onb.id, 'done'), { end: 'HIRED' });
assert.deepEqual(nextTarget({ steps: flow }, rej.id, 'done'), { end: 'REJECTED' });
cond.ifNo = score.id; // backwards = loop
assert.ok(msgs(flow).some((m) => /goes back to an earlier step/.test(m)), 'loops are refused');
assert.deepEqual(nextTarget({ steps: flow }, cond.id, 'no'), { end: 'HOLD' }, 'even if a bad flow slipped in, nobody loops');
cond.ifNo = 'gone';
assert.ok(msgs(flow).some((m) => /no longer exists/.test(m)));
cond.ifNo = offer.id; // skips screen and review: they are still reachable through "yes"
assert.deepEqual(msgs(flow), []);
cond.ifYes = offer.id; cond.ifNo = offer.id;
assert.ok(msgs(flow).filter((m) => /can never be reached/.test(m)).length === 2, 'steps nobody can reach are reported');
assert.equal(reachable(flow).has(screen.id), false);
const lastCond = build('offer', 'onboard', 'condition'); lastCond[2].settings = { field: 'aiScore', op: '>=', value: 1 };
assert.ok(msgs(lastCond).some((m) => /cannot be the last step/.test(m)));

// ---- condition maths; unknown facts are never treated as zero
assert.equal(evalCondition({ field: 'aiScore', op: '>=', value: 60 }, { aiScore: 60 }), true);
assert.equal(evalCondition({ field: 'aiScore', op: '>=', value: 60 }, { aiScore: 59 }), false);
assert.equal(evalCondition({ field: 'aiScore', op: '>=', value: 60 }, {}), null, 'missing information waits instead of failing the candidate');
assert.equal(evalCondition({ field: 'expectedCtcLpa', op: '<=', value: 12 }, { expectedCtcLpa: 12 }), true);
assert.equal(evalCondition({ field: 'screeningOutcome', op: '=', value: 'PASS' }, { screeningOutcome: 'PASS' }), true);
assert.equal(evalCondition({ field: 'screeningOutcome', op: '!=', value: 'PASS' }, { screeningOutcome: 'HOLD' }), true);
assert.equal(evalCondition({ field: 'nope', op: '>=', value: 1 }, { aiScore: 1 }), null);
assert.equal(evalCondition({ field: 'aiScore', op: '>=', value: 'abc' }, { aiScore: 5 }), null);

// ---- try it out: nothing is sent, every path ends somewhere
let sim = simulate({ steps: std }, {});
assert.ok(sim.waitingOn === std[1].id && sim.ended === null, 'asks what happens at the first human step');
sim = simulate({ steps: std }, { [std[1].id]: 'done', [std[2].id]: 'done', [std[3].id]: 'done' });
assert.equal(sim.ended, 'HIRED');
sim = simulate({ steps: std }, { [std[1].id]: 'fail' });
assert.equal(sim.ended, 'REJECTED');
const em3 = build('email', 'reject'); em3[0].settings = { subject: 'S', body: 'Hello {{name}}' };
assert.ok(simulate({ steps: em3 }, {}).lines[0].text.includes('Hello Sample Candidate'), 'the preview fills in a sample candidate');
console.log('flow.engine: all checks passed');
