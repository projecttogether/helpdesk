import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";
import { AppError, zodFieldErrors } from "./errors";
import { authenticate, requestId, requestLog, sameOrigin } from "./middleware";
import { webApp } from "./static";
import { auth } from "../auth/auth";
import { CLIENT_IP_HEADER, clientIp } from "./client-ip";
import { API_MODULES } from "../modules";
import health from "../modules/health";
import { logger } from "../logger";
import { errorReportingSources, tracingMiddleware } from "../error-reporting";
import { MAX_ATTACHMENT_BYTES } from "@helpdesk/shared/tickets";

export function createApp() {
  const app = new Hono<AppEnv>();
  const tracing = tracingMiddleware(app);
  if (tracing) app.use("*", tracing);
  app.use("*", requestId, requestLog);
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", ...errorReportingSources()],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { error: { code: error.code, message: error.message, fields: error.fields } },
        error.status,
      );
    }
    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "validation_error",
            message: "Check the highlighted fields",
            fields: zodFieldErrors(error),
          },
        },
        422,
      );
    }
    if (error instanceof HTTPException) {
      return c.json(
        {
          error: { code: error.status === 413 ? "payload_too_large" : "bad_request", message: error.message },
        },
        error.status,
      );
    }
    logger.error(
      { err: error, requestId: c.get("requestId"), route: `${c.req.method} ${c.req.routePath}` },
      "unhandled error",
    );
    return c.json({ error: { code: "internal_error", message: "Something went wrong. Try again." } }, 500);
  });

  app.route("/", health);

  // API responses can contain session or ticket data, including on redirects and errors.
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("cache-control", "private, no-store");
  });

  const jsonLimit = bodyLimit({ maxSize: 512 * 1024 });
  const authHandler: MiddlewareHandler<AppEnv> = async (c) => {
    // Replace any client-supplied value with the address the app trusts.
    const headers = new Headers(c.req.raw.headers);
    headers.set(CLIENT_IP_HEADER, clientIp(c) ?? "unknown");
    const body = c.req.method === "GET" ? undefined : c.req.raw.body;
    try {
      return await auth().handler(
        new Request(c.req.raw.url, {
          method: c.req.method,
          headers,
          body,
          duplex: "half",
          signal: c.req.raw.signal,
        } as RequestInit),
      );
    } catch {
      // Auth failures can contain credentials or provider responses.
      logger.error(
        { requestId: c.get("requestId"), route: c.req.routePath },
        "authentication request failed",
      );
      throw new AppError(500, "internal_error", "Something went wrong. Try again.");
    }
  };
  // Only expose the session flow. Better Auth also has account management and
  // provider-token endpoints that Helpdesk does not use.
  app.on(["GET", "POST"], "/api/auth/callback/oidc", jsonLimit, authHandler);
  app.post("/api/auth/sign-in/social", jsonLimit, authHandler);
  app.post("/api/auth/sign-out", jsonLimit, authHandler);

  const api = new Hono<AppEnv>();
  const uploadLimit = bodyLimit({ maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024 });
  api.use(
    "*",
    sameOrigin,
    (c, next) =>
      (c.req.method === "POST" && c.req.path === "/api/v1/attachments" ? uploadLimit : jsonLimit)(c, next),
    authenticate,
  );
  for (const module of API_MODULES) api.route("/", module);
  app.route("/api/v1", api);
  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  app.route("/", webApp());
  return app;
}
