# HR Portal (multi-tenant)

Companies sign themselves up, wait for approval, then onboard their own employees, departments and
custom roles. Built on Vite + React, Express / Vercel functions, **MongoDB** (data) and Firebase Authentication (logins).
(Branch `mongodb`: data lives in MongoDB; see "Database: MongoDB" below. Without `MONGODB_URI` the server still falls back to Firestore.)

## How it works

- **Sign-up**: a company registers with email + password. It is `PENDING` and can see nothing until a
  platform admin approves it (then it is `ACTIVE` with the modules you enable).
- **Login**: email + password only. The server looks up which company the account belongs to.
- **Roles**: each company gets default roles (Company Admin, Head HR, HR, Approver/Founder, Department
  Head, Employee) and can create its own from a permission checklist. Nobody can grant a permission they
  do not hold themselves.
- **Security**: the server (Firebase Admin "master key") creates logins and writes `cid / cs / perms / adm`
  claims onto the user's ID token. `firestore.rules` and every API route trust only those claims, so one
  company can never read another's data.

## Setup

1. Create a Firebase project with **Authentication (Email/Password)** and **Firestore**; put the web config
   in `firebase-applet-config.json`.
2. Create a service account key (Project settings > Service accounts) and set
   `FIREBASE_SERVICE_ACCOUNT_JSON` (see `.env.example`).
3. Deploy the rules: `firebase deploy --only firestore:rules`.
4. Make yourself platform admin (can approve companies):
   `npx tsx scripts/make-platform-admin.ts you@example.com --create 'a-strong-password'`
5. `npm install && npm run dev` (or deploy to Vercel with the same env vars).

## Database: MongoDB

All data lives in MongoDB. Firebase is used only for **Authentication** (logins and the `cid / cs / perms` claims).

- **Setup**: create a MongoDB Atlas cluster and set `MONGODB_URI` (and optionally `MONGODB_DB`) in `.env` / Vercel.
  Use a paid tier such as Flex before real data goes in, so you get backups (the free M0 tier has none).
  Items 1 and 2 of Setup above still apply (Authentication, service account); skip step 3 (Firestore rules).
- **How the server talks to it**: every API module calls `adminDb()`, which with `MONGODB_URI` set is a Firestore-shaped
  adapter over MongoDB (`api/_lib/mongoFirestore.ts`): one MongoDB collection per old Firestore collection, document id
  stored as `_id`. Transactions use MongoDB transactions (Atlas is a replica set, so they work); on a standalone mongod it
  falls back to a one-at-a-time lock inside the server process.
- **How the browser talks to it**: it cannot reach MongoDB. The few collections the browser used to read directly
  (companies, employees, departments, roles, documents, versions, audit logs, acknowledgments, notifications,
  document suggestions, requisitions) now go through `POST /api/tenant/data-*` (`api/_lib/dataApi.ts`), which enforces
  the same company and permission checks as `firestore.rules`, using the signed-in user's token. `src/services/dataStore.ts`
  gives the browser the same function names it used with Firestore.
- **Live screens**: Firestore pushed changes; MongoDB does not, so open screens re-check every 20 seconds (`POLL_MS` in
  `dataStore.ts`), when the tab regains focus, and straight after the user's own saves.
- **Moving existing data**: `npm run migrate:mongo -- --dry-run`, then without `--dry-run`. It copies every Firestore
  collection into MongoDB and never deletes anything. Run it while the app is quiet, then deploy with `MONGODB_URI` set.
- **Tests**: `TEST_DB=mongo npx tsx tests/<name>.test.ts` runs a test against the MongoDB adapter (on an in-memory stand-in
  for the driver); `tests/mongoFirestore.test.ts` and `tests/data.api.test.ts` cover the adapter and the browser gateway.

### Migrating the existing single company

`npx tsx scripts/migrate-to-multitenant.ts --company "Amaavigo Group" --admin admin@yourco.com`
(add `--dry-run` first). It prints the company id: set it as `HOME_COMPANY_ID`.

