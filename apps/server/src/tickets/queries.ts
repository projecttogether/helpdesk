import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  Answer,
  Board,
  BoardQuery,
  Message,
  PersonRef,
  RequestDetail,
  RequestSummary,
  TicketDetail,
  TicketEvent,
  TicketSummary,
  ticketListQuerySchema,
} from "@helpdesk/shared/api/tickets";
import {
  BOARD_CLOSED_DAYS,
  CLOSED_STATUSES,
  requesterCanReply,
  STATUSES,
  statusSchema,
  urgencySchema,
  type Status,
} from "@helpdesk/shared/tickets";
import type { z } from "zod";
import { EVENT_KINDS } from "@helpdesk/shared/api/tickets";
import type { DbOrTx } from "../db/client";
import {
  attachments,
  categories,
  formVersions,
  ticketEvents,
  ticketMessages,
  tickets,
  users,
} from "../db/schema";
import { toAttachment } from "../attachments/storage";
import type { UserPrincipal } from "../auth/principal";
import { iso, isoRequired } from "../modules/util";
import { identityRequestsOf } from "../identity/service";

const requesters = alias(users, "requester");
const assignees = alias(users, "assignee");
const creators = alias(users, "creator");

const OPEN_LIMIT = 300;
const CLOSED_LIMIT = 50;

const messageCount = sql<number>`(select count(*) from ${ticketMessages} where ${ticketMessages.ticketId} = ${tickets.id})::int`;

const summaryColumns = {
  ticket: tickets,
  categoryName: categories.name,
  requesterName: requesters.name,
  requesterEmail: requesters.email,
  assigneeName: assignees.name,
  assigneeEmail: assignees.email,
  messageCount,
};

type SummaryRow = {
  ticket: typeof tickets.$inferSelect;
  categoryName: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  messageCount: number;
};

function ref(id: string | null, name: string | null, email: string | null): PersonRef | null {
  if (!id || email === null) return null;
  return { id, name: name?.trim() || email, email };
}

function toSummary(row: SummaryRow): TicketSummary {
  const ticket = row.ticket;
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    status: statusSchema.catch("new").parse(ticket.status),
    urgency: urgencySchema.catch("normal").parse(ticket.urgency),
    category:
      ticket.categoryId && row.categoryName ? { id: ticket.categoryId, name: row.categoryName } : null,
    requester: ref(ticket.requesterId, row.requesterName, row.requesterEmail),
    assignee: ref(ticket.assigneeId, row.assigneeName, row.assigneeEmail),
    dueDate: ticket.dueDate,
    createdAt: isoRequired(ticket.createdAt),
    updatedAt: isoRequired(ticket.updatedAt),
    closedAt: iso(ticket.closedAt),
    revision: ticket.revision,
    messageCount: row.messageCount,
  };
}

function baseSummaryQuery(db: DbOrTx) {
  return db
    .select(summaryColumns)
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .leftJoin(requesters, eq(requesters.id, tickets.requesterId))
    .leftJoin(assignees, eq(assignees.id, tickets.assigneeId));
}

