import { isClosed, type Status } from "@helpdesk/shared/tickets";

/** Up to two initials of a name or email address ("Alma Berger" → "AB", "erin@example.org" → "E"). */
export function initials(name: string): string {
  const words = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter((word) => /\p{L}|\p{N}/u.test(word));
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A due date before today on a ticket that is still open. */
export function isOverdue(dueDate: string | null, status: Status, today = localToday()): boolean {
  return dueDate !== null && !isClosed(status) && dueDate.slice(0, 10) < today;
}
