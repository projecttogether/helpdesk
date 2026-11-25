import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { asc, eq } from "drizzle-orm";
import { DEFAULT_FORM, formDefinitionSchema } from "@helpdesk/shared/form";
import { getDb } from "../db/client";
import { attachments, categories, notifications, ticketEvents, tickets, users } from "../db/schema";
import { lockUploads, pruneUnusedUploads } from "../attachments/storage";
import { config } from "../config";
import { createApp } from "../http/app";
import { createUser, request, resetDatabase } from "../test/helpers";
import { setUpIntegrations } from "../test/integrations";

vi.mock("../auth/resolve", () => import("../test/resolve-mock"));

type User = Awaited<ReturnType<typeof createUser>>;
let requester: User;
let operator: User;
let admin: User;
let categoryId: string;

beforeEach(async () => {
  await resetDatabase();
  requester = await createUser("requester", { name: "Erin Employee", email: "erin@example.org" });
  operator = await createUser("operator", { name: "Oscar Operator", email: "oscar@example.org" });
  admin = await createUser("admin", { name: "Alma Admin", email: "alma@example.org" });
  const [category] = await getDb().select().from(categories);
  categoryId = category!.id;
});

async function currentForm() {
  const response = await request("GET", "/api/v1/form", { userId: requester.id });
  expect(response.status).toBe(200);
  return response.body as { versionId: string; version: number; categories: { id: string }[] };
}

async function submit(answers: Record<string, unknown> = {}, as: User = requester) {
  const form = await currentForm();
  return request("POST", "/api/v1/requests", {
    userId: as.id,
    body: {
      formVersionId: form.versionId,
      submissionKey: randomUUID(),
      answers: {
        title: "Printer on floor 2 is broken",
        category: categoryId,
        urgency: "urgent",
        description: "It jams.",
        ...answers,
      },
    },
  });
}

async function ticket(number: number) {
  const response = await request("GET", `/api/v1/tickets/${number}`, { userId: operator.id });
  expect(response.status).toBe(200);
  return response.body;
}

const notificationsOf = async (kind?: string) =>
  (await getDb().select().from(notifications).orderBy(asc(notifications.createdAt))).filter(
    (row) => !kind || row.kind === kind,
  );

