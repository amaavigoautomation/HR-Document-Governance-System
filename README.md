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

## Known limits

- Talent Acquisition, onboarding and AI candidate evaluation are per company. Companies other than
  `HOME_COMPANY_ID` take applications through their own webhook (`/api/apply/<id>`), manual entry or CSV import,
  and open jobs come from their requisitions. The home company keeps the original website and Google Sheet
  sources. Leave `HOME_COMPANY_ID` empty only if every company should use the built-in data.
- Webhook candidates give a resume link (no file upload). The webhook rate limit is per server instance.
- Onboarding records created before multi-company support have no `companyId`; they are treated as the home
  company's. Run `npx tsx scripts/backfill-onboarding-company.ts --company <id>` to tag them.
- Email is sent from one shared SMTP account for all companies.
- Some screens and document stamps still say "Amaavigo".
- Old uploaded-file links have no signature; set `LEGACY_OPEN_STORAGE=true` while migrating, then off.
- Requisition step-by-step workflow rules are enforced in the app; the Firestore rules enforce tenant and
  permission checks only.