## Leave & Attendance

Sidebar item "Leave & Attendance" (and a tab in the employee portal). Everyone can apply for leave, check in/out
and see their own balances; managers approve their team; HR (`leave.manage`) sets everything up; `leave.report`
gives read-only company reports. Existing roles need `leave.manage` / `leave.report` added in Administration.

- Setup (HR): leave year (calendar or financial or any start month, per leave type if needed), locations with
  weekly offs and holidays (CSV import), leave types, policies (quota, accrual, carry-forward), shift and late rules,
  people (location, policy, manager, join date; CSV import) and opening balances (CSV import).
- Balances are a ledger (credits and debits), so every change is traceable. Daily accrual and the year-end
  carry-forward/lapse are idempotent. Schedule `GET /api/leave/cron?key=$CRON_SECRET` daily (cronjob.org, early
  morning IST); HR can also press "Run accrual now".
- Approvals: manager, or manager then HR, per leave type; reminders to the HR mailboxes in Setup.
- Attendance: web check-in/out (optional IP allow-list), shifts with grace, late marks, missed-swipe corrections
  approved by the manager, monthly report with loss-of-pay days (CSV export). No payroll integration yet.
- Statutory defaults (maternity 26 weeks, state minimums) are starting points; confirm with a labour-law advisor.
- Collections: `leaveSettings`, `leaveProfiles`, `leaveLedger`, `leaveRequests`, `leaveAttendance`,
  `leaveRegularizations` (server-only; deploy the updated `firestore.rules`).

## Employee 360

Employee → Reports → **Employee 360** (Company Admin, `lifecycle.manage` or `leave.manage` only). Searchable list of all employees (filter by department, include former staff, CSV of the basic list). Opening a row shows that person's employment details, identity documents (numbers masked until revealed, photos viewable), personal information, family and qualifications (with certificates) on one read-only page. It reuses the existing profile endpoints, so the server-side permission checks are unchanged.

## Home page

Everyone lands on Home after signing in. It shows a profile card (reporting and approving manager, or the manager covering today), a mood check-in, a leave calendar, online attendance (punch in/out with remarks), quick links and reports, employees on leave, birthdays and anniversaries, important files, CEO speak, announcements, acknowledgements and (for people who manage users) a web/mobile login chart. The old "needs your attention" widgets stay on top.

- Routes live under `/api/leave/home-<action>` (they share the leave function to stay within the Vercel Hobby limit of 12 functions). Code: `api/_lib/homeApi.ts`, `shared/home.ts`, `src/components/home/`.
- New permissions `announce.manage` and `home.manage`. Company Admin has them automatically; Head HR gets both, HR and Approver/Founder get `announce.manage` on new companies. **Existing roles must be given these in Administration.**
- New server-only collections (`homeSettings`, `announcements`, `moodCheckins`, `loginDaily`, `personalDates`). Deploy the rules: `firebase deploy --only firestore:rules`.
- Privacy: birth and marriage dates are kept in `personalDates`, never on the employee document. Colleagues see only day and month, marriage only if the person turns it on, mood only as company-wide counts, and leave only as names and dates.
- Attendance: people can punch in and out many times a day (washroom, lunch). Worked time is the sum of the stretches; the gaps are not counted. Records keep `checkIn` (first in) and `checkOut` (last out) plus a `sessions` list; old one-pair records still work. A stretch left open on a past day shows Incomplete until corrected. Any worked time is at least a half day, never Absent.
- Leave & Attendance > Regularization: a full table for one month and one person (own, direct reports for managers, everyone for HR/report viewers): punch in/out, total hours, "less hours worked", approved corrections (AR columns), info panel with every punch, CSV export. The pencil asks for a fix on your own days, or lets HR set the real times for someone else.
- Leave & Attendance > Attendance application: one form for one or more days (route `apply-attendance`). Per day, tick "update time in" and/or "update time out"; unticked parts stay as recorded. Dates go back to the joining date. Each form gets a doc number (AA-...). Employees apply for themselves (manager approves); a manager can apply for a direct report (HR approves); HR can apply for anyone (applied straight away).
- Leave & Attendance > Attendance reports: In Out Activities, Daily Detail Attendance, Absent, Pending Attendance Applications, Detail In Out Summary, Employee Attendance, Late Coming, Early Going, Half Day and Missed Punch. Pick one employee or (managers: their team, HR: everyone), a date range or month, then Generate, Download CSV or Print/PDF. Data from `attendance-report` (max 93 days) and `pending-applications`; the reports are built in `src/components/leave/attendanceReports.ts`. Not built: Rejected Offline Punches and Employee Change Shift (they need biometric machines and per-employee shifts, which this system does not have), selfie images, and the logo layout option.
- Not built yet: Help Desk, Survey, dependent files.