/** Filters shared by the board and the list. */
function filters(
  query: { categoryId?: string; assignee?: string; urgency?: string; q?: string },
  viewer: UserPrincipal,
): SQL[] {
  const where: SQL[] = [];
  if (query.categoryId) where.push(eq(tickets.categoryId, query.categoryId));
  if (query.urgency) where.push(eq(tickets.urgency, query.urgency));
  if (query.assignee === "me") where.push(eq(tickets.assigneeId, viewer.id));
  else if (query.assignee === "none") where.push(isNull(tickets.assigneeId));
  else if (query.assignee) where.push(eq(tickets.assigneeId, query.assignee));
  const q = query.q?.trim();
  if (q) {
    const number = /^#?(\d{1,9})$/.exec(q)?.[1];
    const pattern = `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    where.push(
      or(
        ilike(tickets.title, pattern),
        ilike(requesters.name, pattern),
        ilike(requesters.email, pattern),
        ...(number ? [eq(tickets.number, Number(number))] : []),
      )!,
    );
  }
  return where;
}

const boardOrder = [sql`${tickets.boardRank} asc nulls last`, asc(tickets.createdAt)];

/** The board: one column per status; done and cancelled show recently closed tickets only. */
export async function loadBoard(db: DbOrTx, query: BoardQuery, viewer: UserPrincipal): Promise<Board> {
  const shared = filters(query, viewer);
  const closedSince = new Date(Date.now() - BOARD_CLOSED_DAYS * 24 * 60 * 60_000);
  const columns = await Promise.all(
    STATUSES.map(async (status) => {
      const closed = CLOSED_STATUSES.includes(status);
      const where = and(
        eq(tickets.status, status),
        ...(closed ? [gte(tickets.closedAt, closedSince)] : []),
        ...shared,
      );
      const [rows, [total]] = await Promise.all([
        baseSummaryQuery(db)
          .where(where)
          .orderBy(...(closed ? [desc(tickets.closedAt)] : boardOrder))
          .limit(closed ? CLOSED_LIMIT : OPEN_LIMIT),
        db
          .select({ value: count() })
          .from(tickets)
          .leftJoin(requesters, eq(requesters.id, tickets.requesterId))
          .where(where),
      ]);
      return { status, tickets: rows.map(toSummary), total: total?.value ?? 0 };
    }),
  );
  return { columns };
}

const URGENCY_ORDER = sql`case ${tickets.urgency} when 'very_urgent' then 0 when 'urgent' then 1 when 'normal' then 2 else 3 end`;

export async function listTickets(
  db: DbOrTx,
  query: z.infer<typeof ticketListQuerySchema>,
  viewer: UserPrincipal,
): Promise<{ items: TicketSummary[]; total: number }> {
  const where = filters(query, viewer);
  if (query.status === "open") where.push(sql`${tickets.status} not in ('done', 'cancelled')`);
  else if (query.status === "closed") where.push(inArray(tickets.status, [...CLOSED_STATUSES]));
  else if (query.status !== "all") where.push(eq(tickets.status, query.status));
  const order =
    query.sort === "created"
      ? [desc(tickets.createdAt)]
      : query.sort === "number"
        ? [desc(tickets.number)]
        : query.sort === "urgency"
          ? [URGENCY_ORDER, desc(tickets.updatedAt)]
          : [desc(tickets.updatedAt)];
  const [rows, [total]] = await Promise.all([
    baseSummaryQuery(db)
      .where(and(...where))
      .orderBy(...order)
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: count() })
      .from(tickets)
      .leftJoin(requesters, eq(requesters.id, tickets.requesterId))
      .where(and(...where)),
  ]);
  return { items: rows.map(toSummary), total: total?.value ?? 0 };
}

async function attachmentsOf(db: DbOrTx, ticketId: string) {
  return db
    .select()
    .from(attachments)
    .where(eq(attachments.ticketId, ticketId))
    .orderBy(asc(attachments.createdAt));
}

function answersWithFiles(
  ticket: typeof tickets.$inferSelect,
  files: (typeof attachments.$inferSelect)[],
): Answer[] {
  const byId = new Map(files.map((file) => [file.id, file]));
  return ticket.answers.map((answer) => ({
    questionId: answer.questionId,
    label: answer.label,
    type: answer.type,
    display: answer.display,
    attachments: answer.attachmentIds
      .map((id) => byId.get(id))
      .filter((file): file is NonNullable<typeof file> => Boolean(file))
      .map(toAttachment),
  }));
}

async function messagesOf(
  db: DbOrTx,
  ticketId: string,
  files: (typeof attachments.$inferSelect)[],
  onlyPublic: boolean,
): Promise<Message[]> {
  const rows = await db
    .select({ message: ticketMessages, name: users.name, email: users.email })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorId))
    .where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        ...(onlyPublic ? [eq(ticketMessages.visibility, "public")] : []),
      ),
    )
    .orderBy(asc(ticketMessages.createdAt));
  return rows.map(({ message, name, email }) => ({
    id: message.id,
    author: ref(message.authorId, name, email),
    visibility: message.visibility === "internal" ? "internal" : "public",
    fromRequester: message.fromRequester,
    body: message.body,
    createdAt: isoRequired(message.createdAt),
    attachments: files.filter((file) => file.messageId === message.id).map(toAttachment),
  }));
}

/** Everything staff see of a ticket. */
export async function loadTicketDetail(db: DbOrTx, number: number): Promise<TicketDetail | null> {
  const [row] = await db
    .select({
      ...summaryColumns,
      creatorName: creators.name,
      creatorEmail: creators.email,
      version: formVersions.version,
    })
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .leftJoin(requesters, eq(requesters.id, tickets.requesterId))
    .leftJoin(assignees, eq(assignees.id, tickets.assigneeId))
    .leftJoin(creators, eq(creators.id, tickets.createdById))
    .leftJoin(formVersions, eq(formVersions.id, tickets.formVersionId))
    .where(eq(tickets.number, number));
  if (!row) return null;
  const ticket = row.ticket;
  const files = await attachmentsOf(db, ticket.id);
  const [messages, eventRows, identity] = await Promise.all([
    messagesOf(db, ticket.id, files, false),
    db
      .select({ event: ticketEvents, name: users.name, email: users.email })
      .from(ticketEvents)
      .leftJoin(users, eq(users.id, ticketEvents.actorId))
      .where(eq(ticketEvents.ticketId, ticket.id))
      .orderBy(asc(ticketEvents.seq)),
    identityRequestsOf(db, ticket.id),
  ]);
  const events: TicketEvent[] = eventRows.flatMap(({ event, name, email }) => {
    const kind = (EVENT_KINDS as readonly string[]).includes(event.kind)
      ? (event.kind as TicketEvent["kind"])
      : null;
    if (!kind) return [];
    return [
      {
        id: event.id,
        actor: ref(event.actorId, name, email),
        kind,
        data: event.data,
        createdAt: isoRequired(event.createdAt),
      },
    ];
  });
  return {
    ...toSummary(row),
    source: ticket.source === "staff" ? "staff" : "form",
    createdBy: ref(ticket.createdById, row.creatorName, row.creatorEmail),
    formVersion: row.version ?? null,
    answers: answersWithFiles(ticket, files),
    messages,
    events,
    identityRequests: identity,
  };
}

/** A requester's own tickets. */
export async function listRequests(
  db: DbOrTx,
  requesterId: string,
  query: { status: "open" | "closed" | "all"; limit: number; offset: number },
): Promise<{ items: RequestSummary[]; total: number }> {
  const where = and(
    eq(tickets.requesterId, requesterId),
    query.status === "open"
      ? sql`${tickets.status} not in ('done', 'cancelled')`
      : query.status === "closed"
        ? inArray(tickets.status, [...CLOSED_STATUSES])
        : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ ticket: tickets, categoryName: categories.name })
      .from(tickets)
      .leftJoin(categories, eq(categories.id, tickets.categoryId))
      .where(where)
      .orderBy(desc(tickets.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(tickets).where(where),
  ]);
  return {
    items: rows.map(({ ticket, categoryName }) => requestSummary(ticket, categoryName)),
    total: total?.value ?? 0,
  };
}

function requestSummary(ticket: typeof tickets.$inferSelect, categoryName: string | null): RequestSummary {
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    status: statusSchema.catch("new").parse(ticket.status),
    category: categoryName,
    createdAt: isoRequired(ticket.createdAt),
    updatedAt: isoRequired(ticket.updatedAt),
    closedAt: iso(ticket.closedAt),
  };
}

/** What a requester sees of their own ticket: no internal notes, no activity. */
export async function loadRequestDetail(
  db: DbOrTx,
  requesterId: string,
  number: number,
): Promise<RequestDetail | null> {
  const [row] = await db
    .select({
      ticket: tickets,
      categoryName: categories.name,
      assigneeName: assignees.name,
      assigneeEmail: assignees.email,
    })
    .from(tickets)
    .leftJoin(categories, eq(categories.id, tickets.categoryId))
    .leftJoin(assignees, eq(assignees.id, tickets.assigneeId))
    .where(and(eq(tickets.number, number), eq(tickets.requesterId, requesterId)));
  if (!row) return null;
  const ticket = row.ticket;
  // Files of internal notes stay out: messages are public ones only, and answers name their own files.
  const files = await attachmentsOf(db, ticket.id);
  const messages = await messagesOf(db, ticket.id, files, true);
  const status = statusSchema.catch("new").parse(ticket.status) as Status;
  const canReply = requesterCanReply({ status, closedAt: ticket.closedAt });
  return {
    ...requestSummary(ticket, row.categoryName),
    urgency: urgencySchema.catch("normal").parse(ticket.urgency),
    assigneeName: ticket.assigneeId ? row.assigneeName?.trim() || row.assigneeEmail || null : null,
    answers: answersWithFiles(ticket, files),
    messages,
    canReply,
    replyReopens: canReply && status === "done",
  };
}
