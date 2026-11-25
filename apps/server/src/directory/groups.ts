import { highestRole, type Role } from "@helpdesk/shared/roles";
import { config } from "../config";

/** The group of each role (GROUP_* settings); null: no group gives that role. */
export function roleGroups(): Record<Role, string | null> {
  const settings = config();
  return {
    requester: settings.GROUP_REQUESTERS,
    operator: settings.GROUP_OPERATORS,
    admin: settings.GROUP_ADMINS,
    superadmin: settings.GROUP_SUPERADMINS,
  };
}

/** Group paths and names compare without leading or trailing slashes. */
const normalize = (group: string) => group.trim().replace(/^\/+|\/+$/g, "");

/** True when `member` is `group` or one of its subgroups (`/a/b` is in `/a`). */
export function inGroup(member: string, group: string): boolean {
  const a = normalize(member);
  const b = normalize(group);
  return b !== "" && (a === b || a.startsWith(`${b}/`));
}

/** The highest role any of these groups gives, or null. */
export function roleFromGroups(memberOf: readonly string[], groups = roleGroups()): Role | null {
  const roles: Role[] = [];
  for (const [role, group] of Object.entries(groups) as [Role, string | null][]) {
    if (group && memberOf.some((member) => inGroup(member, group))) roles.push(role);
  }
  return highestRole(roles);
}

/** A groups claim as a list: an array of strings, or one string. */
export function claimGroups(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}
