import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { auditLog, categories, identityRequests, settings, ticketEvents } from "../db/schema";
import { syncIdentityRequests } from "../identity/service";
import { logger } from "../logger";
import { createUser, request, resetDatabase } from "../test/helpers";

vi.mock("../auth/resolve", () => import("../test/resolve-mock"));

type User = Awaited<ReturnType<typeof createUser>>;
let requester: User;
let operator: User;
let superadmin: User;
let number: number;

const IAM = "https://iam.example.org";
const KEY = `iam_${"k".repeat(43)}`;
const MAPPING = {
  firstName: "first",
  lastName: "last",
  personalEmail: null,
  jobTitle: null,
  personType: "type",
  team: null,
  managerEmail: null,
  startDate: "start",
  endDate: null,
  notes: null,
};

/** IAM's answers to the helpdesk, by "METHOD path" below /api/integration/v1/. */
type Reply = { status?: number; body: unknown };

function stubIam(routes: Record<string, (body: unknown) => Reply | Promise<Reply>>) {
  const calls: { route: string; body: unknown; authorization: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const path = String(url).replace(`${IAM}/api/integration/v1/`, "");
      const route = `${init?.method ?? "GET"} ${path}`;
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ route, body, authorization: new Headers(init?.headers).get("authorization") });
      const handler = routes[route];
      if (!handler) return new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 });
      const reply = await handler(body);
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

/** The submission key of the test's request; IAM answers about `helpdesk:<key>`. */
let currentKey: string;

const iamRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  externalId: `helpdesk:${currentKey}`,
  status: "open",
  createdAt: "2026-11-23T10:00:00.000Z",
  decidedAt: null,
  reason: "",
  url: `${IAM}/requests/12`,
  person: null,
  ...overrides,
});

const PERSON = {
  firstName: "Grace",
  lastName: "Hopper",
  personalEmail: "grace@personal.example.org",
  personType: "intern",
  startDate: "2027-01-04",
};

async function setUpIam() {
  const response = await request("PUT", "/api/v1/integrations/iam", {
    userId: superadmin.id,
    body: { url: `${IAM}/`, apiKey: KEY, mapping: MAPPING },
  });
  expect(response.status).toBe(200);
  return response.body;
}

beforeEach(async () => {
  currentKey = randomUUID();
  await resetDatabase();
  requester = await createUser("requester", { name: "Erin Employee", email: "erin@example.org" });
  operator = await createUser("operator", { name: "Hanna HR", email: "hanna@example.org" });
  superadmin = await createUser("superadmin", { name: "Ada Admin", email: "ada@example.org" });
  const [category] = await getDb().select().from(categories);
  const created = await request("POST", "/api/v1/tickets", {
    userId: operator.id,
    body: {
      requesterId: requester.id,
      title: "New team member",
      categoryId: category!.id,
      description: "Grace starts in January.",
      submissionKey: randomUUID(),
    },
  });
  expect(created.status).toBe(201);
  number = created.body.number as number;
});

afterEach(() => vi.unstubAllGlobals());

