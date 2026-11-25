import { arrayMove } from "@dnd-kit/sortable";
import type { Board, TicketSummary } from "@helpdesk/shared/api/tickets";
import { STATUSES, isClosed, type Status } from "@helpdesk/shared/tickets";

/** The ticket ids of each column, in board order. Columns are keyed by status. */
export type ColumnIds = Record<Status, string[]>;

export const isStatus = (id: string): id is Status => (STATUSES as readonly string[]).includes(id);

export function columnIds(board: Board): ColumnIds {
  const ids = Object.fromEntries(STATUSES.map((status) => [status, [] as string[]])) as ColumnIds;
  for (const column of board.columns) ids[column.status] = column.tickets.map((ticket) => ticket.id);
  return ids;
}

/** The column of an id: a column's own id (its status) or a ticket's. */
export function columnOf(ids: ColumnIds, id: string): Status | undefined {
  if (isStatus(id)) return id;
  return STATUSES.find((status) => ids[status].includes(id));
}

/**
 * While a ticket is dragged over another column, it moves there (before the
 * ticket it is over, or to the end), so the column makes room for it.
 */
export function dragOver(ids: ColumnIds, activeId: string, overId: string): ColumnIds {
  const from = columnOf(ids, activeId);
  const to = columnOf(ids, overId);
  if (!from || !to || from === to) return ids;
  const target = ids[to].filter((id) => id !== activeId);
  const index = target.indexOf(overId);
  target.splice(index >= 0 ? index : target.length, 0, activeId);
  return { ...ids, [from]: ids[from].filter((id) => id !== activeId), [to]: target };
}

/** Where a dropped ticket lands: its column and its index there. */
export function dropPosition(
  ids: ColumnIds,
  activeId: string,
  overId: string | null,
): { status: Status; index: number } | null {
  const status = columnOf(ids, activeId);
  if (!status) return null;
  let list = ids[status];
  if (overId && overId !== activeId && list.includes(overId)) {
    list = arrayMove(list, list.indexOf(activeId), list.indexOf(overId));
  }
  return { status, index: list.indexOf(activeId) };
}

/**
 * The board after a ticket moved to a column at an index ("end": last).
 * Done and cancelled show the latest closed first, so a ticket that enters
 * them goes on top. Also returns the target column's new order, which the
 * move request sends.
 */
export function applyMove(
  board: Board,
  ticketId: string,
  status: Status,
  index: number | "end",
  now = new Date().toISOString(),
): { board: Board; order: string[] } | null {
  const source = board.columns.find((column) => column.tickets.some((ticket) => ticket.id === ticketId));
  const ticket = source?.tickets.find((candidate) => candidate.id === ticketId);
  if (!source || !ticket || !board.columns.some((column) => column.status === status)) return null;
  const moved: TicketSummary =
    ticket.status === status
      ? ticket
      : {
          ...ticket,
          status,
          closedAt: isClosed(status) ? (isClosed(ticket.status) ? ticket.closedAt : now) : null,
        };
  let order: string[] = [];
  const columns = board.columns.map((column) => {
    const rest = column.tickets.filter((candidate) => candidate.id !== ticketId);
    if (column.status !== status) {
      return column === source ? { ...column, tickets: rest, total: Math.max(0, column.total - 1) } : column;
    }
    const at =
      isClosed(status) && column !== source
        ? 0
        : index === "end"
          ? rest.length
          : Math.min(Math.max(index, 0), rest.length);
    const tickets = [...rest.slice(0, at), moved, ...rest.slice(at)];
    order = tickets.map((candidate) => candidate.id);
    return { ...column, tickets, total: column === source ? column.total : column.total + 1 };
  });
  return { board: { ...board, columns }, order };
}

/** The board with one ticket's revision replaced (after the server accepted a move). */
export function withRevision(board: Board, ticketId: string, revision: number): Board {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.tickets.some((ticket) => ticket.id === ticketId)
        ? {
            ...column,
            tickets: column.tickets.map((ticket) =>
              ticket.id === ticketId ? { ...ticket, revision } : ticket,
            ),
          }
        : column,
    ),
  };
}

export function findTicket(board: Board | undefined, ticketId: string): TicketSummary | undefined {
  for (const column of board?.columns ?? []) {
    const ticket = column.tickets.find((candidate) => candidate.id === ticketId);
    if (ticket) return ticket;
  }
  return undefined;
}
