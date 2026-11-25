import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import { config } from "../config";
import { getDb } from "../db/client";
import { resolvePrincipal } from "../auth/resolve";
import type { UserPrincipal } from "../auth/principal";
import { hasRole, type Role } from "@helpdesk/shared/roles";
import { logger } from "../logger";
import type { AppEnv } from "./env";
import { AppError, forbidden, parseWith, unauthorized } from "./errors";
import { parseJsonBody, storableText } from "./json";

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = performance.now();
  await next();
  const path = c.req.path;
  if (path.startsWith("/-/") || path.startsWith("/assets/")) return;
  logger.info(
    {
      requestId: c.get("requestId"),
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    },
    "request",
  );
};

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("principal", await resolvePrincipal(getDb(), c.req.raw.headers));
  await next();
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cross-site request protection: changes need an Origin of the application itself. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header("origin");
  const allowed = new URL(config().APP_URL).origin;
  if (origin ? origin !== allowed : c.req.header("sec-fetch-site") !== "same-origin") {
    throw new AppError(403, "forbidden", "Cross-site request rejected");
  }
  await next();
};

/** The signed-in person; 401 without one. */
export function requireUser(c: Context<AppEnv>): UserPrincipal {
  const principal = c.get("principal");
  if (!principal) throw unauthorized();
  return principal;
}

/** The signed-in person with at least this role; 403 otherwise. */
export function requireRole(c: Context<AppEnv>, role: Role): UserPrincipal {
  const principal = requireUser(c);
  if (!hasRole(principal.role, role)) throw forbidden(FORBIDDEN[role]);
  return principal;
}

const FORBIDDEN: Record<Role, string> = {
  requester: "You have no access",
  operator: "Only operators can do this",
  admin: "Only admins can do this",
  superadmin: "Only superadmins can do this",
};

/** Operators, admins and superadmins: they work on tickets. */
export const requireStaff = (c: Context<AppEnv>) => requireRole(c, "operator");
export const requireAdmin = (c: Context<AppEnv>) => requireRole(c, "admin");
export const requireSuperadmin = (c: Context<AppEnv>) => requireRole(c, "superadmin");

/** The JSON body validated with a shared schema. */
export async function jsonBody<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  return parseJsonBody(await c.req.text(), schema);
}

export function queryOf<T extends z.ZodType>(c: Context<AppEnv>, schema: T): z.infer<T> {
  const query = c.req.query();
  Object.values(query).forEach(storableText);
  return parseWith(schema, query);
}

/** A route parameter that must be a UUID (404 otherwise, like an unknown id). */
export function idParam(c: Context<AppEnv>, name = "id"): string {
  const value = c.req.param(name) ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(404, "not_found", "Not found");
  }
  return value.toLowerCase();
}

/** A ticket number in the path (404 for anything else). */
export function numberParam(c: Context<AppEnv>, name = "number"): number {
  const value = c.req.param(name) ?? "";
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2_147_483_647) {
    throw new AppError(404, "not_found", "Not found");
  }
  return Number(value);
}
