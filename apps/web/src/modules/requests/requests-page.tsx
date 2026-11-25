import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Inbox, SquarePen } from "lucide-react";
import { Page, PageHeader } from "@/components/ui/page";
import { Pager } from "@/components/ui/pager";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormatter } from "@/lib/format";
import { useT } from "@/i18n";
import { requestsQuery } from "./api";
import { messages } from "./messages";

export type RequestFilter = "open" | "closed" | "all";

export function RequestsPage(props: {
  status: RequestFilter;
  page: number;
  onChange: (next: { status?: RequestFilter; page?: number }) => void;
}) {
  const t = useT(messages);
  const format = useFormatter();
  const navigate = useNavigate();
  const list = useQuery(requestsQuery(props.status, props.page));

  return (
    <Page>
      <PageHeader
        title={t("myRequests")}
        description={t("myRequestsText")}
        actions={
          <Button asChild>
            <Link to="/requests/new">
              <SquarePen />
              {t("newRequest")}
            </Link>
          </Button>
        }
      />
      <Tabs
        value={props.status}
        onValueChange={(value) => props.onChange({ status: value as RequestFilter, page: 1 })}
      >
        <TabsList>
          <TabsTrigger value="all">{t("all")}</TabsTrigger>
          <TabsTrigger value="open">{t("open")}</TabsTrigger>
          <TabsTrigger value="closed">{t("closed")}</TabsTrigger>
        </TabsList>
      </Tabs>
      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t("empty")}
          description={t("emptyText")}
          action={
            <Button asChild>
              <Link to="/requests/new">{t("newRequest")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t("number")}</TableHead>
                  <TableHead>{t("title")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("category")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t("updated")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((request) => (
                  <TableRow
                    key={request.id}
                    className="cursor-pointer"
                    onClick={() =>
                      void navigate({ to: "/requests/$number", params: { number: String(request.number) } })
                    }
                  >
                    <TableCell className="text-muted-foreground tabular-nums">#{request.number}</TableCell>
                    <TableCell className="max-w-96">
                      <Link
                        to="/requests/$number"
                        params={{ number: String(request.number) }}
                        className="line-clamp-2 font-medium hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {request.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={request.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">
                      {request.category ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground hidden sm:table-cell"
                      title={format.dateTime(request.updatedAt)}
                    >
                      {format.relative(request.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={props.page}
            pageSize={25}
            total={list.data.total}
            onPage={(page) => props.onChange({ page })}
          />
        </>
      )}
    </Page>
  );
}
