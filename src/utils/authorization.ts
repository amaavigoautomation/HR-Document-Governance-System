import { User, UserRole } from '../types';
import { modulesForPerms } from '../../shared/permissions';

export type AuthorizedModuleType = 'talent-acquisition' | 'document-version-control';

export type ModuleAuthorizationCode =
  | 'ALL'
  | 'TALENT_ACQUISITION'
  | 'DOCUMENT_VERSION_CONTROL';

/**
 * Normalizes any database format of authorizedModules into a canonical code:
 * 'ALL' | 'TALENT_ACQUISITION' | 'DOCUMENT_VERSION_CONTROL'
 */
export function normalizeAuthorizedModules(
  authorizedModules?: string | string[] | null
): ModuleAuthorizationCode {
  if (!authorizedModules) return 'ALL';

  if (Array.isArray(authorizedModules)) {
    const lowerList = authorizedModules.map((m) => String(m).toLowerCase().trim());
    const hasTalent = lowerList.some(
      (m) => m.includes('talent') || m === 'talent_acquisition' || m === 'talent-acquisition'
    );
    const hasDoc = lowerList.some(
      (m) =>
        m.includes('document') ||
        m.includes('version') ||
        m.includes('doc') ||
        m === 'document_version_control' ||
        m === 'document-version-control'
    );
    const hasAll = lowerList.some((m) => m === 'all' || m === 'all_modules' || m === '*');

    if (hasAll || (hasTalent && hasDoc)) return 'ALL';
    if (hasTalent) return 'TALENT_ACQUISITION';
    if (hasDoc) return 'DOCUMENT_VERSION_CONTROL';
    return 'ALL';
  }

  const str = String(authorizedModules).toUpperCase().trim();
  if (
    str === 'TALENT_ACQUISITION' ||
    str === 'TALENT' ||
    str === 'TALENT-ACQUISITION' ||
    str === 'TALENT_ACQ' ||
    str === 'RECRUITMENT'
  ) {
    return 'TALENT_ACQUISITION';
  }

  if (
    str === 'DOCUMENT_VERSION_CONTROL' ||
    str === 'DOCUMENT' ||
    str === 'DOC' ||
    str === 'DOCUMENT-VERSION-CONTROL' ||
    str === 'DOC_VERSION_CONTROL' ||
    str === 'DOCGOV'
  ) {
    return 'DOCUMENT_VERSION_CONTROL';
  }

  return 'ALL';
}

/**
 * Whether a user can open a module. Driven by the permissions on their company roles (see
 * shared/permissions.ts): a module is available when they hold at least one permission that belongs to it.
 * Employees use the Employee Portal rather than these modules.
 */
export function hasModulePermission(
  user: User | null | undefined,
  module: 'talent-acquisition' | 'document-version-control'
): boolean {
  if (!user) return false;
  if (user.role === UserRole.EMPLOYEE) return false;
  return modulesForPerms(user.perms).includes(module);
}

/**
 * Returns list of modules the user is allowed to access
 */
export function getAuthorizedModulesList(
  user: User | null | undefined
): AuthorizedModuleType[] {
  if (!user || user.role === UserRole.EMPLOYEE) return [];
  return modulesForPerms(user.perms);
}

/**
 * Human-readable label for authorization setting
 */
export function getAuthorizationLabel(
  authorizedModules?: string | string[] | null
): string {
  const code = normalizeAuthorizedModules(authorizedModules);
  switch (code) {
    case 'TALENT_ACQUISITION':
      return 'Talent Acquisition';
    case 'DOCUMENT_VERSION_CONTROL':
      return 'Document Version Control';
    case 'ALL':
    default:
      return 'All Modules';
  }
}

/**
 * Short badge text
 */
export function getAuthorizationBadgeText(
  authorizedModules?: string | string[] | null
): string {
  const code = normalizeAuthorizedModules(authorizedModules);
  switch (code) {
    case 'TALENT_ACQUISITION':
      return 'Talent Acq Only';
    case 'DOCUMENT_VERSION_CONTROL':
      return 'Doc Version Control';
    case 'ALL':
    default:
      return 'All Modules';
  }
}
