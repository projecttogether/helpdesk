import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { EMAIL_PROVIDERS, SMTP_SECURITY } from "@helpdesk/shared/api/integrations";
import { iamMappingSchema } from "@helpdesk/shared/api/identity";
import type { DbOrTx } from "../db/client";
import { settings } from "../db/schema";

export async function getSetting(db: DbOrTx, key: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value;
}

export async function putSetting(db: DbOrTx, key: string, value: Record<string, unknown>) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
}

/** Email as stored: the SMTP password and the MailerSend token encrypted. */
export const storedEmailSchema = z.object({
  provider: z.enum(EMAIL_PROVIDERS).default("none"),
  fromAddress: z.string().default(""),
  fromName: z.string().default(""),
  smtp: z
    .object({
      host: z.string().default(""),
      port: z.number().int().default(587),
      security: z.enum(SMTP_SECURITY).default("starttls"),
      username: z.string().default(""),
      passwordEncrypted: z.string().nullable().default(null),
      passwordHint: z.string().nullable().default(null),
    })
    .default({
      host: "",
      port: 587,
      security: "starttls",
      username: "",
      passwordEncrypted: null,
      passwordHint: null,
    }),
  mailersend: z
    .object({
      tokenEncrypted: z.string().nullable().default(null),
      tokenHint: z.string().nullable().default(null),
    })
    .default({ tokenEncrypted: null, tokenHint: null }),
});
export type StoredEmail = z.infer<typeof storedEmailSchema>;

export async function getStoredEmail(db: DbOrTx): Promise<StoredEmail> {
  const parsed = storedEmailSchema.safeParse((await getSetting(db, "email")) ?? {});
  return parsed.success ? parsed.data : storedEmailSchema.parse({});
}

/** The Slack connection as stored: the bot token encrypted, plus what the last check found. */
export const storedSlackSchema = z.object({
  botTokenEncrypted: z.string().nullable().default(null),
  botTokenHint: z.string().nullable().default(null),
  teamName: z.string().nullable().default(null),
  botName: z.string().nullable().default(null),
  channelId: z.string().nullable().default(null),
  channelName: z.string().nullable().default(null),
  missingScopes: z.array(z.string()).default([]),
});
export type StoredSlack = z.infer<typeof storedSlackSchema>;

export async function getStoredSlack(db: DbOrTx): Promise<StoredSlack> {
  const parsed = storedSlackSchema.safeParse((await getSetting(db, "slack")) ?? {});
  return parsed.success ? parsed.data : storedSlackSchema.parse({});
}

/** The connection to IAM: its address, the API key encrypted, and which question fills which field. */
export const storedIamSchema = z.object({
  url: z.string().default(""),
  apiKeyEncrypted: z.string().nullable().default(null),
  apiKeyHint: z.string().nullable().default(null),
  mapping: iamMappingSchema.default(iamMappingSchema.parse({})),
});
export type StoredIam = z.infer<typeof storedIamSchema>;

export async function getStoredIam(db: DbOrTx): Promise<StoredIam> {
  const parsed = storedIamSchema.safeParse((await getSetting(db, "iam")) ?? {});
  return parsed.success ? parsed.data : storedIamSchema.parse({});
}
