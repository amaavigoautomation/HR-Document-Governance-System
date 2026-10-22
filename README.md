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

## Skill assessments

AI-written multiple-choice tests with a percentage score per skill (Talent Acquisition > Skill assessments).

- **Onboarding test:** on a candidate's onboarding screen, HR clicks "Send skill test", types any skills (technical or
  not) and the candidate gets a private link (`/assessment?token=...`). The result is saved as their baseline.
- **Retest:** HR picks an employee and clicks "Retest". The new test has the same skills and difficulty mix with
  different questions, and the report shows the change per skill in percentage points.
- Questions are written by OpenAI the first time a skill is tested and then reused from the company's question bank
  (HR can switch off any question). Needs `OPENAI_API_KEY`; optional `OPENAI_ASSESSMENT_MODEL`.
- Permissions: `assess.manage` (create, resend, cancel, retest, edit bank) and `assess.view` (read results). Company
  admins get both automatically; add them to other roles in Administration > Roles.
- Everything is stored per company in `assessments` and `assessmentQuestions`, readable only through the server
  (`/api/assess/*`), so correct answers never reach the browser. Deploy the updated `firestore.rules`.
- On Vercel the `/api/assess` function is allowed 60 seconds because the first test for a new skill waits for the AI.

## Known limits

- Google Sheet, careers API, onboarding and AI candidate evaluation use one global configuration, so they
  are limited to the `HOME_COMPANY_ID` company.
- Email is sent from one shared SMTP account for all companies.
- Some screens and document stamps still say "Amaavigo".
- Old uploaded-file links have no signature; set `LEGACY_OPEN_STORAGE=true` while migrating, then off.
- Requisition step-by-step workflow rules are enforced in the app; the Firestore rules enforce tenant and
  permission checks only.
