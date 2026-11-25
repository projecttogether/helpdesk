import { Hono } from "hono";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  categoryInputSchema,
  categoryOrderSchema,
  formUpdateSchema,
  type Category,
  type Form,
} from "@helpdesk/shared/api/form";
import { isStaff, roleSchema } from "@helpdesk/shared/roles";
import { getDb, type DbOrTx } from "../db/client";
import { categories, formVersions, users } from "../db/schema";
import { audit } from "../core/audit";
import type { AppEnv } from "../http/env";
import { conflict, notFound, validationError } from "../http/errors";
import { idParam, jsonBody, requireAdmin, requireStaff, requireUser } from "../http/middleware";
import { isoRequired } from "./util";

const router = new Hono<AppEnv>();

async function currentForm(db: DbOrTx): Promise<Form> {
  const [row] = await db
    .select({ version: formVersions, updatedBy: users.name, updatedByEmail: users.email })
    .from(formVersions)
    .leftJoin(users, eq(users.id, formVersions.createdById))
    .orderBy(desc(formVersions.version))
    .limit(1);
  if (!row) throw notFound("The form is not set up yet");
  const active = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.position), asc(categories.name));
  return {
    versionId: row.version.id,
    version: row.version.version,
    definition: row.version.definition,
    categories: active,
    updatedAt: isoRequired(row.version.createdAt),
    updatedBy: row.updatedBy?.trim() || row.updatedByEmail || null,
  };
}

router.get("/form", async (c) => {
  requireUser(c);
  return c.json(await currentForm(getDb()));
});

/** Publishes a new version. Tickets keep the questions as they were asked. */
router.put("/form", async (c) => {
  const actor = requireAdmin(c);
  const input = await jsonBody(c, formUpdateSchema);
  const form = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('helpdesk.form'))`);
    const [latest] = await tx
      .select({ version: formVersions.version })
      .from(formVersions)
      .orderBy(desc(formVersions.version))
      .limit(1);
    if ((latest?.version ?? 0) !== input.baseVersion) {
      throw conflict(
        "Someone else saved the form meanwhile. Reload it to see their changes.",
        "form_changed",
      );
    }
    await tx
      .insert(formVersions)
      .values({ version: input.baseVersion + 1, definition: input.definition, createdById: actor.id });
    await audit(tx, actor, {
      action: "form.published",
      entityType: "form",
      entityId: String(input.baseVersion + 1),
      summary: `Published version ${input.baseVersion + 1} of the request form`,
    });
    return currentForm(tx);
  });
  return c.json(form);
});

async function listCategories(db: DbOrTx): Promise<Category[]> {
  const rows = await db
    .select({ category: categories, assigneeName: users.name, assigneeEmail: users.email })
    .from(categories)
    .leftJoin(users, eq(users.id, categories.defaultAssigneeId))
    .orderBy(asc(categories.position), asc(categories.name));
  return rows.map(({ category, assigneeName, assigneeEmail }) => ({
    id: category.id,
    name: category.name,
    position: category.position,
    isActive: category.isActive,
    defaultAssigneeId: category.defaultAssigneeId,
    defaultAssigneeName: category.defaultAssigneeId ? assigneeName?.trim() || assigneeEmail || null : null,
  }));
}

router.get("/categories", async (c) => {
  requireStaff(c);
  return c.json({ items: await listCategories(getDb()) });
});

async function checkAssignee(db: DbOrTx, id: string | null) {
  if (!id) return;
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, id));
  if (!row || !isStaff(roleSchema.safeParse(row.role).data)) {
    throw validationError({ defaultAssigneeId: "Choose an operator, admin or superadmin" });
  }
}

router.post("/categories", async (c) => {
  const actor = requireAdmin(c);
  const input = await jsonBody(c, categoryInputSchema);
  const items = await getDb().transaction(async (tx) => {
    await checkAssignee(tx, input.defaultAssigneeId);
    const [last] = await tx
      .select({ position: categories.position })
      .from(categories)
      .orderBy(desc(categories.position))
      .limit(1);
    const [created] = await tx
      .insert(categories)
      .values({ ...input, position: (last?.position ?? 0) + 1 })
      .returning();
    await audit(tx, actor, {
      action: "category.created",
      entityType: "category",
      entityId: created!.id,
      summary: `Added the category "${input.name}"`,
    });
    return listCategories(tx);
  });
  return c.json({ items }, 201);
});

// Before /categories/:id, which would match "order" first.
router.put("/categories/order", async (c) => {
  const actor = requireAdmin(c);
  const input = await jsonBody(c, categoryOrderSchema);
  const items = await getDb().transaction(async (tx) => {
    for (const [index, id] of input.ids.entries()) {
      await tx
        .update(categories)
        .set({ position: index + 1 })
        .where(eq(categories.id, id));
    }
    await audit(tx, actor, {
      action: "category.reordered",
      entityType: "category",
      summary: "Reordered the categories",
    });
    return listCategories(tx);
  });
  return c.json({ items });
});

router.put("/categories/:id", async (c) => {
  const actor = requireAdmin(c);
  const id = idParam(c);
  const input = await jsonBody(c, categoryInputSchema);
  const items = await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(categories).where(eq(categories.id, id));
    if (!current) throw notFound("Category not found");
    await checkAssignee(tx, input.defaultAssigneeId);
    if (!input.isActive && current.isActive) {
      const [active] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(categories)
        .where(eq(categories.isActive, true));
      if ((active?.value ?? 0) <= 1) throw conflict("Keep at least one category active");
    }
    await tx
      .update(categories)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(categories.id, id));
    await audit(tx, actor, {
      action: "category.updated",
      entityType: "category",
      entityId: id,
      summary: `Changed the category "${input.name}"`,
    });
    return listCategories(tx);
  });
  return c.json({ items });
});

export default router;
