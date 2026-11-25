import { and, asc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { isDatabaseUnavailable } from "../db/outage";
import { notifications, users } from "../db/schema";
import { getStoredEmail, getStoredSlack } from "../core/settings";
import { logger } from "../logger";
import {
  DeliveryError,
  emailTransportFor,
  slackTransportFor,
  type EmailTransport,
  type SlackTransport,
} from "./transports";

/** Attempts before a notification counts as failed. */
export const MAX_ATTEMPTS = 5;
/** Waits before the next attempt, by attempts so far. */
const BACKOFF_SECONDS = [30, 120, 600, 1800];
const LEASE_SECONDS = 120;

type Row = typeof notifications.$inferSelect;
type Outcome = { status: "sent" | "skipped"; note?: string };

/** Claims one due notification so its lease starts just before sending. */
async function claim(): Promise<Row | undefined> {
  const db = getDb();
  const due = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      or(
        and(eq(notifications.status, "pending"), lte(notifications.nextAttemptAt, sql`now()`)),
        and(eq(notifications.status, "sending"), lt(notifications.leaseUntil, sql`now()`)),
      ),
    )
    .orderBy(asc(notifications.nextAttemptAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const [row] = await db
    .update(notifications)
    .set({
      status: "sending",
      attempts: sql`${notifications.attempts} + 1`,
      leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
    })
    // Materialize the locking query so the update evaluates LIMIT 1 only once.
    .where(eq(notifications.id, sql`(with due as materialized (${due}) select id from due)`))
    .returning();
  return row;
}

type Transports = { email: EmailTransport | null; slack: SlackTransport | null };

async function loadTransports(): Promise<Transports> {
  const db = getDb();
  const [email, slack] = await Promise.all([getStoredEmail(db), getStoredSlack(db)]);
  return { email: emailTransportFor(email), slack: slackTransportFor(slack) };
}

async function slackUserId(slack: SlackTransport, row: Row): Promise<string | null> {
  if (row.recipientUserId) {
    const [person] = await getDb()
      .select({ slackUserId: users.slackUserId, email: users.email })
      .from(users)
      .where(eq(users.id, row.recipientUserId));
    if (person?.slackUserId && person.email === row.recipient) return person.slackUserId;
  }
  const id = await slack.lookupUserByEmail(row.recipient);
  if (id && row.recipientUserId) {
    await getDb().update(users).set({ slackUserId: id }).where(eq(users.id, row.recipientUserId));
  }
  return id;
}

async function send(row: Row, transports: Transports): Promise<Outcome> {
  switch (row.channel) {
    case "email": {
      if (!transports.email) return { status: "skipped", note: "Email is not set up" };
      await transports.email.send({
        to: row.recipient,
        subject: row.subject,
        text: row.text,
        html: row.html ?? "",
      });
      return { status: "sent" };
    }
    case "slack_channel": {
      if (!transports.slack) return { status: "skipped", note: "Slack is not set up" };
      await transports.slack.postMessage(row.recipient, row.text);
      return { status: "sent" };
    }
    case "slack_dm": {
      const fallback = async (reason: string): Promise<Outcome> => {
        if (!transports.email || !row.fallbackText) return { status: "skipped", note: reason };
        await transports.email.send({
          to: row.recipient,
          subject: row.subject,
          text: row.fallbackText,
          html: row.html ?? "",
        });
        return { status: "sent", note: `${reason}; sent by email` };
      };
      if (!transports.slack) return fallback("Slack is not set up");
      try {
        const userId = await slackUserId(transports.slack, row);
        if (!userId) return fallback("No Slack account has this email address");
        await transports.slack.postMessage(userId, row.text);
        return { status: "sent" };
      } catch (error) {
        // Slack refuses for good (e.g. a missing scope), or for the last time: email instead.
        if (error instanceof DeliveryError && (error.permanent || row.attempts >= MAX_ATTEMPTS)) {
          return fallback(`Slack failed (${error.code ?? "error"})`);
        }
        throw error;
      }
    }
    default:
      return { status: "skipped", note: `Unknown channel ${row.channel}` };
  }
}

/**
 * Sends due notifications; returns how many it handled. Throws when the
 * database becomes unreachable; a row claimed by then stays leased and is
 * claimed again once its lease ends. Once `signal` aborts (the process
 * stops), it claims no more: the send in progress ends and its outcome is
 * saved, so a restart neither sends it twice nor loses it.
 */
export async function deliverDue(limit = 20, signal?: AbortSignal): Promise<number> {
  let transports: Transports | undefined;
  let handled = 0;
  for (; handled < limit; handled++) {
    if (signal?.aborted) break;
    const row = await claim();
    if (!row) break;
    transports ??= await loadTransports();
    // An expired lease may have been reclaimed while this send was in progress.
    const currentAttempt = and(
      eq(notifications.id, row.id),
      eq(notifications.status, "sending"),
      eq(notifications.attempts, row.attempts),
    );
    try {
      const outcome = await send(row, transports);
      const result = await getDb()
        .update(notifications)
        .set({
          status: outcome.status,
          sentAt: outcome.status === "sent" ? new Date() : null,
          lastError: outcome.note ?? null,
          leaseUntil: null,
        })
        .where(currentAttempt);
      if (!result.rowCount) continue;
      logger.info(
        { notificationId: row.id, code: outcome.status, channel: row.channel },
        "notification handled",
      );
    } catch (error) {
      // The database is gone, not the email: keep the lease. When it ends, a claim sends the row again.
      if (isDatabaseUnavailable(error)) throw error;
      const permanent = error instanceof DeliveryError && error.permanent;
      const finalAttempt = permanent || row.attempts >= MAX_ATTEMPTS;
      const message = error instanceof DeliveryError ? error.message : "Unexpected error while sending";
      const wait = BACKOFF_SECONDS[Math.min(row.attempts - 1, BACKOFF_SECONDS.length - 1)]!;
      const result = await getDb()
        .update(notifications)
        .set({
          status: finalAttempt ? "failed" : "pending",
          lastError: message,
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + wait * 1000),
        })
        .where(currentAttempt);
      if (!result.rowCount) continue;
      if (error instanceof DeliveryError) {
        logger.warn(
          {
            notificationId: row.id,
            channel: row.channel,
            code: error.code,
            permanent,
            attempt: row.attempts,
          },
          "notification not sent",
        );
      } else {
        logger.error({ err: error, notificationId: row.id, channel: row.channel }, "notification failed");
      }
    }
  }
  return handled;
}

/** Removes handled notifications after 90 days. */
export async function pruneNotifications(): Promise<number> {
  const result = await getDb()
    .delete(notifications)
    .where(
      and(
        inArray(notifications.status, ["sent", "skipped", "failed"]),
        lt(notifications.createdAt, new Date(Date.now() - 90 * 24 * 60 * 60_000)),
      ),
    );
  return result.rowCount ?? 0;
}
