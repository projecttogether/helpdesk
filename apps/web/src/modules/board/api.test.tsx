import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board, TicketDetail, TicketSummary } from "@helpdesk/shared/api/tickets";
import { STATUSES, type Status } from "@helpdesk/shared/tickets";
import { useUpdateTicket } from "@/modules/tickets/api";
import { boardQuery, useMoveTicket } from "./api";
import { applyMove, findTicket } from "./board-state";

const ME = { id: "00000000-0000-4000-8000-0000000000aa", name: "Operator", email: "operator@example.org" };

const TICKET: TicketSummary = {
  id: "00000000-0000-4000-8000-000000000007",
  number: 7,
  title: "Printer on floor 2",
  status: "new",
  urgency: "normal",
  category: null,
  requester: null,
  assignee: null,
  dueDate: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  closedAt: null,
  revision: 1,
  messageCount: 0,
};

/** The board with the ticket in a column. */
function board(ticket: TicketSummary): Board {
  return {
    columns: STATUSES.map((status) => {
      const tickets = status === ticket.status ? [ticket] : [];
      return { status, tickets, total: tickets.length };
    }),
  };
}

const BOARD = board(TICKET);
const FILTERS = { q: undefined };
const KEY = boardQuery(FILTERS).queryKey;

/** The server's answer to "Assign to me": the ticket with its new revision. */
function assigned(revision: number, number = TICKET.number): TicketDetail {
  return {
    ...TICKET,
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    number,
    assignee: ME,
    revision,
    source: "form",
    createdBy: null,
    formVersion: 1,
    answers: [],
    messages: [],
    events: [],
    identityRequests: [],
  };
}

type Request = {
  method: string;
  path: string;
  body: { revision?: number } | undefined;
  reply: (body: unknown, status?: number) => void;
};

/** Stubs fetch; each request waits until the test replies to it, like a slow network. */
function stubSlowServer() {
  const requests: Request[] = [];
  const fetch = vi.fn(
    (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        requests.push({
          method: init?.method ?? "GET",
          path: url.replace(/^\/api\/v1/, "").split("?")[0]!,
          body: typeof init?.body === "string" ? (JSON.parse(init.body) as Request["body"]) : undefined,
          reply: (body, status = 200) =>
            resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { "content-type": "application/json" },
              }),
            ),
        });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return requests;
}

/** The board's two ways to change a card, on one query client that holds the board. */
function renderBoard(options: { showBoard?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(KEY, BOARD);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => {
      // The board page shows the board: a change that ends loads it again.
      useQuery({ ...boardQuery(FILTERS), staleTime: Infinity, enabled: options.showBoard ?? false });
      return { update: useUpdateTicket(), move: useMoveTicket(KEY) };
    },
    { wrapper },
  );
  const statusOnBoard = (): Status | undefined =>
    findTicket(client.getQueryData<Board>(KEY), TICKET.id)?.status;
  return {
    // The card's "…" menu: "Assign to me" sends the card's revision.
    assignToMe: (number = TICKET.number) =>
      result.current.update.mutate({ number, revision: TICKET.revision, change: { assignee: ME } }),
    // A drag of the card, from the board as it was shown.
    moveTo: (status: Status) => {
      const next = applyMove(BOARD, TICKET.id, status, "end")!;
      result.current.move.mutate({ ticket: TICKET, status, board: next.board, order: next.order });
    },
    statusOnBoard,
    result,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("changes of a card on the board", () => {
  it("sends the revision of 'Assign to me' with a move right after it", async () => {
    const requests = stubSlowServer();
    const view = renderBoard();

    view.assignToMe();
    await waitFor(() => expect(requests).toHaveLength(1));
    requests[0]!.reply(assigned(2));
    await waitFor(() => expect(view.result.current.update.isSuccess).toBe(true));

    // The board has not loaded again yet: it still shows revision 1.
    view.moveTo("in_progress");
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({
      method: "POST",
      path: "/tickets/7/move",
      body: { revision: 2, status: "in_progress" },
    });
  });

  it("holds a move until 'Assign to me' is saved, then sends its revision", async () => {
    const requests = stubSlowServer();
    const view = renderBoard();

    view.assignToMe();
    view.moveTo("in_progress");
    // The card moves at once; the request waits for the change before it.
    await waitFor(() => expect(view.statusOnBoard()).toBe("in_progress"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual(["PATCH /tickets/7"]);

    requests[0]!.reply(assigned(2));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ method: "POST", path: "/tickets/7/move", body: { revision: 2 } });
  });

  it("holds 'Assign to me' until a move is saved, then sends the move's revision", async () => {
    const requests = stubSlowServer();
    const view = renderBoard();

    view.moveTo("waiting_for_requester");
    await waitFor(() => expect(requests).toHaveLength(1));
    view.assignToMe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(1);

    requests[0]!.reply({ revision: 2 });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toMatchObject({ method: "PATCH", path: "/tickets/7", body: { revision: 2 } });
  });

  it("keeps a held move on the board: changes before it don't load the board again", async () => {
    const requests = stubSlowServer();
    const view = renderBoard({ showBoard: true });
    const paths = () => requests.map((request) => request.path);

    // "Assign to me" on another card and on this one, then a drag of this one.
    view.assignToMe(8);
    view.assignToMe();
    view.moveTo("in_progress");
    await waitFor(() => expect(paths()).toEqual(["/tickets/8"]));
    requests[0]!.reply(assigned(2, 8));
    await waitFor(() => expect(paths()).toContain("/tickets/7"));

    // A board loaded now comes without the move and would put the card back.
    for (const request of requests.filter((request) => request.path === "/board")) {
      request.reply(board({ ...TICKET, assignee: ME, revision: 2 }));
    }
    requests.find((request) => request.path === "/tickets/7")!.reply(assigned(2));
    await waitFor(() => expect(paths()).toContain("/tickets/7/move"));
    expect(view.statusOnBoard()).toBe("in_progress");
    expect(paths()).toEqual(["/tickets/8", "/tickets/7", "/tickets/7/move"]);

    // The saved move loads the board.
    requests.find((request) => request.path === "/tickets/7/move")!.reply({ revision: 3 });
    await waitFor(() => expect(paths()).toContain("/board"));
  });
});
