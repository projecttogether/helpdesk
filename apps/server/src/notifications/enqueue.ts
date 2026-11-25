import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { notifications } from "../db/schema";
import { getStoredEmail, getStoredSlack } from "../core/settings";
import type { Rendered } from "./templates";

/** The channel the worker listens on; a notification row raises it at commit. */
export const NOTIFY_CHANNEL = "helpdesk_notifications";

export type Recipient = {
  id: string;
  email: string;
  name: string;
  notifyVia: string;
};

export const displayName = (person: { name: string; email: string }) => person.name.trim() || person.email;

type Row = typeof notifications.$inferInsert;

/**
 * Notifications to send after the transaction commits. Collect them while
 * changing a ticket, then `flush` once; channels that are not set up are
 * left out.
 */
export class Outbox {
  private rows: Row[] = [];
  constructor(private readonly ticketId: string | null) {}

  /** An email to a person (requesters always hear by email). */
  email(kind: string, to: Recipient, rendered: Rendered) {
    this.rows.push({
      ticketId: this.ticketId,
      channel: "email",
      kind,
      recipientUserId: to.id,
      recipient: to.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }

  /** A personal message by the person's choice: a Slack direct message (email if that fails) or an email. */
  personal(kind: string, to: Recipient, message: { email: Rendered; slack: string }) {
    if (to.notifyVia === "slack") {
      this.rows.push({
        ticketId: this.ticketId,
        channel: "slack_dm",
        kind,
        recipientUserId: to.id,
        recipient: to.email,
        subject: message.email.subject,
        text: message.slack,
        html: message.email.html,
        fallbackText: message.email.text,
      });
    } else {
      this.email(kind, to, message.email);
    }
  }

  /** A post to the default Slack channel. */
  channel(kind: string, text: string) {
    this.rows.push({
      ticketId: this.ticketId,
      channel: "slack_channel",
      kind,
      recipient: "",
      subject: kind,
      text,
    });
  }

  get size() {
    return this.rows.length;
  }

  async flush(tx: DbOrTx) {
    if (this.rows.length === 0) return;
    const [email, slack] = await Promise.all([getStoredEmail(tx), getStoredSlack(tx)]);
    const emailOn = email.provider !== "none";
    const slackOn = Boolean(slack.botTokenEncrypted);
    const rows: Row[] = [];
    for (const row of this.rows) {
      if (row.channel === "slack_channel") {
        if (slackOn && slack.channelId) rows.push({ ...row, recipient: slack.channelId });
      } else if (row.channel === "slack_dm") {
        if (slackOn) rows.push(row);
        else if (emailOn)
          rows.push({ ...row, channel: "email", text: row.fallbackText!, fallbackText: null });
      } else if (emailOn) {
        rows.push(row);
      }
    }
    this.rows = [];
    if (rows.length === 0) return;
    await tx.insert(notifications).values(rows);
    await tx.execute(sql`select pg_notify(${NOTIFY_CHANNEL}, '')`);
  }
}
