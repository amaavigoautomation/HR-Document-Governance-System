# Security Specification & Threat Model
## HR Document Governance & Version Control Platform

### 1. Data Invariants

1. **Catch-All Default Deny**:
   - Any document outside explicitly declared collections (`employees`, `documents`, `versions`, `auditLogs`, `acknowledgments`, `notifications`) MUST be strictly inaccessible (`read, write: if false`).

2. **Immutable Audit Trail (`/auditLogs/{logId}`)**:
   - Audit records are write-once, append-only records.
   - Updates are permanently forbidden (`allow update: if false`).
   - Deletions are permanently forbidden (`allow delete: if false`).
   - Every log record must contain valid identifiers, action, timestamp, and actor details with bounded character lengths.

3. **Employee Identity & Role Integrity (`/employees/{employeeId}`)**:
   - Document ID must conform to standard identifier constraints (<= 128 characters, alphanumeric, hyphens, underscores).
   - Core identity fields (`id`, `empId`) are immutable once created.
   - Passwords, roles, and profiles must adhere to typed schemas with strict character limits (preventing denial-of-wallet resource poisoning).

4. **Document Master Governance (`/documents/{docId}`)**:
   - Documents require valid identifier formats, title (1–500 chars), category, confidentiality, and status.
   - Documents cannot be hijacked with unbounded payloads or phantom fields.

5. **Version Lifecycle & State Machine (`/versions/{versionId}`)**:
   - Versions belong to an existing document master.
   - Revisions must record valid semantic version numbers (`versionNumber`), author metadata, and allowed status codes (`DRAFT`, `IN_REVIEW`, `APPROVED`, `REJECTED`, `PUBLISHED`, `ARCHIVED`).

6. **Compliance Acknowledgment Invariance (`/acknowledgments/{ackId}`)**:
   - Acknowledgments record formal employee policy sign-offs.
   - Once a record has reached `status == 'ACKNOWLEDGED'`, it CANNOT be downgraded back to `PENDING` (Anti-Downgrade Invariant).
   - Sign-off timestamps and employee metadata must be non-empty and type-safe.

7. **Notification Bounds (`/notifications/{notifId}`)**:
   - System notifications must specify bounded titles, recipient targets, and boolean read states.

---

### 2. The "Dirty Dozen" Threat Payloads (Adversarial Test Suite)

| ID | Attack Vector | Target Path | Malicious Payload / Operation | Expected Response |
|---|---|---|---|---|
| **DD-01** | **Resource Poisoning (ID String Bomb)** | `/employees/{1.5KB_id}` | Attempt to inject a 1500-byte junk character string as a document ID | `PERMISSION_DENIED` |
| **DD-02** | **Privilege Escalation** | `/employees/AM007` | Update with `{ role: 'CREATOR', superAdmin: true, privileges: ['ALL'] }` bypassing schema | `PERMISSION_DENIED` |
| **DD-03** | **Immutable Identity Mutation** | `/employees/AM007` | Attempt to mutate `id` or `empId` from `AM007` to `HACKED01` | `PERMISSION_DENIED` |
| **DD-04** | **Title Resource Exhaustion (Denial-of-Wallet)** | `/documents/doc-bad` | Create a document master with a 500,000-character repetitive junk title | `PERMISSION_DENIED` |
| **DD-05** | **Unregistered Collection Injection** | `/system_secrets/keys` | Create `{ apiKey: 'stolen', adminToken: 'xyz' }` in undeclared path | `PERMISSION_DENIED` |
| **DD-06** | **Audit Log Tampering (History Rewrite)** | `/auditLogs/log-123` | Update an existing audit record to alter timestamp or actor name | `PERMISSION_DENIED` |
| **DD-07** | **Audit Log Deletion (Covering Tracks)** | `/auditLogs/log-123` | Send `delete` request to destroy compliance trace | `PERMISSION_DENIED` |
| **DD-08** | **Version Ghost Field Injection** | `/versions/ver-01` | Inject unauthorized executable payload or script tags into version properties | `PERMISSION_DENIED` |
| **DD-09** | **Version State Shortcutting** | `/versions/ver-01` | Set `approvalStatus: 'SUPER_BYPASS_APPROVED'` with invalid status enum | `PERMISSION_DENIED` |
| **DD-10** | **Compliance Acknowledgment Downgrade** | `/acknowledgments/ack_1` | Attempt to overwrite `status: 'ACKNOWLEDGED'` with `status: 'PENDING'` | `PERMISSION_DENIED` |
| **DD-11** | **Blank / Spoofed Acknowledgment Record** | `/acknowledgments/ack_2` | Create acknowledgment with empty documentId or null employeeId | `PERMISSION_DENIED` |
| **DD-12** | **Notification Spam Exhaustion** | `/notifications/notif_bad` | Create notification with 2MB junk text payload | `PERMISSION_DENIED` |

---

### 3. Verification & Compliance Matrix

- [x] Catch-all default deny implemented at root
- [x] Path variable sanitization (`isValidId`) applied on single-resource operations
- [x] `auditLogs` is strictly write-once (`update, delete: if false`)
- [x] `acknowledgments` forbids downgrade from `ACKNOWLEDGED` to `PENDING`
- [x] Length and size boundaries enforced on all string fields (preventing Denial-of-Wallet)
- [x] Frontend seed data isolated and decommissioned; dynamic database hydration enforced

---

## Multi-tenant addendum

- Identity is a Firebase ID token verified server-side (`Authorization: Bearer`); the old `x-user-role`
  header is gone.
- Tenant, company status and permissions are custom claims (`cid`, `cs`, `perms`, `adm`, `pa`) written only
  by the server. Firestore rules require `cs == 'ACTIVE'` and a matching `companyId` for every read/write.
- `companies`, `employees`, `roles`, `departments` are server-write only. `auditLogs` are append-only.
- A PENDING or SUSPENDED company has no permissions in its token and cannot read company data.
- Privilege escalation: roles can only contain permissions the editing user holds; the last company admin
  cannot be removed.
- Passwords are never stored in Firestore.
- Uploaded files are served with HMAC-signed links.
