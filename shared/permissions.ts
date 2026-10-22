/**
 * Shared permission model (used by the browser, the API and the migration scripts).
 * Pure TypeScript - no browser or Node imports - so it can be imported from anywhere.
 */

export type ModuleKey = 'document-version-control' | 'talent-acquisition';

/** Legacy portal each role opens in. Keeps the existing HR / Approver / Employee screens working. */
export type Portal = 'CREATOR' | 'REVIEWER' | 'EMPLOYEE';

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  /** Module that must be enabled for the company for this permission to be usable. Omit for core permissions. */
  module?: ModuleKey;
}

export const PERMISSIONS: PermissionDef[] = [
  // Document governance
  { key: 'doc.create', label: 'Create documents and versions', group: 'Documents', module: 'document-version-control' },
  { key: 'doc.review', label: 'Review, approve or reject versions', group: 'Documents', module: 'document-version-control' },
  { key: 'doc.publish', label: 'Publish approved versions', group: 'Documents', module: 'document-version-control' },
  { key: 'doc.delete', label: 'Delete documents', group: 'Documents', module: 'document-version-control' },
  { key: 'doc.acknowledge', label: 'Acknowledge policies', group: 'Documents', module: 'document-version-control' },
  { key: 'doc.suggest', label: 'Submit policy suggestions', group: 'Documents', module: 'document-version-control' },
  { key: 'compliance.view', label: 'View compliance tracking', group: 'Documents', module: 'document-version-control' },
  { key: 'audit.view', label: 'View audit log', group: 'Documents', module: 'document-version-control' },

  // Hiring
  { key: 'req.create', label: 'Raise hiring requisitions', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'req.view_all', label: 'View all requisitions', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'req.assign', label: 'Assign requisitions to an HR owner', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'req.hr_decide', label: 'Approve or reject requisitions as HR', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'req.founder_decide', label: 'Give final approval on requisitions', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'req.manage_jd', label: 'Edit, publish and close job descriptions', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'talent.view', label: 'View talent acquisition overview', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'candidate.evaluate', label: 'Run AI candidate evaluation', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'onboarding.manage', label: 'Run candidate onboarding', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'assess.manage', label: 'Create, send and retest skill assessments', group: 'Hiring', module: 'talent-acquisition' },
  { key: 'assess.view', label: 'View skill assessment results', group: 'Hiring', module: 'talent-acquisition' },

  // Administration
  { key: 'users.manage', label: 'Add, edit and deactivate users', group: 'Administration' },
  { key: 'departments.manage', label: 'Manage departments', group: 'Administration' },
  { key: 'roles.manage', label: 'Create and edit roles', group: 'Administration' },
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

export const MODULES: { key: ModuleKey; label: string }[] = [
  { key: 'document-version-control', label: 'Document Version Control' },
  { key: 'talent-acquisition', label: 'Talent Acquisition' },
];

export const ALL_MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key);

export interface RoleDef {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  permissions: string[];
  portal: Portal;
  /** Company admin role: always keeps every permission and cannot be edited or deleted. */
  isAdmin?: boolean;
  /** Seeded from a default template (still editable unless isAdmin). */
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleTemplate {
  slug: string;
  name: string;
  description: string;
  portal: Portal;
  isAdmin?: boolean;
  permissions: string[];
}

/** Templates seeded for every new company. Admins can edit them (except Company Admin) or add their own roles. */
export const DEFAULT_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    slug: 'company-admin',
    name: 'Company Admin',
    description: 'Full access, including users, departments and roles.',
    portal: 'CREATOR',
    isAdmin: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    slug: 'hr-head',
    name: 'Head HR',
    description: 'Leads HR: assigns requisitions and manages people.',
    portal: 'CREATOR',
    permissions: [
      'doc.create', 'doc.publish', 'doc.delete', 'compliance.view', 'audit.view',
      'req.create', 'req.view_all', 'req.assign', 'req.hr_decide', 'req.manage_jd',
      'talent.view', 'candidate.evaluate', 'onboarding.manage', 'assess.manage', 'assess.view',
      'users.manage', 'departments.manage', 'doc.acknowledge', 'doc.suggest',
    ],
  },
  {
    slug: 'hr',
    name: 'HR',
    description: 'Handles documents, hiring and onboarding.',
    portal: 'CREATOR',
    permissions: [
      'doc.create', 'compliance.view',
      'req.create', 'req.hr_decide', 'req.manage_jd',
      'talent.view', 'candidate.evaluate', 'onboarding.manage', 'assess.manage', 'assess.view',
      'doc.acknowledge', 'doc.suggest',
    ],
  },
  {
    slug: 'approver',
    name: 'Approver / Founder',
    description: 'Reviews and publishes policies, gives final hiring approval.',
    portal: 'REVIEWER',
    permissions: [
      'doc.review', 'doc.publish', 'compliance.view', 'audit.view',
      'req.view_all', 'req.assign', 'req.founder_decide', 'talent.view', 'assess.view',
      'doc.acknowledge', 'doc.suggest',
    ],
  },
  {
    slug: 'department-head',
    name: 'Department Head',
    description: 'Can raise hiring requisitions for their team.',
    portal: 'EMPLOYEE',
    permissions: ['req.create', 'doc.acknowledge', 'doc.suggest'],
  },
  {
    slug: 'employee',
    name: 'Employee',
    description: 'Reads and acknowledges policies.',
    portal: 'EMPLOYEE',
    permissions: ['doc.acknowledge', 'doc.suggest'],
  },
];

