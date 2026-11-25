import { and, eq, notInArray, sql } from "drizzle-orm";
import type { User } from "@helpdesk/shared/api/users";
import type { Role } from "@helpdesk/shared/roles";
import { config } from "../config";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { logger } from "../logger";

/**
 * Makes every address in SUPERADMIN_EMAILS a superadmin, so the first person
 * can sign in before the groups exist and an installation can always be
 * recovered.
 */
export async function ensureEnvironmentSuperadmins(db: Db) {
  const emails = config().superadminEmails;
  // Addresses taken out of SUPERADMIN_EMAILS lose the role; their groups
  // decide again at the next sign-in or directory sync.
  await db
    .update(users)
    .set({ role: null, roleSource: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(users.roleSource, "environment"),
        emails.length > 0 ? notInArray(users.email, emails) : sql`true`,
      ),
    );
  for (const email of emails) {
    await db
      .insert(users)
      .values({ email, name: "", role: "superadmin", roleSource: "environment", roleCheckedAt: new Date() })
      .onConflictDoUpdate({
        target: users.email,
        set: { role: "superadmin", roleSource: "environment", updatedAt: sql`now()` },
      });
  }
  if (config().superadminEmails.length > 0)
    logger.info({ count: config().superadminEmails.length }, "superadmins from SUPERADMIN_EMAILS ensured");
}

export function isEnvironmentSuperadmin(email: string): boolean {
  return config().superadminEmails.includes(email.toLowerCase());
}

export type RoleSource = NonNullable<User["roleSource"]>;

/** A person's role and where it came from: SUPERADMIN_EMAILS first, then their groups. */
export function grantedRole(
  email: string,
  fromGroups: Role | null,
  source: Exclude<RoleSource, "environment">,
): { role: Role | null; roleSource: RoleSource | null } {
  if (isEnvironmentSuperadmin(email)) return { role: "superadmin", roleSource: "environment" };
  return fromGroups ? { role: fromGroups, roleSource: source } : { role: null, roleSource: null };
}