## Job descriptions and candidate scoring

- A role's job description is found automatically, best first: one edited on the evaluation screen, then the JD stored on
  the company's own hiring requisition (open or closed; drafts are ignored), then what the careers website returns. HR with `req.manage_jd` can write or edit one for any role from
  Talent Acquisition > candidate evaluation > "View / edit JD" (or generate a draft with AI). It is stored in the
  server-only `jobDescriptions` collection and takes priority over the source; "Revert" goes back to the source.
- With no job description a role has no criteria, so applicants show "Not scored" instead of a made-up score.
- Applicants are scored from their resume, not from a spreadsheet's Pros/Cons columns: first a free match of the JD
  requirements against the resume text ("Resume match"), then "Evaluate with AI" for a deeper reading ("AI").
  Resume links may be on any public host (https or plain http), or a Google Drive / Docs / Dropbox share link, and may be a
  PDF, .docx or old .doc; a link the server cannot read says why, with the host. Private addresses are refused.
  Resumes are read a few at a time within a time budget (`KEYWORD_PASS_BUDGET_MS`, default 7000); refresh to continue.
- Repeat applications by the same person (same email, else mobile, else name) are merged into their latest one in the
  ranking. The raw Overview counts still show every application.

## Vercel function budget

Vercel's Hobby plan allows 12 serverless functions. The app uses 11: `[...catchall]` (also answers `/api/health`), `apply/[webhookId]`,
`assistant/[action]` (Ask HR), `email/[action]`, `hrbp/[action]`, `leave/[action]`, `onboarding/[action]`, `pm/[action]` (Performance), `recruitment/[action]`, `tasks/[action]` (Tasks) and `tenant/[action]`.
All hiring routes share `recruitment/[action]` through `api/_lib/hiringRouter.ts`, told apart by the action name:
`app-<action>` (candidate applications, was `/api/applications/<action>`), `careers-publish` (was `/api/careers/publish`),
`generate-jd` (was `/api/requisitions/generate-jd`), plus the overview and job-description actions.
**Add new hiring features as actions in `hiringRouter.ts`, not as new files under `api/`.**

## Hiring pipeline (Talent Acquisition)

Everything below is native to the app (no n8n) and per company. Server code is in `api/_lib/`, pure rules in `shared/`, screens in `src/components/hiring/`.

| Step | What it does | Where |
| --- | --- | --- |
| Requisition fields, budget, Position ID | Work mode, reporting manager, CTC band; department budget check; founder approval issues `POS-<CO>-<YEAR>-<NNN>` (a reason is required outside budget) | `hiringBudgetApi.ts`, `shared/hiringBudget.ts` |
| JD library, posting tracker, referrals | Reusable JDs; paste-ready posts per job board plus a tracker (only the careers site is published automatically); employee referral page (**Referrals & interviews**) | `pipelineApi.ts` |
| Candidate score | Out of 100: Skills 30, Experience 25, Portfolio 15, Communication 10, Stability 10, Salary fit 10 (weights editable per company). A part nobody has judged is "pending", never zero | `shared/hiringScore.ts` |
| Screening, assessments | HR screening call with pass / hold / fail (moves the stage); tests with a pass mark | `interviewApi.ts` |
| Interviews | Scheduling with `.ics` invites by email, clash warning for interviewers, reminders (24 h and 1 h), reschedule and cancel | `interviewApi.ts`, `shared/interviewEngine.ts` |
| Interview feedback | Blind scorecards: an interviewer sees only their own card until the whole panel has submitted; a summary is made after that | `interviewApi.ts` |

