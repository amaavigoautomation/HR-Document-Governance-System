import assert from 'node:assert/strict';
import { allocationSummary, certStatus, cleanAllocations, daysBetween, kpiAttainment, kpiStatus, nineBox, pipTransition, successionGap, surveyAggregate, validatePipPlan } from '../shared/hrbpEngine.ts';

assert.equal(nineBox(3, 3)!.label, 'Star');
assert.equal(nineBox(1, 1)!.label, 'Underperformer');
assert.equal(nineBox(2, 3)!.label, 'High potential');
assert.equal(nineBox(4, 1), null);
assert.equal(nineBox(0 as any, 2), null);

assert.equal(kpiAttainment(100, 95), 95);
assert.equal(kpiAttainment(100, null), null);
assert.equal(kpiAttainment(0, 5), null);
assert.equal(kpiAttainment(10, 20, 'LOWER'), 50);
assert.equal(kpiAttainment(10, 0, 'LOWER'), 100);
assert.equal(kpiStatus(95), 'GREEN');
assert.equal(kpiStatus(75), 'AMBER');
assert.equal(kpiStatus(40), 'RED');
assert.equal(kpiStatus(null), 'NO_DATA');
assert.equal(kpiStatus(90), 'GREEN');
assert.equal(kpiStatus(70), 'AMBER');

// PIP
assert.ok(pipTransition('DRAFT', 'start').ok);
assert.equal(pipTransition('DRAFT', 'start').to, 'ACTIVE');
assert.equal(pipTransition('DRAFT', 'complete').ok, false);
assert.equal(pipTransition('ACTIVE', 'checkin').to, null);
assert.equal(pipTransition('ACTIVE', 'extend').to, 'EXTENDED');
assert.ok(pipTransition('EXTENDED', 'fail').ok);
assert.equal(pipTransition('COMPLETED', 'cancel').ok, false, 'finished plans are final');
assert.equal(pipTransition('FAILED', 'checkin').ok, false);
const plan = { startOn: '2026-11-01', endOn: '2026-12-15', reason: 'Missed deadlines', goals: [{ text: 'Deliver on time', dueOn: '2026-12-01' }] };
assert.equal(validatePipPlan(plan), null);
assert.ok(validatePipPlan({ ...plan, endOn: '2026-11-05' }));
assert.ok(validatePipPlan({ ...plan, endOn: '2027-06-01' }));
assert.ok(validatePipPlan({ ...plan, goals: [] }));
assert.ok(validatePipPlan({ ...plan, reason: ' ' }));
assert.ok(validatePipPlan({ ...plan, goals: [{ text: 'x', dueOn: '2027-01-01' }] }));
assert.ok(validatePipPlan({ ...plan, goals: [{ text: ' ' }] }));
assert.equal(daysBetween('2026-11-01', '2026-11-15'), 14);

// certificates
assert.equal(certStatus(undefined, '2026-11-02'), 'NO_EXPIRY');
assert.equal(certStatus('2026-10-01', '2026-11-02'), 'EXPIRED');
assert.equal(certStatus('2026-12-01', '2026-11-02'), 'EXPIRING');
assert.equal(certStatus('2027-06-01', '2026-11-02'), 'VALID');
assert.equal(certStatus('2026-11-02', '2026-11-02'), 'EXPIRING', 'expires today is still valid today');

// allocation
assert.deepEqual(cleanAllocations([{ client: ' Acme ', percent: 60.4 }]).value, [{ client: 'Acme', percent: 60 }]);
assert.ok(cleanAllocations([{ client: '', percent: 10 }]).error);
assert.ok(cleanAllocations([{ client: 'A', percent: 0 }]).error);
assert.ok(cleanAllocations([{ client: 'A', percent: 101 }]).error);
assert.ok(cleanAllocations('x').error);
assert.deepEqual(cleanAllocations(undefined).value, []);
assert.equal(allocationSummary([{ client: 'A', percent: 60 }, { client: 'B', percent: 50 }], true).state, 'OVER');
assert.equal(allocationSummary([{ client: 'A', percent: 100 }], true).state, 'FULL');
assert.equal(allocationSummary([{ client: 'A', percent: 40 }], true).state, 'PARTIAL');
assert.equal(allocationSummary([], true).state, 'BENCH');
assert.equal(allocationSummary([], false).state, 'NON_BILLABLE');

// survey anonymity
const qs = [{ id: 'q1', text: 'Happy?', type: 'scale' as const }, { id: 'q2', text: 'Comments', type: 'text' as const }];
const resp = (n: number, t = '') => ({ answers: { q1: n, q2: t } });
const few = surveyAggregate(qs, [resp(5), resp(4), resp(3), resp(4)]);
assert.equal(few.visible, false);
assert.equal((few as any).needed, 1);
const many = surveyAggregate(qs, [resp(5, 'good'), resp(4), resp(3), resp(4), resp(2, 'slow')]) as any;
assert.equal(many.visible, true);
assert.equal(many.questions[0].average, 3.6);
assert.equal(many.questions[0].spread['4'], 2);
assert.deepEqual(many.questions[1].texts, ['good', 'slow']);
assert.equal(many.overall, 3.6);
assert.equal(surveyAggregate(qs, [resp(9), resp(9), resp(9), resp(9), resp(9)]).visible, true);

// succession
assert.equal(successionGap({ critical: true, successors: [] }), 'NO_SUCCESSOR');
assert.equal(successionGap({ critical: false, successors: [] }), 'OK');
assert.equal(successionGap({ critical: true, successors: [{ readiness: 'READY_NOW' }] }), 'THIN');
assert.equal(successionGap({ critical: true, successors: [{ readiness: 'READY_NOW' }, { readiness: 'READY_NOW' }] }), 'COVERED');
assert.equal(successionGap({ critical: true, successors: [{ readiness: 'ONE_TO_TWO_YEARS' }] }), 'NO_SUCCESSOR');
assert.equal(successionGap({ critical: false, successors: [{ readiness: 'ONE_TO_TWO_YEARS' }] }), 'THIN');
assert.equal(successionGap({ critical: false, successors: [{ readiness: 'READY_NOW' }] }), 'COVERED');
console.log('hrbp engine ok');
