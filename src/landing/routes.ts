/**
 * Tiny path-based router for the public marketing pages. The app has no router library, so the
 * marketing site keeps its own `path` state and moves between pages with the History API.
 * Every path here is public; anything else still goes to the sign-in screen.
 */
export const MODULE_KEYS = ['hiring', 'leave', 'payroll', 'performance', 'people', 'policies', 'tasks'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

const STATIC_PATHS = ['/', '/modules', '/smart-features', '/security', '/how-it-works'];

export function normalizePath(path: string): string {
  const clean = (path || '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

export function moduleKeyFromPath(path: string): ModuleKey | null {
  const match = /^\/modules\/([a-z-]+)$/.exec(normalizePath(path));
  if (!match) return null;
  return (MODULE_KEYS as readonly string[]).includes(match[1]) ? (match[1] as ModuleKey) : null;
}

/** True for every page the marketing site can show. App.tsx uses this to decide when to show it. */
export function isMarketingPath(path: string): boolean {
  const p = normalizePath(path);
  return STATIC_PATHS.includes(p) || moduleKeyFromPath(p) !== null;
}

export const NAVIGATE_EVENT = 'lp:navigate';

export function navigate(to: string): void {
  if (normalizePath(window.location.pathname) === normalizePath(to) && !to.includes('#')) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}