describe("access", () => {
  it("keeps staff areas from requesters and everything from people without a role", async () => {
    expect((await request("GET", "/api/v1/form")).status).toBe(401);
    const nobody = await createUser(null);
    expect((await request("GET", "/api/v1/form", { userId: nobody.id })).status).toBe(401);
    expect((await request("GET", "/api/v1/board", { userId: requester.id })).status).toBe(403);
    expect((await request("GET", "/api/v1/tickets", { userId: requester.id })).status).toBe(403);
    expect((await request("GET", "/api/v1/board", { userId: operator.id })).status).toBe(200);
    expect((await request("PUT", "/api/v1/form", { userId: operator.id, body: {} })).status).toBe(403);
    expect((await request("GET", "/api/v1/integrations/email", { userId: admin.id })).status).toBe(403);
    expect((await request("GET", "/api/v1/users", { userId: admin.id })).status).toBe(200);
  });

  it("refuses changes from other sites", async () => {
    const response = await createApp().request("/api/v1/requests", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
        "x-test-user": requester.id,
      },
      body: JSON.stringify({ data: "x".repeat(512 * 1024) }),
    });
    expect(response.status).toBe(403);
  });

  it("marks successful and rejected API responses as private and non-cacheable", async () => {
    const signedIn = await request("GET", "/api/v1/me", { userId: requester.id });
    const signedOut = await request("GET", "/api/v1/me");
    expect(signedIn.status).toBe(200);
    expect(signedOut.status).toBe(401);
    expect(signedIn.headers.get("cache-control")).toBe("private, no-store");
    expect(signedOut.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("sending the form", () => {
  it("creates a ticket, keeps the answers as asked, and queues the notifications", async () => {
    await setUpIntegrations(getDb());
    const response = await submit();
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ number: 1 });

    const detail = await ticket(1);
    expect(detail).toMatchObject({
      number: 1,
      title: "Printer on floor 2 is broken",
      status: "new",
      urgency: "urgent",
      category: { id: categoryId, name: "General" },
      requester: { id: requester.id, name: "Erin Employee" },
      assignee: null,
      source: "form",
      formVersion: 1,
    });
    expect(detail.answers).toEqual([
      {
        questionId: "description",
        label: "Describe your request",
        type: "long_text",
        display: ["It jams."],
        attachments: [],
      },
    ]);

    const sent = await notificationsOf();
    expect(sent.map((row) => [row.channel, row.kind, row.recipient])).toEqual([
      ["email", "ticket_received", "erin@example.org"],
      ["slack_channel", "ticket_created", "C0HELPDESK"],
    ]);
    expect(sent[0]!.subject).toBe("[#1] We received your request: Printer on floor 2 is broken");
    expect(sent[0]!.text).toContain("http://localhost:3000/requests/1");
    expect(sent[1]!.text).toContain("New request #1:");
    expect(sent[1]!.text).toContain("<http://localhost:3000/tickets/1|Open the ticket>");
  });

  it("leaves out channels that are not set up", async () => {
    expect((await submit()).status).toBe(201);
    expect(await notificationsOf()).toEqual([]);
  });

  it("creates one ticket per submission key", async () => {
    const form = await currentForm();
    const body = {
      formVersionId: form.versionId,
      submissionKey: randomUUID(),
      answers: { title: "Twice", category: categoryId, urgency: "low", description: "Sent twice." },
    };
    const first = await request("POST", "/api/v1/requests", { userId: requester.id, body });
    const second = await request("POST", "/api/v1/requests", { userId: requester.id, body });
    expect(first.body).toEqual({ number: 1 });
    expect(second.body).toEqual({ number: 1 });
    expect(await getDb().select().from(tickets)).toHaveLength(1);
    const other = await request("POST", "/api/v1/requests", { userId: operator.id, body });
    expect(other.status).toBe(409);
  });

  it("checks the answers of the shown questions", async () => {
    const response = await submit({ title: "", description: undefined, urgency: "whenever" });
    expect(response.status).toBe(422);
    expect(response.body.error.fields).toEqual({
      "answers.title": "Answer this question",
      "answers.urgency": "Choose one of the options",
      "answers.description": "Answer this question",
    });
  });

  it("follows show-if rules, and assigns the category's default assignee", async () => {
    await setUpIntegrations(getDb());
    await getDb()
      .update(categories)
      .set({ defaultAssigneeId: operator.id })
      .where(eq(categories.id, categoryId));
    const definition = formDefinitionSchema.parse({
      ...DEFAULT_FORM,
      pages: [
        DEFAULT_FORM.pages[0],
        {
          id: "urgent",
          title: "Urgent",
          showIf: {
            match: "all",
            rules: [{ questionId: "urgency", operator: "equals", value: "very_urgent" }],
          },
          questions: [{ id: "why", type: "long_text", label: "Why is it urgent?", required: true }],
        },
      ],
    });
    const saved = await request("PUT", "/api/v1/form", {
      userId: admin.id,
      body: { baseVersion: 1, definition },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);

    // Not very urgent: the page is hidden, so its required question is not.
    expect((await submit({ urgency: "urgent", why: "ignored" })).status).toBe(201);
    expect((await ticket(1)).answers).toEqual([]);
    expect((await submit({ urgency: "very_urgent" })).status).toBe(422);
    expect((await submit({ urgency: "very_urgent", why: "Deadline today" })).status).toBe(201);
    const second = await ticket(2);
    expect(second.answers).toMatchObject([{ questionId: "why", display: ["Deadline today"] }]);
    expect(second.assignee).toMatchObject({ id: operator.id });
    expect(second.events.map((event: { kind: string }) => event.kind)).toEqual(["created", "assigned"]);
    const assigned = await notificationsOf("ticket_assigned");
    expect(assigned).toHaveLength(2);
    expect(assigned[0]).toMatchObject({ channel: "email", recipient: "oscar@example.org" });
    expect(assigned[0]!.text).toContain('Request #1 "Printer on floor 2 is broken" is assigned to you.');
  });
});

describe("the form's language", () => {
  it("starts in English; admins publish it in German, and emails stay English", async () => {
    await setUpIntegrations(getDb());
    expect((await request("GET", "/api/v1/form", { userId: requester.id })).body.definition.language).toBe(
      "en",
    );
    const { language: _language, ...withoutLanguage } = DEFAULT_FORM;
    const unset = await request("PUT", "/api/v1/form", {
      userId: admin.id,
      body: { baseVersion: 1, definition: withoutLanguage },
    });
    expect(unset.body.definition.language).toBe("en");
    const french = await request("PUT", "/api/v1/form", {
      userId: admin.id,
      body: { baseVersion: 2, definition: { ...DEFAULT_FORM, language: "fr" } },
    });
    expect(french.status).toBe(422);
    const german = await request("PUT", "/api/v1/form", {
      userId: admin.id,
      body: { baseVersion: 2, definition: { ...DEFAULT_FORM, language: "de" } },
    });
    expect(german.status).toBe(200);
    expect((await request("GET", "/api/v1/form", { userId: requester.id })).body.definition.language).toBe(
      "de",
    );

    expect((await submit()).status).toBe(201);
    const [received] = await notificationsOf("ticket_received");
    expect(received!.subject).toBe("[#1] We received your request: Printer on floor 2 is broken");
  });
});

describe("requests that cannot be stored", () => {
  it("refuses a form version that is no longer the current one", async () => {
    const old = await currentForm();
    const published = await request("PUT", "/api/v1/form", {
      userId: admin.id,
      body: { baseVersion: 1, definition: DEFAULT_FORM },
    });
    expect(published.status).toBe(200);
    const send = (formVersionId: string) =>
      request("POST", "/api/v1/requests", {
        userId: requester.id,
        body: {
          formVersionId,
          submissionKey: randomUUID(),
          answers: { title: "Printer", category: categoryId, urgency: "urgent", description: "It jams." },
        },
      });
    const outdated = await send(old.versionId);
    expect(outdated.status).toBe(409);
    expect(outdated.body.error.code).toBe("form_changed");
    expect((await send(published.body.versionId.toUpperCase())).status).toBe(201);
  });

  it("refuses text the database cannot store, in a body and in a query", async () => {
    await submit();
    for (const text of ["a\u0000b", "a\ud800b"]) {
      expect((await submit({ description: text })).status).toBe(400);
      const reply = await request("POST", "/api/v1/requests/1/messages", {
        userId: requester.id,
        body: { body: text },
      });
      expect(reply.status).toBe(400);
    }
    expect((await request("GET", "/api/v1/tickets?q=a%00b", { userId: operator.id })).status).toBe(400);
    // An encoded lone surrogate is not decoded: it stays plain text and can be stored.
    expect((await request("GET", "/api/v1/tickets?q=a%ED%A0%80b", { userId: operator.id })).status).toBe(200);
    expect((await submit({ description: "Größe 🙂" })).status).toBe(201);
  });

  it("refuses a due date that is not a calendar date", async () => {
    await submit();
    for (const dueDate of ["2026-02-31", "0000-01-01"]) {
      const response = await request("PATCH", "/api/v1/tickets/1", {
        userId: operator.id,
        body: { revision: 1, dueDate },
      });
      expect(response.status).toBe(422);
      expect(response.body.error.fields).toHaveProperty("dueDate");
    }
  });
});

describe("working on tickets", () => {
  it("changes fields with a revision check and records the activity", async () => {
    await setUpIntegrations(getDb());
    await submit();
    const before = await ticket(1);
    const changed = await request("PATCH", "/api/v1/tickets/1", {
      userId: operator.id,
      body: {
        revision: before.revision,
        status: "in_progress",
        assigneeId: admin.id,
        urgency: "low",
        dueDate: "2026-12-01",
      },
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({
      status: "in_progress",
      urgency: "low",
      dueDate: "2026-12-01",
      assignee: { id: admin.id },
      revision: before.revision + 1,
    });
    const kinds = changed.body.events.map((event: { kind: string }) => event.kind);
    expect(kinds).toEqual(["created", "urgency_changed", "due_date_changed", "assigned", "status_changed"]);

    const stale = await request("PATCH", "/api/v1/tickets/1", {
      userId: operator.id,
      body: { revision: before.revision, title: "Old view" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("ticket_changed");

    const notAssignable = await request("PATCH", "/api/v1/tickets/1", {
      userId: operator.id,
      body: { revision: changed.body.revision, assigneeId: requester.id },
    });
    expect(notAssignable.status).toBe(422);

    const assigned = await notificationsOf("ticket_assigned");
    expect(assigned.map((row) => row.recipient)).toEqual(["alma@example.org"]);
    expect(assigned[0]!.text).toContain("Oscar Operator assigned request #1");
  });

  it("closes a ticket, emails the requester, and reopens it on the requester's reply", async () => {
    await setUpIntegrations(getDb());
    await getDb().update(categories).set({ defaultAssigneeId: operator.id });
    await submit();
    const opened = await ticket(1);
    const done = await request("PATCH", "/api/v1/tickets/1", {
      userId: operator.id,
      body: { revision: opened.revision, status: "done" },
    });
    expect(done.body.status).toBe("done");
    expect(done.body.closedAt).not.toBeNull();
    const doneMail = await notificationsOf("ticket_done");
    expect(doneMail).toHaveLength(1);
    expect(doneMail[0]!.subject).toBe("[#1] Your request is done: Printer on floor 2 is broken");

    const own = await request("GET", "/api/v1/requests/1", { userId: requester.id });
    expect(own.body).toMatchObject({ status: "done", canReply: true, replyReopens: true });

    const reply = await request("POST", "/api/v1/requests/1/messages", {
      userId: requester.id,
      body: { body: "Still jams." },
    });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ status: "in_progress", closedAt: null });
    const after = await ticket(1);
    expect(after.events.at(-1)).toMatchObject({
      kind: "reopened",
      data: { from: "done", to: "in_progress" },
    });
    const replied = await notificationsOf("requester_reply");
    expect(replied).toHaveLength(1);
    expect(replied[0]).toMatchObject({ channel: "email", recipient: "oscar@example.org" });
    expect(replied[0]!.text).toContain("and reopened it");
  });

  it("refuses replies to a done ticket after 14 days, and to a cancelled one", async () => {
    await submit();
    await getDb()
      .update(tickets)
      .set({ status: "done", closedAt: new Date(Date.now() - 15 * 24 * 60 * 60_000) });
    const own = await request("GET", "/api/v1/requests/1", { userId: requester.id });
    expect(own.body).toMatchObject({ canReply: false, replyReopens: false });
    const late = await request("POST", "/api/v1/requests/1/messages", {
      userId: requester.id,
      body: { body: "Hi" },
    });
    expect(late.status).toBe(409);
    await getDb().update(tickets).set({ status: "cancelled", closedAt: new Date() });
    expect(
      (await request("POST", "/api/v1/requests/1/messages", { userId: requester.id, body: { body: "Hi" } }))
        .status,
    ).toBe(409);
  });

  it("keeps internal notes from the requester and posts unassigned replies to Slack", async () => {
    await setUpIntegrations(getDb());
    await submit();
    await request("POST", "/api/v1/tickets/1/messages", {
      userId: operator.id,
      body: { body: "Checked the logs.", visibility: "internal" },
    });
    await request("POST", "/api/v1/tickets/1/messages", {
      userId: operator.id,
      body: { body: "Which printer exactly?", visibility: "public" },
    });
    const own = await request("GET", "/api/v1/requests/1", { userId: requester.id });
    expect(own.body.messages.map((message: { body: string }) => message.body)).toEqual([
      "Which printer exactly?",
    ]);
    expect((await notificationsOf("staff_reply")).map((row) => row.recipient)).toEqual(["erin@example.org"]);

    await getDb().update(tickets).set({ status: "waiting_for_requester" });
    const reply = await request("POST", "/api/v1/requests/1/messages", {
      userId: requester.id,
      body: { body: "The one by the window." },
    });
    expect(reply.body.status).toBe("in_progress");
    const posted = await notificationsOf("requester_reply");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ channel: "slack_channel", recipient: "C0HELPDESK" });
    expect(posted[0]!.text).toContain(
      "Erin Employee replied: #1 Printer on floor 2 is broken (not assigned)",
    );

    // Someone else's request is not found.
    const other = await createUser("requester");
    expect((await request("GET", "/api/v1/requests/1", { userId: other.id })).status).toBe(404);
  });

  it("sends a requester's reply to the channel when the assignee lost their staff role", async () => {
    await setUpIntegrations(getDb());
    await getDb().update(categories).set({ defaultAssigneeId: operator.id });
    await submit();
    await getDb().update(users).set({ role: null }).where(eq(users.id, operator.id));
    await request("POST", "/api/v1/requests/1/messages", {
      userId: requester.id,
      body: { body: "Any news?" },
    });
    const replies = await notificationsOf("requester_reply");
    expect(replies.map((row) => [row.channel, row.recipient])).toEqual([["slack_channel", "C0HELPDESK"]]);
  });

  it("moves cards on the board: a new status and the column's order", async () => {
    await submit({ title: "First" });
    await submit({ title: "Second" });
    await submit({ title: "Third" });
    const board = await request("GET", "/api/v1/board", { userId: operator.id });
    const column = (status: string, body = board.body) =>
      body.columns
        .find((item: { status: string }) => item.status === status)
        .tickets.map((t: { title: string }) => t.title);
    expect(column("new")).toEqual(["First", "Second", "Third"]);

    const third = await ticket(3);
    const first = await ticket(1);
    const reordered = await request("POST", "/api/v1/tickets/3/move", {
      userId: operator.id,
      body: { revision: third.revision, status: "new", order: [third.id, first.id, (await ticket(2)).id] },
    });
    expect(reordered.body).toEqual({ revision: third.revision });
    const moved = await request("POST", "/api/v1/tickets/1/move", {
      userId: operator.id,
      body: { revision: first.revision, status: "in_progress", order: [first.id] },
    });
    expect(moved.body).toEqual({ revision: first.revision + 1 });
    const after = await request("GET", "/api/v1/board", { userId: operator.id });
    expect(column("new", after.body)).toEqual(["Third", "Second"]);
    expect(column("in_progress", after.body)).toEqual(["First"]);
    const events = await getDb().select().from(ticketEvents).where(eq(ticketEvents.ticketId, first.id));
    expect(events.map((event) => event.kind)).toEqual(["created", "status_changed"]);

    const filtered = await request("GET", "/api/v1/board?q=sec", { userId: operator.id });
    expect(column("new", filtered.body)).toEqual(["Second"]);
    const list = await request("GET", "/api/v1/tickets?status=open&sort=number", { userId: operator.id });
    expect(list.body.items.map((t: { number: number }) => t.number)).toEqual([3, 2, 1]);
    expect(list.body.total).toBe(3);
  });

  it("lets staff record a request for someone", async () => {
    await setUpIntegrations(getDb());
    const created = await request("POST", "/api/v1/tickets", {
      userId: operator.id,
      body: {
        requesterId: requester.id,
        title: "Called about payroll",
        categoryId,
        urgency: "normal",
        description: "Asked for last month's payslip.",
        assigneeId: admin.id,
        submissionKey: randomUUID(),
      },
    });
    expect(created.status).toBe(201);
    const detail = await ticket(created.body.number);
    expect(detail).toMatchObject({
      source: "staff",
      createdBy: { id: operator.id },
      requester: { id: requester.id },
      assignee: { id: admin.id },
      answers: [{ label: "Description", display: ["Asked for last month's payslip."] }],
    });
    const kinds = (await notificationsOf()).map((row) => row.kind);
    expect(kinds).toEqual(["ticket_received", "ticket_created", "ticket_assigned"]);
    expect((await request("GET", "/api/v1/requests", { userId: requester.id })).body.total).toBe(1);
  });
});

describe("attachments", () => {
  async function upload(as: User, name = "receipt.pdf", content = "%PDF-1.4 test") {
    const form = new FormData();
    form.append("file", new File([content], name, { type: "application/pdf" }));
    return request("POST", "/api/v1/attachments", { userId: as.id, form });
  }

  it("allows the larger body limit only on the upload route", async () => {
    const contents = "x".repeat(600 * 1024);
    expect((await upload(requester, "large.txt", contents)).status).toBe(201);
    const invalidRoute = await request("POST", "/api/v1/other/attachments", {
      userId: requester.id,
      body: { contents },
    });
    expect(invalidRoute.status).toBe(413);
  });

  it("prunes expired uploads only when they are not locked by a ticket write", async () => {
    const locked = await upload(requester);
    const unused = await upload(requester);
    for (const file of [locked, unused]) {
      expect(file.status).toBe(201);
      await getDb()
        .update(attachments)
        .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
        .where(eq(attachments.id, file.body.id));
    }

    let pruning: Promise<number> | undefined;
    const prunedWhileLocked = await getDb().transaction(async (tx) => {
      await lockUploads(tx, [locked.body.id], requester.id);
      pruning = pruneUnusedUploads();
      return Promise.race([pruning, delay(2_000, null, { ref: false })]);
    });
    await pruning;
    expect(prunedWhileLocked).toBe(1);
    const download = await request("GET", `/api/v1/attachments/${locked.body.id}`, {
      userId: requester.id,
    });
    expect(download.body).toBe("%PDF-1.4 test");

    expect(
      (await request("GET", `/api/v1/attachments/${unused.body.id}`, { userId: requester.id })).status,
    ).toBe(404);
    expect(await pruneUnusedUploads()).toBe(1);
  });

  it("retries expired uploads after filesystem removal fails", async () => {
    const file = await upload(requester);
    expect(file.status).toBe(201);
    const [expired] = await getDb()
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(attachments.id, file.body.id))
      .returning({ storageKey: attachments.storageKey });
    const target = path.resolve(config().ATTACHMENTS_DIR, expired!.storageKey);
    const backup = `${target}.bak`;
    await rename(target, backup);
    await mkdir(target);
    try {
      expect(await pruneUnusedUploads()).toBe(0);
      expect(await getDb().select().from(attachments).where(eq(attachments.id, file.body.id))).toHaveLength(
        1,
      );
    } finally {
      await rmdir(target);
      await rename(backup, target);
    }
    expect(await pruneUnusedUploads()).toBe(1);
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await getDb().select().from(attachments).where(eq(attachments.id, file.body.id))).toHaveLength(0);
  });

  it("stores uploads, links them to a ticket, and checks who may download", async () => {
    const file = await upload(requester);
    expect(file.status).toBe(201);
    expect(file.body).toMatchObject({ filename: "receipt.pdf", size: 13 });
    expect((await upload(requester, "virus.exe")).status).toBe(400);

    // Another person cannot use or read someone else's upload.
    expect(
      (await request("GET", `/api/v1/attachments/${file.body.id}`, { userId: operator.id })).status,
    ).toBe(404);
    const stolen = await submit({ files: [file.body.id] }, operator);
    expect(stolen.status).toBe(422);

    expect((await submit({ files: [file.body.id] })).status).toBe(201);
    const detail = await ticket(1);
    expect(
      detail.answers.find((answer: { questionId: string }) => answer.questionId === "files"),
    ).toMatchObject({
      display: ["receipt.pdf"],
      attachments: [{ id: file.body.id, filename: "receipt.pdf" }],
    });
    const download = await request("GET", `/api/v1/attachments/${file.body.id}`, { userId: operator.id });
    expect(download.status).toBe(200);
    expect(download.body).toBe("%PDF-1.4 test");
    expect(download.headers.get("content-disposition")).toContain('attachment; filename="receipt.pdf"');
    expect(download.headers.get("content-type")).toBe("application/octet-stream");

    // A file in an internal note stays with staff.
    const note = await upload(operator, "notes.txt", "internal");
    await request("POST", "/api/v1/tickets/1/messages", {
      userId: operator.id,
      body: { body: "See file", visibility: "internal", attachmentIds: [note.body.id] },
    });
    expect(
      (await request("GET", `/api/v1/attachments/${note.body.id}`, { userId: requester.id })).status,
    ).toBe(404);
    expect(
      (await request("GET", `/api/v1/attachments/${file.body.id}`, { userId: requester.id })).status,
    ).toBe(200);
    const stranger = await createUser("requester");
    expect(
      (await request("GET", `/api/v1/attachments/${file.body.id}`, { userId: stranger.id })).status,
    ).toBe(404);
  });
});

describe("categories", () => {
  it("adds, reorders and deactivates categories, keeping one active", async () => {
    const added = await request("POST", "/api/v1/categories", {
      userId: admin.id,
      body: { name: "IT", isActive: true, defaultAssigneeId: operator.id },
    });
    expect(added.status).toBe(201);
    const it = added.body.items.find((item: { name: string }) => item.name === "IT");
    expect(it).toMatchObject({ defaultAssigneeName: "Oscar Operator", position: 2 });

    const reordered = await request("PUT", "/api/v1/categories/order", {
      userId: admin.id,
      body: { ids: [it.id, categoryId] },
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.items.map((item: { name: string }) => item.name)).toEqual(["IT", "General"]);

    const off = await request("PUT", `/api/v1/categories/${categoryId}`, {
      userId: admin.id,
      body: { name: "General", isActive: false, defaultAssigneeId: null },
    });
    expect(off.status).toBe(200);
    const last = await request("PUT", `/api/v1/categories/${it.id}`, {
      userId: admin.id,
      body: { name: "IT", isActive: false, defaultAssigneeId: null },
    });
    expect(last.status).toBe(409);
    expect((await currentForm()).categories.map((category) => category.id)).toEqual([it.id]);
    expect(
      (await request("POST", "/api/v1/categories", { userId: operator.id, body: { name: "X" } })).status,
    ).toBe(403);
  });
});

describe("SUPERADMIN_EMAILS", () => {
  it("takes the role from addresses no longer listed", async () => {
    const { ensureEnvironmentSuperadmins } = await import("../directory");
    const former = await createUser("superadmin", { email: "former@example.org" });
    await getDb().update(users).set({ roleSource: "environment" }).where(eq(users.id, former.id));
    await ensureEnvironmentSuperadmins(getDb());
    const [after] = await getDb().select().from(users).where(eq(users.id, former.id));
    expect(after).toMatchObject({ role: null, roleSource: null });
    const [root] = await getDb().select().from(users).where(eq(users.email, "root@example.org"));
    expect(root).toMatchObject({ role: "superadmin", roleSource: "environment" });
    // People with a role from their groups keep it.
    const [stays] = await getDb().select().from(users).where(eq(users.id, admin.id));
    expect(stays!.role).toBe("admin");
  });
});
