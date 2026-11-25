import { z } from "zod";
import { idSchema } from "./common";

export const EMAIL_PROVIDERS = ["none", "smtp", "mailersend"] as const;
export const emailProviderSchema = z.enum(EMAIL_PROVIDERS);
export type EmailProvider = z.infer<typeof emailProviderSchema>;
export const SMTP_SECURITY = ["tls", "starttls", "none"] as const;

/** Email as superadmins see it: secrets only as hints. */
export const emailSettingsSchema = z.object({
  provider: emailProviderSchema,
  fromAddress: z.string(),
  fromName: z.string(),
  smtp: z.object({
    host: z.string(),
    port: z.number().int(),
    security: z.enum(SMTP_SECURITY),
    username: z.string(),
    passwordHint: z.string().nullable(),
  }),
  mailersend: z.object({ tokenHint: z.string().nullable() }),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

/** Saving email settings. An empty secret keeps the stored one. */
export const emailSettingsInputSchema = z
  .object({
    provider: emailProviderSchema,
    fromAddress: z.string().trim().max(320).default(""),
    fromName: z.string().trim().max(100).default(""),
    smtp: z
      .object({
        host: z.string().trim().max(255).default(""),
        port: z.coerce.number().int().min(1).max(65535).default(587),
        security: z.enum(SMTP_SECURITY).default("starttls"),
        username: z.string().trim().max(320).default(""),
        password: z.string().max(1000).default(""),
      })
      .default({ host: "", port: 587, security: "starttls", username: "", password: "" }),
    mailersend: z.object({ token: z.string().trim().max(1000).default("") }).default({ token: "" }),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "none") return;
    if (!z.email().safeParse(value.fromAddress).success) {
      ctx.addIssue({ code: "custom", path: ["fromAddress"], message: "Enter the sender address" });
    }
    if (value.provider === "smtp" && !value.smtp.host) {
      ctx.addIssue({ code: "custom", path: ["smtp", "host"], message: "Enter the mail server" });
    }
  });
export type EmailSettingsInput = z.input<typeof emailSettingsInputSchema>;

export const emailTestSchema = z.object({ to: z.email().trim().max(320) });

/** Bot token scopes: post to channels and direct messages, find people by email. */
export const REQUIRED_SLACK_SCOPES = ["chat:write", "users:read", "users:read.email"] as const;
/** For the channel picker: public and private channels the bot is in. */
export const OPTIONAL_SLACK_SCOPES = ["channels:read", "groups:read"] as const;

export const slackSettingsSchema = z.object({
  configured: z.boolean(),
  botTokenHint: z.string().nullable(),
  teamName: z.string().nullable(),
  botName: z.string().nullable(),
  /** Where new tickets are posted. */
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  missingScopes: z.array(z.string()),
});
export type SlackSettings = z.infer<typeof slackSettingsSchema>;

export const slackSettingsInputSchema = z.object({
  /** Empty keeps the stored token; null removes the connection. */
  botToken: z.string().trim().max(500).nullable().default(""),
  channelId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{8,20}$/, "A Slack channel ID, e.g. C0123456789")
    .nullable()
    .default(null),
});
export type SlackSettingsInput = z.input<typeof slackSettingsInputSchema>;

export const slackChannelsSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), name: z.string(), isPrivate: z.boolean(), isMember: z.boolean() }),
  ),
});

export const directoryStatusSchema = z.object({
  mode: z.enum(["keycloak", "oidc"]),
  groups: z.object({
    requester: z.string().nullable(),
    operator: z.string().nullable(),
    admin: z.string().nullable(),
    superadmin: z.string().nullable(),
  }),
  syncMinutes: z.number().int().nullable(),
  lastSync: z
    .object({
      at: z.string(),
      ok: z.boolean(),
      message: z.string(),
      people: z.number().int(),
    })
    .nullable(),
});
export type DirectoryStatus = z.infer<typeof directoryStatusSchema>;

export const deliverySchema = z.object({
  id: idSchema,
  channel: z.enum(["email", "slack_channel", "slack_dm"]),
  kind: z.string(),
  recipient: z.string(),
  status: z.enum(["pending", "sending", "sent", "failed", "skipped"]),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  ticketNumber: z.number().int().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type Delivery = z.infer<typeof deliverySchema>;
export const deliveryListSchema = z.object({ items: z.array(deliverySchema), total: z.number().int() });
