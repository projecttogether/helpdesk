import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { notifications, users } from "../db/schema";
import { encryptSecret } from "../core/crypto";
import { putSetting } from "../core/settings";
import { isDatabaseUnavailable } from "../db/outage";
import { logger } from "../logger";
import { createUser, lockTable, resetDatabase } from "../test/helpers";
import { setUpIntegrations } from "../test/integrations";
import { deliverDue } from "./deliver";

type Call = { url: string; body: string };
let calls: Call[];
let answer: (url: string, body: string) => Response | Promise<Response>;

beforeEach(async () => {
  await resetDatabase();
  calls = [];
  answer = (url) =>
    url.includes("slack.test")
      ? Response.json(
          url.endsWith("users.lookupByEmail") ? { ok: true, user: { id: "U0OSCAR" } } : { ok: true },
        )
      : new Response("", { status: 202 });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
    calls.push({ url, body });
    return answer(url, body);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function queue(values: Partial<typeof notifications.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(notifications)
    .values({
      channel: "email",
      kind: "ticket_received",
      recipient: "erin@example.org",
      subject: "[#1] We received your request",
      text: "Hello",
      html: "<p>Hello</p>",
      ...values,
    })
    .returning();
  return row!;
}

const stateOf = async (id: string) =>
  (await getDb().select().from(notifications).where(eq(notifications.id, id)))[0]!;

describe("deliverDue", () => {
  it("claims each notification just before sending it", async () => {
    await setUpIntegrations(getDb());
    const first = await queue({ nextAttemptAt: new Date(0) });
    const second = await queue();
    const states: string[][] = [];
    answer = async () => {
      states.push([(await stateOf(first.id)).status, (await stateOf(second.id)).status]);
      return new Response(null, { status: 202 });
    };
    expect(await deliverDue()).toBe(2);
    expect(states).toEqual([
      ["sending", "pending"],
      ["sent", "sending"],
    ]);
  });

  it.each([
    { earlier: 202, later: 503, expected: "pending", lastError: "MailerSend answered HTTP 503" },
    { earlier: 503, later: 202, expected: "sent", lastError: null },
  ])("preserves the latest attempt when an earlier send returns HTTP $earlier", async (test) => {
    await setUpIntegrations(getDb());
    const email = await queue();
    const { promise: newerStarted, resolve: markNewerStarted } = Promise.withResolvers<void>();
    const { promise: olderFinished, resolve: markOlderFinished } = Promise.withResolvers<void>();
    let retry: Promise<number> | undefined;
    answer = async () => {
      if (calls.length > 1) {
        markNewerStarted();
        await olderFinished;
        return new Response(null, { status: test.later });
      }
      await getDb()
        .update(notifications)
        .set({ leaseUntil: new Date(0) })
        .where(eq(notifications.id, email.id));
      retry = deliverDue(1);
      await Promise.race([newerStarted, retry]);
      return new Response(null, { status: test.earlier });
    };
    try {
      expect(await deliverDue(1)).toBe(1);
      expect(await stateOf(email.id)).toMatchObject({ status: "sending", attempts: 2, lastError: null });
    } finally {
      markOlderFinished();
      await retry;
    }
    expect(await stateOf(email.id)).toMatchObject({
      status: test.expected,
      attempts: 2,
      lastError: test.lastError,
    });
  });

  it("claims nothing more once the process stops, and saves the send in progress", async () => {
    await setUpIntegrations(getDb());
    const first = await queue({ nextAttemptAt: new Date(0) });
    const second = await queue();
    const stopping = new AbortController();
    answer = () => {
      // A deploy stops the worker while the first email is on its way.
      stopping.abort();
      return new Response(null, { status: 202 });
    };
    expect(await deliverDue(20, stopping.signal)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(await stateOf(first.id)).toMatchObject({ status: "sent", attempts: 1, leaseUntil: null });
    // The next process sends it, once.
    expect(await stateOf(second.id)).toMatchObject({ status: "pending", attempts: 0 });
    expect(await deliverDue()).toBe(1);
    expect(await stateOf(second.id)).toMatchObject({ status: "sent", attempts: 1 });
    expect(calls).toHaveLength(2);
  });

  it("keeps the lease when the database restarts during a send, then sends again", async () => {
    await setUpIntegrations(getDb());
    const email = await queue();
    const error = vi.spyOn(logger, "error");
    let restart: Promise<void> | undefined;
    answer = async () => {
      if (!restart) {
        // Recording the result waits for the lock and loses its connection.
        const locked = await lockTable("notifications");
        restart = locked.terminateWaiting();
      }
      return new Response(null, { status: 202 });
    };
    await expect(deliverDue()).rejects.toSatisfy(isDatabaseUnavailable);
    await restart;
    expect(await stateOf(email.id)).toMatchObject({ status: "sending", attempts: 1, lastError: null });
    expect(error).not.toHaveBeenCalled();

    // Claimed again once the lease ends, not before.
    expect(await deliverDue()).toBe(0);
    await getDb()
      .update(notifications)
      .set({ leaseUntil: new Date(Date.now() - 1000) })
      .where(eq(notifications.id, email.id));
    expect(await deliverDue()).toBe(1);
    expect(await stateOf(email.id)).toMatchObject({ status: "sent", attempts: 2, lastError: null });
  });

  it("sends email over MailerSend and posts to the Slack channel", async () => {
    await setUpIntegrations(getDb());
    const email = await queue();
    const post = await queue({ channel: "slack_channel", recipient: "C0HELPDESK", text: "New request #1" });
    expect(await deliverDue()).toBe(2);
    expect((await stateOf(email.id)).status).toBe("sent");
    expect((await stateOf(post.id)).status).toBe("sent");
    const mail = calls.find((call) => call.url === "http://mailersend.test/v1/email")!;
    expect(JSON.parse(mail.body)).toMatchObject({
      from: { email: "helpdesk@example.org", name: "Helpdesk" },
      to: [{ email: "erin@example.org" }],
      subject: "[#1] We received your request",
    });
    const slack = calls.find((call) => call.url === "http://slack.test/api/chat.postMessage")!;
    expect(new URLSearchParams(slack.body).get("channel")).toBe("C0HELPDESK");
    expect(new URLSearchParams(slack.body).get("text")).toBe("New request #1");
  });

  it("finds a person's Slack account by email for direct messages and remembers it", async () => {
    await setUpIntegrations(getDb());
    const oscar = await createUser("operator", { email: "oscar@example.org", notifyVia: "slack" });
    const dm = await queue({
      channel: "slack_dm",
      recipient: "oscar@example.org",
      recipientUserId: oscar.id,
      text: "Assigned",
      fallbackText: "Assigned (email)",
    });
    await deliverDue();
    expect((await stateOf(dm.id)).status).toBe("sent");
    const post = calls.find((call) => call.url.endsWith("chat.postMessage"))!;
    expect(new URLSearchParams(post.body).get("channel")).toBe("U0OSCAR");
    const [stored] = await getDb().select().from(users).where(eq(users.id, oscar.id));
    expect(stored!.slackUserId).toBe("U0OSCAR");
  });

  it("emails instead when the person has no Slack account", async () => {
    await setUpIntegrations(getDb());
    answer = (url) =>
      url.endsWith("users.lookupByEmail")
        ? Response.json({ ok: false, error: "users_not_found" })
        : new Response("", { status: 202 });
    const dm = await queue({
      channel: "slack_dm",
      recipient: "oscar@example.org",
      text: "Assigned",
      fallbackText: "Assigned (email)",
    });
    await deliverDue();
    const row = await stateOf(dm.id);
    expect(row).toMatchObject({
      status: "sent",
      lastError: "No Slack account has this email address; sent by email",
    });
    const mail = calls.find((call) => call.url.endsWith("/email"))!;
    expect(JSON.parse(mail.body).text).toBe("Assigned (email)");
  });

  it("emails instead when Slack refuses the direct message for good", async () => {
    await setUpIntegrations(getDb());
    answer = (url) =>
      url.includes("slack.test")
        ? Response.json({ ok: false, error: "missing_scope" })
        : new Response("", { status: 202 });
    const dm = await queue({
      channel: "slack_dm",
      recipient: "oscar@example.org",
      text: "Assigned",
      fallbackText: "Assigned (email)",
    });
    await deliverDue();
    expect(await stateOf(dm.id)).toMatchObject({
      status: "sent",
      lastError: "Slack failed (missing_scope); sent by email",
    });
    expect(calls.some((call) => call.url.endsWith("/email"))).toBe(true);
  });

  it("retries temporary failures and gives up on permanent ones", async () => {
    await setUpIntegrations(getDb());
    answer = () => new Response("busy", { status: 503 });
    const email = await queue();
    await deliverDue();
    let row = await stateOf(email.id);
    expect(row).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "MailerSend answered HTTP 503 busy",
    });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    answer = () => new Response('{"message":"The from.email domain must be verified"}', { status: 422 });
    await getDb()
      .update(notifications)
      .set({ nextAttemptAt: new Date() })
      .where(eq(notifications.id, email.id));
    await deliverDue();
    row = await stateOf(email.id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(2);
  });

  it("skips channels that were turned off after queuing", async () => {
    const email = await queue();
    await deliverDue();
    expect(await stateOf(email.id)).toMatchObject({ status: "skipped", lastError: "Email is not set up" });
    expect(calls).toEqual([]);
  });

  // Needs Mailpit (compose.dev.yaml, or the CI service): MAILPIT_SMTP_PORT and MAILPIT_API_URL.
  it.skipIf(!process.env.MAILPIT_API_URL)("sends email over SMTP", async () => {
    vi.unstubAllGlobals();
    const subject = `SMTP test ${Date.now()}`;
    await putSetting(getDb(), "email", {
      provider: "smtp",
      fromAddress: "helpdesk@example.org",
      fromName: "Helpdesk",
      smtp: {
        host: "localhost",
        port: Number(process.env.MAILPIT_SMTP_PORT ?? 1028),
        security: "none",
        username: "",
        passwordEncrypted: encryptSecret("unused"),
        passwordHint: null,
      },
    });
    const email = await queue({ subject });
    await deliverDue();
    expect((await stateOf(email.id)).status).toBe("sent");
    const search = await fetch(
      `${process.env.MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
    );
    const found = (await search.json()) as { messages: { Subject: string; To: { Address: string }[] }[] };
    expect(found.messages[0]).toMatchObject({ Subject: subject, To: [{ Address: "erin@example.org" }] });
  });
});
