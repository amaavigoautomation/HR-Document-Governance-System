# HR Portal (multi-tenant)

Companies sign themselves up, wait for approval, then onboard their own employees, departments and
custom roles. Built on Vite + React, Express / Vercel functions, Firestore and Firebase Authentication.

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

## Performance Management

Sidebar item "Performance". Everyone sees their own goals (KRA/KPI), reviews, SOPs, check-ins and development plans;
managers get their team (set targets, verify evidence, review); HR (`perf.manage`) sets everything up and runs
calibration; `perf.approve` gives plan and final review approval; `perf.view` gives read-only aggregated dashboards.
Existing roles need these permissions added in Administration (new companies get them in the Head HR, HR and
Approver templates).

- Three pillars are scored separately: KRA/KPI (results), Behaviour (competencies) and SOP compliance. Default weights
  60 / 25 / 15 are a proposal: HR edits and approves a framework (weights must total 100) before it is used.
- Never guessed: no role family, framework, approved template or manager means the plan or review waits as
  "Needs configuration" with the reason, and an exception is raised for HR. KPI targets are always entered by people.
- "Not observed" and "insufficient evidence" are left out of the score, never counted as 0 or 3. Task counts and
  login hours never become ratings. Critical SOP misses are reported separately from the average.
- Review flow: self-assessment, manager assessment, feedback discussion, HR review/calibration (every change needs a
  reason), final approval, publish, employee acknowledges or disagrees (disputes go to someone other than the manager).
  Nobody approves their own review and the evaluating manager cannot give the final approval. Employees only see
  scores after publication. Finalised reviews can be amended only by an authorised person, with a reason and an audit record.
- Plans, frameworks, SOP versions and competency versions are copied into each review, so later changes never
  rewrite history. Plans are effective-dated; a manager or department change starts a new plan.
- SOPs link to published documents in Document Governance. A minor revision keeps the earlier acknowledgement; a
  major one needs it again.
- AI (optional, `OPENAI_API_KEY`, `PERF_AI=off` to disable) only restates cited evidence for the manager to edit
  and suggests clearer KPI wording without changing numbers. Sentences without evidence references or that infer
  personality, health, family and similar are dropped. Conduct and safety concerns are referred to the confidential HR
  process; only the fact of the referral is recorded.
- Daily job: schedule `GET /api/perf/cron?key=$CRON_SECRET` (same `CRON_SECRET` as leave). It builds missing plans,
  syncs SOP assignments and versions, creates monthly check-ins, retries reviews waiting on configuration, sends
  reminders and raises overdue items. Every step is idempotent, so a repeat run changes nothing.
- Task tool evidence (optional): Setup > Get started shows a per-company webhook key. `POST /api/perf/evidence-hook`
  with header `x-webhook-key` and `{externalId, employeeEmail, kpiCode, description, reference, value, occurredAt}`
  records pending evidence for the manager to verify. Repeated deliveries and unmatched events are logged, not scored.
- Dashboards show group results only where at least 3 reviews are finished. Consistency checks (uniform scores,
  manager outliers, large self/final gaps, thin evidence) are prompts for a person to look, not verdicts.
- Runs as its own Vercel function (`api/perf/[action].ts`, the 12th: the Hobby limit). Notifications are email plus in-app.
- Collections (server-only; deploy the updated `firestore.rules`): `perfSettings`, `perfFrameworks`, `perfCycles`,
  `perfSops`, `perfSopAssignments`, `perfTemplates`, `perfPlans`, `perfEvidence`, `perfReviews`, `perfCheckins`,
  `perfDevPlans`, `perfAudit`, `perfExceptions`, `perfNotifications`.
- The reporting manager comes from the leave profile (Leave > Setup > People). The 5-point scale and competency
  list are starting points from the framework document; confirm with HR and leadership.

**Moodometer** (Performance → Moodometer)
- Voluntary and self-reported. Reuses the Home mood check-ins (`moodCheckins`, one answer per person per day, changeable until midnight). There is no free-text note.
- Employees see their own answer and last 30 days. Managers see a combined result for their direct reports; HR (`perf.manage` / `perf.approve` / `perf.view`) sees company-wide trend (7/30/90 days), department breakdown, participation and a CSV export.
- Anonymous: results are only shown for groups of at least 3 different people. No names anywhere.
- If a department averages low for 3 days in a row, HR gets a group-level "Low team mood" exception from the daily cron.
- Never used in ratings, scores, reviews or AI drafts.


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
