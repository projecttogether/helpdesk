import { and, desc, eq, sql } from "drizzle-orm";
import type {
  MessageCreate,
  RequestCreate,
  StaffTicketCreate,
  TicketMove,
  TicketPatch,
} from "@helpdesk/shared/api/tickets";
import { systemQuestion, validateAnswers, type AnswerIssue } from "@helpdesk/shared/form";
import { isStaff, roleSchema } from "@helpdesk/shared/roles";
import {
  isClosed,
  requesterCanReply,
  statusSchema,
  type Status,
  type Urgency,
} from "@helpdesk/shared/tickets";
import { config } from "../config";
import { getDb, type DbOrTx, type Tx } from "../db/client";
import { categories, formVersions, ticketEvents, ticketMessages, tickets, users } from "../db/schema";
import type { UserPrincipal } from "../auth/principal";
import { conflict, notFound, validationError } from "../http/errors";
import { linkUploads, lockUploads } from "../attachments/storage";
import { displayName, Outbox, type Recipient } from "../notifications/enqueue";
import {
  newTicketPost,
  requesterReplied,
  staffReplied,
  ticketAssigned,
  ticketDone,
  ticketReceived,
  unassignedReplyPost,
  type TicketFacts,
} from "../notifications/templates";
import { fileAnswerIds, storedAnswers, type StoredAnswer } from "./answers";

type TicketRow = typeof tickets.$inferSelect;
type UserRow = typeof users.$inferSelect;
type EventData = Record<string, string | null>;

const ISSUE_MESSAGES: Record<AnswerIssue, string> = {
  required: "Answer this question",
  invalid: "Check this answer",
  too_long: "This answer is too long",
  unknown_option: "Choose one of the options",
  too_many: "Too many files",
};

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: unknown; cause?: { code?: unknown } }).cause?.code ??
    (error as { code?: unknown }).code;
  return code === "23505";
}

const staffUrl = (number: number) => `${config().APP_URL}/tickets/${number}`;
const requesterUrl = (number: number) => `${config().APP_URL}/requests/${number}`;

async function person(tx: DbOrTx, id: string | null): Promise<UserRow | null> {
  if (!id) return null;
  const [row] = await tx.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

const recipient = (row: UserRow): Recipient => ({
  id: row.id,
  email: row.email,
  name: displayName(row),
  notifyVia: row.notifyVia,
});

async function categoryName(tx: DbOrTx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await tx.select({ name: categories.name }).from(categories).where(eq(categories.id, id));
  return row?.name ?? null;
}

async function facts(tx: DbOrTx, ticket: TicketRow, requester: UserRow | null): Promise<TicketFacts> {
  return {
    number: ticket.number,
    title: ticket.title,
    category: await categoryName(tx, ticket.categoryId),
    urgency: ticket.urgency as Urgency,
    requesterName: requester ? displayName(requester) : "—",
    url: staffUrl(ticket.number),
  };
}

async function recordEvents(
  tx: DbOrTx,
  ticketId: string,
  actorId: string | null,
  events: [string, EventData][],
) {
  if (events.length === 0) return;
  await tx.insert(ticketEvents).values(events.map(([kind, data]) => ({ ticketId, actorId, kind, data })));
}

async function lockTicket(tx: Tx, number: number, requesterId?: string): Promise<TicketRow> {
  const [ticket] = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.number, number), ...(requesterId ? [eq(tickets.requesterId, requesterId)] : [])))
    .for("update");
  if (!ticket) throw notFound("Ticket not found");
  return ticket;
}

/** A staff member who may be assigned, or a field error. */
async function assignable(tx: DbOrTx, id: string): Promise<UserRow> {
  const row = await person(tx, id);
  if (!row || !isStaff(roleSchema.safeParse(row.role).data)) {
    throw validationError({ assigneeId: "Choose an operator, admin or superadmin" });
  }
  return row;
}

/** The category's default assignee, when that person can still be assigned. */
async function defaultAssignee(
  tx: DbOrTx,
  category: { defaultAssigneeId: string | null },
): Promise<UserRow | null> {
  const row = await person(tx, category.defaultAssigneeId);
  return row && isStaff(roleSchema.safeParse(row.role).data) ? row : null;
}

