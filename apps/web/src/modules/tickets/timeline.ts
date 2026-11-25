import type { Message, PersonRef, TicketEvent } from "@helpdesk/shared/api/tickets";
import { STATUSES, URGENCIES, type Status, type Urgency } from "@helpdesk/shared/tickets";
import type { messages } from "./messages";

export type TimelineEntry =
  | { type: "message"; id: string; at: string; message: Message }
  | {
      type: "event";
      id: string;
      at: string;
      event: TicketEvent;
      /** An assignment the form made (the category's default assignee), not a person. */
      automatic: boolean;
    };

/** Sorts entries with the same time: creation first, then messages, then other activity. */
function rank(entry: TimelineEntry): number {
  if (entry.type === "message") return 1;
  return entry.event.kind === "created" ? 0 : 2;
}

/**
 * Messages and activity in one list, oldest first. Entries of the same moment
 * keep a natural order: a reply that reopens a ticket comes before "reopened".
 */
export function mergeTimeline(messages: Message[], events: TicketEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...messages.map((message): TimelineEntry => ({
      type: "message",
      id: `m-${message.id}`,
      at: message.createdAt,
      message,
    })),
    ...events.map((event): TimelineEntry => ({
      type: "event",
      id: `e-${event.id}`,
      at: event.createdAt,
      event,
      // The server records a category's default assignee with no actor.
      automatic: event.kind === "assigned" && event.actor === null && Boolean(event.data.to),
    })),
  ];
  return entries
    .map((entry, index) => ({ entry, index, time: Date.parse(entry.at) }))
    .sort((a, b) => a.time - b.time || rank(a.entry) - rank(b.entry) || a.index - b.index)
    .map(({ entry }) => entry);
}

type Key = keyof (typeof messages)["en"] & string;

export type EventWords = {
  t: (key: Key, params?: Record<string, string | number>) => string;
  status: (status: Status) => string;
  urgency: (urgency: Urgency) => string;
  /** Formats a calendar date (YYYY-MM-DD). */
  date: (value: string) => string;
};

export const personName = (person: PersonRef | null) => (person ? person.name || person.email : null);

/** One line about a change, e.g. "Oscar changed the status from New to In progress". */
export function describeEvent(event: TicketEvent, automatic: boolean, words: EventWords): string {
  const { t } = words;
  const actor = personName(event.actor) ?? t("someone");
  const from = event.data.from ?? null;
  const to = event.data.to ?? null;
  const status = (value: string | null) =>
    value && (STATUSES as readonly string[]).includes(value) ? words.status(value as Status) : (value ?? "–");
  const urgency = (value: string | null) =>
    value && (URGENCIES as readonly string[]).includes(value)
      ? words.urgency(value as Urgency)
      : (value ?? "–");
  const date = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? words.date(value) : value);

  switch (event.kind) {
    case "created":
      return event.data.source === "staff" ? t("evCreatedStaff", { actor }) : t("evCreatedForm", { actor });
    case "status_changed":
      return t("evStatus", { actor, from: status(from), to: status(to) });
    case "reopened":
      return t("evReopened", { actor });
    case "urgency_changed":
      return t("evUrgency", { actor, from: urgency(from), to: urgency(to) });
    case "category_changed":
      return from
        ? t("evCategory", { actor, from, to: to ?? "–" })
        : t("evCategorySet", { actor, to: to ?? "–" });
    case "title_changed":
      return t("evTitle", { actor, from: from ?? "", to: to ?? "" });
    case "due_date_changed":
      if (!to) return t("evDueRemoved", { actor });
      if (!from) return t("evDueSet", { actor, to: date(to) });
      return t("evDue", { actor, from: date(from), to: date(to) });
    case "identity_requested":
      return t("evIdentityRequested", { actor, name: event.data.name ?? "–" });
    case "identity_request_changed": {
      const name = event.data.name ?? "–";
      if (to === "approved") return t("evIdentityApproved", { name });
      if (to === "rejected")
        return event.data.reason
          ? t("evIdentityRejectedReason", { name, reason: event.data.reason })
          : t("evIdentityRejected", { name });
      if (to === "active") return t("evIdentityActive", { name });
      if (to === "refused") return t("evIdentityRefused", { name, reason: event.data.reason ?? "–" });
      return event.actor
        ? t("evIdentityCancelled", { actor, name })
        : t("evIdentityCancelledInIam", { name });
    }
    case "assigned":
      if (automatic && to) return t("evAssignedAuto", { to });
      if (!to) return from ? t("evUnassigned", { actor, from }) : t("evAssignee", { actor });
      if (to === actor) return from ? t("evTookFrom", { actor, from }) : t("evTook", { actor });
      return from ? t("evReassigned", { actor, from, to }) : t("evAssigned", { actor, to });
  }
}
