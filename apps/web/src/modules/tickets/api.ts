import { useMutation, useMutationState, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Category } from "@helpdesk/shared/api/form";
import type {
  Board,
  MessageCreate,
  TicketDetail,
  TicketPatch,
  TicketSummary,
} from "@helpdesk/shared/api/tickets";
import type { Status, Urgency } from "@helpdesk/shared/tickets";
import type { PickedPerson } from "@/components/person-picker";
import { useT } from "@/i18n";
import { ApiError, api, errorMessage } from "@/lib/api";
import type { Sort, StatusFilter, TicketFilters } from "./filters";
import { messages } from "./messages";

/** How often the board, the list and a ticket refresh while shown. */
export const REFRESH_MS = 30_000;

/** The query of GET /tickets. */
export type ListQuery = TicketFilters & { status: StatusFilter; sort: Sort; limit: number; offset: number };

export const ticketKeys = {
  /** Every board query (all filters). */
  boards: ["board"] as const,
  /** Every list query. */
  lists: ["tickets"] as const,
  list: (query: ListQuery) => ["tickets", query] as const,
  detail: (number: number) => ["ticket", number] as const,
};

/** Every category, also inactive ones (staff only). */
export const categoriesQuery = {
  queryKey: ["categories", "staff"] as const,
  queryFn: () => api.get<{ items: Category[] }>("/categories"),
  staleTime: 60_000,
};

export const ticketListQuery = (query: ListQuery) => ({
  queryKey: ticketKeys.list(query),
  queryFn: () => api.get<{ items: TicketSummary[]; total: number }>("/tickets", query),
  refetchInterval: REFRESH_MS,
  refetchOnWindowFocus: true,
});

export const ticketQuery = (number: number) => ({
  queryKey: ticketKeys.detail(number),
  queryFn: () => api.get<TicketDetail>(`/tickets/${number}`),
  refetchInterval: REFRESH_MS,
  refetchOnWindowFocus: true,
});

/** A change on a ticket's page or card, with the values shown while it is saved. */
export type TicketChange = {
  title?: string;
  status?: Status;
  urgency?: Urgency;
  category?: { id: string; name: string };
  assignee?: PickedPerson | null;
  dueDate?: string | null;
};

export type TicketUpdate = { number: number; revision: number; change: TicketChange };

/** The request body of a change. */
export function toPatch(change: TicketChange, revision: number): TicketPatch {
  const patch: TicketPatch = { revision };
  if (change.title !== undefined) patch.title = change.title;
  if (change.status !== undefined) patch.status = change.status;
  if (change.urgency !== undefined) patch.urgency = change.urgency;
  if (change.category !== undefined) patch.categoryId = change.category.id;
  if (change.assignee !== undefined) patch.assigneeId = change.assignee?.id ?? null;
  if (change.dueDate !== undefined) patch.dueDate = change.dueDate;
  return patch;
}

/** The ticket with a change applied: what the page shows while the change is saved. */
export function withChange(ticket: TicketDetail, change: TicketChange): TicketDetail {
  const next = { ...ticket };
  if (change.title !== undefined) next.title = change.title;
  if (change.status !== undefined) next.status = change.status;
  if (change.urgency !== undefined) next.urgency = change.urgency;
  if (change.category !== undefined) next.category = change.category;
  if (change.assignee !== undefined) next.assignee = change.assignee;
  if (change.dueDate !== undefined) next.dueDate = change.dueDate;
  return next;
}

/** True when the server refused a change because someone else changed the ticket first. */
export const isStale = (error: unknown) => error instanceof ApiError && error.code === "ticket_changed";

/**
 * Changes and board moves of tickets run one after another, so one doesn't
 * send a revision that the one before it is about to replace.
 */
export const TICKET_WRITES = { id: "ticket-write" };

/** Board moves (board/api.ts). */
export const MOVE_KEY = ["board-move"] as const;

/**
 * The newest revision of a ticket that this browser knows: the given one,
 * the cached ticket's or a cached board's. A change answers with the new
 * revision in one cache, a move in another; each sends the newest.
 */
export function latestRevision(queryClient: QueryClient, number: number, known: number): number {
  let revision = Math.max(
    known,
    queryClient.getQueryData<TicketDetail>(ticketKeys.detail(number))?.revision ?? 0,
  );
  for (const [, board] of queryClient.getQueriesData<Board>({ queryKey: ticketKeys.boards })) {
    for (const column of board?.columns ?? []) {
      for (const ticket of column.tickets) {
        if (ticket.number === number) revision = Math.max(revision, ticket.revision);
      }
    }
  }
  return revision;
}

const UPDATE_KEY = ["ticket-update"] as const;

/**
 * Changes a ticket's fields. Changes (and board moves) run one after
 * another, each with the newest known revision, so quick changes in a row
 * don't refuse each other. The answer replaces the cached ticket; a stale
 * revision shows a toast and loads the ticket again.
 */
export function useUpdateTicket() {
  const t = useT(messages);
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_KEY,
    scope: TICKET_WRITES,
    mutationFn: ({ number, revision, change }: TicketUpdate) =>
      api.patch<TicketDetail>(
        `/tickets/${number}`,
        toPatch(change, latestRevision(queryClient, number, revision)),
      ),
    onSuccess: (detail) => {
      queryClient.setQueryData(ticketKeys.detail(detail.number), detail);
    },
    onError: (error, { number }) => {
      if (isStale(error)) toast.error(t("changedMeanwhile"));
      else toast.error(errorMessage(error));
      void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(number) });
    },
    onSettled: () => {
      // While a move waits or runs, a loaded board would put its card back; the move loads it.
      if (!queryClient.isMutating({ mutationKey: MOVE_KEY })) {
        void queryClient.invalidateQueries({ queryKey: ticketKeys.boards });
      }
      void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
  });
}

/** The changes of a ticket that are being saved, merged: shown in place of the saved values. */
export function usePendingChange(number: number): TicketChange {
  const pending = useMutationState({
    filters: { mutationKey: UPDATE_KEY, status: "pending" },
    select: (mutation) => mutation.state.variables as TicketUpdate | undefined,
  });
  return Object.assign(
    {},
    ...pending.filter((update) => update?.number === number).map((update) => update!.change),
  ) as TicketChange;
}

/** A reply to the requester or an internal note. */
export function useSendMessage(number: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: MessageCreate) => api.post<TicketDetail>(`/tickets/${number}/messages`, input),
    onSuccess: (detail) => {
      queryClient.setQueryData(ticketKeys.detail(number), detail);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.boards });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.lists });
    },
  });
}
