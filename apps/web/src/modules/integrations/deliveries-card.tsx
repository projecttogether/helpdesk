import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Hash, Mail, MessageSquare, RefreshCw, Send } from "lucide-react";
import type { Delivery } from "@helpdesk/shared/api/integrations";
import { Pager } from "@/components/ui/pager";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import { cn } from "@/components/ui/utils";
import { useDeliveries } from "./api";
import { useDeliveryChannelLabel, useDeliveryKindLabel, useDeliveryStatusLabel } from "./delivery-labels";
import { messages } from "./messages";

const PAGE_SIZE = 25;

const STATUS_STYLE: Record<Delivery["status"], string> = {
  pending: "bg-amber-500/15 text-amber-800 border-amber-500/30 dark:text-amber-300",
  sending: "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
  sent: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  skipped: "bg-muted text-muted-foreground",
};

const CHANNEL_ICON = { email: Mail, slack_channel: Hash, slack_dm: MessageSquare } satisfies Record<
  Delivery["channel"],
  unknown
>;

export function DeliveryStatusBadge({ status }: { status: Delivery["status"] }) {
  const label = useDeliveryStatusLabel();
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {label(status)}
    </Badge>
  );
}

export function DeliveriesTable({ items }: { items: Delivery[] }) {
  const t = useT(messages);
  const format = useFormatter();
  const kindLabel = useDeliveryKindLabel();
  const channelLabel = useDeliveryChannelLabel();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colTime")}</TableHead>
          <TableHead>{t("colChannel")}</TableHead>
          <TableHead>{t("colWhat")}</TableHead>
          <TableHead>{t("colRecipient")}</TableHead>
          <TableHead>{t("colStatus")}</TableHead>
          <TableHead className="text-right">{t("colAttempts")}</TableHead>
          <TableHead>{t("colError")}</TableHead>
          <TableHead>{t("colTicket")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((delivery) => {
          const Icon = CHANNEL_ICON[delivery.channel];
          return (
            <TableRow key={delivery.id}>
              <TableCell className="align-top whitespace-nowrap">
                <time dateTime={delivery.createdAt} title={format.relative(delivery.createdAt)}>
                  {format.dateTime(delivery.createdAt)}
                </time>
              </TableCell>
              <TableCell className="align-top">
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  {channelLabel(delivery.channel)}
                </span>
              </TableCell>
              <TableCell className="align-top">{kindLabel(delivery.kind)}</TableCell>
              <TableCell className="max-w-64 align-top break-all whitespace-normal">
                {delivery.recipient || <span className="text-muted-foreground">{t("defaultChannel")}</span>}
              </TableCell>
              <TableCell className="align-top">
                <DeliveryStatusBadge status={delivery.status} />
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">
                {format.number(delivery.attempts)}
              </TableCell>
              <TableCell
                className={cn(
                  "max-w-80 min-w-48 align-top whitespace-normal",
                  delivery.lastError && "text-destructive",
                )}
              >
                {delivery.lastError ? (
                  <span className="line-clamp-3 break-words" title={delivery.lastError}>
                    {delivery.lastError}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                {delivery.ticketNumber !== null ? (
                  <Link
                    to={`/tickets/${delivery.ticketNumber}`}
                    className="text-link underline-offset-4 hover:underline"
                  >
                    {t("ticket", { number: delivery.ticketNumber })}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function DeliveriesCard() {
  const t = useT(messages);
  const [page, setPage] = useState(1);
  const deliveries = useDeliveries(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("deliveriesTitle")}</h2>
        </CardTitle>
        <CardDescription>{t("deliveriesDescription")}</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={deliveries.isFetching}
            onClick={() => void deliveries.refetch()}
          >
            <RefreshCw className={deliveries.isFetching ? "animate-spin" : undefined} />
            {t("refresh")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {deliveries.isLoading ? (
          <LoadingState />
        ) : deliveries.isError || !deliveries.data ? (
          <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
        ) : deliveries.data.items.length === 0 && page === 1 ? (
          <EmptyState icon={<Send />} title={t("deliveriesEmpty")} />
        ) : (
          <>
            <DeliveriesTable items={deliveries.data.items} />
            <Pager page={page} pageSize={PAGE_SIZE} total={deliveries.data.total} onPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