Data lives in the server-only collection `hiringItems` (told apart by `kind`). Resume reading handles text-based PDF/DOCX; scanned images need OCR, which is not set up.
Reminders run from a Vercel cron (`vercel.json`, once a day on the Hobby plan, so the 1-hour reminder is best-effort there); set `CRON_SECRET` so the cron call is accepted, or press "send reminders" as HR.
WhatsApp reminders and real calendar sync (Google / Microsoft) are not built; the invite is a standard `.ics` attachment.

## HR Business Partner (Phase 3)

`/api/hrbp/<action>` (`api/_lib/hrbpApi.ts`, rules in `shared/hrbpEngine.ts`, screens in `src/components/hrbp/`, sidebar item **HR Business Partner**).
Permissions: `hrbp.manage` (run the toolkit) and `hrbp.view` (leadership dashboard). Data lives in the server-only collection `hrbpItems`.

Employee business mapping (HRBP-001), org structure, headcount against approved numbers and resource planning (HRBP-002 to 004), quarterly talent review with the 9-box (HRBP-005),
KPI governance (HRBP-006), performance improvement plans (HRBP-007), anonymous pulse surveys (HRBP-008, results hidden below 5 answers), recognition (HRBP-009), wellness (HRBP-010),
training needs (HRBP-011), learning paths (HRBP-012), certificate tracker (HRBP-013), retention planning, succession planning and the leadership dashboard.
Existing companies need `hrbp.manage` / `hrbp.view` / `hiring.budget.manage` granted to the right roles (new companies get them from the role templates).

## Performance Management (HR-PM-001 to HR-PM-009, simplified)

Built from the "HR Performance Management Automation" specification, simplified so nobody needs training. No n8n: the app's own API and a daily job do the automation. Open **Performance** in the sidebar.

**What is measured:** Results (KPIs with targets, 60%), Behaviour (25%) and SOP compliance (15%). Ratings are 1–5 or "Not observed"; "Not observed" is left out, never counted as 0. A critical SOP marked "not compliant" is never averaged away: HR must look at it before approving.

**Who sees what:** everyone lands on **To do** (one list of what is waiting for them) and **My performance**. Managers get **My team**. HR gets **Setup**, **Targets (plans)**, **Reviews** and **Needs attention**. Approvers get **Reviews**. Leadership gets **Reports** (groups only; department averages hidden under 3 people).

**The year:**
1. HR runs the 5-step **Setup** once (weights, behaviours, SOPs from Document Governance, a KRA/KPI template per designation, timing). Nothing starts until "Finish setup".
2. Every employee gets a plan automatically. The manager sets targets (weights must total 100), HR approves, the employee acknowledges the targets and each SOP (open first, then "I have read and understood"). Missing manager or template → plan **on hold** with the reason; it starts by itself once fixed.
3. During the quarter, work is recorded against KPIs (by the employee, the manager, a CSV upload or a daily Google Sheet feed) and the manager verifies it. A check-in is created on the 1st of each month.
4. The quarter's reviews open by themselves on the first day after it ends (HR can also open one now). Self-review → manager (discussion date required) → HR approval → shared after N days → employee acknowledges or disagrees (kept word for word) → HR resolves.
5. When a review is shared, a development / improvement / recognition plan is drafted from the score; the manager confirms it. Training needs go to HRBP.

