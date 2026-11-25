import { z } from "zod";
import { idSchema } from "./common";
import { answersSchema, questionTypeSchema, validDate } from "../form";
import { MAX_ATTACHMENTS_PER_MESSAGE, statusSchema, urgencySchema } from "../tickets";
import { identityRequestSchema } from "./identity";

export const personRefSchema = z.object({ id: idSchema, name: z.string(), email: z.string() });
export type PersonRef = z.infer<typeof personRefSchema>;

export const attachmentSchema = z.object({
  id: idSchema,
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** One answered question as it was asked, kept with the ticket. */
export const answerSchema = z.object({
  questionId: z.string(),
  label: z.string(),
  type: questionTypeSchema,
  /** What to show: the text, the chosen labels, or the file names. */
  display: z.array(z.string()),
  attachments: z.array(attachmentSchema).default([]),
});
export type Answer = z.infer<typeof answerSchema>;

export const categoryRefSchema = z.object({ id: idSchema, name: z.string() });

export const ticketSummarySchema = z.object({
  id: idSchema,
  number: z.number().int(),
  title: z.string(),
  status: statusSchema,
  urgency: urgencySchema,
  category: categoryRefSchema.nullable(),
  requester: personRefSchema.nullable(),
  assignee: personRefSchema.nullable(),
  dueDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
  revision: z.number().int(),
  /** Replies and notes. */
  messageCount: z.number().int(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

const assigneeFilter = z.union([z.literal("me"), z.literal("none"), idSchema]);

export const boardQuerySchema = z.object({
  categoryId: idSchema.optional(),
  assignee: assigneeFilter.optional(),
  urgency: urgencySchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const boardSchema = z.object({
  columns: z.array(
    z.object({
      status: statusSchema,
      tickets: z.array(ticketSummarySchema),
      /** More tickets match than the column shows (closed columns show recent ones). */
      total: z.number().int(),
    }),
  ),
});
export type Board = z.infer<typeof boardSchema>;

export const ticketListQuerySchema = z.object({
  status: z.union([statusSchema, z.enum(["open", "closed", "all"])]).default("open"),
  categoryId: idSchema.optional(),
  assignee: assigneeFilter.optional(),
  urgency: urgencySchema.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["updated", "created", "number", "urgency"]).default("updated"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TicketListQuery = z.input<typeof ticketListQuerySchema>;
export const ticketListSchema = z.object({ items: z.array(ticketSummarySchema), total: z.number().int() });

export const messageSchema = z.object({
  id: idSchema,
  author: personRefSchema.nullable(),
  /** public: the requester sees it; internal: only staff. */
  visibility: z.enum(["public", "internal"]),
  /** Written by the requester (not by staff). */
  fromRequester: z.boolean(),
  body: z.string(),
  createdAt: z.string(),
  attachments: z.array(attachmentSchema),
});
export type Message = z.infer<typeof messageSchema>;

export const EVENT_KINDS = [
  "created",
  "status_changed",
  "assigned",
  "urgency_changed",
  "category_changed",
  "title_changed",
  "due_date_changed",
  "reopened",
  /** Staff asked IAM for a person (`name`). */
  "identity_requested",
  /** IAM answered (`name`, `to`: approved, rejected, cancelled, or the person's status, e.g. active). */
  "identity_request_changed",
] as const;
export const eventSchema = z.object({
  id: idSchema,
  actor: personRefSchema.nullable(),
  kind: z.enum(EVENT_KINDS),
  /** from / to values; people and categories by name. */
  data: z.record(z.string(), z.union([z.string(), z.null()])),
  createdAt: z.string(),
});
export type TicketEvent = z.infer<typeof eventSchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  source: z.enum(["form", "staff"]),
  createdBy: personRefSchema.nullable(),
  formVersion: z.number().int().nullable(),
  answers: z.array(answerSchema),
  messages: z.array(messageSchema),
  events: z.array(eventSchema),
  /** Requests to IAM for new people, sent from this ticket. */
  identityRequests: z.array(identityRequestSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

/** A calendar date the database can store (its dates start in the year 1). */
const dueDateSchema = z
  .string()
  .refine((value) => validDate(value) && value >= "0001-01-01", "Enter a date")
  .nullable();

/** Staff changes; `revision` refuses a change to a ticket someone else changed meanwhile. */
export const ticketPatchSchema = z.object({
  revision: z.number().int().min(1),
  title: z.string().trim().min(1, "Enter a title").max(120).optional(),
  status: statusSchema.optional(),
  urgency: urgencySchema.optional(),
  categoryId: idSchema.optional(),
  assigneeId: idSchema.nullable().optional(),
  dueDate: dueDateSchema.optional(),
});
export type TicketPatch = z.infer<typeof ticketPatchSchema>;

/** A drag on the board: the ticket's new status and the order of that column after the drop. */
export const ticketMoveSchema = z.object({
  revision: z.number().int().min(1),
  status: statusSchema,
  order: z.array(idSchema).max(1000),
});
export type TicketMove = z.infer<typeof ticketMoveSchema>;

const attachmentIdsSchema = z.array(idSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]);

export const messageCreateSchema = z
  .object({
    body: z.string().trim().max(10_000).default(""),
    visibility: z.enum(["public", "internal"]).default("public"),
    attachmentIds: attachmentIdsSchema,
  })
  .refine((value) => value.body !== "" || value.attachmentIds.length > 0, {
    path: ["body"],
    message: "Write a message or add a file",
  });
export type MessageCreate = z.input<typeof messageCreateSchema>;

/** A requester sends the form. `submissionKey` makes a repeated send create one ticket. */
export const requestCreateSchema = z.object({
  formVersionId: idSchema,
  answers: answersSchema,
  submissionKey: idSchema,
});
export type RequestCreate = z.infer<typeof requestCreateSchema>;
export const requestCreatedSchema = z.object({ number: z.number().int() });

/** Staff record a request for someone, e.g. after a phone call. */
export const staffTicketCreateSchema = z.object({
  requesterId: idSchema,
  title: z.string().trim().min(1, "Enter a title").max(120),
  categoryId: idSchema,
  urgency: urgencySchema.default("normal"),
  description: z.string().trim().max(10_000).default(""),
  assigneeId: idSchema.nullable().default(null),
  attachmentIds: attachmentIdsSchema,
  submissionKey: idSchema,
});
export type StaffTicketCreate = z.input<typeof staffTicketCreateSchema>;

export const requestSummarySchema = z.object({
  id: idSchema,
  number: z.number().int(),
  title: z.string(),
  status: statusSchema,
  category: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: z.string().nullable(),
});
export type RequestSummary = z.infer<typeof requestSummarySchema>;
export const requestListQuerySchema = z.object({
  status: z.enum(["open", "closed", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const requestListSchema = z.object({ items: z.array(requestSummarySchema), total: z.number().int() });

/** A requester's own ticket: no internal notes, no activity. */
export const requestDetailSchema = requestSummarySchema.extend({
  urgency: urgencySchema,
  assigneeName: z.string().nullable(),
  answers: z.array(answerSchema),
  messages: z.array(messageSchema),
  /** The requester may reply; a reply to a done ticket reopens it. */
  canReply: z.boolean(),
  replyReopens: z.boolean(),
});
export type RequestDetail = z.infer<typeof requestDetailSchema>;
