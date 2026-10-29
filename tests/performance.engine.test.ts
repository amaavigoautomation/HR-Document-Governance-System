import assert from 'node:assert/strict';
import {
  adjustmentProblem, approveProblems, bandOf, behaviourScore, blankCompetencyAssessments, blankKpiAssessments, bannedInference, checkinIdOf, cleanKras,
  computeScores, deadlineState, fairnessFlags, filterAiSummary, isFinal, isMaterialRevision, kpiQualityFlags, kpiScore, leaveShare, managerSubmitProblems,
  monthRange, nextStatus, overallScore, pickFramework, planActiveAt, quarterRange, ratingDistribution, resolveRoleFamily, reviewIdOf, selfApprovalProblem,
  selfSubmitProblems, sopScore, suggestedOutcome, totalKpiWeight, vagueTarget, validateFramework, validateKpiWeights, validateWeights,
} from '../shared/performanceEngine.ts';
import { DEFAULT_WEIGHTS, type Framework, type Plan, type RoleFamily, type SopCheck } from '../shared/performance.ts';

// --- weights
assert.equal(validateWeights(DEFAULT_WEIGHTS), null);
assert.match(validateWeights({ kra: 60, behaviour: 25, sop: 10 })!, /95/);
assert.ok(validateWeights({ kra: -5, behaviour: 55, sop: 50 }));
assert.equal(validateFramework({ name: 'F', weights: DEFAULT_WEIGHTS, effectiveFrom: '2026-01-01', effectiveTo: '' }), null);
assert.ok(validateFramework({ name: 'F', weights: DEFAULT_WEIGHTS, effectiveFrom: '2026-02-01', effectiveTo: '2026-01-01' }));

// --- KRA cleaning and KPI weights
const kras = cleanKras([
  { id: 'Camp', name: 'Campaign Execution', kpis: [{ code: 'camp 1', description: 'Campaigns launched', weightage: '40', target: '' }, { code: 'camp 1', weightage: 60, target: '12 per month', measurement: 'Task evidence', evidenceSource: 'Task system' }] },
]);
assert.equal(kras.length, 1);
assert.equal(kras[0].kpis.length, 2);
assert.notEqual(kras[0].kpis[0].code, kras[0].kpis[1].code, 'codes are made unique');
assert.equal(kras[0].kpis[0].target, '', 'blank targets stay blank: numbers are never invented');
assert.equal(totalKpiWeight(kras), 100);
assert.equal(validateKpiWeights(kras), null);
kras[0].kpis[1].weightage = 50;
assert.match(validateKpiWeights(kras)!, /90/);
kras[0].kpis[1].weightage = 60;
assert.ok(validateKpiWeights([]));

// --- vague targets
assert.ok(vagueTarget(''));
assert.ok(vagueTarget('improve results regularly'));
assert.equal(vagueTarget('Launch 12 campaigns per month'), null);
assert.ok(kpiQualityFlags(kras[0].kpis[0]).length >= 2);

// --- scoring: the worked example in the specification
const w = DEFAULT_WEIGHTS;
const o = overallScore({ kra: 4, behaviour: 3, sop: 4 }, w);
assert.equal(o.overall, 3.75);
assert.equal(o.partial, false);
assert.equal(bandOf(3.75), 'Exceeds Standard');
assert.equal(bandOf(null), 'Not rated');
assert.equal(suggestedOutcome(4.2), 'RECOGNITION');
assert.equal(suggestedOutcome(3), 'DEVELOPMENT');
assert.equal(suggestedOutcome(2), 'IMPROVEMENT');

// a pillar with nothing scorable is left out and flagged, never counted as zero
const part = overallScore({ kra: 4, behaviour: null, sop: 4 }, w);
assert.equal(part.overall, 4);
assert.equal(part.partial, true);
assert.deepEqual(part.missing, ['behaviour']);
assert.equal(overallScore({ kra: null, behaviour: null, sop: null }, w).overall, null);

// --- KPI score: insufficient evidence is excluded, a calibration override wins
const k = blankKpiAssessments(kras);
k[0].managerScore = 4; k[1].managerScore = 2;
assert.equal(kpiScore(kras, k), 2.8); // (4*40 + 2*60) / 100
k[1].insufficientEvidence = true; // leaves it out; does not count as zero
assert.equal(kpiScore(kras, k), 4);
k[1].insufficientEvidence = false; k[1].finalScore = 4;
assert.equal(kpiScore(kras, k), 4);
assert.equal(kpiScore(kras, blankKpiAssessments(kras)), null, 'nothing rated yet gives no score');

