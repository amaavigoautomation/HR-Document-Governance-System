import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeRecruitment } from '../api/_lib/recruitmentApi.ts';
import { clearEvaluationCache, collapseRepeatApplications, parseJDText, personKey } from '../api/_lib/serverAiEvaluation.ts';
import { keywordEvidence } from '../api/_lib/resumeKeywords.ts';
import { designationKey } from '../api/_lib/jobDescriptions.ts';

// ---------------------------------------------------------------- pure pieces

// No JD text: nothing is invented (no placeholder skills), and it says so
const none = parseJDText('Inside Sales Manager', '');
assert.equal(none.jdProvided, false);
assert.equal(none.jdSource, 'NONE');
assert.deepEqual(none.requiredSkills, []);
assert.deepEqual(none.coreResponsibilities, []);

// A JD with headings
const jd = parseJDText(
  'Inside Sales Manager',
  'Role overview\nExperience: 3-5 years\n\nResponsibilities\n- Manage the inside sales pipeline\n- Coach a team of sales executives\n\nRequired skills\n- CRM tools such as HubSpot\n- Cold calling and negotiation\n',
  'PORTAL'
);
assert.equal(jd.jdProvided, true);
assert.equal(jd.jdSource, 'PORTAL');
assert.equal(jd.minExperience, '3 Years');
assert.equal(jd.maxExperience, '5 Years');
assert.ok(jd.requiredSkills.length >= 2, JSON.stringify(jd.requiredSkills));
assert.ok(jd.coreResponsibilities.length >= 2);

// A JD with only bullets still gives requirements
const bullets = parseJDText('Analyst', 'We need someone who can:\n- Build Excel dashboards\n- Write SQL queries\n');
assert.ok(bullets.requiredSkills.includes('Build Excel dashboards'));

// Keyword evidence: strong, partial, absent
const need = { requiredSkills: ['CRM tools such as HubSpot', 'Cold calling and negotiation', 'Kubernetes cluster operations'], coreResponsibilities: ['Manage the inside sales pipeline'] };
const strong = keywordEvidence(need, 'Led the inside sales pipeline for 4 years. Daily cold calling, negotiation of contracts, HubSpot CRM admin. Grew revenue 35%.');
assert.equal(strong.skills[0].status, 'MET');
assert.equal(strong.skills[1].status, 'MET');
assert.equal(strong.skills[2].status, 'NOT_EVIDENCED');
assert.equal(strong.responsibilities[0].status, 'MET');
assert.ok(strong.hasMetrics);
const weak = keywordEvidence(need, 'Fresher. Worked on a college newsletter and some design projects.');
assert.ok(weak.skills.every((s) => s.status === 'NOT_EVIDENCED'));
assert.ok(!weak.hasMetrics);

// Repeat applications: same email (any case) or same mobile = one person, latest wins
assert.equal(personKey('A@x.com', '', 'A'), personKey('a@x.com ', '999', 'B'));
assert.equal(personKey('', '+91 98765-43210', 'A'), personKey('', '9876543210', 'B'));
const merged = collapseRepeatApplications([
  { id: '1', _identity: 'e:a@x.com', _appliedAt: 100, _order: 0 },
  { id: '2', _identity: 'e:b@x.com', _appliedAt: 100, _order: 1 },
  { id: '3', _identity: 'e:a@x.com', _appliedAt: 200, _order: 2 },
  { id: '4', _identity: '', _appliedAt: 0, _order: 3 },
]);
assert.deepEqual(merged.map((r) => r.id), ['2', '3', '4']);
assert.equal(designationKey('  Inside   Sales-Manager '), designationKey('inside sales manager'));

// ---------------------------------------------------------------- the home company, end to end

const CID = 'home1';
process.env.HOME_COMPANY_ID = CID;
const fdb = new FakeFirestore();
__useFakeAdmin({
  db: fdb,
  auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) },
});
const tokenFor = (uid: string, perms: string[]) => ({
  authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@amaavigo.com`, cid: CID, cs: 'ACTIVE', perms, adm: false })).toString('base64')}`,
});
const HR = tokenFor('u_hr', ['talent.view', 'candidate.evaluate', 'req.manage_jd']);
const VIEWER = tokenFor('u_view', ['talent.view', 'candidate.evaluate']);
fdb.seed('companies', CID, { name: 'Amaavigo' });

async function docx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

