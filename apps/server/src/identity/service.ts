import { and, asc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  IDENTITY_REQUEST_STATUSES,
  type IdentityRequest,
  type identityRequestInputSchema,
} from "@helpdesk/shared/api/identity";
import { config } from "../config";
import { getDb, type DbOrTx } from "../db/client";
import { identityRequests, ticketEvents, tickets, users } from "../db/schema";
import type { UserPrincipal } from "../auth/principal";
import { getStoredIam } from "../core/settings";
import { AppError, conflict, notFound, validationError } from "../http/errors";
import { logger } from "../logger";
import { iamClient, iamConfigured, IamError, type IamRequest, type IamRequestCreate } from "./iam";

/**
 * Identity requests: staff ask IAM for a new person from a ticket.
 * IAM keeps the request and decides; the helpdesk keeps what IAM last said
 * (`identity_requests`) and notes each step in the ticket's activity. The
 * worker asks IAM for news (`syncIdentityRequests`).
 *
 * A send is saved before IAM is called (status `sending`, with the exact
 * details in `payload`), and delivered until IAM confirms it: by the send
 * itself, by "Send again", or by the worker. Every delivery sends the stored
 * details under the same reference, so IAM keeps one request whatever
 * fails in between, and what the ticket shows is what IAM got.
 */

type Row = typeof identityRequests.$inferSelect;
type Input = z.output<typeof identityRequestInputSchema>;

/** IAM's refusals as helpdesk errors, for staff. */
function asAppError(error: unknown): unknown {
  if (!(error instanceof IamError)) return error;
  switch (error.kind) {
    case "invalid":
      return error.fields && Object.keys(error.fields).length > 0
        ? validationError(error.fields, error.message)
        : new AppError(422, "iam_refused", error.message);
    case "unreachable":
    case "failed":
      return new AppError(502, "iam_unavailable", error.message);
    case "not_found":
      return notFound(error.message);
    default:
      return conflict(error.message, `iam_${error.kind}`);
  }
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw asAppError(error);
  }
}

export function toView(row: Row, sentBy: { name: string | null; email: string } | null): IdentityRequest {
  return {
    id: row.id,
    name: row.name,
    personType: row.personType,
    status: IDENTITY_REQUEST_STATUSES.find((status) => status === row.status) ?? "sending",
    reason: row.reason,
    lastError: row.status === "sending" ? row.lastError : null,
    personStatus: row.personStatus,
    workEmail: row.workEmail,
    url: row.url,
    sentBy: sentBy ? sentBy.name?.trim() || sentBy.email : null,
    createdAt: row.createdAt.toISOString(),
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
  };
}

/** The requests sent from a ticket, oldest first. */
export async function identityRequestsOf(db: DbOrTx, ticketId: string): Promise<IdentityRequest[]> {
  const rows = await db
    .select({ row: identityRequests, name: users.name, email: users.email })
    .from(identityRequests)
    .leftJoin(users, eq(users.id, identityRequests.sentById))
    .where(eq(identityRequests.ticketId, ticketId))
    .orderBy(asc(identityRequests.createdAt));
  return rows.map(({ row, name, email }) => toView(row, email === null ? null : { name, email }));
}

/**
 * The activity entries an answer of IAM adds to what the row knows: a
 * decision, and accounts that became ready. Null: the answer is older than
 * the row (a decided request never opens again), so it must not be saved.
 */
function changes(row: Pick<Row, "status" | "personStatus">, answer: IamRequest): string[] | null {
  if (row.status !== "open" && answer.status !== row.status) return null;
  const steps: string[] = [];
  if (row.status === "open" && answer.status !== "open") steps.push(answer.status);
  if (answer.person?.status === "active" && row.personStatus !== "active") steps.push("active");
  return steps;
}

const externalId = (id: string) => `helpdesk:${id}`;

/**
 * Saves IAM's answer under the row's lock and notes what changed in the
 * ticket's activity. Returns whether anything changed; an answer older than
 * the row, or about another request, is not saved.
 */
