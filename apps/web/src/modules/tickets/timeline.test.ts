import { describe, expect, it } from "vitest";
import type { Message, TicketEvent } from "@helpdesk/shared/api/tickets";
import type { Status, Urgency } from "@helpdesk/shared/tickets";
import { translate } from "@/i18n";
import { createFormatter } from "@/lib/format";
import { labelMessages } from "@/lib/labels";
import { messages } from "./messages";
import { describeEvent, mergeTimeline, type EventWords } from "./timeline";

const alma = { id: "00000000-0000-4000-8000-000000000001", name: "Alma Berger", email: "alma@example.org" };
const oscar = { id: "00000000-0000-4000-8000-000000000002", name: "Oscar Lind", email: "oscar@example.org" };
const erin = { id: "00000000-0000-4000-8000-000000000003", name: "", email: "erin@example.org" };

let seq = 0;
function event(
  kind: TicketEvent["kind"],
  at: string,
  data: TicketEvent["data"] = {},
  actor: TicketEvent["actor"] = alma,
): TicketEvent {
  seq += 1;
  return { id: `e${seq}`, actor, kind, data, createdAt: at };
}
function message(at: string, extra: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    author: erin,
    visibility: "public",
    fromRequester: true,
    body: "Hello",
    createdAt: at,
    attachments: [],
    ...extra,
  };
}

function words(): EventWords {
  const labels = translate(labelMessages, "en");
  return {
    t: translate(messages, "en"),
    status: (status: Status) => labels(status),
    urgency: (urgency: Urgency) => labels(urgency),
    date: createFormatter("en").date,
  };
}

describe("mergeTimeline", () => {
  it("merges messages and events by time", () => {
    const created = event("created", "2026-11-01T10:00:00.000Z", { source: "form" }, erin);
    const reply = message("2026-11-01T11:00:00.000Z", { author: oscar, fromRequester: false });
    const status = event("status_changed", "2026-11-01T10:30:00.000Z", { from: "new", to: "in_progress" });
    const entries = mergeTimeline([reply], [created, status]);
    expect(entries.map((entry) => entry.id)).toEqual([`e-${created.id}`, `e-${status.id}`, `m-${reply.id}`]);
  });

  it("puts a reply before the reopening it caused (same moment)", () => {
    const at = "2026-11-02T08:00:00.000Z";
    const reopened = event("reopened", at, { from: "done", to: "in_progress" }, erin);
    const reply = message(at);
    const entries = mergeTimeline([reply], [reopened]);
    expect(entries.map((entry) => entry.type)).toEqual(["message", "event"]);
  });

  it("keeps the order of events of the same moment and marks the category's default assignment", () => {
    const at = "2026-11-01T10:00:00.000Z";
    const created = event("created", at, { source: "form" }, erin);
    const assigned = event("assigned", at, { from: null, to: "Oscar Lind" }, null);
    const later = event("assigned", "2026-11-03T10:00:00.000Z", { from: "Oscar Lind", to: "Alma Berger" });
    const entries = mergeTimeline([], [created, assigned, later]);
    expect(
      entries.map((entry) => (entry.type === "event" ? [entry.event.kind, entry.automatic] : null)),
    ).toEqual([
      ["created", false],
      ["assigned", true],
      ["assigned", false],
    ]);
  });

  it("does not mark assignments someone made", () => {
    const at = "2026-11-01T10:00:00.000Z";
    const entries = mergeTimeline(
      [],
      [event("created", at, { source: "staff" }), event("assigned", at, { from: null, to: "Oscar Lind" })],
    );
    expect(entries.every((entry) => entry.type === "event" && !entry.automatic)).toBe(true);
  });
});

describe("describeEvent", () => {
  const en = words();
  const at = "2026-11-01T10:00:00.000Z";

  it("names statuses and urgencies", () => {
    const status = event("status_changed", at, { from: "new", to: "in_progress" }, oscar);
    expect(describeEvent(status, false, en)).toBe("Oscar Lind changed the status from New to In progress");
    const urgency = event("urgency_changed", at, { from: "normal", to: "very_urgent" });
    expect(describeEvent(urgency, false, en)).toBe(
      "Alma Berger changed the urgency from Normal to Very urgent",
    );
  });

  it("describes assignments", () => {
    expect(describeEvent(event("assigned", at, { from: null, to: "Oscar Lind" }), false, en)).toBe(
      "Alma Berger assigned Oscar Lind",
    );
    expect(describeEvent(event("assigned", at, { from: null, to: "Alma Berger" }), false, en)).toBe(
      "Alma Berger took the ticket",
    );
    expect(describeEvent(event("assigned", at, { from: "Oscar Lind", to: null }), false, en)).toBe(
      "Alma Berger removed Oscar Lind as assignee",
    );
    expect(describeEvent(event("assigned", at, { from: "Oscar Lind", to: "Erin" }), false, en)).toBe(
      "Alma Berger handed the ticket from Oscar Lind to Erin",
    );
    expect(describeEvent(event("assigned", at, { from: null, to: "Oscar Lind" }, erin), true, en)).toBe(
      "Assigned to Oscar Lind automatically",
    );
  });

  it("formats due dates and names people without a name by email", () => {
    expect(
      describeEvent(event("due_date_changed", at, { from: null, to: "2026-11-20" }, erin), false, en),
    ).toBe("erin@example.org set the due date to Nov 20, 2026");
    expect(describeEvent(event("due_date_changed", at, { from: "2026-11-20", to: null }), false, en)).toBe(
      "Alma Berger removed the due date",
    );
  });

  it("follows identity requests to IAM", () => {
    const name = "Grace Hopper";
    expect(describeEvent(event("identity_requested", at, { name, to: "open" }), false, en)).toBe(
      "Alma Berger asked IAM for an identity for Grace Hopper",
    );
    const iam = (to: string, reason: string | null = null) =>
      describeEvent(event("identity_request_changed", at, { name, to, reason }, null), false, en);
    expect(iam("approved")).toBe("IAM approved the identity request for Grace Hopper");
    expect(iam("rejected", "No contract yet.")).toBe(
      "IAM rejected the identity request for Grace Hopper: No contract yet.",
    );
    expect(iam("active")).toBe("The accounts of Grace Hopper are ready");
    expect(iam("refused", "No interns.")).toBe(
      "IAM refused the identity request for Grace Hopper: No interns.",
    );
    expect(iam("cancelled")).toBe("The identity request for Grace Hopper was cancelled");
    expect(describeEvent(event("identity_request_changed", at, { name, to: "cancelled" }), false, en)).toBe(
      "Alma Berger cancelled the identity request for Grace Hopper",
    );
  });

  it("describes creation, reopening and the title", () => {
    expect(describeEvent(event("created", at, { source: "staff" }), false, en)).toBe(
      "Alma Berger recorded the request",
    );
    expect(describeEvent(event("created", at, { source: "form" }, erin), false, en)).toBe(
      "erin@example.org sent the request through the form",
    );
    expect(describeEvent(event("reopened", at, { from: "done", to: "new" }, erin), false, en)).toBe(
      "erin@example.org reopened the request",
    );
    expect(
      describeEvent(event("title_changed", at, { from: "Printer", to: "Printer broken" }), false, en),
    ).toBe("Alma Berger changed the title from “Printer” to “Printer broken”");
  });

  it("names a missing actor", () => {
    expect(
      describeEvent({ ...event("category_changed", at, { from: null, to: "IT" }), actor: null }, false, en),
    ).toBe("Someone set the category to IT");
  });
});
