import { Requisition, User, UserRole } from '../types';

/**
 * Single source of truth for who may do what in the hiring-requisition flow.
 *
 * NOTE: Until real authentication is introduced these checks are enforced in the UI and
 * the service layer only. Keep every check here so it can later be mirrored server-side.
 *
 * Role mapping:
 *  - Founder      -> UserRole.REVIEWER (the existing approver accounts)
 *  - HR           -> UserRole.CREATOR  (hrLevel 'HEAD' = Head HR, otherwise standard HR)
 *  - Dept head    -> UserRole.EMPLOYEE with isDepartmentHead = true
 */

export type RequisitionAction =
  | 'create'
  | 'view'
  | 'assign' // assign / reassign an HR owner
  | 'hrDecide'
  | 'founderDecide'
  | 'editJd'
  | 'publish'
  | 'close'
  | 'manageRoles';

export const isFounder = (u?: User | null): boolean => !!u && u.role === UserRole.REVIEWER;
export const isHr = (u?: User | null): boolean => !!u && u.role === UserRole.CREATOR;
export const isHeadHr = (u?: User | null): boolean => isHr(u) && u?.hrLevel === 'HEAD';
export const isDepartmentHead = (u?: User | null): boolean =>
  !!u && u.role === UserRole.EMPLOYEE && u.isDepartmentHead === true;

export const sameUser = (a?: { id?: string } | null, b?: { id?: string } | null): boolean =>
  !!a?.id && !!b?.id && a.id === b.id;

export function can(user: User | null | undefined, action: RequisitionAction, req?: Requisition | null): boolean {
  if (!user) return false;

  switch (action) {
    case 'create':
      // Department heads raise requests; HR / founder may raise one on someone's behalf
      return isDepartmentHead(user) || isHr(user) || isFounder(user);

    case 'view':
      if (!req) return isHr(user) || isFounder(user) || isDepartmentHead(user);
      if (isFounder(user) || isHeadHr(user)) return true;
      if (isHr(user)) return sameUser(req.ownerHr, user) || sameUser(req.raisedBy, user);
      return sameUser(req.requestedBy, user) || sameUser(req.raisedBy, user);

    case 'assign':
      // Head HR assigns; founder can also assign so the flow never deadlocks when no Head HR exists yet
      return (
        (isHeadHr(user) || isFounder(user)) &&
        !!req &&
        req.status !== 'REJECTED' &&
        req.status !== 'CLOSED'
      );

    case 'hrDecide':
      return isHr(user) && !!req && req.status === 'PENDING_HR' && sameUser(req.ownerHr, user);

    case 'founderDecide':
      return isFounder(user) && !!req && req.status === 'PENDING_FOUNDER';

    case 'editJd':
      return isHr(user) && !!req && sameUser(req.ownerHr, user) && (req.status === 'JD_DRAFT' || req.status === 'JOB_OPEN');

    case 'publish':
      return isHr(user) && !!req && sameUser(req.ownerHr, user) && req.status === 'JD_DRAFT' && !!req.jd?.text.trim();

    case 'close':
      return isHr(user) && !!req && sameUser(req.ownerHr, user) && req.status === 'JOB_OPEN';

    case 'manageRoles':
      return isFounder(user) || isHeadHr(user);

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
