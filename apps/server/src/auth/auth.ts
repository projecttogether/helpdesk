import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { eq, sql } from "drizzle-orm";
import { config } from "../config";
import { getDb } from "../db/client";
import { accounts, authRateLimits, sessions, users, verifications } from "../db/schema";
import { CLIENT_IP_HEADER } from "../http/client-ip";
import { logger } from "../logger";
import { directory, type SignInTokens } from "../directory";

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

/**
 * Sign-in only through the OpenID Connect provider. Anyone the provider
 * knows may try; a session starts only when the person has a role, which
 * the directory decides from their groups at every sign-in.
 */
function createAuth() {
  const settings = config();
  const appUrl = new URL(settings.APP_URL);
  const callbackTokens = new WeakMap<Request, SignInTokens>();
  const rememberTokens = async (tokens: SignInTokens, context: { request?: Request } | null) => {
    const request = context?.request;
    if (!request || new URL(request.url).pathname !== "/api/auth/callback/oidc" || !tokens.idToken) {
      return false;
    }
    callbackTokens.set(request, tokens);
  };
  return betterAuth({
    appName: settings.APP_NAME,
    baseURL: settings.APP_URL,
    basePath: "/api/auth",
    secret: settings.AUTH_SECRET,
    trustedOrigins: [settings.APP_URL],
    onAPIError: {
      // Let the app handle unexpected failures before the router can log them.
      throw: true,
      errorURL: new URL("/sign-in", appUrl).toString(),
    },
    // Auth library diagnostics can contain provider responses and query values.
    logger: {
      log: (level) => logger[level]("authentication library reported a problem"),
    },
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        rateLimit: authRateLimits,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "helpdesk",
      useSecureCookies: appUrl.protocol === "https:",
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    emailAndPassword: { enabled: false },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/sign-in/social" && context.body?.idToken) {
          throw new APIError("BAD_REQUEST", { message: "Sign in through the OpenID Connect provider" });
        }
      }),
    },
    user: {
      validateUserInfo: async ({ user, source }) => {
        if (source.action === "create-user" || !user.id) return;
        const subject = source.oauth?.profile?.sub;
        if (typeof subject !== "string" || !subject) return { error: "oidc_subject_required" };
        // Better Auth calls this before writing the account link or profile.
        if (!(await directory().ownsSubject(user.id, subject))) {
          return { error: "oidc_subject_mismatch" };
        }
      },
    },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      // Claim-based roles can only be refreshed by signing in again.
      disableSessionRefresh: directory().roleMaxAgeSeconds !== null,
      updateAge: 60 * 60 * 24,
      // Protected routes check the current session and role in the database.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    account: {
      // The directory sync (or SUPERADMIN_EMAILS) may know a person by email
      // before their first sign-in, which links the provider's account to
      // that entry. The organization's own provider vouches for the address.
      accountLinking: {
        enabled: true,
        trustedProviders: ["oidc"],
        allowDifferentEmails: false,
        requireLocalEmailVerified: false,
        updateUserInfoOnLink: true,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      // Starting a sign-in only redirects to the provider (no passwords here).
      // The default of 3 per 10 seconds would lock out an office whose people
      // share one public address and sign in at nine.
      customRules: { "/sign-in/social": { window: 60, max: 60 } },
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "oidc",
            discoveryUrl: `${settings.OIDC_ISSUER.replace(/\/+$/, "")}/.well-known/openid-configuration`,
            requireIdTokenVerification: true,
            clientId: settings.OIDC_CLIENT_ID,
            clientSecret: settings.OIDC_CLIENT_SECRET,
            scopes: settings.OIDC_SCOPES.split(/\s+/).filter(Boolean),
            pkce: settings.OIDC_PKCE,
            // Anyone may sign in; the session hook below checks the role.
            disableImplicitSignUp: false,
            // Name and picture follow the provider at every sign-in.
            overrideUserInfo: true,
          },
        ],
      }),
    ],
    databaseHooks: {
      account: {
        // The before hooks see the current exchange, even when the database
        // keeps a token omitted from the new exchange.
        create: { before: rememberTokens },
        update: { before: rememberTokens },
      },
      session: {
        create: {
          // Roles follow the groups at every sign-in; no role, no session.
          before: async (session, context) => {
            const tokens = context?.request && callbackTokens.get(context.request);
            if (!tokens) return false;
            const role = await directory().admit(session.userId, tokens);
            if (!role) return false;
            return { data: session };
          },
          after: async (session) => {
            await getDb()
              .update(users)
              .set({ lastSignInAt: sql`now()` })
              .where(eq(users.id, session.userId))
              .catch((error: unknown) => logger.warn({ err: error }, "could not record the sign-in time"));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** The authentication library instance (created on first use, after configuration loads). */
export function auth(): Auth {
  instance ??= createAuth();
  return instance;
}
