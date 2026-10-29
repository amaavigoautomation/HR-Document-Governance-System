import assert from 'node:assert/strict';
import { applyEvidence, experiencePoints } from '../api/_lib/aiScoring.ts';
import { keywordEvidence } from '../api/_lib/resumeKeywords.ts';

// With no minimum in the job description, experience points grow with the years instead of a flat 22
assert.equal(experiencePoints('MEETS', 0, '0 Years documented'), 8);
assert.equal(experiencePoints('MEETS', 2, '2 Years documented'), 14);
assert.equal(experiencePoints('MEETS', 6, '6 Years documented'), 22);
assert.equal(experiencePoints('MEETS', 3, '3 Years (Meets 3+ yrs requirement)'), 22, 'a stated minimum still earns 22');
assert.equal(experiencePoints('EXCEEDS', 9, ''), 25);

const jd = {
  requiredSkills: ['Meta Ads campaign management', 'Google Ads and search campaigns', 'Lead generation funnels', 'Analytics and reporting'],
  coreResponsibilities: ['Plan and run paid campaigns', 'Report weekly performance to the founders'],
};
const mk = (years: number) => ({
  id: 'x', resumeUrl: 'https://amaavigo.com/r.pdf', experienceNumeric: years,
  experienceVsJD: { status: 'MEETS' as const, label: `${years} Years documented` },
  skillsAlignment: [], responsibilitiesAlignment: [], strengths: [], gaps: [], missingOrNotEvidenced: [],
  alignmentScore: 0, overallAlignment: 'Not Evidenced' as const, keyTakeaway: '', interviewChecklist: [], noticePeriod: '',
});
const strong = applyEvidence(mk(5), jd, keywordEvidence(jd, 'Ran Meta Ads campaigns and Google Ads search campaigns. Built lead generation funnels, weekly reporting and analytics. Grew leads 40%. Planned paid campaigns.'), 'KEYWORDS');
const mid = applyEvidence(mk(2), jd, keywordEvidence(jd, 'Managed Meta Ads for a small shop and wrote weekly reports.'), 'KEYWORDS');
const none = applyEvidence(mk(1), jd, keywordEvidence(jd, 'Fresher. Wrote a college newsletter and designed posters.'), 'KEYWORDS');
assert.ok(strong.alignmentScore > mid.alignmentScore && mid.alignmentScore > none.alignmentScore, `${strong.alignmentScore} > ${mid.alignmentScore} > ${none.alignmentScore}`);
assert.ok(none.alignmentScore < 27, 'a candidate with nothing evidenced no longer lands on the old shared floor');
console.log('scoring spread tests passed');