async function apply(id: string, answer: IamRequest, actorId: string | null): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(identityRequests).where(eq(identityRequests.id, id)).for("update");
    if (!row || answer.externalId !== externalId(id)) return false;
    const steps = changes(row, answer);
    if (steps === null) return false;
    await tx
      .update(identityRequests)
      .set({
        status: answer.status,
        reason: answer.reason,
        personStatus: answer.person?.status ?? null,
        workEmail: answer.person?.workEmail ?? null,
        url: answer.url || row.url,
        checkedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(identityRequests.id, id));
    if (steps.length > 0) {
      await tx.insert(ticketEvents).values(
        steps.map((to) => ({
          ticketId: row.ticketId,
          actorId,
          kind: "identity_request_changed",
          data: { name: row.name, to, reason: to === "rejected" ? answer.reason || null : null },
        })),
      );
    }
    return steps.length > 0;
  });
}

/** Notes in the ticket's activity what IAM's first answer says: the request, and a decision already made. */
async function confirmedEvents(tx: DbOrTx, row: Row, answer: IamRequest): Promise<void> {
  await tx.insert(ticketEvents).values({
    ticketId: row.ticketId,
    actorId: row.sentById,
    kind: "identity_requested",
    data: { name: row.name, to: answer.status },
  });
  const steps = changes({ status: "open", personStatus: null }, answer) ?? [];
  if (steps.length > 0) {
    await tx.insert(ticketEvents).values(
      steps.map((to) => ({
        ticketId: row.ticketId,
        actorId: null,
        kind: "identity_request_changed",
        data: { name: row.name, to, reason: to === "rejected" ? answer.reason || null : null },
      })),
    );
  }
}

/** IAM's refusal as one line, for the ticket: the message and the fields it names. */
function refusal(error: IamError): string {
  const fields = Object.values(error.fields ?? {});
  return (fields.length > 0 ? fields.join(" ") : error.message).slice(0, 1000);
}

/**
 * IAM said no for good and stored nothing: the details are invalid (422),
 * or the reference belongs to other details or a decided request (409
 * `reference_reused`, `request_closed`). Any other answer may change on a
 * later try.
 */
const isRefusal = (error: IamError) =>
  error.kind === "invalid" ||
  (error.kind === "closed" && (error.code === "reference_reused" || error.code === "request_closed"));

type Delivery =
  | { outcome: "confirmed" }
  | { outcome: "refused"; error: IamError | null }
  | { outcome: "unconfirmed"; error: IamError }
  | { outcome: "skipped" | "gone" };

/**
 * Delivers a saved request with its saved details, under its row's lock:
 * the send, "Send again" and the worker never deliver the same request at
 * once, and IAM's answer is written in the same transaction. `wait`: wait
 * for another delivery to finish (people); the worker skips a locked row.
 * A saved request is never deleted: a refusal keeps it on the ticket as
 * refused, without its details, and its key is never used again.
 */
