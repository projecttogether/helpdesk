import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { notifications } from "../db/schema";
import { logger } from "../logger";
import { NOTIFY_CHANNEL } from "../notifications/enqueue";
import { lockTable, resetDatabase } from "../test/helpers";
import { setUpIntegrations } from "../test/integrations";
import { startWorker } from ".";

beforeEach(async () => {
  await resetDatabase();
  await setUpIntegrations(getDb(), { slack: false });
  vi.stubGlobal("fetch", async () => new Response(null, { status: 202 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function queueEmail() {
  const [row] = await getDb()
    .insert(notifications)
    .values({
      channel: "email",
      kind: "ticket_received",
      recipient: "erin@example.org",
      subject: "[#1] We received your request",
      text: "Hello",
    })
    .returning();
  await getDb().execute(sql`select pg_notify(${NOTIFY_CHANNEL}, '')`);
  return row!;
}

const statusOf = async (id: string) =>
  (await getDb().select().from(notifications).where(eq(notifications.id, id)))[0]!.status;

/** Connections of this database that last ran LISTEN. */
const listeners = async () =>
  (
    await getDb().execute<{ pid: number }>(
      sql`select pid from pg_stat_activity
           where datname = current_database() and query = ${`listen ${NOTIFY_CHANNEL}`}`,
    )
  ).rows.map((row) => row.pid);

describe("worker", () => {
  it("carries on when PostgreSQL ends its connection during a claim (HELPDESK-6)", async () => {
    const warn = vi.spyOn(logger, "warn");
    const error = vi.spyOn(logger, "error");
    const locked = await lockTable("notifications");
    const stop = startWorker();
    try {
      // The worker's first claim waits for the lock, then loses its connection.
      await locked.terminateWaiting();
      const email = await queueEmail();
      await vi.waitFor(async () => expect(await statusOf(email.id)).toBe("sent"), {
        timeout: 15_000,
        interval: 100,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ task: "deliver", code: "57P01", attempt: 1 }),
        "database unavailable; trying again",
      );
      expect(error).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });

  it("finishes the email in progress when it stops, and sends no other", async () => {
    const { promise: sending, resolve: markSending } = Promise.withResolvers<void>();
    const { promise: release, resolve: releaseSend } = Promise.withResolvers<void>();
    let sends = 0;
    vi.stubGlobal("fetch", async () => {
      sends += 1;
      markSending();
      await release;
      return new Response(null, { status: 202 });
    });
    const first = await queueEmail();
    const second = await queueEmail();
    const stop = startWorker();
    await sending;
    // SIGTERM during the first send: stopping waits for it and saves its outcome.
    let stopped = false;
    const stopDone = stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stopped).toBe(false);
    releaseSend();
    await stopDone;
    expect(sends).toBe(1);
    expect([await statusOf(first.id), await statusOf(second.id)].sort()).toEqual(["pending", "sent"]);
  });

  it("listens again when PostgreSQL ends the listening connection", async () => {
    const stop = startWorker();
    try {
      let first: number[] = [];
      await vi.waitFor(async () => {
        first = await listeners();
        expect(first).toHaveLength(1);
      });
      await getDb().execute(sql`select pg_terminate_backend(${first[0]})`);
      await vi.waitFor(
        async () => {
          const now = await listeners();
          expect(now).toHaveLength(1);
          expect(now[0]).not.toBe(first[0]);
        },
        { timeout: 15_000, interval: 100 },
      );
    } finally {
      await stop();
    }
    // Stopping ends the listening connection too.
    await vi.waitFor(async () => expect(await listeners()).toEqual([]));
  });
});
