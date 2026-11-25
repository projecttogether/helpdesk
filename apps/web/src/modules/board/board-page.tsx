import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { STATUSES } from "@helpdesk/shared/tickets";
import { Page, PageHeader } from "@/components/ui/page";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { FilterBar } from "@/modules/tickets/filter-bar";
import { hasFilters, type TicketFilters } from "@/modules/tickets/filters";
import { boardQuery } from "./api";
import { BoardView } from "./board-view";
import { messages } from "./messages";

/** The staff's main screen: every ticket by status, filtered by the address. */
export function BoardPage(props: {
  filters: TicketFilters;
  onFilters: (patch: Partial<TicketFilters>) => void;
}) {
  const t = useT(messages);
  const options = boardQuery(props.filters);
  const board = useQuery({ ...options, placeholderData: keepPreviousData });
  const empty = board.data?.columns.every((column) => column.total === 0);

  return (
    <Page wide>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild>
            <Link to="/tickets/new">
              <Plus />
              {t("newTicket")}
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-3">
        <FilterBar value={props.filters} onChange={props.onFilters} />
        {board.data && empty && hasFilters(props.filters) ? (
          <p className="text-muted-foreground text-sm" role="status">
            {t("noMatches")}
          </p>
        ) : null}
      </div>
      {board.data ? (
        <div className="relative">
          {board.isPlaceholderData ? (
            <Spinner className="text-muted-foreground absolute -top-5 right-0" aria-label={t("updating")} />
          ) : null}
          <BoardView board={board.data} queryKey={options.queryKey} />
        </div>
      ) : board.isPending ? (
        <BoardSkeleton />
      ) : (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      )}
    </Page>
  );
}

function BoardSkeleton() {
  const t = useT(messages);
  return (
    <div className="flex gap-3 overflow-hidden" role="status" aria-label={t("loading")}>
      {STATUSES.map((status, index) => (
        <div
          key={status}
          className="bg-muted/50 flex min-w-[16.5rem] flex-1 flex-col gap-2 rounded-xl border p-3"
        >
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: Math.max(1, 3 - (index % 3)) }, (_, card) => (
            <Skeleton key={card} className="bg-background h-24 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
