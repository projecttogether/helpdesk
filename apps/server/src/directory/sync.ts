import { and, eq, isNotNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { highestRole, type Role } from "@helpdesk/shared/roles";
import type { DirectoryStatus } from "@helpdesk/shared/api/integrations";
import { config } from "../config";
import { getDb, type DbOrTx } from "../db/client";
import { settings, users } from "../db/schema";
import { putSetting } from "../core/settings";
import { logger } from "../logger";
import { roleGroups } from "./groups";
import { displayNameOf, type KeycloakClient, type KeycloakUser } from "./keycloak";
import { grantedRole } from "./superadmins";

const lastSyncSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  message: z.string(),
  people: z.number().int(),
});

export async function directoryStatus(
  db: DbOrTx,
  mode: DirectoryStatus["mode"],
  syncMinutes: number | null,
): Promise<DirectoryStatus> {
  const settingsRow = await db.select().from(settings).where(eq(settings.key, "directory"));
  const lastSync = lastSyncSchema.safeParse(settingsRow[0]?.value);
  const groups = roleGroups();
  return {
    mode,
    groups: {
      requester: groups.requester,
      operator: groups.operator,
      admin: groups.admin,
      superadmin: groups.superadmin,
    },
    syncMinutes,
    lastSync: lastSync.success ? lastSync.data : null,
  };
}

type Found = { user: KeycloakUser; roles: Set<Role> };

/**
 * DIRECTORY=keycloak: reads the members of every role group and updates
 * everyone's role, so all operators can be assigned before they ever sign
 * in. People who left every group lose their role. Runs in one transaction
 * under a lock, so two processes never sync at once.
 */
export async function syncDirectory(client: KeycloakClient): Promise<{ people: number }> {
  const db = getDb();
  try {
    const found = new Map<string, Found>();
    for (const [role, path] of Object.entries(roleGroups()) as [Role, string | null][]) {
      if (!path) continue;
      for (const [id, user] of await client.membersOf(path)) {
        const entry = found.get(id) ?? { user, roles: new Set<Role>() };
        entry.roles.add(role);
        found.set(id, entry);
      }
    }
    const people = [...found.values()].filter(
      (entry) => entry.user.enabled !== false && entry.user.email?.includes("@"),
    );
    const count = await db.transaction(async (tx) => {
      const [lock] = await tx
        .execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtext('helpdesk.directory_sync')) as locked`,
        )
        .then((result) => result.rows);
      if (!lock?.locked) return null;
      const superadmins = config().superadminEmails;
      for (const { user, roles } of people) {
        const email = user.email!.trim().toLowerCase();
        const name = displayNameOf(user);
        const [existing] = await tx
          .select({ id: users.id, email: users.email, directoryId: users.directoryId })
          .from(users)
          .where(or(eq(users.directoryId, user.id), eq(users.email, email)))
          .orderBy(sql`(${users.directoryId} = ${user.id}) desc nulls last`)
          .limit(1);
        const values = {
          name,
          ...grantedRole(email, highestRole(roles), "directory"),
          roleCheckedAt: new Date(),
          directoryId: user.id,
          updatedAt: new Date(),
        };
        if (existing) {
          // A new email address only when no one else has it.
          const [taken] =
            existing.email === email
              ? []
              : await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
          await tx
            .update(users)
            .set({ ...values, ...(taken ? {} : { email }) })
            .where(eq(users.id, existing.id));
        } else {
          await tx.insert(users).values({ email, ...values });
        }
      }
      // Everyone else the directory gave a role to has left the groups.
      const ids = people.map((entry) => entry.user.id);
      await tx
        .update(users)
        .set({ role: null, roleSource: null, roleCheckedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(users.roleSource, "directory"),
            isNotNull(users.role),
            ids.length > 0 ? notInArray(users.directoryId, ids) : sql`true`,
            superadmins.length > 0 ? notInArray(users.email, superadmins) : sql`true`,
          ),
        );
      await putSetting(tx, "directory", {
        at: new Date().toISOString(),
        ok: true,
        message: `Synced ${people.length} people`,
        people: people.length,
      });
      return people.length;
    });
    if (count === null) {
      logger.info("directory sync skipped: another process is syncing");
      return { people: 0 };
    }
    logger.info({ people: count }, "directory synced");
    return { people: count };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown error";
    await putSetting(db, "directory", { at: new Date().toISOString(), ok: false, message, people: 0 }).catch(
      () => undefined,
    );
    throw error;
  }
}