describe("the IAM connection", () => {
  it("sends the stored key only to the address it was entered for", async () => {
    await setUpIam();
    const moved = await request("PUT", "/api/v1/integrations/iam", {
      userId: superadmin.id,
      body: { url: "https://other.example.org", apiKey: "", mapping: MAPPING },
    });
    expect(moved.status).toBe(422);
    expect(moved.body.error.fields.apiKey).toContain("Enter the API key again");
    const sameOrigin = await request("PUT", "/api/v1/integrations/iam", {
      userId: superadmin.id,
      body: { url: `${IAM}/iam`, apiKey: "", mapping: MAPPING },
    });
    expect(sameOrigin.status).toBe(200);
    const withKey = await request("PUT", "/api/v1/integrations/iam", {
      userId: superadmin.id,
      body: { url: "https://other.example.org", apiKey: KEY, mapping: MAPPING },
    });
    expect(withKey.status).toBe(200);
  });

  it("is set up by superadmins, keeps the key secret, and tests it", async () => {
    expect((await request("GET", "/api/v1/integrations/iam", { userId: operator.id })).status).toBe(403);
    const saved = await setUpIam();
    expect(saved).toEqual({ url: IAM, apiKeyHint: expect.any(String), mapping: MAPPING });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    const [row] = await getDb().select().from(settings).where(eq(settings.key, "iam"));
    expect(JSON.stringify(row!.value)).not.toContain(KEY);
    const [entry] = await getDb().select().from(auditLog).where(eq(auditLog.action, "integration.iam"));
    expect(entry!.summary).toBe("Set up IAM for identity requests");

    const calls = stubIam({
      "GET identity-requests/options": () => ({
        body: { personTypes: [{ value: "intern", label: "Intern" }], teams: [] },
      }),
    });
    const test = await request("POST", "/api/v1/integrations/iam/test", { userId: superadmin.id });
    expect(test.body).toMatchObject({ ok: true, message: "Connected. IAM accepts requests for: Intern." });
    expect(calls[0]!.authorization).toBe(`Bearer ${KEY}`);

    // A wrong key: the test says so.
    stubIam({ "GET identity-requests/options": () => ({ status: 401, body: { error: {} } }) });
    const refused = await request("POST", "/api/v1/integrations/iam/test", { userId: superadmin.id });
    expect(refused.body).toMatchObject({ ok: false, message: expect.stringContaining("API key") });
  });

  it("tells staff when IAM is not set up", async () => {
    const options = await request("GET", "/api/v1/identity/options", { userId: operator.id });
    expect(options.body).toMatchObject({ configured: false, personTypes: [] });
    const sent = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: randomUUID() },
    });
    expect(sent.status).toBe(409);
    expect(sent.body.error.code).toBe("iam_not_configured");
  });
});

