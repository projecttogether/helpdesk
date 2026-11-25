import { and, eq, isNull, ne, or, sql, TransactionRollbackError } from "drizzle-orm";
import { roleSchema, type Role } from "@helpdesk/shared/roles";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { logger } from "../logger";
import { jwtClaims } from "./claims";
import { roleFromGroups } from "./groups";
import { grantedRole, isEnvironmentSuperadmin } from "./superadmins";

export type SignInTokens = { idToken?: string | null; accessToken?: string | null };

/** Where the groups of a person signing in come from: one adapter per DIRECTORY mode. */
export type SignInGroups = {
  /** Recorded as the source of a role from these groups. */
  source: "directory" | "sign_in";
  read(claims: Record<string, unknown>, subject: string, tokens: SignInTokens): Promise<string[]>;
  /** When the groups cannot be read, a person already bound to the subject keeps their last role. */
  keepRoleWhenUnreadable: boolean;
};

/** A person stays bound to the first provider subject they signed in with. */
const boundToOther = (directoryId: string | null, subject: string) =>
  Boolean(directoryId) && directoryId !== subject;

export async function ownsSubject(userId: string, subject: string): Promise<boolean> {
  const [existing] = await getDb()
    .select({ directoryId: users.directoryId })
    .from(users)
    .where(eq(users.id, userId));
  return !boundToOther(existing?.directoryId ?? null, subject);
}

/**
 * Decides a person's role at sign-in from their groups, stores it, and
 * returns it (null: no access, no session). SUPERADMIN_EMAILS come first.
 */
export async function admit(
  groups: SignInGroups,
  userId: string,
  tokens: SignInTokens,
): Promise<Role | null> {
  const claims = jwtClaims(tokens.idToken);
  const subject = claims?.sub;
  // Better Auth verifies an ID token when it is present. Require one in
  // this exchange so roles cannot follow a stale token or a different account.
  if (!claims || typeof subject !== "string" || !subject) return null;

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || boundToOther(user.directoryId, subject)) return null;

  let fromGroups: Role | null = null;
  try {
    if (!isEnvironmentSuperadmin(user.email)) {
      fromGroups = roleFromGroups(await groups.read(claims, subject, tokens));
    }
  } catch {
    // Request errors can include an invalid Authorization header value.
    logger.warn({ userId }, "could not read the groups at sign-in");
    return groups.keepRoleWhenUnreadable && user.directoryId === subject
      ? (roleSchema.safeParse(user.role).data ?? null)
      : null;
  }
  const { role, roleSource } = grantedRole(user.email, fromGroups, groups.source);

  const updated = await db
    .transaction(async (tx) => {
      // The provider's subject moved to this person (e.g. their email changed):
      // the older entry loses the binding and its role.
      await tx
        .update(users)
        .set({ directoryId: null, role: null, roleSource: null, updatedAt: sql`now()` })
        .where(and(eq(users.directoryId, subject), ne(users.id, userId)));
      // Do not let concurrent sign-ins bind one local user to different subjects.
      const [row] = await tx
        .update(users)
        .set({
          role,
          roleSource,
          roleCheckedAt: sql`now()`,
          directoryId: subject,
          updatedAt: sql`now()`,
        })
        .where(and(eq(users.id, userId), or(isNull(users.directoryId), eq(users.directoryId, subject))))
        .returning({ id: users.id });
      if (!row) tx.rollback();
      return row;
    })
    .catch((error: unknown) => {
      if (error instanceof TransactionRollbackError) return undefined;
      throw error;
    });
  if (!updated) return null;
  logger.info({ userId, role: role ?? "none" }, "access checked at sign-in");
  return role;
}
