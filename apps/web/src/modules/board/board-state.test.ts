import { describe, expect, it } from "vitest";
import type { Board, TicketSummary } from "@helpdesk/shared/api/tickets";
import { STATUSES, type Status } from "@helpdesk/shared/tickets";
import {
  applyMove,
  columnIds,
  columnOf,
  dragOver,
  dropPosition,
  findTicket,
  withRevision,
} from "./board-state";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function ticket(n: number, status: Status, extra: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: id(n),
    number: n,
    title: `Ticket ${n}`,
    status,
    urgency: "normal",
    category: null,
    requester: null,
    assignee: null,
    dueDate: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
    closedAt: status === "done" || status === "cancelled" ? "2026-11-10T10:00:00.000Z" : null,
    revision: 1,
    messageCount: 0,
    ...extra,
  };
}

/** A board from ticket numbers per column; totals equal the shown tickets unless given. */
function board(
  columns: Partial<Record<Status, number[]>>,
  totals: Partial<Record<Status, number>> = {},
): Board {
  return {
    columns: STATUSES.map((status) => {
      const tickets = (columns[status] ?? []).map((n) => ticket(n, status));
      return { status, tickets, total: totals[status] ?? tickets.length };
    }),
  };
}

const numbers = (value: Board, status: Status) =>
  value.columns.find((column) => column.status === status)!.tickets.map((item) => item.number);
const total = (value: Board, status: Status) =>
  value.columns.find((column) => column.status === status)!.total;

describe("columnIds and columnOf", () => {
  it("lists ids per status and finds the column of a ticket or a column id", () => {
    const ids = columnIds(board({ new: [1, 2], in_progress: [3] }));
    expect(ids.new).toEqual([id(1), id(2)]);
    expect(ids.done).toEqual([]);
    expect(columnOf(ids, id(3))).toBe("in_progress");
    expect(columnOf(ids, "waiting_for_others")).toBe("waiting_for_others");
    expect(columnOf(ids, id(99))).toBeUndefined();
  });
});

describe("dragOver", () => {
  const ids = columnIds(board({ new: [1, 2], in_progress: [3, 4] }));

  it("moves the card into another column before the card it is over", () => {
    const next = dragOver(ids, id(1), id(4));
    expect(next.new).toEqual([id(2)]);
    expect(next.in_progress).toEqual([id(3), id(1), id(4)]);
  });

  it("moves the card to the end when it is over the column itself", () => {
    expect(dragOver(ids, id(1), "in_progress").in_progress).toEqual([id(3), id(4), id(1)]);
  });

  it("leaves moves within a column to the drop", () => {
    expect(dragOver(ids, id(1), id(2))).toBe(ids);
  });
});

describe("dropPosition", () => {
  const ids = columnIds(board({ new: [1, 2, 3] }));

  it("reorders within the column", () => {
    expect(dropPosition(ids, id(1), id(3))).toEqual({ status: "new", index: 2 });
    expect(dropPosition(ids, id(3), id(1))).toEqual({ status: "new", index: 0 });
  });

  it("keeps the place when dropped on itself or the column", () => {
    expect(dropPosition(ids, id(2), id(2))).toEqual({ status: "new", index: 1 });
    expect(dropPosition(ids, id(2), "new")).toEqual({ status: "new", index: 1 });
  });

  it("uses the column the card was dragged into", () => {
    const moved = dragOver(columnIds(board({ new: [1], in_progress: [3, 4] })), id(1), id(4));
    // Dropped where dragging over the column put it…
    expect(dropPosition(moved, id(1), id(1))).toEqual({ status: "in_progress", index: 1 });
    // …or over a card of that column: it takes that card's place.
    expect(dropPosition(moved, id(1), id(4))).toEqual({ status: "in_progress", index: 2 });
    expect(dropPosition(moved, id(1), id(3))).toEqual({ status: "in_progress", index: 0 });
  });
});

describe("applyMove", () => {
  it("reorders within a column and returns its new order", () => {
    const result = applyMove(board({ new: [1, 2, 3] }), id(3), "new", 0)!;
    expect(numbers(result.board, "new")).toEqual([3, 1, 2]);
    expect(result.order).toEqual([id(3), id(1), id(2)]);
    expect(total(result.board, "new")).toBe(3);
  });

  it("moves across columns: status, counts and the target order", () => {
    const before = board({ new: [1, 2], in_progress: [3, 4] }, { new: 5, in_progress: 7 });
    const result = applyMove(before, id(2), "in_progress", 1)!;
    expect(numbers(result.board, "new")).toEqual([1]);
    expect(numbers(result.board, "in_progress")).toEqual([3, 2, 4]);
    expect(result.order).toEqual([id(3), id(2), id(4)]);
    expect(total(result.board, "new")).toBe(4);
    expect(total(result.board, "in_progress")).toBe(8);
    expect(findTicket(result.board, id(2))?.status).toBe("in_progress");
    // The board it came from is unchanged.
    expect(numbers(before, "new")).toEqual([1, 2]);
  });

  it("puts tickets that close on top of the closed column, with a closing time", () => {
    const result = applyMove(
      board({ in_progress: [1], done: [7, 8] }),
      id(1),
      "done",
      "end",
      "2026-11-16T09:00:00.000Z",
    )!;
    expect(numbers(result.board, "done")).toEqual([1, 7, 8]);
    expect(findTicket(result.board, id(1))?.closedAt).toBe("2026-11-16T09:00:00.000Z");
  });

  it("clears the closing time when a ticket opens again", () => {
    const result = applyMove(board({ done: [7] }), id(7), "new", "end")!;
    expect(findTicket(result.board, id(7))).toMatchObject({ status: "new", closedAt: null });
  });

  it("appends with 'end' and clamps indexes", () => {
    expect(
      numbers(
        applyMove(board({ new: [1], in_progress: [3, 4] }), id(1), "in_progress", "end")!.board,
        "in_progress",
      ),
    ).toEqual([3, 4, 1]);
    expect(
      numbers(
        applyMove(board({ new: [1], in_progress: [3] }), id(1), "in_progress", 99)!.board,
        "in_progress",
      ),
    ).toEqual([3, 1]);
  });

  it("returns null for a ticket that is not on the board", () => {
    expect(applyMove(board({ new: [1] }), id(2), "done", 0)).toBeNull();
  });
});

describe("withRevision", () => {
  it("replaces one ticket's revision", () => {
    const next = withRevision(board({ new: [1, 2] }), id(2), 5);
    expect(findTicket(next, id(2))?.revision).toBe(5);
    expect(findTicket(next, id(1))?.revision).toBe(1);
  });
});
