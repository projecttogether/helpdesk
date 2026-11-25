import { isFailedQuery, logger } from "../logger";

/*
 * PostgreSQL restarts now and then: during a deploy, a server's updates or a
 * database upgrade. Workers then see failed queries for a few seconds. Those are not
 * bugs: the worker logs a warning and tries again. Only a database that stays
 * unreachable becomes an error in Sentry.
 */

/**
 * How long the database may stay unreachable before it counts as an outage.
 * A restart takes seconds, a minute at most; 5 minutes is far
 * beyond that, yet short enough that someone hears of a real outage before
 * people miss their emails.
 */
export const OUTAGE_REPORT_AFTER_MS = 5 * 60_000;

/** First wait before trying again; it doubles up to the longest wait. */
const RETRY_FIRST_MS = 5_000;
/** The longest wait. Stays below the worker's 60-second health check, so the heartbeat stays fresh. */
const RETRY_MAX_MS = 30_000;

/** SQLSTATEs of a lost connection or a server that shuts down or starts up. */
const UNAVAILABLE_STATES = new Set(["08000", "08001", "08003", "08006", "57P01", "57P02", "57P03"]);
/** Socket errors while PostgreSQL is down, moves or restarts. */
const UNAVAILABLE_SOCKET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);
/** Errors of node-postgres itself (no code) when a connection ends. */
const CONNECTION_LOST = new Set([
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "Client has encountered a connection error and is not queryable",
  "timeout exceeded when trying to connect",
]);

/**
 * Why `error` means the database is unreachable for now: a SQLSTATE, a
 * socket error code or `connection_lost`. Null for every other error, such as
 * bad SQL, a constraint violation or a failed email. Looks through Drizzle's
 * wrapper and a failed connection attempt to several addresses, nothing else:
 * an email or Keycloak call that cannot connect is not a database outage.
 */
export function databaseUnavailableCode(error: unknown): string | null {
  if (isFailedQuery(error)) return databaseUnavailableCode(error.cause);
  if (error instanceof AggregateError) {
    const codes = error.errors.map(databaseUnavailableCode);
    return codes.length > 0 && codes.every(Boolean) ? codes[0]! : null;
  }
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") return CONNECTION_LOST.has(error.message) ? "connection_lost" : null;
  if (UNAVAILABLE_STATES.has(code)) return code;
  // Socket errors of Node.js carry the system call (connect, read, getaddrinfo).
  return UNAVAILABLE_SOCKET_CODES.has(code) && "syscall" in error ? code : null;
}

export const isDatabaseUnavailable = (error: unknown) => databaseUnavailableCode(error) !== null;

/** Wait before attempt `attempt + 1`: 5, 10, 20, then 30 seconds. */
export const retryDelayMs = (attempt: number) =>
  Math.min(RETRY_FIRST_MS * 2 ** Math.max(0, attempt - 1), RETRY_MAX_MS);

/**
 * One process's view of the database. Every failed attempt is a warning;
 * the first failure after OUTAGE_REPORT_AFTER_MS without a success is an
 * error, once per outage. A success ends the outage.
 */
export function createOutageTracker(now: () => number = Date.now) {
  let since: number | undefined;
  let reported = false;
  return {
    failed(task: string, error: unknown, attempt: number) {
      const at = now();
      since ??= at;
      const fields = { task, attempt, code: databaseUnavailableCode(error), ms: at - since };
      if (!reported && at - since >= OUTAGE_REPORT_AFTER_MS) {
        reported = true;
        // Without `err`, Sentry groups every long outage into one issue, whichever query failed.
        logger.error(fields, "database unreachable for more than 5 minutes");
      } else {
        logger.warn({ ...fields, err: error }, "database unavailable; trying again");
      }
    },
    succeeded() {
      if (since === undefined) return;
      logger.info({ ms: now() - since }, "database reachable again");
      since = undefined;
      reported = false;
    },
  };
}

export type OutageTracker = ReturnType<typeof createOutageTracker>;

/** The tracker of this process. */
export const databaseOutage = createOutageTracker();

/** Waits `ms`, or less when `signal` aborts. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Runs `job`, and again with backoff while the database is unreachable, for
 * up to OUTAGE_REPORT_AFTER_MS. Then, or when `signal` aborts, it throws the
 * last error. Other errors are thrown at once.
 */
export async function retryWhileUnavailable<T>(
  task: string,
  job: () => Promise<T>,
  options: { signal?: AbortSignal; outage?: OutageTracker; now?: () => number } = {},
): Promise<T> {
  const { signal, outage = databaseOutage, now = Date.now } = options;
  const started = now();
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await job();
      outage.succeeded();
      return result;
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      outage.failed(task, error, attempt);
      if (signal?.aborted || now() - started >= OUTAGE_REPORT_AFTER_MS) throw error;
      await pause(retryDelayMs(attempt), signal);
      if (signal?.aborted) throw error;
    }
  }
}