const resumes: Record<string, Buffer> = {
  'https://www.amaavigo.com/cv/strong.docx': await docx(
    'Asha Rao. Inside sales leader. Led the inside sales pipeline and coached a team of sales executives for 6 years.\nExpert in HubSpot CRM, cold calling and negotiation. Grew revenue 40% year on year.\nPortfolio and case studies available.'
  ),
  'https://www.amaavigo.com/cv/weak.docx': await docx(
    'Ravi Kumar. Recent graduate with a degree in commerce. Worked on a college fest committee and a small newsletter project.\nInterested in learning about business and meeting new people in a professional setting.'
  ),
};

const application = (id: number, name: string, email: string, cv: string, createdAt: string, title = 'Inside Sales Manager') => ({
  id,
  name,
  email,
  mobile: '99999000' + String(id).padStart(2, '0'),
  designation: { title },
  experience: id === 1 ? '6' : '1',
  notice_period: '30',
  interview_status: { name: 'New Applicant' },
  attachment_url: cv,
  created_at: createdAt,
});
const apps = [
  application(1, 'Asha Rao', 'asha@x.com', 'https://www.amaavigo.com/cv/strong.docx', '2026-10-01T10:00:00Z'),
  application(2, 'Ravi Kumar', 'ravi@x.com', 'https://www.amaavigo.com/cv/weak.docx', '2026-10-02T10:00:00Z'),
  application(3, 'Ravi Kumar', 'RAVI@x.com', 'https://www.amaavigo.com/cv/weak.docx', '2026-10-05T10:00:00Z'), // applied again
  application(4, 'Asha Rao', 'asha@x.com', 'https://www.amaavigo.com/cv/strong.docx', '2026-10-06T10:00:00Z', 'Account Executive'),
];
// "Inside Sales Manager" has no description on the website; "Account Executive" does.
const openings: any[] = [
  { id: 7, designation: { title: 'Inside Sales Manager' }, no_of_opening: 2, joining_on: '', qualification: '' },
  { id: 8, designation: { title: 'Account Executive' }, no_of_opening: 1, joining_on: '', qualification: 'Required skills\n- Cold calling and negotiation\n' },
];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url = String(input?.href || input);
  const json = (data: any) => ({ ok: true, status: 200, url, text: async () => JSON.stringify(data), headers: new Headers() });
  if (url.includes('/api/job-applications')) return json({ success: true, data: apps });
  if (url.includes('/api/current-openings')) return json({ success: true, data: openings });
  const body = resumes[url];
  if (body) return { ok: true, status: 200, url, headers: new Headers(), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  return { ok: false, status: 404, url, text: async () => 'nope', headers: new Headers() };
}) as any;

const get = (headers: any, action: string, query: any = {}) => routeRecruitment({ method: 'GET', action, headers, query });
const post = (headers: any, action: string, body: any) => routeRecruitment({ method: 'POST', action, headers, query: {}, body });
const evaluate = async (designation = 'Inside Sales Manager') => {
  clearEvaluationCache();
  const r = await get(HR, 'ai-evaluation', { designation });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json;
};

// 1. The website has no JD for the role: nobody gets a score, and nothing is made up
let ev = await evaluate();
assert.equal(ev.jdSummary.jdProvided, false);
assert.deepEqual(ev.jdSummary.requiredSkills, []);
assert.equal(ev.totalCandidates, 2, 'the repeat application is merged');
assert.equal(ev.duplicatesMerged, 1);
assert.ok(ev.candidates.every((c: any) => c.scored === false && c.alignmentScore === 0), JSON.stringify(ev.candidates.map((c: any) => c.alignmentScore)));
assert.equal(ev.hrRecommendation.topCandidate, null);
assert.equal(ev.candidates.find((c: any) => c.name === 'Ravi Kumar').id, '3', 'the latest application is kept');

// 2. Writing a JD needs the permission, is validated, and is then used
assert.equal((await post(VIEWER, 'jd-save', { designation: 'Inside Sales Manager', text: 'x' })).status, 403);
assert.equal((await post(HR, 'jd-save', { designation: '', text: 'x' })).status, 400);
assert.equal((await post(HR, 'jd-save', { designation: 'Inside Sales Manager', text: '   ' })).status, 400);
assert.equal((await routeRecruitment({ method: 'GET', action: 'jd-save', headers: HR, query: {} })).status, 405);
const saved = await post(HR, 'jd-save', {
  designation: 'inside sales manager',
  text: 'Responsibilities\n- Manage the inside sales pipeline\n- Coach a team of sales executives\n\nRequired skills\n- CRM tools such as HubSpot\n- Cold calling and negotiation\n\nExperience: 3 years',
});
assert.equal(saved.status, 200, JSON.stringify(saved.json));