/** Notifications for a new ticket: the requester, the Slack channel, and an assignee. */
async function announceNewTicket(
  tx: DbOrTx,
  ticket: TicketRow,
  requester: UserRow,
  assignee: UserRow | null,
  actor: UserPrincipal,
  /** Who chose the assignee; null when the category's default applies. */
  assignedBy: string | null,
) {
  const appName = config().APP_NAME;
  const ticketFacts = await facts(tx, ticket, requester);
  const outbox = new Outbox(ticket.id);
  outbox.email(
    "ticket_received",
    recipient(requester),
    ticketReceived(appName, displayName(requester), {
      ...ticketFacts,
      url: requesterUrl(ticket.number),
    }),
  );
  outbox.channel("ticket_created", newTicketPost(ticketFacts));
  if (assignee && assignee.id !== actor.id) {
    outbox.personal(
      "ticket_assigned",
      recipient(assignee),
      ticketAssigned(appName, displayName(assignee), ticketFacts, assignedBy),
    );
  }
  await outbox.flush(tx);
}

async function existingSubmission(
  db: DbOrTx,
  key: string,
  actor: UserPrincipal,
): Promise<{ number: number } | null> {
  const [row] = await db
    .select({ number: tickets.number, requesterId: tickets.requesterId, createdById: tickets.createdById })
    .from(tickets)
    .where(eq(tickets.submissionKey, key));
  if (!row) return null;
  if (row.requesterId !== actor.id && row.createdById !== actor.id) {
    throw conflict("This submission was already used", "duplicate_submission");
  }
  return { number: row.number };
}

/** Runs `create` once per submission key: a repeated send returns the first ticket. */
async function once(key: string, actor: UserPrincipal, create: () => Promise<{ number: number }>) {
  const existing = await existingSubmission(getDb(), key, actor);
  if (existing) return existing;
  try {
    return await create();
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await existingSubmission(getDb(), key, actor);
      if (again) return again;
    }
    throw error;
  }
}

/** A requester sends the form. */
export async function createFromForm(
  actor: UserPrincipal,
  input: RequestCreate,
): Promise<{ number: number }> {
  return once(input.submissionKey, actor, () =>
    getDb().transaction(async (tx) => {
      // Only the current form: an older version may lack questions that are required now.
      const [version] = await tx.select().from(formVersions).orderBy(desc(formVersions.version)).limit(1);
      if (version?.id !== input.formVersionId.toLowerCase()) {
        throw conflict("The form changed. Reload the page and send it again.", "form_changed");
      }
      const definition = version.definition;
      const active = await tx.select().from(categories).where(eq(categories.isActive, true));
      const { values, issues, visible } = validateAnswers(definition, input.answers, {
        categoryIds: active.map((category) => category.id),
      });
      if (Object.keys(issues).length > 0) {
        throw validationError(
          Object.fromEntries(
            Object.entries(issues).map(([id, issue]) => [`answers.${id}`, ISSUE_MESSAGES[issue]]),
          ),
        );
      }
      const title = String(values[systemQuestion(definition, "title")!.id]);
      const urgency = String(values[systemQuestion(definition, "urgency")!.id]);
      const category = active.find((item) => item.id === values[systemQuestion(definition, "category")!.id])!;
      const assignee = await defaultAssignee(tx, category);
      const requester = (await person(tx, actor.id))!;
      const files = await lockUploads(tx, fileAnswerIds(visible, values), actor.id);
      const answers = storedAnswers(visible, values, new Map(files.map((file) => [file.id, file.filename])));

      const [ticket] = await tx
        .insert(tickets)
        .values({
          title,
          urgency,
          categoryId: category.id,
          requesterId: actor.id,
          assigneeId: assignee?.id ?? null,
          source: "form",
          formVersionId: version.id,
          answers,
          submissionKey: input.submissionKey,
        })
        .returning();
      await linkUploads(tx, files, { ticketId: ticket!.id });
      await recordEvents(tx, ticket!.id, actor.id, [["created", { source: "form" }]]);
      // The category's default assignee: assigned by no one.
      if (assignee)
        await recordEvents(tx, ticket!.id, null, [["assigned", { from: null, to: displayName(assignee) }]]);
      await announceNewTicket(tx, ticket!, requester, assignee, actor, null);
      return { number: ticket!.number };
    }),
  );
}

