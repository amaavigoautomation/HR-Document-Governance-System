import assert from 'node:assert/strict';
import { validateWeights, validateKpiWeights, pillarScore, sopScore, overallScore, ratingBand, canMove, isFinal, unsupportedInference, fairnessFlags, MIN_GROUP, isRating } from '../shared/pmEngine.ts';

// weights
assert.equal(validateWeights(60, 25, 15).ok, true);
assert.equal(validateWeights(60, 25, 10).ok, false);
assert.equal(validateWeights('', 25, 15).ok, false);
assert.equal(validateWeights(-10, 95, 15).ok, false);
assert.equal(validateKpiWeights([{ weightage: 60 }, { weightage: 40 }]).ok, true);
assert.equal(validateKpiWeights([{ weightage: 60 }, { weightage: 30 }]).ok, false);
assert.equal(validateKpiWeights([]).ok, false);

// rating scale: 1-5 only, never 0
assert.ok(isRating(1) && isRating(5)); assert.ok(!isRating(0) && !isRating(6) && !isRating(3.5) && !isRating(null));

// missing evidence is left out, never zero
const p = pillarScore([{ value: 4, weight: 50 }, { value: null, weight: 50 }]);
assert.equal(p.score, 4); assert.equal(p.skipped, 1);
assert.equal(pillarScore([{ value: null, weight: 100 }]).score, null);

// overall: partial parts are re-weighted and labelled
const full = overallScore({ kra: 4, behaviour: 3, sop: 5 }, { kra: 60, behaviour: 25, sop: 15 });
assert.equal(full.score, 3.9); assert.equal(full.partial, false);
const part = overallScore({ kra: 4, behaviour: null, sop: 5 }, { kra: 60, behaviour: 25, sop: 15 });
assert.equal(part.partial, true); assert.deepEqual(part.missing, ['behaviour']);
assert.equal(overallScore({ kra: null, behaviour: null, sop: null }, { kra: 60, behaviour: 25, sop: 15 }).score, null);

// SOP: a critical failure is not averaged away
const s = sopScore([{ result: 'COMPLIANT' }, { result: 'COMPLIANT' }, { result: 'COMPLIANT' }, { result: 'NON_COMPLIANT', critical: true }]);
assert.equal(s.criticalFailures, 1);
assert.equal(sopScore([{ result: 'NOT_VERIFIED' }, { result: 'NOT_APPLICABLE' }]).score, null, 'unverified or n/a is not a failure');

assert.equal(ratingBand(3)?.value, 3); assert.equal(ratingBand(null), null);

// review flow
assert.ok(canMove('OPEN', 'SELF_ASSESSED')); assert.ok(!canMove('OPEN', 'APPROVED')); assert.ok(!canMove('APPROVED', 'OPEN'));
assert.ok(isFinal('APPROVED') && isFinal('PUBLISHED') && !isFinal('DISCUSSED'));

// AI guard
assert.ok(unsupportedInference('He seems disloyal and unmotivated'));
assert.ok(unsupportedInference('Probably has a health problem'));
assert.equal(unsupportedInference('Closed 14 tickets a week, up from 10'), null);

// fairness: needs a group; flags a manager who rates everyone the same
const rows = [1, 2, 3].map((i) => ({ managerUid: 'm1', managerName: 'M1', overall: 4.5, insufficient: 0, ratedWithoutEvidence: 0 })).concat([1, 2, 3].map(() => ({ managerUid: 'm2', managerName: 'M2', overall: 3, insufficient: 0, ratedWithoutEvidence: 0 })));
assert.ok(fairnessFlags(rows).some((f) => f.managerName === 'M1'));
assert.equal(fairnessFlags(rows.slice(0, 2)).length, 0);
assert.equal(MIN_GROUP, 3);
console.log('pm.engine: all checks passed');