// --- behaviour: not observed is excluded, not 0 and not 3
const comps = [{ competencyId: 'a', weight: 1 }, { competencyId: 'b', weight: 1 }, { competencyId: 'c', weight: 2 }];
const c = blankCompetencyAssessments(comps);
c[0].managerRating = 5; c[1].managerNotObserved = true; c[2].managerRating = 2;
assert.equal(behaviourScore(comps, c), 3, '(5*1 + 2*2) / 3 = 3, with the not observed one left out');
c[2].finalNotObserved = true;
assert.equal(behaviourScore(comps, c), 5);

// --- SOP: not applicable and not verified are ignored; critical misses are listed on their own
const check = (result: SopCheck['result'], critical = false): SopCheck => ({ sopId: 's', sopTitle: 'Data handling', versionNumber: '1.0', checkpointId: Math.random().toString(), checkpoint: 'Step', critical, result, evidence: '', severity: 'HIGH', correctiveAction: '', reviewerUid: 'm', reviewedAt: '' });
assert.equal(sopScore([]).score, null);
assert.equal(sopScore([check('NOT_VERIFIED'), check('NOT_APPLICABLE')]).score, null);
assert.equal(sopScore([check('COMPLIANT'), check('COMPLIANT')]).score, 5);
assert.equal(sopScore([check('COMPLIANT'), check('NON_COMPLIANT')]).score, 3);
const crit = sopScore([check('COMPLIANT'), check('COMPLIANT'), check('COMPLIANT'), check('NON_COMPLIANT', true)]);
assert.equal(crit.score, 4, 'the average looks fine ...');
assert.equal(crit.criticalFindings.length, 1, '... but the critical miss is not hidden by it');

// --- approval is blocked until critical findings and partial scores are acknowledged
const base: any = { scores: { overall: 4, criticalFindings: crit.criticalFindings, partial: true }, hrCriticalAcknowledged: false, hrPartialAcknowledged: false };
assert.equal(approveProblems(base).length, 2);
assert.equal(approveProblems({ ...base, hrCriticalAcknowledged: true, hrPartialAcknowledged: true }).length, 0);
assert.ok(approveProblems({ ...base, scores: { ...base.scores, overall: null } }).some((m) => /scored/.test(m)));
assert.ok(adjustmentProblem({ reason: '' }, 4));
assert.ok(adjustmentProblem({ reason: 'x' }, 9));
assert.equal(adjustmentProblem({ reason: 'Evidence shows more' }, 4), null);

// --- the whole score from a review shape
const review: any = { kras, competencies: [{ competencyId: 'a', name: 'A', standard: '', weight: 1 }], kpiAssessments: blankKpiAssessments(kras), competencyAssessments: blankCompetencyAssessments([{ competencyId: 'a' }]), sopChecks: [check('COMPLIANT')], weights: w };
review.kpiAssessments.forEach((a: any) => { a.managerScore = 4; });
review.competencyAssessments[0].managerRating = 3;
const s = computeScores(review);
assert.deepEqual([s.kra, s.behaviour, s.sop, s.overall], [4, 3, 5, 3.9]);
assert.equal(s.band, 'Exceeds Standard');

// --- submission checks
assert.ok(selfSubmitProblems({ ...review, achievements: '' }).length >= 3);
const selfOk: any = { ...review, achievements: 'Shipped it', kpiAssessments: review.kpiAssessments.map((a: any) => ({ ...a, selfNote: 'done' })), competencyAssessments: review.competencyAssessments.map((a: any) => ({ ...a, selfRating: 3 })) };
assert.deepEqual(selfSubmitProblems(selfOk), []);
const mgr: any = { ...review, managerComments: '' };
assert.ok(managerSubmitProblems(mgr).some((m) => /comments/.test(m)));
mgr.managerComments = 'Fine'; mgr.competencyAssessments[0].managerRating = 5;
assert.ok(managerSubmitProblems(mgr).some((m) => /needs an observed example/.test(m)), 'an extreme rating needs evidence');
mgr.competencyAssessments[0].managerExamples = 'Led the migration';
assert.deepEqual(managerSubmitProblems(mgr), []);
mgr.sopChecks = [{ ...check('NON_COMPLIANT'), correctiveAction: '' }];
assert.ok(managerSubmitProblems(mgr).some((m) => /corrective action/.test(m)));

