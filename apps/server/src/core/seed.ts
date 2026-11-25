import { count } from "drizzle-orm";
import { DEFAULT_FORM } from "@helpdesk/shared/form";
import type { DbOrTx } from "../db/client";
import { categories, formVersions } from "../db/schema";
import { logger } from "../logger";

/** A new installation starts with the default form (in English) and one category. */
export async function ensureDefaults(db: DbOrTx) {
  const [forms] = await db.select({ value: count() }).from(formVersions);
  if (!forms?.value) {
    await db.insert(formVersions).values({ version: 1, definition: DEFAULT_FORM }).onConflictDoNothing();
    logger.info("default request form created");
  }
  const [existing] = await db.select({ value: count() }).from(categories);
  if (!existing?.value) {
    await db.insert(categories).values({ name: "General", position: 1 });
    logger.info("default category created");
  }
}
