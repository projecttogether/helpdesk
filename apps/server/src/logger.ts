import { pino, stdSerializers } from "pino";
import pg from "pg";
import { logTarget } from "./log-target";

type FailedQuery = Error & { query: string; params: unknown[] };

/**
 * Drizzle's DrizzleQueryError, recognized by its fields rather than its class,
 * which a second copy of drizzle-orm would not share.
 */
export const isFailedQuery = (error: unknown): error is FailedQuery =>
  error instanceof Error &&
  typeof (error as Partial<FailedQuery>).query === "string" &&
  Array.isArray((error as Partial<FailedQuery>).params);

/**
 * PostgreSQL errors can quote row data, even without a Drizzle wrapper.
 * Keep the database error code, code location and parameterized query.
 */
export function serializeError(error: unknown) {
  const failedQuery = isFailedQuery(error);
  if (!failedQuery && !(error instanceof pg.DatabaseError)) return stdSerializers.err(error as Error);
  const cause = failedQuery ? error.cause : error;
  const code = (cause as { code?: unknown } | undefined)?.code;
  // The stack starts with the message; only the frames after it stay.
  const stack = error.stack ?? "";
  const start = stack.indexOf(error.message);
  return {
    type: error.constructor.name,
    query: failedQuery ? error.query : undefined,
    code: typeof code === "string" ? code : undefined,
    stack: start === -1 ? undefined : stack.slice(start + error.message.length).replace(/^\n/, ""),
  };
}

const toStderr = logTarget() === "stderr";

/**
 * Structured JSON logs. Never log message texts, answers, tokens or other
 * personal data; log identifiers instead.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL?.trim() || (process.env.NODE_ENV === "test" ? "silent" : "info"),
    base: { role: toStderr ? "cli" : process.env.APP_ROLE?.trim() || "all" },
    serializers: { err: serializeError },
    redact: {
      paths: [
        "password",
        "token",
        "secret",
        "apiKey",
        "botToken",
        "*.password",
        "*.token",
        "*.secret",
        "*.apiKey",
        "*.botToken",
        "authorization",
        "cookie",
      ],
      censor: "[redacted]",
    },
    ...(process.env.NODE_ENV === "development" && process.stdout.isTTY && !toStderr
      ? { transport: { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname" } } }
      : {}),
  },
  toStderr ? pino.destination({ fd: 2, sync: true }) : undefined,
);