/** Staff record a request for someone, e.g. after a phone call. */
export async function createByStaff(
  actor: UserPrincipal,
  input: StaffTicketCreate & { submissionKey: string },
) {
  return once(input.submissionKey, actor, () =>
    getDb().transaction(async (tx) => {
      const requester = await person(tx, input.requesterId);
      if (!requester || !roleSchema.safeParse(requester.role).success) {
        throw validationError({ requesterId: "Choose a person with access" });
      }
      const [category] = await tx.select().from(categories).where(eq(categories.id, input.categoryId));
      if (!category) throw validationError({ categoryId: "Choose a category" });
      const assignee = input.assigneeId
        ? await assignable(tx, input.assigneeId)
        : await defaultAssignee(tx, category);
      const files = await lockUploads(tx, input.attachmentIds ?? [], actor.id);
      const [ticket] = await tx
        .insert(tickets)
        .values({
          title: input.title,
          urgency: input.urgency ?? "normal",
          categoryId: category.id,
          requesterId: requester.id,
          assigneeId: assignee?.id ?? null,
          createdById: actor.id,
          source: "staff",
          submissionKey: input.submissionKey,
        })
        .returning();
      await linkUploads(tx, files, { ticketId: ticket!.id });
      const answers: StoredAnswer[] = [];
      if (input.description) {
        answers.push({
          questionId: "description",
          label: "Description",
          type: "long_text",
          display: [input.description],
          attachmentIds: [],
        });
      }
      if (files.length > 0) {
        answers.push({
          questionId: "files",
          label: "Attachments",
          type: "file",
          display: files.map((file) => file.filename),
          attachmentIds: files.map((file) => file.id),
        });
      }
      await tx.update(tickets).set({ answers }).where(eq(tickets.id, ticket!.id));
      await recordEvents(tx, ticket!.id, actor.id, [["created", { source: "staff" }]]);
      if (assignee) {
        // Chosen by staff, or the category's default (assigned by no one).
        await recordEvents(tx, ticket!.id, input.assigneeId ? actor.id : null, [
          ["assigned", { from: null, to: displayName(assignee) }],
        ]);
      }
      await announceNewTicket(
        tx,
        ticket!,
        requester,
        assignee,
        actor,
        input.assigneeId ? actor.name || actor.email : null,
      );
      return { number: ticket!.number };
    }),
  );
}

type Change = { values: Partial<typeof tickets.$inferInsert>; events: [string, EventData][]; outbox: Outbox };

/** A status change: closing time, board position, activity, and the requester's email when done. */
async function changeStatus(tx: DbOrTx, ticket: TicketRow, to: Status, change: Change) {
  const from = statusSchema.catch("new").parse(ticket.status);
  if (from === to) return;
  change.values.status = to;
  change.values.boardRank = null;
  if (isClosed(to)) change.values.closedAt = new Date();
  else if (isClosed(from)) change.values.closedAt = null;
  change.events.push(["status_changed", { from, to }]);
  if (to === "done") {
    const requester = await person(tx, ticket.requesterId);
    if (requester && roleSchema.safeParse(requester.role).success) {
      change.outbox.email(
        "ticket_done",
        recipient(requester),
        ticketDone(config().APP_NAME, displayName(requester), {
          ...(await facts(tx, ticket, requester)),
          url: requesterUrl(ticket.number),
        }),
      );
    }
  }
}

