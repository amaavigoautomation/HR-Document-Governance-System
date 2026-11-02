import assert from 'node:assert/strict';
import {
  cleanBudgetInput, deptKey, evaluateBudget, formatCtcRange, formatPositionId, parseLpaRange, requisitionMaxCtcLpa,
} from '../shared/hiringBudget.ts';

const NOW = '2026-11-02T10:00:00.000Z';
const base = { currentHeadcount: 8, committedVacancies: 1, requestedVacancies: 1, requestedCtcMaxLpa: 8, now: NOW };

// within both limits: no override needed
{
  const c = evaluateBudget({ ...base, budget: { approvedHeadcount: 10, maxCtcLpa: 10 } });
  assert.equal(c.status, 'OK');
  assert.equal(c.overrideRequired, false);
  assert.equal(c.headcountAfter, 10); // 8 + 1 + 1 equals the limit, which is allowed
}

// one over the headcount
{
  const c = evaluateBudget({ ...base, requestedVacancies: 2, budget: { approvedHeadcount: 10, maxCtcLpa: 10 } });
  assert.equal(c.status, 'OVER_HEADCOUNT');
  assert.equal(c.overrideRequired, true);
  assert.ok(c.messages[0].includes('above the approved headcount of 10'));
}

// over the CTC limit only
{
  const c = evaluateBudget({ ...base, requestedCtcMaxLpa: 12.5, budget: { approvedHeadcount: 20, maxCtcLpa: 10 } });
  assert.equal(c.status, 'OVER_BUDGET');
  assert.ok(c.messages.some((m) => m.includes('12.5 LPA') && m.includes('10 LPA')));
}

// both
assert.equal(evaluateBudget({ ...base, requestedVacancies: 5, requestedCtcMaxLpa: 30, budget: { approvedHeadcount: 10, maxCtcLpa: 10 } }).status, 'OVER_BOTH');

// no budget at all: allowed with a reason, never silently passed
{
  for (const budget of [null, undefined, {}, { approvedHeadcount: null, maxCtcLpa: null }]) {
    const c = evaluateBudget({ ...base, budget });
    assert.equal(c.status, 'NO_BUDGET_SET');
    assert.equal(c.overrideRequired, true);
  }
}

// only one limit set: the other is skipped and says so
{
  const c = evaluateBudget({ ...base, budget: { approvedHeadcount: 10, maxCtcLpa: null } });
  assert.equal(c.status, 'OK');
  assert.ok(c.messages.some((m) => m.includes('No CTC limit is set')));
}

// a requisition with no CTC cannot fail the pay check, but the check says it could not run
{
  const c = evaluateBudget({ ...base, requestedCtcMaxLpa: null, budget: { approvedHeadcount: 10, maxCtcLpa: 5 } });
  assert.equal(c.status, 'OK');
  assert.ok(c.messages.some((m) => m.includes('could not be checked')));
}

// bad numbers never throw and never go negative
{
  const c = evaluateBudget({ currentHeadcount: -3, committedVacancies: NaN as any, requestedVacancies: 1.9, requestedCtcMaxLpa: null, budget: { approvedHeadcount: 2 }, now: NOW });
  assert.equal(c.currentHeadcount, 0);
  assert.equal(c.committedVacancies, 0);
  assert.equal(c.requestedVacancies, 1);
}

// budget entry validation
assert.deepEqual(cleanBudgetInput({ approvedHeadcount: '12', maxCtcLpa: '8.256' }).value, { approvedHeadcount: 12, maxCtcLpa: 8.26 });
assert.deepEqual(cleanBudgetInput({ approvedHeadcount: '', maxCtcLpa: null }).value, { approvedHeadcount: null, maxCtcLpa: null });
assert.ok(cleanBudgetInput({ approvedHeadcount: 2.5 }).error);
assert.ok(cleanBudgetInput({ approvedHeadcount: -1 }).error);
assert.ok(cleanBudgetInput({ maxCtcLpa: 0 }).error);
assert.ok(cleanBudgetInput({ maxCtcLpa: 5000 }).error);
assert.ok(cleanBudgetInput({ maxCtcLpa: 'abc' }).error);

// old free-text ranges are read only when they clearly say LPA / lakh
assert.deepEqual(parseLpaRange('INR 6-8 LPA'), { min: 6, max: 8 });
assert.deepEqual(parseLpaRange('6 to 8 lakh'), { min: 6, max: 8 });
assert.deepEqual(parseLpaRange('8 LPA'), { min: 8, max: 8 });
assert.deepEqual(parseLpaRange('12.5 lacs'), { min: 12.5, max: 12.5 });
assert.deepEqual(parseLpaRange('8-6 LPA'), { min: 6, max: 8 });
assert.deepEqual(parseLpaRange('50000 per month'), { min: null, max: null });
assert.deepEqual(parseLpaRange('negotiable'), { min: null, max: null });
assert.deepEqual(parseLpaRange(undefined), { min: null, max: null });

// the number field wins over the old text
assert.equal(requisitionMaxCtcLpa({ ctcMaxLpa: 9, budgetRange: 'INR 6-8 LPA' }), 9);
assert.equal(requisitionMaxCtcLpa({ budgetRange: 'INR 6-8 LPA' }), 8);
assert.equal(requisitionMaxCtcLpa({ ctcMaxLpa: 0, budgetRange: '' }), null);

assert.equal(formatCtcRange(6, 8), 'INR 6-8 LPA');
assert.equal(formatCtcRange(null, 8), 'INR 8 LPA');
assert.equal(formatCtcRange(8, 8), 'INR 8 LPA');
assert.equal(formatCtcRange(null, null), '');

// Position IDs
assert.equal(formatPositionId('ama', 2026, 1), 'POS-AMA-2026-001');
assert.equal(formatPositionId('', 2026, 42), 'POS-2026-042');
assert.equal(formatPositionId('A-B C', 2027, 1234), 'POS-ABC-2027-1234');
assert.equal(formatPositionId('PUR', 2026, 0), 'POS-PUR-2026-001');

// department names match regardless of case and spacing
assert.equal(deptKey('  Sales   &  Marketing '), 'sales & marketing');
assert.equal(deptKey(undefined), '');

console.log('hiring budget ok');
