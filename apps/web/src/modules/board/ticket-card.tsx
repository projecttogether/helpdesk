import { useMemo, type ReactNode, type Ref } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays, MessageSquare, MoreHorizontal, UserCheck } from "lucide-react";
import type { TicketSummary } from "@helpdesk/shared/api/tickets";
import { STATUSES, type Status } from "@helpdesk/shared/tickets";
import { UrgencyBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { INTL_LOCALE, useLocale, useT } from "@/i18n";
import { useStatusLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";
import { PersonAvatar, StatusDot } from "@/modules/tickets/bits";
import { isOverdue } from "@/modules/tickets/display";
import { personName } from "@/modules/tickets/timeline";
import { messages } from "./messages";

/** "Nov 12": a short calendar date (YYYY-MM-DD) in the interface language. */
function useShortDate() {
  const locale = useLocale();
  return useMemo(() => {
    const tag = INTL_LOCALE[locale];
    const short = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(tag, { dateStyle: "full", timeZone: "UTC" });
    const parse = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return {
      short: (value: string) => short.format(parse(value)),
      long: (value: string) => long.format(parse(value)),
    };
  }, [locale]);
}

export type CardActions = {
  onMove: (status: Status) => void;
  /** Absent when the ticket is already assigned to the viewer. */
  onAssignToMe?: () => void;
};

/**
 * A ticket on the board. The title links to the ticket and stretches over
 * the whole card; the "…" menu moves and assigns without dragging.
 */
export function TicketCard(props: {
  ticket: TicketSummary;
  actions?: CardActions;
  /** The link starts keyboard dragging (Space). */
  linkRef?: Ref<HTMLAnchorElement>;
  linkProps?: Record<string, unknown>;
  /** Shown while dragged, under the pointer. */
  overlay?: boolean;
  /** The card's place while it is dragged. */
  placeholder?: boolean;
}) {
  const t = useT(messages);
  const date = useShortDate();
  const { ticket } = props;
  const overdue = isOverdue(ticket.dueDate, ticket.status);
  const assignee = personName(ticket.assignee);

  return (
    <article
      className={cn(
        "group bg-card relative rounded-lg border p-3 shadow-xs transition-[box-shadow,border-color,opacity]",
        "hover:border-foreground/20 hover:shadow-sm",
        "has-[a:focus-visible]:border-ring has-[a:focus-visible]:ring-ring/50 has-[a:focus-visible]:ring-[3px]",
        // Long presses start a drag on touch screens: no text selection or link preview.
        "select-none [-webkit-touch-callout:none]",
        props.overlay && "ring-ring/30 cursor-grabbing shadow-lg ring-2",
        props.placeholder && "border-dashed opacity-40 shadow-none",
      )}
      // The overlay only shows the drag; screen readers hear the announcements instead.
      aria-hidden={props.overlay || undefined}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            {/* The link says the number to screen readers. */}
            <span className="font-medium tabular-nums" aria-hidden>
              #{ticket.number}
            </span>
            {ticket.category ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{ticket.category.name}</span>
              </>
            ) : null}
          </div>
          <Link
            ref={props.linkRef}
            to="/tickets/$number"
            params={{ number: String(ticket.number) }}
            draggable={false}
            tabIndex={props.overlay ? -1 : undefined}
            {...props.linkProps}
            className="mt-1 line-clamp-2 text-sm leading-snug font-medium break-words outline-none after:absolute after:inset-0 after:rounded-lg"
          >
            <span className="sr-only">#{ticket.number} </span>
            {ticket.title}
          </Link>
        </div>
        {props.actions ? <CardMenu ticket={ticket} actions={props.actions} /> : null}
      </div>
      <div className="text-muted-foreground mt-3 flex min-w-0 items-center gap-3 text-xs">
        <UrgencyBadge urgency={ticket.urgency} compact />
        {ticket.dueDate ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap",
              overdue && "text-destructive font-medium",
            )}
            title={t(overdue ? "dueOverdue" : "due", { date: date.long(ticket.dueDate) })}
          >
            <CalendarDays className="size-3.5" aria-hidden />
            <span aria-hidden>{date.short(ticket.dueDate)}</span>
            <span className="sr-only">
              {t(overdue ? "dueOverdue" : "due", { date: date.long(ticket.dueDate) })}
            </span>
          </span>
        ) : null}
        {ticket.messageCount > 0 ? (
          <span
            className="inline-flex items-center gap-1"
            title={t("messageCount", { count: ticket.messageCount })}
          >
            <MessageSquare className="size-3.5" aria-hidden />
            <span aria-hidden>{ticket.messageCount}</span>
            <span className="sr-only">{t("messageCount", { count: ticket.messageCount })}</span>
          </span>
        ) : null}
        <span className="ml-auto flex min-w-0 items-center">
          {assignee ? (
            <PersonAvatar name={assignee} label={t("assignedTo", { name: assignee })} size="sm" />
          ) : (
            <span className="truncate">{t("unassigned")}</span>
          )}
        </span>
      </div>
    </article>
  );
}

/** "…": move to another column or take the ticket, without dragging. */
function CardMenu({ ticket, actions }: { ticket: TicketSummary; actions: CardActions }) {
  const t = useT(messages);
  const statusLabel = useStatusLabel();
  // Pointer and touch presses on the menu never start a drag of the card.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div className="relative z-10 -mt-1 -mr-1.5 shrink-0" onPointerDown={stop} onTouchStart={stop}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground size-7"
            aria-label={t("cardMenu", { number: ticket.number })}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {actions.onAssignToMe ? (
            <>
              <DropdownMenuItem onSelect={actions.onAssignToMe}>
                <UserCheck />
                {t("assignToMe")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {STATUSES.filter((status) => status !== ticket.status).map((status) => (
            <DropdownMenuItem key={status} onSelect={() => actions.onMove(status)}>
              <StatusDot status={status} />
              {t("moveTo", { status: statusLabel(status) })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Fills a slot of the card list while there is nothing to show. */
export function CardSlot({ children }: { children: ReactNode }) {
  return (
    <li className="text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-xs">
      {children}
    </li>
  );
}
