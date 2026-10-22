import assert from 'node:assert/strict';
import {
  compareResults, levelFor, scoreAssessment, skillKey, splitCount, blueprintTotal, type ScorableQuestion, type SkillBlueprint,
} from '../shared/assessment.ts';
import { parseGenerated } from '../api/_lib/assessments.ts';
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_TEMPLATES, effectivePermissions } from '../shared/permissions.ts';

// ---- skill keys
assert.equal(skillKey(' Node.JS '), 'node.js');
assert.equal(skillKey('React   Native'), 'react native');
assert.equal(skillKey('C++'), 'c++');

// ---- splitting counts
for (const preset of ['easy', 'balanced', 'hard'] as const) {
  for (const n of [1, 5, 10, 15, 25, 40]) {
    const b = splitCount(n, preset);
    assert.equal(blueprintTotal(b), n, `${preset} ${n}`);
    assert.ok(b.easy >= 0 && b.medium >= 0 && b.hard >= 0);
  }
}
assert.deepEqual(splitCount(10, 'balanced'), { easy: 4, medium: 4, hard: 2 });

// ---- scoring: weights easy 1, medium 2, hard 3
const qs: ScorableQuestion[] = [
  { id: 'r1', skill: 'React', difficulty: 'easy', correctIndex: 0 },
  { id: 'r2', skill: 'React', difficulty: 'medium', correctIndex: 1 },
  { id: 'r3', skill: 'React', difficulty: 'hard', correctIndex: 2 },
  { id: 'n1', skill: 'Node.js', difficulty: 'easy', correctIndex: 3 },
  { id: 'n2', skill: 'node.js', difficulty: 'medium', correctIndex: 0 },
];
const res = scoreAssessment(qs, { r1: 0, r2: 1, r3: 0, n1: 3 }); // r3 wrong, n2 unanswered
const react = res.skills.find((x) => x.skillKey === 'react')!;
const node = res.skills.find((x) => x.skillKey === 'node.js')!;
assert.equal(res.skills.length, 2);
assert.equal(react.earned, 3); // 1 + 2
assert.equal(react.possible, 6);
assert.equal(react.percent, 50);
assert.equal(node.earned, 1);
assert.equal(node.possible, 3);
assert.equal(node.percent, 33.3);
assert.equal(res.overall.earned, 4);
assert.equal(res.overall.possible, 9);
assert.equal(res.overall.percent, 44.4);
assert.equal(res.answered, 4);
assert.equal(react.level, 'Intermediate');
assert.equal(node.level, 'Beginner');
assert.equal(levelFor(75), 'Advanced');
assert.equal(levelFor(39.9), 'Beginner');

// a perfect and an empty test
assert.equal(scoreAssessment(qs, { r1: 0, r2: 1, r3: 2, n1: 3, n2: 0 }).overall.percent, 100);
assert.equal(scoreAssessment(qs, {}).overall.percent, 0);
assert.equal(scoreAssessment([], {}).overall.percent, 0);

// ---- comparison
const bp1: SkillBlueprint[] = [{ skill: 'React', easy: 1, medium: 1, hard: 1 }, { skill: 'Node.js', easy: 1, medium: 1, hard: 0 }];
const before = { result: res, blueprint: bp1 };
const afterRes = scoreAssessment(qs, { r1: 0, r2: 1, r3: 2, n1: 3, n2: 0 });
const cmp = compareResults(before, { result: afterRes, blueprint: bp1 });
const cReact = cmp.skills.find((x) => x.skillKey === 'react')!;
assert.equal(cReact.before, 50);
assert.equal(cReact.after, 100);
assert.equal(cReact.deltaPoints, 50);
assert.equal(cReact.relativePercent, 100);
assert.equal(cReact.comparable, true);
assert.equal(cmp.overall.deltaPoints, 55.6);
assert.equal(cmp.overall.comparable, true);

// different shape -> flagged
const cmp2 = compareResults(before, { result: afterRes, blueprint: [{ skill: 'React', easy: 2, medium: 0, hard: 1 }, bp1[1]] });
assert.equal(cmp2.skills.find((x) => x.skillKey === 'react')!.comparable, false);
assert.equal(cmp2.overall.comparable, false);

// a skill missing on one side
const onlyReact = scoreAssessment(qs.slice(0, 3), { r1: 0 });
const cmp3 = compareResults(before, { result: onlyReact, blueprint: [bp1[0]] });
const nodeCmp = cmp3.skills.find((x) => x.skillKey === 'node.js')!;
assert.equal(nodeCmp.after, null);
assert.equal(nodeCmp.deltaPoints, null);
assert.equal(cmp3.overall.comparable, false);

// zero baseline -> no relative percent, but points still shown
const zero = scoreAssessment(qs, {});
const cmp4 = compareResults({ result: zero, blueprint: bp1 }, { result: afterRes, blueprint: bp1 });
assert.equal(cmp4.skills[0].relativePercent, null);
assert.equal(cmp4.skills[0].deltaPoints, 100);

// ---- AI output validation
const good = { difficulty: 'easy', topic: 'hooks', text: 'What does useState return?', options: ['A pair', 'A promise', 'A string', 'Nothing'], correctIndex: 0, explanation: 'It returns [state, setState].' };
const parsed = parseGenerated(JSON.stringify({ questions: [
  good,
  { ...good, text: 'dup options', options: ['a', 'a', 'b', 'c'] },        // duplicate options
  { ...good, text: 'three options', options: ['a', 'b', 'c'] },            // not 4
  { ...good, text: 'bad index', correctIndex: 7 },                          // out of range
  { ...good, text: 'all of above', options: ['a', 'b', 'c', 'All of the above'] },
  { ...good, text: '', options: ['a', 'b', 'c', 'd'] },                     // empty text
]}), 'medium');
assert.equal(parsed.length, 1);
assert.equal(parsed[0].difficulty, 'medium'); // difficulty comes from the request, not the model
assert.deepEqual(parseGenerated('not json', 'easy'), []);
assert.equal(parseGenerated('```json\n' + JSON.stringify({ questions: [good] }) + '\n```', 'easy').length, 1);

// ---- permissions
assert.ok(ALL_PERMISSION_KEYS.includes('assess.manage') && ALL_PERMISSION_KEYS.includes('assess.view'));
const mods = ['document-version-control', 'talent-acquisition'];
const admin = effectivePermissions([{ permissions: [], isAdmin: true }], mods);
assert.ok(admin.includes('assess.manage') && admin.includes('assess.view'));
const hr = DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === 'hr')!;
assert.ok(hr.permissions.includes('assess.manage'));
const noTalent = effectivePermissions([{ permissions: ALL_PERMISSION_KEYS }], ['document-version-control']);
assert.ok(!noTalent.includes('assess.manage'), 'assessment permissions need the Talent Acquisition module');

console.log('assessment tests passed');