async function changeAssignee(
  tx: DbOrTx,
  ticket: TicketRow,
  to: string | null,
  actor: UserPrincipal,
  change: Change,
) {
  if (to === ticket.assigneeId) return;
  const previous = await person(tx, ticket.assigneeId);
  const next = to ? await assignable(tx, to) : null;
  change.values.assigneeId = to;
  change.events.push([
    "assigned",
    { from: previous ? displayName(previous) : null, to: next ? displayName(next) : null },
  ]);
  if (next && next.id !== actor.id) {
    const requester = await person(tx, ticket.requesterId);
    change.outbox.personal(
      "ticket_assigned",
      recipient(next),
      ticketAssigned(
        config().APP_NAME,
        displayName(next),
        { ...(await facts(tx, ticket, requester)), title: change.values.title ?? ticket.title },
        actor.name || actor.email,
      ),
    );
  }
}

async function saveChange(tx: DbOrTx, ticket: TicketRow, actor: UserPrincipal, change: Change) {
  if (change.events.length === 0) return ticket.revision;
  const [updated] = await tx
    .update(tickets)
    .set({ ...change.values, revision: sql`${tickets.revision} + 1`, updatedAt: sql`now()` })
    .where(eq(tickets.id, ticket.id))
    .returning({ revision: tickets.revision });
  await recordEvents(tx, ticket.id, actor.id, change.events);
  await change.outbox.flush(tx);
  return updated!.revision;
}

function staleCheck(ticket: TicketRow, revision: number) {
  if (ticket.revision !== revision) {
    throw conflict(
      "Someone else changed this ticket meanwhile. Reload it to see the changes.",
      "ticket_changed",
    );
  }
}

/** Staff change a ticket's fields. */
export async function updateTicket(
  actor: UserPrincipal,
  number: number,
  patch: TicketPatch,
): Promise<number> {
  return getDb().transaction(async (tx) => {
    const ticket = await lockTicket(tx, number);
    staleCheck(ticket, patch.revision);
    const change: Change = { values: {}, events: [], outbox: new Outbox(ticket.id) };
    if (patch.title !== undefined && patch.title !== ticket.title) {
      change.values.title = patch.title;
      change.events.push(["title_changed", { from: ticket.title, to: patch.title }]);
    }
    if (patch.urgency !== undefined && patch.urgency !== ticket.urgency) {
      change.values.urgency = patch.urgency;
      change.events.push(["urgency_changed", { from: ticket.urgency, to: patch.urgency }]);
    }
    if (patch.categoryId !== undefined && patch.categoryId !== ticket.categoryId) {
      const name = await categoryName(tx, patch.categoryId);
      if (name === null) throw validationError({ categoryId: "Choose a category" });
      change.values.categoryId = patch.categoryId;
      change.events.push(["category_changed", { from: await categoryName(tx, ticket.categoryId), to: name }]);
    }
    if (patch.dueDate !== undefined && patch.dueDate !== ticket.dueDate) {
      change.values.dueDate = patch.dueDate;
      change.events.push(["due_date_changed", { from: ticket.dueDate, to: patch.dueDate }]);
    }
    if (patch.assigneeId !== undefined) await changeAssignee(tx, ticket, patch.assigneeId, actor, change);
    if (patch.status !== undefined) await changeStatus(tx, ticket, patch.status, change);
    return saveChange(tx, ticket, actor, change);
  });
}

/**
 * A drag on the board: maybe a new status, and the column's new order. The
 * order is layout only: it records no activity and checks no revision.
 */
export async function moveTicket(actor: UserPrincipal, number: number, move: TicketMove): Promise<number> {
  return getDb().transaction(async (tx) => {
    const ticket = await lockTicket(tx, number);
    let revision = ticket.revision;
    if (move.status !== ticket.status) {
      staleCheck(ticket, move.revision);
      const change: Change = { values: {}, events: [], outbox: new Outbox(ticket.id) };
      await changeStatus(tx, ticket, move.status, change);
      revision = await saveChange(tx, ticket, actor, change);
    }
    const order = move.order.includes(ticket.id) ? move.order : [...move.order, ticket.id];
    if (order.length > 0) {
      const values = sql.join(
        order.map((id, index) => sql`(${id}::uuid, ${index + 1}::double precision)`),
        sql`, `,
      );
      await tx.execute(sql`
        update ${tickets} set board_rank = ranks.rank
        from (values ${values}) as ranks(id, rank)
        where ${tickets.id} = ranks.id and ${tickets.status} = ${move.status}`);
    }
    return revision;
  });
}

