import { z } from "zod";

/**
 * Who may do what. Roles come from the identity provider's groups
 * (docs/identity-and-access.md); the highest group a person is in wins.
 * - requester: sends requests and sees their own.
 * - operator: also works on every ticket (board, replies, assignment).
 * - admin: also edits the request form and its categories, and sees people.
 * - superadmin: also sets up email, Slack and the directory, and reads the audit log.
 */
export const ROLES = ["requester", "operator", "admin", "superadmin"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

const RANK: Record<Role, number> = { requester: 0, operator: 1, admin: 2, superadmin: 3 };

/** True when `role` includes everything `needed` may do. */
export function hasRole(role: Role | null | undefined, needed: Role): boolean {
  return role ? RANK[role] >= RANK[needed] : false;
}

/** Operators, admins and superadmins work on tickets and can be assigned. */
export const isStaff = (role: Role | null | undefined) => hasRole(role, "operator");

/** The highest of several roles, or null for none. */
export function highestRole(roles: Iterable<Role>): Role | null {
  let best: Role | null = null;
  for (const role of roles) if (!best || RANK[role] > RANK[best]) best = role;
  return best;
}

/** How a person hears about tickets assigned to them. */
export const NOTIFY_CHANNELS = ["email", "slack"] as const;
export const notifyChannelSchema = z.enum(NOTIFY_CHANNELS);
export type NotifyChannel = z.infer<typeof notifyChannelSchema>;
