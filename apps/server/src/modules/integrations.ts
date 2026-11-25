import { Hono } from "hono";
import { count, desc, eq } from "drizzle-orm";
import {
  emailSettingsInputSchema,
  emailTestSchema,
  slackSettingsInputSchema,
} from "@helpdesk/shared/api/integrations";
import { pageQuerySchema } from "@helpdesk/shared/api/common";
import { getDb } from "../db/client";
import { notifications, tickets } from "../db/schema";
import type { AppEnv } from "../http/env";
import { jsonBody, queryOf, requireSuperadmin } from "../http/middleware";
import { readEmail, saveEmail, sendTestEmail } from "../integrations/email";
import { listSlackChannels, postSlackTest, readSlack, saveSlack } from "../integrations/slack";
import { iso, isoRequired } from "./util";

/**
 * Email and Slack, set up by superadmins. Secrets are stored encrypted and
 * shown only as hints. `cli settings` runs the same functions (src/integrations).
 */
const router = new Hono<AppEnv>();

router.get("/integrations/email", async (c) => {
  requireSuperadmin(c);
  return c.json(await readEmail());
});

router.put("/integrations/email", async (c) => {
  const actor = requireSuperadmin(c);
  return c.json(await saveEmail(actor, await jsonBody(c, emailSettingsInputSchema)));
});

router.post("/integrations/email/test", async (c) => {
  requireSuperadmin(c);
  const { to } = await jsonBody(c, emailTestSchema);
  return c.json(await sendTestEmail(to));
});

router.get("/integrations/slack", async (c) => {
  requireSuperadmin(c);
  return c.json(await readSlack());
});

router.put("/integrations/slack", async (c) => {
  const actor = requireSuperadmin(c);
  return c.json(await saveSlack(actor, await jsonBody(c, slackSettingsInputSchema)));
});

router.get("/integrations/slack/channels", async (c) => {
  requireSuperadmin(c);
  return c.json(await listSlackChannels());
});

router.post("/integrations/slack/test", async (c) => {
  requireSuperadmin(c);
  return c.json(await postSlackTest());
});

/** Recent emails and Slack messages, with their delivery state. */
router.get("/integrations/deliveries", async (c) => {
  requireSuperadmin(c);
  const query = queryOf(c, pageQuerySchema);
  const [rows, [total]] = await Promise.all([
    getDb()
      .select({ notification: notifications, number: tickets.number })
      .from(notifications)
      .leftJoin(tickets, eq(tickets.id, notifications.ticketId))
      .orderBy(desc(notifications.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    getDb().select({ value: count() }).from(notifications),
  ]);
  return c.json({
    items: rows.map(({ notification, number }) => ({
      id: notification.id,
      channel: notification.channel,
      kind: notification.kind,
      recipient: notification.recipient,
      status: notification.status,
      attempts: notification.attempts,
      lastError: notification.lastError,
      ticketNumber: number ?? null,
      createdAt: isoRequired(notification.createdAt),
      sentAt: iso(notification.sentAt),
    })),
    total: total?.value ?? 0,
  });
});

export default router;