/** Staff reply to the requester or write an internal note. */
export async function addStaffMessage(actor: UserPrincipal, number: number, input: MessageCreate) {
  return getDb().transaction(async (tx) => {
    const ticket = await lockTicket(tx, number);
    const visibility = input.visibility ?? "public";
    const body = input.body ?? "";
    const files = await lockUploads(tx, input.attachmentIds ?? [], actor.id);
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId: ticket.id, authorId: actor.id, visibility, fromRequester: false, body })
      .returning();
    await linkUploads(tx, files, { ticketId: ticket.id, messageId: message!.id });
    await tx
      .update(tickets)
      .set({ updatedAt: sql`now()` })
      .where(eq(tickets.id, ticket.id));
    if (visibility === "public") {
      const requester = await person(tx, ticket.requesterId);
      if (requester && requester.id !== actor.id && roleSchema.safeParse(requester.role).success) {
        const outbox = new Outbox(ticket.id);
        outbox.email(
          "staff_reply",
          recipient(requester),
          staffReplied(
            config().APP_NAME,
            displayName(requester),
            { ...(await facts(tx, ticket, requester)), url: requesterUrl(ticket.number) },
            actor.name || actor.email,
            body || "📎",
          ),
        );
        await outbox.flush(tx);
      }
    }
    return message!.id;
  });
}

/**
 * The requester replies. A reply to a ticket waiting for them puts it back
 * in progress; a reply to a done ticket (within REOPEN_DAYS) reopens it.
 */
export async function addRequesterMessage(actor: UserPrincipal, number: number, input: MessageCreate) {
  return getDb().transaction(async (tx) => {
    const ticket = await lockTicket(tx, number, actor.id);
    const status = statusSchema.catch("new").parse(ticket.status);
    if (!requesterCanReply({ status, closedAt: ticket.closedAt })) {
      throw conflict("This request is closed. Send a new request instead.", "request_closed");
    }
    const body = input.body ?? "";
    const files = await lockUploads(tx, input.attachmentIds ?? [], actor.id);
    const [message] = await tx
      .insert(ticketMessages)
      .values({ ticketId: ticket.id, authorId: actor.id, visibility: "public", fromRequester: true, body })
      .returning();
    await linkUploads(tx, files, { ticketId: ticket.id, messageId: message!.id });

    const change: Change = { values: {}, events: [], outbox: new Outbox(ticket.id) };
    const reopened = status === "done";
    if (reopened) {
      const to: Status = ticket.assigneeId ? "in_progress" : "new";
      change.values = { status: to, closedAt: null, boardRank: null };
      change.events.push(["reopened", { from: status, to }]);
    } else if (status === "waiting_for_requester") {
      change.values = { status: "in_progress", boardRank: null };
      change.events.push(["status_changed", { from: status, to: "in_progress" }]);
    }
    const requester = (await person(tx, actor.id))!;
    // Someone who lost their staff role hears nothing more; the reply goes to the channel.
    const assigned = await person(tx, ticket.assigneeId);
    const assignee = assigned && isStaff(roleSchema.safeParse(assigned.role).data) ? assigned : null;
    const ticketFacts = await facts(tx, ticket, requester);
    if (assignee && assignee.id !== actor.id) {
      change.outbox.personal(
        "requester_reply",
        recipient(assignee),
        requesterReplied(config().APP_NAME, displayName(assignee), ticketFacts, body || "📎", reopened),
      );
    } else if (!assignee) {
      change.outbox.channel("requester_reply", unassignedReplyPost(ticketFacts, reopened));
    }
    if (change.events.length > 0) {
      await saveChange(tx, ticket, actor, change);
    } else {
      await tx
        .update(tickets)
        .set({ updatedAt: sql`now()` })
        .where(eq(tickets.id, ticket.id));
      await change.outbox.flush(tx);
    }
    return message!.id;
  });
}