async function deliver(id: string, options: { wait: boolean }): Promise<Delivery> {
  const stored = await getStoredIam(getDb());
  return getDb().transaction(async (tx): Promise<Delivery> => {
    const query = tx.select().from(identityRequests).where(eq(identityRequests.id, id));
    const [row] = options.wait ? await query.for("update") : await query.for("update", { skipLocked: true });
    // Gone (its ticket was deleted), or another delivery holds it (the worker skips it).
    if (!row) return { outcome: options.wait ? "gone" : "skipped" };
    if (row.status === "refused") return { outcome: "refused", error: null };
    if (row.status !== "sending" || !row.payload) return { outcome: "confirmed" };

    let answer: IamRequest;
    try {
      answer = await iamClient(stored).create(row.payload);
      if (answer.externalId !== externalId(id))
        throw new IamError("failed", "IAM answered about another request.");
    } catch (error) {
      if (!(error instanceof IamError)) throw error;
      if (isRefusal(error)) {
        const reason = refusal(error);
        await tx
          .update(identityRequests)
          .set({
            status: "refused",
            reason,
            payload: null,
            lastError: null,
            checkedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(identityRequests.id, id));
        await tx.insert(ticketEvents).values({
          ticketId: row.ticketId,
          actorId: null,
          kind: "identity_request_changed",
          data: { name: row.name, to: "refused", reason },
        });
        return { outcome: "refused", error };
      }
      await tx
        .update(identityRequests)
        .set({
          lastError: error.message.slice(0, 1000),
          checkedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(identityRequests.id, id));
      return { outcome: "unconfirmed", error };
    }
    await tx
      .update(identityRequests)
      .set({
        iamId: answer.id,
        status: answer.status,
        reason: answer.reason,
        personStatus: answer.person?.status ?? null,
        workEmail: answer.person?.workEmail ?? null,
        url: answer.url,
        payload: null,
        lastError: null,
        checkedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(identityRequests.id, id));
    await confirmedEvents(tx, row, answer);
    return { outcome: "confirmed" };
  });
}

/**
 * A request IAM refused (now or before), as `iam_refused` with IAM's field
 * messages: the dialog shows them and sends the corrected details under a
 * new key. (Helpdesk's own checks answer `validation_error`; the key stays.)
 */
function refusedError(error: IamError | null): AppError {
  if (!error) return conflict("IAM refused this request. Send a corrected one.", "iam_refused");
  const fields = error.fields && Object.keys(error.fields).length > 0 ? error.fields : undefined;
  return new AppError(fields ? 422 : 409, "iam_refused", error.message, fields);
}

/**
 * Sends a request to IAM from a ticket: saved first, then delivered.
 * "confirmed": IAM has it. "unconfirmed": saved, but IAM did not answer
 * clearly; "Send again" and the worker deliver it. A refusal throws IAM's
 * errors: a fresh send is forgotten, a retried one stays on the ticket as
 * refused. The same `submissionKey` again delivers the saved details, never
 * new ones.
 */
export async function sendIdentityRequest(
  actor: UserPrincipal,
  number: number,
  input: Input,
): Promise<"confirmed" | "unconfirmed"> {
  const db = getDb();
  const [ticket] = await db
    .select({ id: tickets.id, number: tickets.number })
    .from(tickets)
    .where(eq(tickets.number, number));
  if (!ticket) throw notFound("Ticket not found");
  const savedOn = async () =>
    (
      await db
        .select({ ticketId: identityRequests.ticketId })
        .from(identityRequests)
        .where(eq(identityRequests.id, input.submissionKey))
    )[0];
  let saved = await savedOn();
  if (!saved) {
    // Not set up and nothing saved: nothing to save. A saved request is
    // delivered (or stays unconfirmed) whatever the settings say now.
    await call(async () => iamClient(await getStoredIam(db)));
    await db
      .insert(identityRequests)
      .values({
        id: input.submissionKey,
        ticketId: ticket.id,
        name: `${input.firstName} ${input.lastName}`.trim(),
        personType: input.personType,
        status: "sending",
        payload: {
          externalId: externalId(input.submissionKey),
          externalUrl: `${config().APP_URL}/tickets/${ticket.number}`,
          requestedBy: { name: actor.name, email: actor.email },
          firstName: input.firstName,
          lastName: input.lastName,
          personalEmail: input.personalEmail,
          jobTitle: input.jobTitle,
          personType: input.personType,
          teamId: input.teamId,
          managerEmail: input.managerEmail,
          startDate: input.startDate,
          endDate: input.endDate,
          notes: input.notes,
        } satisfies IamRequestCreate,
        sentById: actor.id,
      })
      .onConflictDoNothing();
    saved = await savedOn();
  }
  // Gone with its ticket meanwhile.
  if (!saved) throw notFound("Ticket not found");
  // The key belongs to a request on another ticket.
  if (saved.ticketId !== ticket.id) throw conflict("This request was already sent", "duplicate_submission");
  // Whoever saved it, the saved details go: a retry never sends new ones.
  const delivery = await deliver(input.submissionKey, { wait: true });
  if (delivery.outcome === "refused") throw refusedError(delivery.error);
  if (delivery.outcome === "gone") throw notFound("Request not found");
  return delivery.outcome === "unconfirmed" ? "unconfirmed" : "confirmed";
}

/** "Send again" for a request IAM has not confirmed: the saved details, the same reference. */
export async function resendIdentityRequest(
  number: number,
  id: string,
): Promise<"confirmed" | "unconfirmed"> {
  const [found] = await getDb()
    .select({ id: identityRequests.id })
    .from(identityRequests)
    .innerJoin(tickets, eq(tickets.id, identityRequests.ticketId))
    .where(and(eq(identityRequests.id, id), eq(tickets.number, number)));
  if (!found) throw notFound("Request not found");
  // Not set up: the request stays unconfirmed, with why.
  const delivery = await deliver(id, { wait: true });
  // A refusal stays on the ticket as refused; the ticket shows it.
  return delivery.outcome === "unconfirmed" ? "unconfirmed" : "confirmed";
}

/** Withdraws an open request in IAM, e.g. when the contract fell through. */
export async function cancelIdentityRequest(actor: UserPrincipal, number: number, id: string): Promise<void> {
  const db = getDb();
  const [found] = await db
    .select({ row: identityRequests })
    .from(identityRequests)
    .innerJoin(tickets, eq(tickets.id, identityRequests.ticketId))
    .where(and(eq(identityRequests.id, id), eq(tickets.number, number)));
  if (!found) throw notFound("Request not found");
  const iamId = found.row.iamId;
  if (iamId === null) throw conflict("IAM has not confirmed this request yet.", "iam_unconfirmed");
  const client = await call(async () => iamClient(await getStoredIam(db)));
  // The request at this ID must be ours: IAM's address may have changed since.
  const current = await call(() => client.get(iamId));
  if (current.externalId !== externalId(id)) {
    throw conflict("IAM does not know this request any more.", "iam_not_found");
  }
  const answer = await call(() => client.cancel(iamId));
  await apply(id, answer, actor.id);
}

/**
 * Requests still to do: unconfirmed sends, open ones, and approved ones
 * whose accounts are not ready yet (also a linked person who is offboarded
 * or archived and may be onboarded again).
 */
const UNSETTLED = or(
  eq(identityRequests.status, "sending"),
  eq(identityRequests.status, "open"),
  and(
    eq(identityRequests.status, "approved"),
    or(isNull(identityRequests.personStatus), ne(identityRequests.personStatus, "active")),
  ),
);

/** Moves a request IAM cannot answer about to the back of the queue, so the others still get their turn. */
async function checkedNow(id: string): Promise<void> {
  await getDb()
    .update(identityRequests)
    .set({ checkedAt: sql`now()` })
    .where(eq(identityRequests.id, id));
}

/** Asks IAM what became of unsettled requests, least recently checked first. Returns how many changed. */
export async function syncIdentityRequests(limit = 100): Promise<number> {
  // Also when IAM is not set up any more: a stuck send must not go unseen.
  await alertStuckSends();
  const stored = await getStoredIam(getDb());
  if (!iamConfigured(stored)) return 0;
  const client = iamClient(stored);
  const rows = await getDb()
    .select()
    .from(identityRequests)
    .where(UNSETTLED)
    .orderBy(sql`${identityRequests.checkedAt} asc nulls first`)
    .limit(limit);
  let changed = 0;
  for (const row of rows) {
    if (row.status === "sending" || row.iamId === null) {
      const delivery = await deliver(row.id, { wait: false });
      if (delivery.outcome === "confirmed" || delivery.outcome === "refused") changed += 1;
      else if (delivery.outcome === "unconfirmed") {
        logger.warn(
          { requestId: row.id, kind: delivery.error.kind },
          "IAM did not confirm an identity request",
        );
        if (isGlobal(delivery.error)) break;
      }
      continue;
    }
    let answer: IamRequest;
    try {
      answer = await client.get(row.iamId);
    } catch (error) {
      if (!(error instanceof IamError)) throw error;
      logger.warn({ requestId: row.id, kind: error.kind }, "IAM did not answer about an identity request");
      // A connection, key or setting problem affects every request: try again next time.
      if (isGlobal(error)) break;
      // Anything else is about this request: the others still get their turn.
      await checkedNow(row.id);
      continue;
    }
    if (answer.externalId !== externalId(row.id)) {
      // IAM's address changed: this ID is someone else's request there.
      logger.warn({ requestId: row.id }, "IAM answered with another request");
      await checkedNow(row.id);
      continue;
    }
    if (await apply(row.id, answer, null)) changed += 1;
  }
  return changed;
}

/** A connection, key or setting problem: it affects every request. */
const isGlobal = (error: IamError) =>
  error.kind === "unreachable" || error.kind === "unauthorized" || error.kind === "off";

/** How long a send may stay unconfirmed before Sentry hears of it. */
export const STUCK_AFTER_HOURS = 24;

/** Reports each send IAM has not confirmed for a day, once, so a stuck request never goes unseen. */
async function alertStuckSends(): Promise<void> {
  const stuck = await getDb()
    .update(identityRequests)
    .set({ alertedAt: sql`now()` })
    .where(
      and(
        eq(identityRequests.status, "sending"),
        isNull(identityRequests.alertedAt),
        lt(identityRequests.createdAt, sql`now() - make_interval(hours => ${STUCK_AFTER_HOURS})`),
      ),
    )
    .returning({ id: identityRequests.id, lastError: identityRequests.lastError });
  for (const row of stuck) {
    logger.error(
      { requestId: row.id, hours: STUCK_AFTER_HOURS },
      "IAM has not confirmed an identity request for a day",
    );
  }
}
