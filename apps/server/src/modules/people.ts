import { Hono } from "hono";
import { and, asc, count, desc, ilike, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import {
  auditListQuerySchema,
  peopleQuerySchema,
  userListQuerySchema,
  type User,
} from "@helpdesk/shared/api/users";
import { roleSchema, type Role } from "@helpdesk/shared/roles";
import { type checkResultSchema } from "@helpdesk/shared/api/common";
import type { z } from "zod";
import { getDb } from "../db/client";
import { auditLog, users } from "../db/schema";
import { audit } from "../core/audit";
import type { AppEnv } from "../http/env";
import { conflict } from "../http/errors";
import { queryOf, requireAdmin, requireStaff, requireSuperadmin } from "../http/middleware";
import { directory, isEnvironmentSuperadmin } from "../directory";
import { iso, isoRequired } from "./util";

const router = new Hono<AppEnv>();

/** People who may be assigned: everyone with a staff role. */
const STAFF_ROLES: Role[] = ["operator", "admin", "superadmin"];

function search(q: string | undefined): SQL | undefined {
  if (!q) return undefined;
  const pattern = `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  return or(ilike(users.name, pattern), ilike(users.email, pattern));
}

/** People to pick: assignees (staff) or requesters (everyone with access). */
router.get("/people", async (c) => {
  requireStaff(c);
  const query = queryOf(c, peopleQuerySchema);
  const rows = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(
      and(
        query.scope === "staff" ? inArray(users.role, STAFF_ROLES) : isNotNull(users.role),
        search(query.q),
      ),
    )
    .orderBy(asc(users.name), asc(users.email))
    .limit(query.scope === "staff" ? 500 : 50);
  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      name: row.name.trim() || row.email,
      email: row.email,
      role: roleSchema.safeParse(row.role).data ?? null,
    })),
  });
});

/** Everyone the app knows, with their role and where it came from. */
router.get("/users", async (c) => {
  requireAdmin(c);
  const query = queryOf(c, userListQuerySchema);
  const access =
    query.access === "with"
      ? isNotNull(users.role)
      : query.access === "without"
        ? isNull(users.role)
        : undefined;
  const rows = await getDb()
    .select()
    .from(users)
    .where(and(access, search(query.q)))
    .orderBy(asc(users.name), asc(users.email))
    .limit(1000);
  const items: User[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: roleSchema.safeParse(row.role).data ?? null,
    fromEnvironment: isEnvironmentSuperadmin(row.email),
    roleSource:
      row.roleSource === "directory" || row.roleSource === "sign_in" || row.roleSource === "environment"
        ? row.roleSource
        : null,
    roleCheckedAt: iso(row.roleCheckedAt),
    lastSignInAt: iso(row.lastSignInAt),
    createdAt: isoRequired(row.createdAt),
  }));
  return c.json({ items });
});

router.get("/directory", async (c) => {
  requireAdmin(c);
  return c.json(await directory().status());
});

router.post("/directory/sync", async (c) => {
  const actor = requireSuperadmin(c);
  const sync = directory().sync;
  if (!sync) throw conflict("Roles come from the sign-in; there is nothing to sync");
  const started = Date.now();
  let result: z.infer<typeof checkResultSchema>;
  try {
    const { people } = await sync.run();
    result = { ok: true, message: `Synced ${people} people`, latencyMs: Date.now() - started };
  } catch (error) {
    result = {
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 300) : "The sync failed",
      latencyMs: Date.now() - started,
    };
  }
  await audit(getDb(), actor, {
    action: "directory.synced",
    entityType: "directory",
    summary: result.message,
  });
  return c.json(result);
});

/** Checks that the service account can read every role group. */
router.post("/directory/check", async (c) => {
  requireSuperadmin(c);
  const sync = directory().sync;
  if (!sync) throw conflict("Roles come from the sign-in; there is nothing to check");
  const started = Date.now();
  try {
    await sync.check();
    return c.json({
      ok: true,
      message: "The service account can read every group",
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    return c.json({
      ok: false,
      message: error instanceof Error ? error.message.slice(0, 300) : "The check failed",
      latencyMs: Date.now() - started,
    });
  }
});

router.get("/audit", async (c) => {
  requireSuperadmin(c);
  const query = queryOf(c, auditListQuerySchema);
  const [rows, [total]] = await Promise.all([
    getDb().select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(query.limit).offset(query.offset),
    getDb().select({ value: count() }).from(auditLog),
  ]);
  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      createdAt: isoRequired(row.createdAt),
      actorEmail: row.actorEmail,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
    })),
    total: total?.value ?? 0,
  });
});

export default router;