// --- state machine and segregation of duties
assert.equal(nextStatus('SELF_PENDING', 'SELF_SUBMIT'), 'MANAGER_PENDING');
assert.equal(nextStatus('MANAGER_PENDING', 'MANAGER_SUBMIT'), 'DISCUSSION_PENDING');
assert.equal(nextStatus('DISCUSSION_PENDING', 'DISCUSSION_DONE'), 'HR_REVIEW');
assert.equal(nextStatus('HR_REVIEW', 'HR_FORWARD'), 'APPROVAL_PENDING');
assert.equal(nextStatus('APPROVAL_PENDING', 'APPROVE'), 'PUBLISHED');
assert.equal(nextStatus('PUBLISHED', 'DISAGREE'), 'DISPUTED');
assert.equal(nextStatus('DISPUTED', 'RESOLVE_DISPUTE'), 'CLOSED');
assert.equal(nextStatus('SELF_PENDING', 'APPROVE'), null, 'no shortcuts');
assert.equal(nextStatus('CONFIGURATION_PENDING', 'SELF_SUBMIT'), null, 'a review that is not configured cannot be finished');
assert.equal(nextStatus('ACKNOWLEDGED', 'APPROVE'), null);
assert.ok(isFinal('PUBLISHED') && !isFinal('HR_REVIEW'));
const rv = { uid: 'emp', managerUid: 'mgr' };
assert.ok(selfApprovalProblem(rv, 'emp', 'APPROVE'), 'nobody approves their own review');
assert.ok(selfApprovalProblem(rv, 'emp', 'HR'));
assert.ok(selfApprovalProblem(rv, 'mgr', 'APPROVE'), 'the evaluating manager does not give final approval');
assert.equal(selfApprovalProblem(rv, 'mgr', 'HR'), null);
assert.equal(selfApprovalProblem(rv, 'hr', 'APPROVE'), null);

// --- ids are deterministic, so a repeated run cannot create a second review
assert.equal(reviewIdOf('c1', 'q1', 'u1'), reviewIdOf('c1', 'q1', 'u1'));
assert.equal(checkinIdOf('c1', 'u1', '2026-10'), 'c1__u1__2026-10');

// --- periods and deadlines
assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
assert.deepEqual(quarterRange('2026-11-15'), { start: '2026-10-01', end: '2026-12-31', label: 'Q4 2026' });
assert.equal(deadlineState('2026-10-10', '2026-10-09'), 'OVERDUE');
assert.equal(deadlineState('2026-10-08', '2026-10-09'), 'DUE_SOON');
assert.equal(deadlineState('2026-10-01', '2026-10-20'), 'OK');
assert.equal(deadlineState('2026-10-01', ''), 'NONE');
assert.equal(leaveShare('2026-10-01', '2026-10-10', [{ from: '2026-10-01', to: '2026-10-05' }, { from: '2026-10-04', to: '2026-10-08' }]), 0.8, 'overlapping leave is counted once');
assert.equal(leaveShare('2026-10-01', '2026-10-10', []), 0);

// --- role family, framework and plan lookups
const fams: RoleFamily[] = [
  { id: 'mk', name: 'Marketing', departmentName: 'Marketing', designationKeywords: [], category: 'INDIVIDUAL', competencyIds: [], active: true },
  { id: 'mk-lead', name: 'Marketing lead', departmentName: 'marketing', designationKeywords: ['lead', 'head'], category: 'MANAGER', competencyIds: ['mgr-people'], active: true },
];
assert.equal(resolveRoleFamily(fams, 'Marketing', 'Performance Marketing Executive')?.id, 'mk');
assert.equal(resolveRoleFamily(fams, 'Marketing', 'Team Lead')?.id, 'mk-lead');
assert.equal(resolveRoleFamily(fams, 'Finance', 'Accountant'), null);

