import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Attachment } from "@helpdesk/shared/api/tickets";
import { isAllowedAttachment, MAX_ATTACHMENT_BYTES } from "@helpdesk/shared/tickets";
import { config } from "../config";
import { getDb, type DbOrTx } from "../db/client";
import { attachments } from "../db/schema";
import { badRequest, validationError } from "../http/errors";
import { logger } from "../logger";

type Row = typeof attachments.$inferSelect;

export const toAttachment = (row: Row): Attachment => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType,
  size: row.size,
  createdAt: row.createdAt.toISOString(),
});

const root = () => path.resolve(config().ATTACHMENTS_DIR);

/** Where a stored file lives; keys are generated, never taken from a request. */
function filePath(storageKey: string): string {
  if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(storageKey)) throw new Error("Invalid storage key");
  return path.join(root(), storageKey);
}

/** A safe file name: no paths, no control characters, at most 200 characters. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = [...base]
    .filter(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127 && character !== '"',
    )
    .join("")
    .trim()
    .slice(-200);
  return clean || "file";
}

/** Stores an upload; it belongs to the uploader until a ticket or message uses it. */
export async function saveUpload(uploaderId: string, file: File): Promise<Attachment> {
  const filename = cleanFilename(file.name);
  if (!isAllowedAttachment(filename)) throw badRequest("This file type is not allowed");
  if (file.size === 0) throw badRequest("The file is empty");
  if (file.size > MAX_ATTACHMENT_BYTES) throw badRequest("The file is larger than 10 MB");
  const id = randomUUID();
  const storageKey = `${id.slice(0, 2)}/${id}`;
  const target = filePath(storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  try {
    const [row] = await getDb()
      .insert(attachments)
      .values({
        id,
        uploaderId,
        filename,
        contentType: (file.type || "application/octet-stream").slice(0, 100),
        size: file.size,
        storageKey,
      })
      .returning();
    return toAttachment(row!);
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
}

/**
 * Locks the uploads a change wants to use. Only the uploader's own, unused
 * uploads qualify; anything else fails the whole change. Call it before
 * creating a ticket, so a refused file does not use up a ticket number.
 */
export async function lockUploads(tx: DbOrTx, ids: readonly string[], uploaderId: string): Promise<Row[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select()
    .from(attachments)
    .where(
      and(
        inArray(attachments.id, [...ids]),
        eq(attachments.uploaderId, uploaderId),
        isNull(attachments.ticketId),
      ),
    )
    .for("update");
  if (rows.length !== new Set(ids).size) {
    throw validationError({ attachmentIds: "A file is missing. Upload it again." });
  }
  return rows;
}

/** Attaches locked uploads to a ticket (and message). */
export async function linkUploads(
  tx: DbOrTx,
  rows: readonly Row[],
  target: { ticketId: string; messageId?: string | null },
) {
  if (rows.length === 0) return;
  await tx
    .update(attachments)
    .set({ ticketId: target.ticketId, messageId: target.messageId ?? null })
    .where(
      inArray(
        attachments.id,
        rows.map((row) => row.id),
      ),
    );
}

export function readStoredFile(row: Row) {
  return createReadStream(filePath(row.storageKey));
}

/** Removes uploads no ticket used within a day. */
export async function pruneUnusedUploads(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
  return getDb().transaction(async (tx) => {
    // Ticket writes lock these rows before linking them. Hold the same locks through cleanup.
    const rows = await tx
      .select({ id: attachments.id, storageKey: attachments.storageKey })
      .from(attachments)
      .where(and(isNull(attachments.ticketId), lt(attachments.createdAt, cutoff)))
      .limit(500)
      .for("update", { skipLocked: true });
    const removed: string[] = [];
    for (const row of rows) {
      try {
        await rm(filePath(row.storageKey), { force: true });
        removed.push(row.id);
      } catch (error) {
        logger.warn({ err: error, attachmentId: row.id }, "could not remove an unused upload");
      }
    }
    if (removed.length > 0) await tx.delete(attachments).where(inArray(attachments.id, removed));
    return removed.length;
  });
}
