import pg from "pg";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logger";
import { DeliveryError } from "../notifications/transports";
import {
  OUTAGE_REPORT_AFTER_MS,
  createOutageTracker,
  databaseUnavailableCode,
  retryDelayMs,
  retryWhileUnavailable,
} from "./outage";

const databaseError = (code: string) =>
  Object.assign(new pg.DatabaseError("server message", 0, "error"), { code });
const socketError = (code: string) =>
  Object.assign(new Error(`connect ${code} 127.0.0.1:5432`), { code, syscall: "connect" });
const failedQuery = (cause: Error) =>
  new DrizzleQueryError('update "notifications" set "status" = $1', ["sending"], cause);

describe("databaseUnavailableCode", () => {
  it.each([
    ["a connection ended by a shutdown (HELPDESK-6)", failedQuery(databaseError("57P01")), "57P01"],
    ["a server that starts up", databaseError("57P03"), "57P03"],
    ["a lost connection", failedQuery(databaseError("08006")), "08006"],
    [
      "a connection that ended",
      failedQuery(new Error("Connection terminated unexpectedly")),
      "connection_lost",
    ],
    ["a refused connection", socketError("ECONNREFUSED"), "ECONNREFUSED"],
    ["a reset connection", failedQuery(socketError("ECONNRESET")), "ECONNRESET"],
    ["an unknown host while the container restarts", socketError("ENOTFOUND"), "ENOTFOUND"],
    [
      "refused connections to every address",
      new AggregateError([socketError("ECONNREFUSED"), socketError("ECONNREFUSED")]),
      "ECONNREFUSED",
    ],
  ])("recognizes %s", (_, error, code) => {
    expect(databaseUnavailableCode(error)).toBe(code);
  });

  it.each([
    ["a unique violation", failedQuery(databaseError("23505"))],
    ["a missing table", failedQuery(databaseError("42P01"))],
    ["a protocol violation", databaseError("08P01")],
    ["a failed email", new DeliveryError("MailerSend: connect ECONNREFUSED 10.0.0.1:443")],
    ["a failed call to Keycloak", new TypeError("fetch failed", { cause: socketError("ECONNREFUSED") })],
    ["an SMTP timeout", Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })],
    ["a bug", new Error("Cannot read properties of undefined")],
    ["an empty AggregateError", new AggregateError([])],
    ["a thrown string", "Connection terminated unexpectedly"],
  ])("leaves %s to the error reports", (_, error) => {
    expect(databaseUnavailableCode(error)).toBeNull();
  });
});

describe("retryDelayMs", () => {
  it("doubles from 5 to 30 seconds", () => {
    expect([1, 2, 3, 4, 10].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
  });
});

describe("outage tracker", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(logger, "warn");
    error = vi.spyOn(logger, "error");
  });
  afterEach(() => vi.restoreAllMocks());

  it("warns during a short outage and reports a long one once", () => {
    let now = 0;
    const outage = createOutageTracker(() => now);
    const lost = failedQuery(databaseError("57P01"));
    for (const at of [0, 60_000, OUTAGE_REPORT_AFTER_MS - 1]) {
      now = at;
      outage.failed("deliver", lost, 1);
    }
    expect(warn).toHaveBeenCalledTimes(3);
    expect(error).not.toHaveBeenCalled();

    now = OUTAGE_REPORT_AFTER_MS;
    outage.failed("deliver", lost, 4);
    now += 30_000;
    outage.failed("directory-sync", lost, 1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      { task: "deliver", attempt: 4, code: "57P01", ms: OUTAGE_REPORT_AFTER_MS },
      "database unreachable for more than 5 minutes",
    );

    // A success ends the outage; the next one starts from zero.
    outage.succeeded();
    now += OUTAGE_REPORT_AFTER_MS;
    outage.failed("deliver", lost, 1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({ task: "deliver", code: "57P01", ms: 0 }),
      "database unavailable; trying again",
    );
  });
});

describe("retryWhileUnavailable", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("tries again while the database restarts", async () => {
    const error = vi.spyOn(logger, "error");
    const job = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(failedQuery(databaseError("57P01")))
      .mockRejectedValueOnce(socketError("ECONNREFUSED"))
      .mockResolvedValue(3);
    const result = retryWhileUnavailable("prune-notifications", job, { outage: createOutageTracker() });
    await vi.advanceTimersByTimeAsync(5_000 + 10_000);
    await expect(result).resolves.toBe(3);
    expect(job).toHaveBeenCalledTimes(3);
    expect(error).not.toHaveBeenCalled();
  });

  it("throws other errors at once", async () => {
    const job = vi.fn().mockRejectedValue(failedQuery(databaseError("23505")));
    await expect(retryWhileUnavailable("prune-uploads", job)).rejects.toThrow(DrizzleQueryError);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("gives up after five minutes and reports the outage", async () => {
    const error = vi.spyOn(logger, "error");
    const job = vi.fn().mockRejectedValue(failedQuery(databaseError("57P03")));
    const result = retryWhileUnavailable("directory-sync", job, { outage: createOutageTracker() });
    const settled = expect(result).rejects.toThrow(DrizzleQueryError);
    await vi.advanceTimersByTimeAsync(OUTAGE_REPORT_AFTER_MS + 30_000);
    await settled;
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ task: "directory-sync", code: "57P03" }),
      "database unreachable for more than 5 minutes",
    );
  });

  it("stops waiting when the worker stops", async () => {
    const stopping = new AbortController();
    const job = vi.fn().mockRejectedValue(socketError("ECONNREFUSED"));
    const result = retryWhileUnavailable("prune-uploads", job, {
      signal: stopping.signal,
      outage: createOutageTracker(),
    });
    const settled = expect(result).rejects.toThrow("ECONNREFUSED");
    await vi.advanceTimersByTimeAsync(1_000);
    stopping.abort();
    await settled;
    expect(job).toHaveBeenCalledTimes(1);
  });
});
