import type { LucideIcon } from "lucide-react";
import {
  ArrowUpDown,
  CalendarDays,
  CircleDot,
  Lock,
  Pencil,
  RotateCcw,
  Sparkles,
  Tag,
  UserRound,
  UserRoundPlus,
} from "lucide-react";
import type { Message, TicketEvent } from "@helpdesk/shared/api/tickets";
import { AttachmentList } from "@/components/attachments";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import { useStatusLabel, useUrgencyLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";
import { PersonAvatar, RelativeTime } from "./bits";
import { messages } from "./messages";
import { describeEvent, mergeTimeline, personName, type EventWords } from "./timeline";

const EVENT_ICON: Record<TicketEvent["kind"], LucideIcon> = {
  created: Sparkles,
  status_changed: CircleDot,
  assigned: UserRound,
  urgency_changed: ArrowUpDown,
  category_changed: Tag,
  title_changed: Pencil,
  due_date_changed: CalendarDays,
  reopened: RotateCcw,
  identity_requested: UserRoundPlus,
  identity_request_changed: UserRoundPlus,
};

/** Messages and activity of a ticket, oldest first, on one line. */
export function Timeline(props: { messages: Message[]; events: TicketEvent[] }) {
  const t = useT(messages);
  const format = useFormatter();
  const status = useStatusLabel();
  const urgency = useUrgencyLabel();
  const words: EventWords = { t, status, urgency, date: format.date };
  const entries = mergeTimeline(props.messages, props.events);
  return (
    <ol className="before:bg-border relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px">
      {entries.map((entry) =>
        entry.type === "message" ? (
          <MessageItem key={entry.id} message={entry.message} />
        ) : (
          <EventItem
            key={entry.id}
            event={entry.event}
            text={describeEvent(entry.event, entry.automatic, words)}
          />
        ),
      )}
    </ol>
  );
}

function EventItem({ event, text }: { event: TicketEvent; text: string }) {
  const Icon = EVENT_ICON[event.kind];
  return (
    <li className="relative flex items-start gap-3 text-sm">
      <span className="bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center">
        <span className="bg-muted flex size-6 items-center justify-center rounded-full border">
          <Icon className="size-3.5" aria-hidden />
        </span>
      </span>
      <p className="text-muted-foreground min-w-0 pt-1.5 break-words">
        {text}
        <span aria-hidden> · </span>
        <RelativeTime iso={event.createdAt} className="whitespace-nowrap" />
      </p>
    </li>
  );
}

function MessageItem({ message }: { message: Message }) {
  const t = useT(messages);
  const internal = message.visibility === "internal";
  const author = personName(message.author) ?? t("someone");
  return (
    <li className="relative flex items-start gap-3">
      <PersonAvatar
        name={author}
        tone={message.fromRequester ? "requester" : "neutral"}
        className="ring-background ring-4"
      />
      <article
        aria-label={internal ? t("noteBy", { name: author }) : t("messageBy", { name: author })}
        className={cn(
          "min-w-0 flex-1 rounded-lg border px-4 py-3 shadow-xs",
          internal
            ? "border-amber-500/40 bg-amber-500/10 dark:bg-amber-400/10"
            : message.fromRequester
              ? "border-sky-500/25 bg-sky-500/5 dark:bg-sky-400/5"
              : "bg-card",
        )}
      >
        <header className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{author}</span>
          {internal ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300"
            >
              <Lock aria-hidden />
              {t("internalNote")}
            </Badge>
          ) : message.fromRequester ? (
            <Badge
              variant="outline"
              className="border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
            >
              {t("requester")}
            </Badge>
          ) : null}
          <RelativeTime iso={message.createdAt} className="text-muted-foreground text-xs" />
        </header>
        {message.body ? <div className="text-sm break-words whitespace-pre-wrap">{message.body}</div> : null}
        <AttachmentList attachments={message.attachments} className={message.body ? "mt-3" : undefined} />
      </article>
    </li>
  );
}