describe("identity requests", () => {
  it("sends a request once, shows it on the ticket, and follows IAM's answers", async () => {
    await setUpIam();
    let current = iamRequest();
    const calls = stubIam({
      "POST identity-requests": () => ({ status: 201, body: current }),
      "GET identity-requests/12": () => ({ body: current }),
    });
    expect(
      (
        await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
          userId: requester.id,
          body: { ...PERSON, submissionKey: randomUUID() },
        })
      ).status,
    ).toBe(403);

    const key = currentKey;
    const sent = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: key },
    });
    expect(sent.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      externalId: `helpdesk:${key}`,
      externalUrl: `http://localhost:3000/tickets/${number}`,
      requestedBy: { name: "Hanna HR", email: "hanna@example.org" },
      firstName: "Grace",
      personType: "intern",
      teamId: null,
      startDate: "2027-01-04",
    });
    expect(sent.body.identityRequests).toEqual([
      expect.objectContaining({ id: key, name: "Grace Hopper", status: "open", sentBy: "Hanna HR" }),
    ]);
    expect(sent.body.events.at(-1)).toMatchObject({
      kind: "identity_requested",
      data: { name: "Grace Hopper", to: "open" },
    });

    // Sent again (a double click, a retry): nothing new.
    const again = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: key },
    });
    expect(again.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(await getDb().select().from(identityRequests)).toHaveLength(1);

    expect(await syncIdentityRequests()).toBe(0);
    current = iamRequest({
      status: "approved",
      person: { status: "planned", workEmail: "grace@example.org", startDate: "2027-01-04" },
    });
    expect(await syncIdentityRequests()).toBe(1);
    current = iamRequest({
      status: "approved",
      person: { status: "active", workEmail: "grace@example.org", startDate: "2027-01-04" },
    });
    expect(await syncIdentityRequests()).toBe(1);
    // Settled: the worker no longer asks.
    const asked = calls.length;
    expect(await syncIdentityRequests()).toBe(0);
    expect(calls).toHaveLength(asked);

    const changes = await getDb()
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.kind, "identity_request_changed"))
      .orderBy(asc(ticketEvents.seq));
    expect(changes.map((event) => event.data.to)).toEqual(["approved", "active"]);
    const shown = await request("GET", `/api/v1/tickets/${number}`, { userId: operator.id });
    expect(shown.body.identityRequests[0]).toMatchObject({
      status: "approved",
      personStatus: "active",
      workEmail: "grace@example.org",
    });
  });

  it("shows IAM's refusals and lets staff cancel an open request", async () => {
    await setUpIam();
    stubIam({
      "POST identity-requests": () => ({
        status: 422,
        body: {
          error: {
            code: "validation_error",
            message: "Check the highlighted fields",
            fields: { personType: "This installation accepts no identity requests for interns." },
          },
        },
      }),
    });
    const refusedKey = randomUUID();
    const refused = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: refusedKey },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("iam_refused");
    expect(refused.body.error.fields).toEqual({
      personType: "This installation accepts no identity requests for interns.",
    });
    // Never deleted: the ticket keeps it as refused, and its key is used up.
    const [kept] = await getDb().select().from(identityRequests);
    expect(kept).toMatchObject({ id: refusedKey, status: "refused", payload: null });

    // IAM takes no requests right now: kept, unconfirmed, for the worker to send later.
    stubIam({ "POST identity-requests": () => ({ status: 403, body: { error: { message: "Off." } } }) });
    const offKey = randomUUID();
    const off = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: offKey },
    });
    expect(off.status).toBe(202);
    expect(off.body.identityRequests.find((item: { id: string }) => item.id === offKey)).toMatchObject({
      status: "sending",
      lastError: "Off.",
    });

    const key = currentKey;
    stubIam({
      "POST identity-requests": () => ({ status: 201, body: iamRequest() }),
      "GET identity-requests/12": () => ({ body: iamRequest() }),
      "POST identity-requests/12/cancel": () => ({ body: iamRequest({ status: "cancelled" }) }),
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: key },
    });
    const cancelled = await request("POST", `/api/v1/tickets/${number}/identity-requests/${key}/cancel`, {
      userId: operator.id,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.identityRequests.find((item: { id: string }) => item.id === key).status).toBe(
      "cancelled",
    );
    expect(cancelled.body.events.at(-1)).toMatchObject({
      kind: "identity_request_changed",
      data: { to: "cancelled" },
    });
    const elsewhere = await request("POST", `/api/v1/tickets/${number + 1}/identity-requests/${key}/cancel`, {
      userId: operator.id,
    });
    expect(elsewhere.status).toBe(404);
  });

  it("checks the request before asking IAM", async () => {
    await setUpIam();
    const calls = stubIam({});
    const invalid = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, firstName: " ", endDate: "2026-01-01", submissionKey: randomUUID() },
    });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.error.fields).sort()).toEqual(["endDate", "firstName"]);
    expect(calls).toEqual([]);
  });

  it("keeps a cancel when an older answer of IAM arrives after it", async () => {
    await setUpIam();
    let polling = false;
    stubIam({
      "POST identity-requests": () => ({ status: 201, body: iamRequest() }),
      "GET identity-requests/12": async () => {
        if (!polling) return { body: iamRequest() };
        polling = false;
        // Staff cancel while the worker's question is on its way; its answer is from before.
        const cancelled = await request(
          "POST",
          `/api/v1/tickets/${number}/identity-requests/${currentKey}/cancel`,
          { userId: operator.id },
        );
        expect(cancelled.status).toBe(200);
        return { body: iamRequest() };
      },
      "POST identity-requests/12/cancel": () => ({ body: iamRequest({ status: "cancelled" }) }),
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    polling = true;
    expect(await syncIdentityRequests()).toBe(0);
    const [row] = await getDb().select().from(identityRequests);
    expect(row!.status).toBe("cancelled");
    const changes = await getDb()
      .select()
      .from(ticketEvents)
      .where(eq(ticketEvents.kind, "identity_request_changed"));
    expect(changes.map((event) => event.data.to)).toEqual(["cancelled"]);
  });

  it("never takes an answer about another request, e.g. after IAM's address changed", async () => {
    await setUpIam();
    const calls = stubIam({
      "POST identity-requests": () => ({ status: 201, body: iamRequest() }),
      "GET identity-requests/12": () => ({
        body: iamRequest({ externalId: "other-app:7", status: "rejected", reason: "Not yours" }),
      }),
      "POST identity-requests/12/cancel": () => ({ body: iamRequest({ status: "cancelled" }) }),
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    const [before] = await getDb().select().from(identityRequests);
    expect(await syncIdentityRequests()).toBe(0);
    const [row] = await getDb().select().from(identityRequests);
    expect(row!.status).toBe("open");
    // To the back of the queue, so other requests get their turn.
    expect(row!.checkedAt!.getTime()).toBeGreaterThan(before!.checkedAt!.getTime());
    const cancel = await request("POST", `/api/v1/tickets/${number}/identity-requests/${currentKey}/cancel`, {
      userId: operator.id,
    });
    expect(cancel.status).toBe(409);
    expect(calls.map((call) => call.route)).not.toContain("POST identity-requests/12/cancel");
  });

  it("notes a decision IAM made before its first answer, and asks until the accounts are ready", async () => {
    await setUpIam();
    let current = iamRequest({
      status: "approved",
      person: { status: "archived", workEmail: "grace@example.org", startDate: null },
    });
    stubIam({
      "POST identity-requests": () => ({ status: 201, body: current }),
      "GET identity-requests/12": () => ({ body: current }),
    });
    const sent = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(sent.body.events.slice(-2).map((event: { kind: string }) => event.kind)).toEqual([
      "identity_requested",
      "identity_request_changed",
    ]);
    // A linked person who left before: IAM may onboard them again.
    expect(await syncIdentityRequests()).toBe(0);
    current = iamRequest({
      status: "approved",
      person: { status: "active", workEmail: "grace@example.org", startDate: null },
    });
    expect(await syncIdentityRequests()).toBe(1);
  });

  it("takes a submission key in capitals as the same request", async () => {
    await setUpIam();
    const calls = stubIam({
      "POST identity-requests": () => ({ status: 201, body: iamRequest() }),
      "GET identity-requests/12": () => ({ body: iamRequest({ status: "rejected", reason: "No." }) }),
    });
    const sent = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey.toUpperCase() },
    });
    expect(sent.status).toBe(201);
    expect(calls[0]!.body).toMatchObject({ externalId: `helpdesk:${currentKey}` });
    expect(await syncIdentityRequests()).toBe(1);
  });

  it("goes on with the other requests when IAM fails for one", async () => {
    await setUpIam();
    const first = currentKey;
    const second = randomUUID();
    stubIam({
      "POST identity-requests": (body) => {
        const ref = (body as { externalId: string }).externalId;
        return {
          status: 201,
          body: iamRequest({ id: ref === `helpdesk:${first}` ? 12 : 13, externalId: ref }),
        };
      },
      "GET identity-requests/12": () => ({ status: 500, body: { error: { code: "internal_error" } } }),
      "GET identity-requests/13": () => ({
        body: iamRequest({ id: 13, externalId: `helpdesk:${second}`, status: "approved" }),
      }),
    });
    for (const key of [first, second]) {
      await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
        userId: operator.id,
        body: { ...PERSON, submissionKey: key },
      });
    }
    // The failing request was checked least recently, so it comes first.
    await getDb()
      .update(identityRequests)
      .set({ checkedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(identityRequests.id, first));
    expect(await syncIdentityRequests()).toBe(1);
    const rows = await getDb().select().from(identityRequests).orderBy(asc(identityRequests.createdAt));
    expect(rows.map((row) => row.status)).toEqual(["open", "approved"]);
    expect(rows[0]!.checkedAt!.getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
  });

  it("delivers a send whose answer got lost exactly once, with the details first saved", async () => {
    await setUpIam();
    let stored: unknown = null;
    let reachable = false;
    const calls = stubIam({
      "POST identity-requests": (body) => {
        // IAM stores the first request it gets; the answer then gets lost on the way back.
        stored ??= body;
        if (!reachable) throw new Error("connection reset");
        return { status: 200, body: iamRequest() };
      },
    });
    const first = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(first.status).toBe(202);
    expect(first.body.identityRequests[0]).toMatchObject({ status: "sending", url: "" });
    expect(first.body.events.map((event: { kind: string }) => event.kind)).not.toContain(
      "identity_requested",
    );

    // Staff edit and send again with the same key: the saved details go, not the edited ones.
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, firstName: "Edited", submissionKey: currentKey },
    });
    reachable = true;
    expect(await syncIdentityRequests()).toBe(1);
    const posts = calls.filter((call) => call.route === "POST identity-requests").map((call) => call.body);
    expect(posts).toHaveLength(3);
    for (const body of posts) expect(body).toEqual(stored);
    expect(stored).toMatchObject({ firstName: "Grace", externalId: `helpdesk:${currentKey}` });

    const [row] = await getDb().select().from(identityRequests);
    expect(row).toMatchObject({
      status: "open",
      iamId: 12,
      payload: null,
      lastError: null,
      name: "Grace Hopper",
    });
    const sent = await getDb().select().from(ticketEvents).where(eq(ticketEvents.kind, "identity_requested"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.actorId).toBe(operator.id);
  });

  it("sends an unconfirmed request again from the ticket, and keeps a refusal on the ticket", async () => {
    await setUpIam();
    let answer: () => Reply = () => {
      throw new Error("timeout");
    };
    stubIam({ "POST identity-requests": () => answer() });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    answer = () => ({
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message: "Check the highlighted fields",
          fields: { personType: "This installation accepts no identity requests for interns." },
        },
      },
    });
    const again = await request("POST", `/api/v1/tickets/${number}/identity-requests/${currentKey}/send`, {
      userId: operator.id,
    });
    expect(again.status).toBe(200);
    expect(again.body.identityRequests[0]).toMatchObject({
      status: "refused",
      reason: "This installation accepts no identity requests for interns.",
      lastError: null,
    });
    expect(again.body.events.at(-1)).toMatchObject({
      kind: "identity_request_changed",
      data: { to: "refused" },
    });
    const [row] = await getDb().select().from(identityRequests);
    expect(row!.payload).toBeNull();
  });

  it("tells Sentry once when IAM has not confirmed a send for a day", async () => {
    await setUpIam();
    stubIam({
      "POST identity-requests": () => {
        throw new Error("down");
      },
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    const report = vi.spyOn(logger, "error");
    expect(await syncIdentityRequests()).toBe(0);
    expect(report).not.toHaveBeenCalled();
    await getDb()
      .update(identityRequests)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(identityRequests.id, currentKey));
    await syncIdentityRequests();
    await syncIdentityRequests();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]![0]).toEqual({ requestId: currentKey, hours: 24 });
    report.mockRestore();
  });

  it("never delivers one request twice at the same time", async () => {
    await setUpIam();
    let release: () => void = () => undefined;
    let reachable = false;
    const calls = stubIam({
      "POST identity-requests": async () => {
        if (!reachable) throw new Error("down");
        // The worker's delivery is slow; Send again comes meanwhile.
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { status: 201, body: iamRequest() };
      },
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    reachable = true;
    const worker = syncIdentityRequests();
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.route === "POST identity-requests")).toHaveLength(2),
    );
    const again = request("POST", `/api/v1/tickets/${number}/identity-requests/${currentKey}/send`, {
      userId: operator.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Send again waits for the worker's delivery instead of sending a second one.
    expect(calls.filter((call) => call.route === "POST identity-requests")).toHaveLength(2);
    release();
    expect(await worker).toBe(1);
    expect((await again).status).toBe(200);
    expect(calls.filter((call) => call.route === "POST identity-requests")).toHaveLength(2);
    const sent = await getDb().select().from(ticketEvents).where(eq(ticketEvents.kind, "identity_requested"));
    expect(sent).toHaveLength(1);
  });

  it("answers a retried send that IAM refuses with IAM's errors, and keeps it as refused", async () => {
    await setUpIam();
    let answer: () => Reply = () => {
      throw new Error("down");
    };
    stubIam({ "POST identity-requests": () => answer() });
    const first = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(first.status).toBe(202);
    // Send again without a clear answer: still unconfirmed.
    const again = await request("POST", `/api/v1/tickets/${number}/identity-requests/${currentKey}/send`, {
      userId: operator.id,
    });
    expect(again.status).toBe(202);
    // IAM is busy with something else: an unknown conflict keeps it queued.
    answer = () => ({ status: 409, body: { error: { code: "concurrent_change", message: "Try again." } } });
    const busy = await request("POST", `/api/v1/tickets/${number}/identity-requests/${currentKey}/send`, {
      userId: operator.id,
    });
    expect(busy.status).toBe(202);
    expect(busy.body.identityRequests[0]).toMatchObject({ status: "sending", lastError: "Try again." });

    answer = () => ({
      status: 422,
      body: { error: { code: "validation_error", message: "Check", fields: { personType: "No interns." } } },
    });
    const retried = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(retried.status).toBe(422);
    expect(retried.body.error.fields).toEqual({ personType: "No interns." });
    const [row] = await getDb().select().from(identityRequests);
    expect(row).toMatchObject({ status: "refused", reason: "No interns.", payload: null });
    // Sent again with that key: still refused, for the dialog to start a new request.
    const once = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(once.status).toBe(409);
    expect(once.body.error.code).toBe("iam_refused");
  });

  it("keeps a saved request unconfirmed while IAM is not set up, and tells a refused key from that", async () => {
    await setUpIam();
    stubIam({
      "POST identity-requests": () => {
        throw new Error("down");
      },
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    await request("PUT", "/api/v1/integrations/iam", {
      userId: superadmin.id,
      body: { url: IAM, apiKey: null, mapping: MAPPING },
    });
    // Send again and a replay of the same key: still unconfirmed, with why.
    const again = await request("POST", `/api/v1/tickets/${number}/identity-requests/${currentKey}/send`, {
      userId: operator.id,
    });
    expect(again.status).toBe(202);
    expect(again.body.identityRequests[0]).toMatchObject({
      status: "sending",
      lastError: "Set up IAM first (Integrations).",
    });
    const replay = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(replay.status).toBe(202);
    // A new request is refused at once: nothing to save without IAM.
    const fresh = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: randomUUID() },
    });
    expect(fresh.status).toBe(409);
    expect(fresh.body.error.code).toBe("iam_not_configured");
    // A refused key answers as refused, whatever the settings say.
    await getDb()
      .update(identityRequests)
      .set({ status: "refused", payload: null })
      .where(eq(identityRequests.id, currentKey));
    const refused = await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    expect(refused.body.error.code).toBe("iam_refused");
  });

  it("tells Sentry about a stuck send also after IAM's key was removed", async () => {
    await setUpIam();
    stubIam({
      "POST identity-requests": () => {
        throw new Error("down");
      },
    });
    await request("POST", `/api/v1/tickets/${number}/identity-requests`, {
      userId: operator.id,
      body: { ...PERSON, submissionKey: currentKey },
    });
    await request("PUT", "/api/v1/integrations/iam", {
      userId: superadmin.id,
      body: { url: IAM, apiKey: null, mapping: MAPPING },
    });
    await getDb()
      .update(identityRequests)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(identityRequests.id, currentKey));
    const report = vi.spyOn(logger, "error");
    await syncIdentityRequests();
    expect(report).toHaveBeenCalledTimes(1);
    report.mockRestore();
  });
});