**Rules that never bend:** nobody sets or approves their own targets or approves a review they are the subject or manager of; a shared review changes only by an audited amendment (old version kept); running anything twice creates nothing twice; attendance and task counts are context, never ratings; AI only drafts text from recorded work (never names, never ratings) and anything about personality, motive or health is discarded and logged; with AI off everything still works.

**Automation:** event hooks run straight away (setup changes, template saved, targets approved, review approved/shared). The daily job (`/api/pm/daily`, cron with `CRON_SECRET`; HR can also press "Run the daily checks now" in Reports) syncs plans with People (joiners, leavers, role/department/manager changes, new SOP versions), reads the evidence feed, creates check-ins, opens the quarter, starts held reviews, closes late self-reviews, sends reminders and escalations, and shares approved reviews.

**Data:** nine server-only collections, each record carrying `companyId`: `pmSettings`, `pmTemplates`, `pmPlans`, `pmEvidence`, `pmCheckins`, `pmCycles`, `pmReviews` (with a frozen copy of the plan, weights and SOP versions), `pmDevPlans`, `pmLog` (audit trail + exceptions). Records from the earlier module (`pmItems`) are left untouched.

**Defaults used for open decisions:** HR approval is final (pm.manage or pm.approve, never the review's subject or manager); cycles are calendar quarters; after a mid-quarter role change the review scores the new plan only (the old plan and its evidence are kept).

Tests: `npx tsx tests/pm.test.ts` walks a whole year and checks all 12 acceptance tests from section 14 of the spec.

## Task Management

Open **Tasks** in the sidebar. A ClickUp-style place for day-to-day work: **My tasks** (grouped by when they are due, with a quick-add), **Boards** (columns by status, drag a card to move it), **Dashboard** and **Projects**.

**Who can give a task to whom:** anyone to themselves; a manager to everyone who reports up to them (their reports, and those people's reports); `task.manage` and company admins to anyone. Nobody gives work upwards or sideways.

**Who sees what:** the person doing a task, who gave it, its reviewer and its watchers, every manager above the assignee, and `task.manage` / `task.view_all` see it. A task on a **project** is visible to everyone who may open that project. Projects are **company-wide** (created by `task.manage` or a company admin) or for **one department** (created by `task.manage`, the department head, or a manager in that department; used by people in that department). Tasks without a project stay between the people involved and their managers.

**Review:** a task can need a review. The assignee sends it for review; only the reviewer (default: whoever gave the task, or the assignee's manager when they gave it to themselves) can approve it or send it back with a reason. Nobody approves their own work, not even an admin. A task linked to a **KPI** always needs a review.

**Link to Performance:** when a KPI-linked task is approved, it is added to Performance as work evidence for that KPI (`pmEvidence`, source `TASK`). If the reviewer is the person's manager it is already verified; otherwise the manager verifies it like any other work item. Counts never turn into a rating. Reopening a task withdraws evidence nobody has verified yet.

**Dashboards** show open work, what is late, what is in review, finished per week (everyone together) and open work per person. There is deliberately no "most tasks closed" ranking.

**Attachments** (up to 10 per task, 10 MB each; pdf, images, Office files, csv, txt) go to Cloudinary for now. The browser uploads straight to Cloudinary with a short-lived signature from the server, files are stored as private (`authenticated`), and people open them through a link the server signs for five minutes, only for people who may see the task. The server checks the real size and that the file sits under `tasks/<companyId>/<taskId>/`. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` (never commit them). Without them everything else works and the attach button explains it. To change storage later, implement the `AttachmentStore` interface in `api/_lib/taskCore.ts`; nothing else knows about Cloudinary.

**Daily reminders:** `GET /api/tasks/daily` with `Authorization: Bearer <CRON_SECRET>` (call it from cronjob.org, like the other daily jobs; it is not in `vercel.json` because Hobby allows only two crons). One email per person: due today (once), late (every 3 days; the person who gave the task hears once a week), waiting for review for 2+ days (every 3 days). Running it twice sends nothing twice.

**Permissions:** `task.manage` (Head HR by default) and `task.view_all` (Approver by default). Existing companies' roles are already seeded: add the permission to a role in Administration to use it.

**Data:** three server-only collections, each record carrying `companyId`: `taskProjects`, `taskItems`, `taskLog` (comments and the activity trail). Code: `shared/taskEngine.ts` (rules, no database), `api/_lib/taskCore.ts` and `taskApi.ts`, `src/components/tasks/`.

**Not in this version:** recurring tasks, task dependencies, custom statuses per project, sub-tasks as separate tasks (use the checklist), email for comments.

Tests: `npx tsx tests/task.test.ts`. The Cloudinary calls were written from its documentation and are covered by a fake store in the tests; try one real upload after adding the keys.

## Hiring Flow builder (custom steps from applicant to onboarding)

Everything up to "job posted on the website" stays fixed. From the moment an applicant arrives, each company can build its own step-by-step flow under the **Hiring Automation** sidebar section (Hiring flow, Who is where, My tasks), without code.

- **Steps** (plain-language cards, add/move/delete with buttons): score the resume, phone screening, skills test, interview (up to 5 rounds, with a pass mark), someone reviews (Yes/No), ask someone to approve, choose a path (If ... then ...), send an email, wait N days, offer, start joining, reject (with or without an email). Each person-step has an owner and a number of days; owners get a task and an email, and late tasks get one nudge a day.
- **Idiot-proofing**: start from the standard process in one click (it matches how hiring works today); the checklist beside the builder lists every problem in plain words and publishing stays locked until there are none (no owner, no ending in hire or reject, an Offer before joining, unknown placeholders such as `{{nmae}}`, steps nobody can reach, more than 5 interviews ...); steps only go forward so loops are impossible; "Try it with a pretend candidate" walks any path and sends nothing; drafts save by themselves.
- **Versions**: changing a live flow edits a copy; publishing makes Version N+1. Applicants already in the flow finish on the version they started with. **One flow per designation**: the Default flow covers everyone, and HR can make a separate flow for one or more designations (picked from designations already in the app; a designation belongs to at most one flow; matching ignores capitals and spaces). An applicant follows the flow for their designation once it is published, otherwise the Default flow. Each flow has its own drafts, versions and publish step. Stopping a designation flow sends new applicants back to the Default flow; applicants already inside keep their version.
- **How it runs**: the engine *watches* the existing screens (screening, tests, interviews, offers, joining) instead of replacing them, so the work is done where it always was and the applicant moves on by itself. Automatic steps are done by the engine. It advances on hooks (new application, screening saved, interview feedback complete, test scored, offer action or answer), on **Check everyone now**, and in the daily job (`hiring-daily`).
- **Safe by design**: one record per applicant (`flowrun_<applicationId>`); every move is checked inside a transaction; each email is claimed before it is sent so it goes out once even if two engines run together; unknown facts (for example no salary stated) never count as zero, the flow stops and tells HR (or follows the choice the builder made). Anything that goes wrong shows under **Who is where** as "Needs HR attention" with the reason and buttons: try again, skip (reason required), choose someone else, reject, take out of the flow. A manual rejection in the Candidates screen stops the flow with a note.
- Applicants who applied before a flow was published are not pulled in by surprise; HR can add them with **Add earlier applicants**.
- Permissions: the people who already manage hiring (`app.manage`, `req.manage_jd`, `req.hr_decide`) build flows and fix stuck applicants; anyone can see and answer their own tasks (**My tasks** in Hiring Automation). Email and in-app tasks only for now.
- Code: `shared/flowEngine.ts` (steps, validator, routing, try-it-out), `api/_lib/flowApi.ts` (`flow-*` actions in `hiringRouter.ts`, no new Vercel function), `src/components/HiringAutomationModule.tsx`, `src/components/hiringflow/`, `src/services/flowService.ts`. Data: `hiringItems` kinds `flow` (with `familyId`), `flowFamily` (name and designations), `flowRun`, `flowTask`. Tests: `tests/flow.engine.test.ts`, `tests/flow.api.test.ts`.


### Automatic skills test

The **Skills test** step can be given by the app (the default for new steps) or by a person. For an app-given test, open the step and, under "The test questions", press **Make the test with AI**. The AI writes a multiple-choice test from the job description (the JD library first, then the requisition's JD). There is one test per job title, so everyone applying for the same job gets the same questions. HR can read and edit every question. When an applicant reaches the step, the flow emails a private link (`/?test=<token>`, needs `APP_BASE_URL`); the candidate takes the timed test once with no sign-in; the server marks it and stores the percentage as a normal assessment, and the flow passes or fails the applicant against the pass mark. Below the pass mark the step either follows the flow's "does not work out" path or asks a named person to decide. Links expire (Retry sends a fresh one), and a test started but never handed in is marked with the answers it has. The answer key and the secret link are never sent to the candidate's browser or to HR screens. API: `stest-*` actions in `skillTestApi.ts`; tests in `tests/skilltest.test.ts`.

## Offers, joining, probation, growth, AI and the founder dashboard

All of this is built inside the existing functions (still 9 of 12 on Vercel). Hiring routes are actions of `/api/recruitment/<action>`; probation, OKRs and promotions are actions of `/api/hrbp/<action>`.

- **Offers** (`api/_lib/offerApi.ts`, `shared/offerEngine.ts`): HR raises an offer from a candidate; a CTC above the job's band needs a written reason; the founder approves (or counters); the offer pack (letter, compensation breakup, joining checklist, NDA, employment agreement) is built from editable templates; the candidate answers on a private page (`/?offer=<token>`); accepting starts onboarding automatically. Reminders every 2 days, "no response" after 7 days, expiry on the valid-till date, joining reminders at 7 days and 1 day. **The NDA and employment agreement are generic drafts and must be reviewed by a lawyer.**
- **Joining board** (`joiningApi.ts`): documents and emergency contact status, welcome kit, IT setup (email, Microsoft 365, Google, Teams, ClickUp, attendance, payroll) and an asset register with unique tags.
- **Probation, OKRs, promotions, quarterly round** (`talentCycleApi.ts`, `shared/talentCycle.ts`): 30/60/90-day manager reviews with reminders, HR decision (confirm, extend, end); OKRs at company, team and individual level; promotion flow manager -> HR -> founder -> applied; one quarterly checklist. Applying a promotion changes the designation only; the salary revision is created by hand in Payroll. Probation KPI achievement is entered by the manager.
- **AI** (`aiHiringApi.ts`, `openaiHelper.ts`, `shared/resumeAi.ts`): resume reading (including scanned PDFs and photos), employment gaps and stability, duplicate detection and merge, candidate comparison, hiring recommendation, follow-up email drafts and a dashboard summary. The model only reads and writes language; scores and verdicts are fixed rules. Names are never sent to the AI and interview feedback counts only once the whole panel has submitted. With no key every feature falls back to rules.
- **Founder dashboard** (`analyticsApi.ts`, `shared/hiringAnalytics.ts`): vacancies, pipeline, time to hire, offer acceptance, cost per hire, upcoming joinings, budget vs actual, source effectiveness, attrition. Visible to company admins, the founder permission, `hrbp.view` and `hrbp.manage`.
- **Candidate screening link** (`screeningLinkApi.ts`): the candidate fills a short form and picks time slots on `/?screen=<token>`; status is Pending, Completed, Reschedule or No response (after 3 days).
- **Outside connections** (`integrations.ts`): Microsoft Teams meeting links and WhatsApp reminders switch on when their variables are set; Google Meet and ClickUp are manual. Everything works without them.
- **Daily job**: one cron, `/api/recruitment/hiring-daily` (needs `CRON_SECRET`), runs offer reminders and expiry, probation and quarterly reminders, interview reminders and the screening-link sweep.

Environment variables: `OPENAI_API_KEY`, `OPENAI_HIRING_MODEL` (optional, default gpt-4o-mini), `AI_MONTHLY_CALLS` (optional limit per company), `APP_BASE_URL` (the public address used in emailed links), `CRON_SECRET`, and optionally `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_ORGANIZER_UPN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`.
Existing roles need the permissions `hrbp.manage`, `hrbp.view` and `hiring.budget.manage` granted where HR and the founder should use these screens.

## Known limits

- Talent Acquisition, onboarding and AI candidate evaluation are per company. Companies other than
  `HOME_COMPANY_ID` take applications through their own webhook (`/api/apply/<id>`), manual entry or CSV import,
  and open jobs come from their requisitions. The home company keeps the original website and Google Sheet
  sources. Leave `HOME_COMPANY_ID` empty only if every company should use the built-in data.
- Webhook candidates give a resume link (no file upload). The webhook rate limit is per server instance.
- Onboarding records created before multi-company support have no `companyId`; they are treated as the home
  company's. Run `npx tsx scripts/backfill-onboarding-company.ts --company <id>` to tag them.
- Email is sent from one shared SMTP account for all companies.
- Leave: festival holidays must be added or imported each year; leave years anchored to each person's joining date,
  hourly leave, and days-worked earned leave are not built yet.
- Some screens and document stamps still say "Amaavigo".
- Old uploaded-file links have no signature; set `LEGACY_OPEN_STORAGE=true` while migrating, then off.
- Requisition step-by-step workflow rules are enforced in the app; the Firestore rules enforce tenant and
  permission checks only.

## Ask HR assistant

A floating "Ask HR" button (all roles) opens a chat panel; Ctrl+K search also offers "Ask HR: ...". Read-only: it answers about the person's own leave, holidays, notice period, payslips and the published policies they may read. Code: `api/_lib/assistantApi.ts` (tools run as the caller through the existing routers), `shared/assistantEngine.ts`, `src/components/assistant/`. Logs in `assistantLogs`, daily counts in `assistantUsage` (server-only). Env: `OPENAI_ASSISTANT_MODEL` (optional), `ASSISTANT_DAILY_LIMIT` (per person, default 30); it also counts against `AI_MONTHLY_CALLS`. Test: `npx tsx tests/assistant.engine.test.ts`.

## Flags (payroll checks, late marks, leave patterns)

One list for HR to review, in Leave & Attendance > Flags (the old Exceptions screen, extended). Detection is plain arithmetic in `shared/anomalyEngine.ts`; AI is optional and only writes a one-line "what to check" for new flags (same number check as Ask HR). Nothing is deducted, changed or sent to employees because of a flag.

- Payroll checks run each time a run is calculated (`payrollChecks` in `api/_lib/flagsApi.ts`) and compare with the previous month: net pay change, loss-of-pay jump, negative net, deductions over half of gross, large one-offs, people missing or new, shared bank account (compared as a hash, never stored or shown), total payroll change.
- Late marks and leave patterns run in the daily leave cron (`/api/leave/cron`) and on "Scan now": late marks and streaks, missing check-outs, leave next to a weekend or holiday, short sick leaves, leave applied after the fact.
- Stored in `leaveExceptions` (categories `FLAG_PAYROLL`, `FLAG_LATE`, `FLAG_LEAVE`); thresholds in `flagSettings/{companyId}` (server only). A reviewed flag stays quiet unless it gets worse or 90 days pass; a flag is closed automatically when a recalculation no longer finds it.
- Who sees what: payroll flags need `payroll.view` (read) or `payroll.manage` (review); late and leave flags need `leave.report` (read) or `leave.manage` (review and thresholds). Employees and managers see nothing. No new Vercel function.
- Tests: `npx tsx tests/anomaly.engine.test.ts`, `npx tsx tests/flags.api.test.ts`.
