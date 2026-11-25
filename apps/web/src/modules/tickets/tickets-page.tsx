import type { MouseEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ListTodo, Plus } from "lucide-react";
import type { TicketSummary } from "@helpdesk/shared/api/tickets";
import { STATUSES } from "@helpdesk/shared/tickets";
import { Page, PageHeader } from "@/components/ui/page";
import { Pager } from "@/components/ui/pager";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, UrgencyBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import { useStatusLabel } from "@/lib/labels";
import { ticketListQuery, type ListQuery } from "./api";
import { FilterBar } from "./filter-bar";
import { hasFilters, pickFilters, SORTS, type ListSearch, type Sort, type StatusFilter } from "./filters";
import { messages } from "./messages";
import { personName } from "./timeline";

const PAGE_SIZE = 50;

/** Every ticket in a table, with the board's filters plus status, sort and pages. */
export function TicketsPage(props: { search: ListSearch; onSearch: (patch: Partial<ListSearch>) => void }) {
  const t = useT(messages);
  const statusLabel = useStatusLabel();
  const { search, onSearch } = props;
  const page = search.page ?? 1;
  const status = search.status ?? "open";
  const sort = search.sort ?? "updated";
  const query: ListQuery = {
    ...pickFilters(search),
    status,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const list = useQuery({ ...ticketListQuery(query), placeholderData: keepPreviousData });
  // Any change of filters, status or sort starts again on page 1.
  const change = (patch: Partial<ListSearch>) => onSearch({ ...patch, page: undefined });

  const statusText = (value: StatusFilter) =>
    value === "open"
      ? t("statusOpen")
      : value === "closed"
        ? t("statusClosed")
        : value === "all"
          ? t("statusAll")
          : statusLabel(value);

  return (
    <Page>
      <PageHeader
        title={t("listTitle")}
        description={t("listDescription")}
        actions={
          <Button asChild>
            <Link to="/tickets/new">
              <Plus />
              {t("newTicket")}
            </Link>
          </Button>
        }
      />
      <FilterBar value={search} onChange={change}>
        <Select
          value={status}
          onValueChange={(next) => change({ status: next === "open" ? undefined : (next as StatusFilter) })}
        >
          <SelectTrigger aria-label={t("status")} className="w-full sm:w-48">
            <SelectValue>{statusText(status)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t("statusOpen")}</SelectItem>
            <SelectItem value="closed">{t("statusClosed")}</SelectItem>
            <SelectItem value="all">{t("statusAll")}</SelectItem>
            <SelectSeparator />
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {statusLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(next) => change({ sort: next === "updated" ? undefined : (next as Sort) })}
        >
          <SelectTrigger aria-label={t("sort")} className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`sort_${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>
      {list.isPending ? (
        <LoadingState />
      ) : !list.data ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<ListTodo />}
          title={hasFilters(search) || status !== "open" ? t("noMatches") : t("noOpenTickets")}
          description={hasFilters(search) ? t("noMatchesHint") : undefined}
        />
      ) : (
        <>
          <Card className="relative py-0">
            {list.isPlaceholderData ? (
              <Spinner className="text-muted-foreground absolute top-3 right-3" aria-label={t("updating")} />
            ) : null}
            <TicketTable tickets={list.data.items} />
          </Card>
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={list.data.total}
            onPage={(next) => onSearch({ page: next > 1 ? next : undefined })}
          />
        </>
      )}
    </Page>
  );
}

function TicketTable({ tickets }: { tickets: TicketSummary[] }) {
  const t = useT(messages);
  const format = useFormatter();
  const navigate = useNavigate();
  const open = (ticket: TicketSummary, event: MouseEvent) => {
    // The title link handles its own clicks (also new tabs); text selection stays possible.
    if ((event.target as HTMLElement).closest("a") || window.getSelection()?.toString()) return;
    void navigate({ to: "/tickets/$number", params: { number: String(ticket.number) } });
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead>{t("colTitle")}</TableHead>
          <TableHead>{t("status")}</TableHead>
          <TableHead>{t("urgency")}</TableHead>
          <TableHead>{t("category")}</TableHead>
          <TableHead>{t("requester")}</TableHead>
          <TableHead>{t("assignee")}</TableHead>
          <TableHead>{t("colUpdated")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TableRow key={ticket.id} className="cursor-pointer" onClick={(event) => open(ticket, event)}>
            <TableCell className="text-muted-foreground tabular-nums">{ticket.number}</TableCell>
            <TableCell className="max-w-96 min-w-56 whitespace-normal">
              <Link
                to="/tickets/$number"
                params={{ number: String(ticket.number) }}
                className="line-clamp-2 font-medium break-words underline-offset-4 hover:underline focus-visible:underline"
              >
                {ticket.title}
              </Link>
            </TableCell>
            <TableCell>
              <StatusBadge status={ticket.status} />
            </TableCell>
            <TableCell>
              <UrgencyBadge urgency={ticket.urgency} />
            </TableCell>
            <TableCell className="max-w-48 truncate">{ticket.category?.name ?? "–"}</TableCell>
            <TableCell className="max-w-48 truncate">{personName(ticket.requester) ?? "–"}</TableCell>
            <TableCell className="max-w-48 truncate">
              {personName(ticket.assignee) ?? (
                <span className="text-muted-foreground">{t("unassigned")}</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              <time dateTime={ticket.updatedAt} title={format.dateTime(ticket.updatedAt)}>
                {format.relative(ticket.updatedAt)}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