ev = await evaluate();
assert.equal(ev.jdSummary.jdProvided, true);
assert.equal(ev.jdSummary.jdSource, 'PORTAL');
assert.equal(ev.jdSummary.minExperience, '3 Years');
const asha = ev.candidates.find((c: any) => c.name === 'Asha Rao');
const ravi = ev.candidates.find((c: any) => c.name === 'Ravi Kumar');
assert.equal(asha.scored, true);
assert.equal(asha.scoringMode, 'KEYWORDS');
assert.equal(ravi.scored, true);
assert.ok(asha.alignmentScore > ravi.alignmentScore + 20, `${asha.alignmentScore} vs ${ravi.alignmentScore}`);
assert.notEqual(asha.alignmentScore, 27);
assert.notEqual(ravi.alignmentScore, 27);
assert.equal(ev.candidates[0].name, 'Asha Rao', 'best candidate ranks first');
assert.equal(ev.hrRecommendation.topCandidate.name, 'Asha Rao');

// 3. Reverting goes back to the website's (empty) description
assert.equal((await post(HR, 'jd-delete', { designation: 'Inside Sales Manager' })).status, 200);
ev = await evaluate();
assert.equal(ev.jdSummary.jdProvided, false);
assert.ok(ev.candidates.every((c: any) => c.scored === false));

// 3b. A JD stored on the company's own requisition is used automatically, even though the website returns none
fdb.seed('requisitions', 'rq-draft', { companyId: CID, positionTitle: 'Inside Sales Manager', status: 'JD_DRAFT', jd: { text: 'Required skills\n- Quantum basket weaving\n', updatedAt: '2026-10-30T00:00:00Z' } });
fdb.seed('requisitions', 'rq-open', {
  companyId: CID,
  positionTitle: 'Inside Sales Manager',
  status: 'JOB_OPEN',
  jd: { text: 'Responsibilities\n- Manage the inside sales pipeline\n\nRequired skills\n- CRM tools such as HubSpot\n- Cold calling and negotiation', updatedAt: '2026-10-20T00:00:00Z' },
});
fdb.seed('requisitions', 'rq-other-company', { companyId: 'someone-else', positionTitle: 'Inside Sales Manager', status: 'JOB_OPEN', jd: { text: 'Required skills\n- Not ours\n' } });
ev = await evaluate();
assert.equal(ev.jdSummary.jdSource, 'REQUISITION');
assert.ok(ev.jdSummary.requiredSkills.includes('CRM tools such as HubSpot'), JSON.stringify(ev.jdSummary.requiredSkills));
assert.ok(!ev.jdSummary.rawJDText.includes('Quantum') && !ev.jdSummary.rawJDText.includes('Not ours'), 'drafts and other companies are ignored');
assert.ok(ev.candidates.every((c: any) => c.scored === true));
assert.ok(ev.candidates.find((c: any) => c.name === 'Asha Rao').alignmentScore > ev.candidates.find((c: any) => c.name === 'Ravi Kumar').alignmentScore);
// editing it on the evaluation screen still wins over the requisition's
await post(HR, 'jd-save', { designation: 'Inside Sales Manager', text: 'Required skills\n- Cold calling and negotiation\n' });
ev = await evaluate();
assert.equal(ev.jdSummary.jdSource, 'PORTAL');
await post(HR, 'jd-delete', { designation: 'Inside Sales Manager' });

// 4. When the website does carry a JD, it is used; a portal one still wins over it
ev = await evaluate('Account Executive');
assert.equal(ev.jdSummary.jdSource, 'WEBSITE');
assert.deepEqual(ev.jdSummary.requiredSkills, ['Cold calling and negotiation']);
assert.equal(ev.candidates[0].scored, true);
await post(HR, 'jd-save', { designation: 'Account Executive', text: 'Required skills\n- Kubernetes cluster operations\n' });
ev = await evaluate('Account Executive');
assert.equal(ev.jdSummary.jdSource, 'PORTAL');
assert.deepEqual(ev.jdSummary.requiredSkills, ['Kubernetes cluster operations']);

globalThis.fetch = realFetch;
console.log('recruitment.scoring: ok');
