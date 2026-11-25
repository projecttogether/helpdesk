import { Readable } from "node:stream";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { isStaff } from "@helpdesk/shared/roles";
import { getDb } from "../db/client";
import { attachments, ticketMessages, tickets } from "../db/schema";
import type { AppEnv } from "../http/env";
import { badRequest, notFound } from "../http/errors";
import { idParam, requireUser } from "../http/middleware";
import { readStoredFile, saveUpload } from "../attachments/storage";
import type { UserPrincipal } from "../auth/principal";

const router = new Hono<AppEnv>();

/** Uploads one file (multipart field `file`); a ticket or message then uses its id. */
router.post("/attachments", async (c) => {
  const actor = requireUser(c);
  const body = await c.req.parseBody().catch(() => {
    throw badRequest("Send the file as multipart/form-data");
  });
  const file = body.file;
  if (!(file instanceof File)) throw badRequest("Choose a file");
  return c.json(await saveUpload(actor.id, file), 201);
});

/** Who may download: staff any ticket's files; requesters their own ticket's, except internal notes'. */
async function mayRead(viewer: UserPrincipal, row: typeof attachments.$inferSelect): Promise<boolean> {
  if (!row.ticketId) return row.uploaderId === viewer.id;
  if (isStaff(viewer.role)) return true;
  const [ticket] = await getDb()
    .select({ requesterId: tickets.requesterId })
    .from(tickets)
    .where(eq(tickets.id, row.ticketId));
  if (ticket?.requesterId !== viewer.id) return false;
  if (!row.messageId) return true;
  const [message] = await getDb()
    .select({ visibility: ticketMessages.visibility })
    .from(ticketMessages)
    .where(eq(ticketMessages.id, row.messageId));
  return message?.visibility === "public";
}

router.get("/attachments/:id", async (c) => {
  const viewer = requireUser(c);
  const [row] = await getDb()
    .select()
    .from(attachments)
    .where(eq(attachments.id, idParam(c)));
  if (!row || !(await mayRead(viewer, row))) throw notFound("File not found");
  const encoded = encodeURIComponent(row.filename);
  const ascii = row.filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // Always a download, never shown inline: uploads must not run in the app's origin.
  c.header("content-type", "application/octet-stream");
  c.header("content-length", String(row.size));
  c.header("content-disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  c.header("x-content-type-options", "nosniff");
  return c.body(Readable.toWeb(readStoredFile(row)) as ReadableStream);
});

export default router;
