import { ArrowDown, ArrowUp, ChevronsUp, Minus } from "lucide-react";
import type { Status, Urgency } from "@helpdesk/shared/tickets";
import { Badge } from "@/components/ui/badge";
import { useStatusLabel, useUrgencyLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";

const STATUS_STYLE: Record<Status, string> = {
  new: "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
  in_progress: "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300",
  waiting_for_requester: "bg-amber-500/15 text-amber-800 border-amber-500/30 dark:text-amber-300",
  waiting_for_others: "bg-orange-500/15 text-orange-800 border-orange-500/30 dark:text-orange-300",
  done: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
};

/** A ticket's status as a colored badge. */
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const label = useStatusLabel();
  return (
    <Badge variant="outline" className={cn(STATUS_STYLE[status], className)}>
      {label(status)}
    </Badge>
  );
}

const URGENCY_STYLE: Record<Urgency, string> = {
  low: "text-muted-foreground",
  normal: "text-muted-foreground",
  urgent: "text-amber-700 border-amber-500/40 dark:text-amber-300",
  very_urgent: "bg-destructive/10 text-destructive border-destructive/30",
};
const URGENCY_ICON = {
  low: ArrowDown,
  normal: Minus,
  urgent: ArrowUp,
  very_urgent: ChevronsUp,
} satisfies Record<Urgency, unknown>;

/** A ticket's urgency; `compact` shows the icon only (with the label for screen readers). */
export function UrgencyBadge({ urgency, compact }: { urgency: Urgency; compact?: boolean }) {
  const label = useUrgencyLabel();
  const Icon = URGENCY_ICON[urgency];
  if (compact) {
    return (
      <span className={cn("inline-flex items-center", URGENCY_STYLE[urgency])} title={label(urgency)}>
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{label(urgency)}</span>
      </span>
    );
  }
  return (
    <Badge variant="outline" className={URGENCY_STYLE[urgency]}>
      <Icon aria-hidden />
      {label(urgency)}
    </Badge>
  );
}
