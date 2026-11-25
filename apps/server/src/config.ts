import { z } from "zod";

/**
 * Settings from the environment. Read them only through `config()`; blank
 * values count as unset. Document every variable in docs/configuration.md.
 * Everything else (the form, categories, email, Slack) is configured in the
 * app and stored in the database.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, fallback: z.input<T>) =>
  z.preprocess(blankToUndefined, schema.default(fallback as never));
const flag = (fallback: boolean) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== ""
        ? ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
        : undefined,
    z.boolean().default(fallback),
  );
/** A group name or path; "-" turns the role off. */
const group = (fallback: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .max(255)
      .default(fallback)
      .transform((value) => (value.trim() === "-" ? null : value.trim())),
  );

const EXAMPLE_SECRET = "change-me-to-a-long-random-value";

const schema = z
  .object({
    NODE_ENV: withDefault(z.enum(["development", "test", "production"]), "development"),
    /** Which part of the application this process runs. */
    APP_ROLE: withDefault(z.enum(["all", "web", "worker", "migrate"]), "all"),
    PORT: withDefault(z.coerce.number().int().min(1).max(65535), 3000),
    HOST: withDefault(z.string(), "0.0.0.0"),
    /** The public URL of the app, e.g. https://helpdesk.example.org */
    APP_URL: withDefault(z.url(), "http://localhost:3000"),
    APP_NAME: withDefault(z.string().min(1).max(100), "Helpdesk"),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_SIZE: withDefault(z.coerce.number().int().min(1).max(200), 10),
    /** Signs sessions. At least 32 characters. */
    AUTH_SECRET: z.string().min(32),
    /** Encrypts stored passwords and tokens (email, Slack). 32 bytes, base64. */
    ENCRYPTION_KEY: z.string().min(1),
    LOG_LEVEL: withDefault(z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]), "info"),
    /**
     * Reverse proxies in front of the app that append to X-Forwarded-For:
     * `true` (one), a number of hops, or `false`/0 (use the socket address).
     */
    TRUST_PROXY: z.preprocess((value) => {
      if (typeof value !== "string" || value.trim() === "") return undefined;
      const text = value.trim().toLowerCase();
      if (["true", "yes", "on"].includes(text)) return 1;
      if (["false", "no", "off"].includes(text)) return 0;
      return text;
    }, z.coerce.number().int().min(0).max(10).default(0)),
    /** Apply database migrations when the process starts (single-container setups). */
    RUN_MIGRATIONS: flag(false),
    /** Directory with the built web app. */
    WEB_DIST_DIR: optional(z.string()),
    MIGRATIONS_DIR: optional(z.string()),
    /** Where uploaded files are stored. Keep it on a volume and in backups. */
    ATTACHMENTS_DIR: withDefault(z.string(), ".data/attachments"),
    /** Sign-in with an OpenID Connect provider (Keycloak, Microsoft Entra ID, Authentik, …). */
    OIDC_ISSUER: z.url(),
    OIDC_CLIENT_ID: z.string().min(1),
    OIDC_CLIENT_SECRET: z.string().min(1),
    OIDC_PROVIDER_NAME: withDefault(z.string().max(40), "single sign-on"),
    OIDC_SCOPES: withDefault(z.string(), "openid email profile"),
    /** Proof Key for Code Exchange; turn off only for providers that reject it. */
    OIDC_PKCE: flag(true),
    /**
     * Where roles come from:
     * - keycloak: the Keycloak Admin API, synced every DIRECTORY_SYNC_MINUTES
     *   and at each sign-in; everyone in the groups can be assigned at once.
     * - oidc: the groups claim of the sign-in (any OpenID Connect provider);
     *   people appear after their first sign-in.
     */
    DIRECTORY: withDefault(z.enum(["keycloak", "oidc"]), "oidc"),
    /** The claim with a person's groups (DIRECTORY=oidc). */
    OIDC_GROUPS_CLAIM: withDefault(z.string().min(1).max(100), "groups"),
    /** Groups (paths in Keycloak) that give each role; members of subgroups count. */
    GROUP_REQUESTERS: group("/helpdesk/employees"),
    GROUP_OPERATORS: group("/helpdesk/operators"),
    GROUP_ADMINS: group("/helpdesk/admins"),
    GROUP_SUPERADMINS: group("/helpdesk/superadmins"),
    /** Client with a service account that may view users (DIRECTORY=keycloak); defaults to the sign-in client. */
    KEYCLOAK_CLIENT_ID: optional(z.string().min(1)),
    KEYCLOAK_CLIENT_SECRET: optional(z.string().min(1)),
    DIRECTORY_SYNC_MINUTES: withDefault(z.coerce.number().int().min(1).max(1440), 15),
    /** Comma-separated email addresses that are always superadmins (first setup and recovery). */
    SUPERADMIN_EMAILS: withDefault(z.string(), ""),
    /** The worker touches this file every few seconds, for container health checks. */
    WORKER_HEARTBEAT_FILE: optional(z.string()),
    /** Slack's Web API base URL; only for tests against a stand-in. */
    SLACK_API_URL: withDefault(z.url(), "https://slack.com/api/"),
    /** MailerSend's API base URL; only for tests against a stand-in. */
    MAILERSEND_API_URL: withDefault(z.url(), "https://api.mailersend.com/v1/"),
    /**
     * The version: the commit an image was built from (its first 12
     * characters), set by the Deploy workflow; unset in images built from source.
     */
    APP_VERSION: optional(z.string().max(100)),
    /** Error reports and performance data to Sentry or a compatible service; off when unset. */
    SENTRY_DSN: optional(z.url()),
    SENTRY_ENVIRONMENT: optional(z.string().max(64)),
    SENTRY_RELEASE: optional(z.string().max(200)),
    /** Share of requests and page loads traced for performance data, 0 to 1. */
    SENTRY_TRACES_SAMPLE_RATE: withDefault(z.coerce.number().min(0).max(1), 0),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && value.AUTH_SECRET === EXAMPLE_SECRET) {
      ctx.addIssue({ code: "custom", path: ["AUTH_SECRET"], message: "Replace the example value" });
    }
    const key = Buffer.from(value.ENCRYPTION_KEY, "base64");
    if (key.length !== 32) {
      ctx.addIssue({ code: "custom", path: ["ENCRYPTION_KEY"], message: "Must be 32 bytes, base64-encoded" });
    }
    for (const email of splitList(value.SUPERADMIN_EMAILS)) {
      if (!z.email().safeParse(email).success) {
        ctx.addIssue({
          code: "custom",
          path: ["SUPERADMIN_EMAILS"],
          message: "Each entry must be an email address",
        });
      }
    }
    if (value.DIRECTORY === "keycloak" && !/\/realms\/[^/]+\/?$/.test(value.OIDC_ISSUER)) {
      ctx.addIssue({
        code: "custom",
        path: ["OIDC_ISSUER"],
        message: "DIRECTORY=keycloak needs a Keycloak realm URL (…/realms/<realm>)",
      });
    }
    if (
      !value.GROUP_REQUESTERS &&
      !value.GROUP_OPERATORS &&
      !value.GROUP_ADMINS &&
      !value.GROUP_SUPERADMINS
    ) {
      ctx.addIssue({ code: "custom", path: ["GROUP_REQUESTERS"], message: "Set at least one group" });
    }
  });

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export type Config = z.infer<typeof schema> & { superadminEmails: string[] };

let cached: Config | undefined;

/** A missing or invalid variable. Its message names variables and rules, never values. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid configuration:\n${problems}`);
  }
  const value = parsed.data;
  cached = {
    ...value,
    APP_URL: value.APP_URL.replace(/\/+$/, ""),
    superadminEmails: splitList(value.SUPERADMIN_EMAILS),
  };
  return cached;
}

/** Tests only: forget the cached configuration after changing process.env. */
export function resetConfigForTests() {
  cached = undefined;
}
