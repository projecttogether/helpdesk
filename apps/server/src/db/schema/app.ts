import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { FormDefinition } from "@helpdesk/shared/form";
import type { StoredAnswer } from "../../tickets/answers";
import type { IamRequestCreate } from "../../identity/iam";
import { users } from "./auth";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** Integration settings (email, Slack) and the directory sync status, by key. Secrets are encrypted. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Changes made by admins and superadmins. Never stores secrets. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_audit_log_created").on(table.createdAt)],
);

/** Every published version of the request form; the highest version is the current form. */
export const formVersions = pgTable("form_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull().unique(),
  definition: jsonb("definition").$type<FormDefinition>().notNull(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The answers of the form's category question; the board filters by them. */
export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  defaultAssigneeId: uuid("default_assignee_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The number people use: #1, #2, … */
    number: integer("number").generatedAlwaysAsIdentity().notNull().unique(),
    title: text("title").notNull(),
    /** Status (`@helpdesk/shared/tickets`) */
    status: text("status").notNull().default("new"),
    /** Urgency */
    urgency: text("urgency").notNull().default("normal"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    requesterId: uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Staff who recorded it for the requester; null when the requester sent the form. */
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    /** form or staff */
    source: text("source").notNull(),
    formVersionId: uuid("form_version_id").references(() => formVersions.id, { onDelete: "set null" }),
    /** The answered questions as they were asked (labels kept). */
    answers: jsonb("answers").$type<StoredAnswer[]>().notNull().default([]),
    /** One ticket per submission, however often the browser sends it. */
    submissionKey: uuid("submission_key").unique(),
    dueDate: date("due_date"),
    /** Order within the board column; null sorts after ranked tickets, oldest first. */
    boardRank: doublePrecision("board_rank"),
    /** Raised by every change people make; refuses changes based on an old view. */
    revision: integer("revision").notNull().default(1),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("idx_tickets_status").on(table.status, table.boardRank),
    index("idx_tickets_requester").on(table.requesterId, table.createdAt),
    index("idx_tickets_assignee").on(table.assigneeId),
    index("idx_tickets_updated").on(table.updatedAt),
  ],
);

/** Replies (public: the requester sees them) and internal notes. */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** public or internal */
    visibility: text("visibility").notNull(),
    fromRequester: boolean("from_requester").notNull().default(false),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_ticket_messages_ticket").on(table.ticketId, table.createdAt)],
);

/** What happened to a ticket: status, assignment and field changes. */
export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Order of events; several share one transaction's time. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, string | null>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_ticket_events_ticket").on(table.ticketId, table.seq)],
);

/**
 * Uploaded files, stored in ATTACHMENTS_DIR under `storageKey`. An upload
 * belongs to its uploader until a ticket or message uses it; unused uploads
 * are removed after a day.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => ticketMessages.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id").references(() => users.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_attachments_ticket").on(table.ticketId),
    index("idx_attachments_unused")
      .on(table.createdAt)
      .where(sql`${table.ticketId} is null`),
  ],
);

/**
 * Emails and Slack messages to send. They are written in the same
 * transaction as the change they report, and the worker sends them.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    /** email, slack_channel or slack_dm */
    channel: text("channel").notNull(),
    /** What it reports, e.g. ticket_created, staff_reply. */
    kind: text("kind").notNull(),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    /** An email address, a Slack channel ID, or (slack_dm) the person's email. */
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    text: text("text").notNull(),
    html: text("html"),
    /** slack_dm: the email text, sent instead when the person has no Slack account. */
    fallbackText: text("fallback_text"),
    /** pending, sending, sent, failed or skipped */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_notifications_due")
      .on(table.nextAttemptAt)
      .where(sql`${table.status} in ('pending', 'sending')`),
    index("idx_notifications_created").on(table.createdAt),
  ],
);

/**
 * Requests to IAM for a new person, sent from a ticket. Saved
 * before IAM is called (`sending`, with `payload`); once IAM confirmed it
 * (`iamId`), this row keeps what IAM last said, for the ticket. The row's id
 * is the submission key, sent to IAM as `helpdesk:<id>`.
 */
export const identityRequests = pgTable(
  "identity_requests",
  {
    id: uuid("id").primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** IAM's ID, once IAM confirmed the request. */
    iamId: integer("iam_id"),
    /** The person's name, as sent. */
    name: text("name").notNull(),
    personType: text("person_type").notNull(),
    /** sending (not confirmed by IAM yet), refused (by IAM), open, approved, rejected or cancelled */
    status: text("status").notNull(),
    reason: text("reason").notNull().default(""),
    /** The person's status in IAM once approved. */
    personStatus: text("person_status"),
    workEmail: text("work_email"),
    url: text("url").notNull().default(""),
    sentById: uuid("sent_by_id").references(() => users.id, { onDelete: "set null" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** While sending: the exact details every delivery sends; dropped once IAM confirmed or refused them. */
    payload: jsonb("payload").$type<IamRequestCreate>(),
    /** While sending: why the last delivery got no clear answer. */
    lastError: text("last_error"),
    /** When Sentry heard that IAM had not confirmed the request for a day. */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("idx_identity_requests_ticket").on(table.ticketId, table.createdAt),
    index("idx_identity_requests_status").on(table.status),
  ],
);
