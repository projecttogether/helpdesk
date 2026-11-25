import { z } from "zod";
import { idSchema, pageQuerySchema } from "./common";
import { notifyChannelSchema, roleSchema } from "../roles";

export const meSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  image: z.string().nullable(),
  /** How assigned tickets and requester replies reach this person (staff only). */
  notifyVia: notifyChannelSchema,
  /** Slack is set up, so `notifyVia: "slack"` can work. */
  slackAvailable: z.boolean(),
  /** IAM is set up, so staff can request identities from tickets (false for requesters). */
  identityRequests: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

/** What runs (superadmins): the version is the commit the image was built from; null for a build from source. */
export const aboutSchema = z.object({ version: z.string().nullable() });
export type About = z.infer<typeof aboutSchema>;

export const meUpdateSchema = z.object({
  notifyVia: notifyChannelSchema.optional(),
});
export type MeUpdate = z.infer<typeof meUpdateSchema>;

/** A person who can be assigned or chosen as requester. */
export const personSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string(),
  role: roleSchema.nullable(),
});
export type Person = z.infer<typeof personSchema>;

export const peopleQuerySchema = z.object({
  /** staff: operators, admins and superadmins (assignees); all: everyone with access. */
  scope: z.enum(["staff", "all"]).default("staff"),
  q: z.string().trim().max(100).optional(),
});
export const peopleListSchema = z.object({ items: z.array(personSchema) });

/** A person as admins see them on the People page. */
export const userSchema = z.object({
  id: idSchema,
  email: z.string(),
  name: z.string(),
  /** Null: no access (in none of the groups). */
  role: roleSchema.nullable(),
  /** Listed in SUPERADMIN_EMAILS: always a superadmin. */
  fromEnvironment: z.boolean(),
  /** Where the role came from: the directory sync, the last sign-in, or SUPERADMIN_EMAILS. */
  roleSource: z.enum(["directory", "sign_in", "environment"]).nullable(),
  roleCheckedAt: z.string().nullable(),
  lastSignInAt: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;
export const userListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  access: z.enum(["with", "without", "all"]).default("with"),
});
export const userListSchema = z.object({ items: z.array(userSchema) });

export const auditEntrySchema = z.object({
  id: idSchema,
  createdAt: z.string(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  /** Short description, e.g. 'Changed the request form'. Never contains secrets. */
  summary: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export const auditListQuerySchema = pageQuerySchema;
export const auditListSchema = z.object({ items: z.array(auditEntrySchema), total: z.number().int() });

/** Public: what the sign-in page shows. */
export const authConfigSchema = z.object({
  appName: z.string(),
  providerName: z.string(),
});
export type AuthConfig = z.infer<typeof authConfigSchema>;
