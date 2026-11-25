import { z } from "zod";

/** The fixed ticket statuses, in board column order. */
export const STATUSES = [
  "new",
  "in_progress",
  "waiting_for_requester",
  "waiting_for_others",
  "done",
  "cancelled",
] as const;
export const statusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof statusSchema>;

/** Done and cancelled tickets are closed. */
export const CLOSED_STATUSES: readonly Status[] = ["done", "cancelled"];
export const isClosed = (status: Status) => CLOSED_STATUSES.includes(status);

export const URGENCIES = ["low", "normal", "urgent", "very_urgent"] as const;
export const urgencySchema = z.enum(URGENCIES);
export type Urgency = z.infer<typeof urgencySchema>;

/** A requester's reply reopens a done ticket for this many days after it was closed. */
export const REOPEN_DAYS = 14;
/** The board shows done and cancelled tickets closed within this many days. */
export const BOARD_CLOSED_DAYS = 14;

/** True when a requester may still reply to (and so reopen) a ticket. */
export function requesterCanReply(
  ticket: { status: Status; closedAt: string | Date | null },
  now = Date.now(),
): boolean {
  if (ticket.status === "cancelled") return false;
  if (ticket.status !== "done") return true;
  if (!ticket.closedAt) return true;
  return now - new Date(ticket.closedAt).getTime() <= REOPEN_DAYS * 24 * 60 * 60_000;
}

/** Attachments: size and type limits, checked on both sides. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "txt",
  "csv",
  "md",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
  "zip",
  "eml",
  "msg",
] as const;

export function attachmentExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export function isAllowedAttachment(filename: string): boolean {
  return (ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(attachmentExtension(filename));
}