const PORTAL_RANK: Record<Portal, number> = { CREATOR: 3, REVIEWER: 2, EMPLOYEE: 1 };

export function isKnownPermission(key: string): boolean {
  return ALL_PERMISSION_KEYS.includes(key);
}

export function permissionModule(key: string): ModuleKey | undefined {
  return PERMISSIONS.find((p) => p.key === key)?.module;
}

/** Union of permissions across roles, restricted to the modules the company has enabled. */
export function effectivePermissions(roles: Pick<RoleDef, 'permissions' | 'isAdmin'>[], enabledModules: string[]): string[] {
  const set = new Set<string>();
  for (const role of roles) {
    const source = role.isAdmin ? ALL_PERMISSION_KEYS : role.permissions;
    for (const key of source) {
      if (!isKnownPermission(key)) continue;
      const mod = permissionModule(key);
      if (mod && !enabledModules.includes(mod)) continue;
      set.add(key);
    }
  }
  return Array.from(set).sort();
}

/** Highest portal among the user's roles (HR > Approver > Employee). */
export function portalForRoles(roles: Pick<RoleDef, 'portal'>[]): Portal {
  let best: Portal = 'EMPLOYEE';
  for (const r of roles) {
    if (PORTAL_RANK[r.portal] > PORTAL_RANK[best]) best = r.portal;
  }
  return best;
}

export function hasPerm(perms: string[] | undefined | null, key: string): boolean {
  return !!perms && perms.includes(key);
}

export function hasAnyPerm(perms: string[] | undefined | null, keys: string[]): boolean {
  return !!perms && keys.some((k) => perms.includes(k));
}

/** Modules a user can open, based on their permissions. */
export function modulesForPerms(perms: string[] | undefined | null): ModuleKey[] {
  const out: ModuleKey[] = [];
  const list = perms || [];
  if (list.some((p) => permissionModule(p) === 'document-version-control')) out.push('document-version-control');
  if (list.some((p) => permissionModule(p) === 'talent-acquisition')) out.push('talent-acquisition');
  return out;
}

/**
 * Custom claims written to the Firebase ID token. Kept deliberately small (the hard limit is 1000 bytes).
 *  cid  company id            cs  company status (PENDING | ACTIVE | SUSPENDED)
 *  perms permission keys      adm company admin flag        pa  platform admin flag
 */
export interface TenantClaims {
  cid?: string;
  cs?: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  perms?: string[];
  adm?: boolean;
  pa?: boolean;
}

export const CLAIMS_BYTE_LIMIT = 900;

export function claimsFitLimit(claims: TenantClaims): boolean {
  return JSON.stringify(claims).length <= CLAIMS_BYTE_LIMIT;
}

/** Roles a user may grant: every permission in the role must already be held by the actor (no privilege escalation). */
export function canGrantPermissions(actorPerms: string[], actorIsAdmin: boolean, requested: string[]): boolean {
  if (actorIsAdmin) return requested.every(isKnownPermission);
  return requested.every((k) => isKnownPermission(k) && actorPerms.includes(k));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