const fw = (over: Partial<Framework>): Framework => ({ id: 'f', companyId: 'c', name: 'F', employeeCategory: 'INDIVIDUAL', roleFamilyId: '', weights: w, reviewFrequency: 'QUARTERLY', effectiveFrom: '2026-01-01', effectiveTo: '', status: 'APPROVED', version: 1, approvedBy: '', approvedAt: '', createdBy: '', createdAt: '', updatedAt: '', ...over });
assert.equal(pickFramework([fw({ status: 'DRAFT' })], 'INDIVIDUAL', 'mk', '2026-10-01'), null, 'a draft framework is never used');
assert.equal(pickFramework([fw({ effectiveFrom: '2027-01-01' })], 'INDIVIDUAL', 'mk', '2026-10-01'), null);
assert.equal(pickFramework([fw({ id: 'general' }), fw({ id: 'specific', roleFamilyId: 'mk' })], 'INDIVIDUAL', 'mk', '2026-10-01')?.id, 'specific');
assert.equal(pickFramework([fw({ id: 'general' })], 'MANAGER', 'x', '2026-10-01'), null);

const plan = (over: Partial<Plan>): Plan => ({ id: 'p', companyId: 'c', uid: 'u', employeeName: '', department: '', designation: '', roleFamilyId: '', roleFamilyName: '', managerUid: '', frameworkId: '', frameworkVersion: 1, templateId: '', templateVersion: 1, kras: [], competencies: [], competencyVersion: 1, effectiveFrom: '2026-01-01', effectiveTo: '', status: 'ACTIVE', pendingReason: '', approvals: [], version: 1, createdAt: '', updatedAt: '', ...over });
const plans = [plan({ id: 'old', status: 'SUPERSEDED', effectiveTo: '2026-06-30', department: 'Marketing' }), plan({ id: 'new', effectiveFrom: '2026-07-01', department: 'Finance', version: 2 })];
assert.equal(planActiveAt(plans, 'u', '2026-03-01')?.id, 'old', 'a transfer keeps the old plan for the old period');
assert.equal(planActiveAt(plans, 'u', '2026-08-01')?.id, 'new');
assert.equal(planActiveAt(plans, 'someone-else', '2026-08-01'), null);

assert.ok(isMaterialRevision('1.4', '2.0'));
assert.ok(!isMaterialRevision('1.0', '1.1'));

// --- fairness flags
const rows = (m: string, vals: number[]) => vals.map((v, i) => ({ reviewId: `${m}${i}`, uid: `${m}${i}`, managerUid: m, overall: v, selfAverage: null, kpiCount: 4, insufficientCount: 0 }));
const flags = fairnessFlags([...rows('m1', [3, 3, 3.1]), ...rows('m2', [4.8, 5, 4.9]), ...rows('m3', [2, 2.1, 2.3]), ...rows('m4', [3.4, 3.1, 2.9])]);
assert.ok(flags.some((f) => f.kind === 'UNIFORM_MANAGER' && f.managerUid === 'm1'));
assert.ok(flags.some((f) => f.kind === 'MANAGER_OUTLIER' && f.managerUid === 'm2'));
assert.ok(!flags.some((f) => f.kind === 'UNIFORM_MANAGER' && f.managerUid === 'm4'));
const gap = fairnessFlags([{ reviewId: 'r', uid: 'u', managerUid: 'm', overall: 2, selfAverage: 4.6, kpiCount: 4, insufficientCount: 3 }]);
assert.deepEqual(gap.map((f) => f.kind).sort(), ['MISSING_EVIDENCE', 'SELF_GAP']);
assert.deepEqual(ratingDistribution([1, 2.4, 2.6, 5, null]), { '1': 1, '2': 1, '3': 1, '4': 0, '5': 1 });

// --- AI guardrails: no personality, health, loyalty or private-life conclusions; every claim cites evidence
assert.ok(bannedInference('She seems emotionally unstable'));
assert.ok(bannedInference('His loyalty is questionable'));
assert.ok(bannedInference('Based on login hours he is idle'));
assert.equal(bannedInference('Delivered 12 campaigns on schedule'), null);
const f = filterAiSummary('Delivered 12 campaigns [1]. She is clearly unmotivated [2]. Reports were late [9]. The team likes her.', [1, 2, 3]);
assert.equal(f.kept, 'Delivered 12 campaigns [1].');
assert.equal(f.dropped, 3);

console.log('performance engine tests passed');
