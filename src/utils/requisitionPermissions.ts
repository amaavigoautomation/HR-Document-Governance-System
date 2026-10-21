import { Requisition, User, UserRole } from '../types';
import { hasPerm } from '../../shared/permissions';

/**
 * Single source of truth for who may do what in the hiring-requisition flow.
 *
 * Decisions are driven by the permissions on the user's roles (see shared/permissions.ts), which the
 * server stamps onto their sign-in token. Company admins can change who holds which permission by
 * editing roles - nothing here is tied to a job title.
 *
 *   req.create          raise requisitions
 *   req.view_all        see every requisition in the company (otherwise only your own)
 *   req.assign          assign / reassign the HR owner
 *   req.hr_decide       be an HR owner who approves or rejects
 *   req.founder_decide  give the final approval
 *   req.manage_jd       edit, publish and close the job description (as the HR owner)
 */

export type RequisitionAction =
  | 'create'
  | 'view'
  | 'assign' // assign / reassign an HR owner
  | 'hrDecide'
  | 'founderDecide'
  | 'editJd'
  | 'publish'
  | 'close';

const perms = (u?: User | null) => u?.perms;

export const isFounder = (u?: User | null): boolean => !!u && hasPerm(perms(u), 'req.founder_decide');
export const isHr = (u?: User | null): boolean => !!u && hasPerm(perms(u), 'req.hr_decide');
export const canAssign = (u?: User | null): boolean => !!u && hasPerm(perms(u), 'req.assign');
/** People who may raise a requisition for their team but are not HR or an approver. */
export const isDepartmentHead = (u?: User | null): boolean =>
  !!u && u.role === UserRole.EMPLOYEE && hasPerm(perms(u), 'req.create');

export const sameUser = (a?: { id?: string } | null, b?: { id?: string } | null): boolean =>
  !!a?.id && !!b?.id && a.id === b.id;

export function can(user: User | null | undefined, action: RequisitionAction, req?: Requisition | null): boolean {
  if (!user) return false;
  const p = perms(user);

  switch (action) {
    case 'create':
      return hasPerm(p, 'req.create');

    case 'view':
      if (!req) return hasPerm(p, 'req.view_all') || hasPerm(p, 'req.create') || isHr(user) || isFounder(user);
      if (hasPerm(p, 'req.view_all')) return true;
      if (isHr(user)) return sameUser(req.ownerHr, user) || sameUser(req.raisedBy, user);
      return sameUser(req.requestedBy, user) || sameUser(req.raisedBy, user);

    case 'assign':
      return canAssign(user) && !!req && req.status !== 'REJECTED' && req.status !== 'CLOSED';

    case 'hrDecide':
      return isHr(user) && !!req && req.status === 'PENDING_HR' && sameUser(req.ownerHr, user);

    case 'founderDecide':
      return isFounder(user) && !!req && req.status === 'PENDING_FOUNDER';

    case 'editJd':
      return hasPerm(p, 'req.manage_jd') && !!req && sameUser(req.ownerHr, user) && (req.status === 'JD_DRAFT' || req.status === 'JOB_OPEN');

    case 'publish':
      return hasPerm(p, 'req.manage_jd') && !!req && sameUser(req.ownerHr, user) && req.status === 'JD_DRAFT' && !!req.jd?.text.trim();

    case 'close':
      return hasPerm(p, 'req.manage_jd') && !!req && sameUser(req.ownerHr, user) && req.status === 'JOB_OPEN';

    default:
      return false;
  }
}

export const STATUS_LABEL: Record<Requisition['status'], string> = {
  PENDING_ASSIGNMENT: 'Awaiting assignment',
  PENDING_HR: 'With HR',
  PENDING_FOUNDER: 'With founder',
  JD_DRAFT: 'JD in progress',
  JOB_OPEN: 'Job open',
  REJECTED: 'Rejected',
  CLOSED: 'Closed',
};

/** Whose turn is it? Used for the "Needs my action" filter. */
export function needsMyAction(user: User | null | undefined, req: Requisition): boolean {
  return (
    can(user, 'hrDecide', req) ||
    can(user, 'founderDecide', req) ||
    (req.status === 'PENDING_ASSIGNMENT' && can(user, 'assign', req)) ||
    (req.status === 'JD_DRAFT' && can(user, 'editJd', req))
  );
}
