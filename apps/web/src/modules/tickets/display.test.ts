import { describe, expect, it } from "vitest";
import type { TicketDetail } from "@helpdesk/shared/api/tickets";
import { toPatch, withChange } from "./api";
import { initials, isOverdue, localToday } from "./display";

describe("initials", () => {
  it("takes the first and last word of a name or email address", () => {
    expect(initials("Alma Berger")).toBe("AB");
    expect(initials("Oscar van der Lind")).toBe("OL");
    expect(initials("erin@example.org")).toBe("E");
    expect(initials("erin.meyer@example.org")).toBe("EM");
    expect(initials("  ")).toBe("?");
  });
});

describe("isOverdue", () => {
  it("is true for a past due date of an open ticket only", () => {
    expect(isOverdue("2026-11-15", "in_progress", "2026-11-16")).toBe(true);
    expect(isOverdue("2026-11-16", "in_progress", "2026-11-16")).toBe(false);
    expect(isOverdue("2026-11-15", "done", "2026-11-16")).toBe(false);
    expect(isOverdue(null, "new", "2026-11-16")).toBe(false);
  });

  it("uses the local calendar date", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("ticket changes", () => {
  it("sends only the changed fields, with ids for people and categories", () => {
    expect(toPatch({ status: "done" }, 3)).toEqual({ revision: 3, status: "done" });
    expect(
      toPatch(
        {
          assignee: null,
          category: { id: "00000000-0000-4000-8000-000000000009", name: "IT" },
          dueDate: null,
          title: "New title",
        },
        4,
      ),
    ).toEqual({
      revision: 4,
      assigneeId: null,
      categoryId: "00000000-0000-4000-8000-000000000009",
      dueDate: null,
      title: "New title",
    });
  });

  it("shows changes that are being saved", () => {
    const ticket = { title: "Old", status: "new", assignee: null, dueDate: "2026-11-20" } as TicketDetail;
    const shown = withChange(ticket, { status: "in_progress", dueDate: null });
    expect(shown).toMatchObject({ title: "Old", status: "in_progress", dueDate: null });
    expect(ticket.status).toBe("new");
  });
});
