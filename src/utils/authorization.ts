import { User, UserRole } from '../types';

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
 * Checks if a given user is authorized to access a specific module
 */
export function hasModulePermission(
  user: User | null | undefined,
  module: 'talent-acquisition' | 'document-version-control'
): boolean {
  if (!user) return false;
  // Employees only access Employee Portal
  if (user.role === UserRole.EMPLOYEE) {
    return false;
  }

  const code = normalizeAuthorizedModules(user.authorizedModules);
  if (code === 'ALL') return true;

  if (module === 'talent-acquisition') {
    return code === 'TALENT_ACQUISITION';
  }

  if (module === 'document-version-control') {
    return code === 'DOCUMENT_VERSION_CONTROL';
  }

  return false;
}

/**
 * Returns list of modules the user is allowed to access
 */
export function getAuthorizedModulesList(
  user: User | null | undefined
): AuthorizedModuleType[] {
  if (!user || user.role === UserRole.EMPLOYEE) return [];
  const code = normalizeAuthorizedModules(user.authorizedModules);

  if (code === 'ALL') {
    return ['talent-acquisition', 'document-version-control'];
  }
  if (code === 'TALENT_ACQUISITION') {
    return ['talent-acquisition'];
  }
  if (code === 'DOCUMENT_VERSION_CONTROL') {
    return ['document-version-control'];
  }
  return ['talent-acquisition', 'document-version-control'];
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
