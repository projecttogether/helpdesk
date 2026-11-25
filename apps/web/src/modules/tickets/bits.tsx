import type { Status } from "@helpdesk/shared/tickets";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useFormatter } from "@/lib/format";
import { cn } from "@/components/ui/utils";
import { initials } from "./display";

const STATUS_DOT: Record<Status, string> = {
  new: "bg-sky-500",
  in_progress: "bg-violet-500",
  waiting_for_requester: "bg-amber-500",
  waiting_for_others: "bg-orange-500",
  done: "bg-emerald-500",
  cancelled: "bg-muted-foreground/50",
};

/** A small dot in the status color (the same colors as StatusBadge). */
export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_DOT[status], className)}
    />
  );
}

/** A person's initials in a circle; the name is in the tooltip and for screen readers (`label`). */
export function PersonAvatar(props: {
  name: string;
  label?: string;
  size?: "sm" | "default";
  tone?: "neutral" | "requester";
  className?: string;
}) {
  return (
    <Avatar size={props.size ?? "default"} className={props.className} title={props.label ?? props.name}>
      <AvatarFallback
        className={cn(
          "font-medium",
          props.size === "sm" ? "text-[10px]" : "text-xs",
          props.tone === "requester" && "bg-sky-500/15 text-sky-800 dark:text-sky-200",
        )}
      >
        <span aria-hidden>{initials(props.name)}</span>
        <span className="sr-only">{props.label ?? props.name}</span>
      </AvatarFallback>
    </Avatar>
  );
}

/** "3 hours ago", with the exact time in the tooltip. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const format = useFormatter();
  return (
    <time dateTime={iso} title={format.dateTime(iso)} className={className}>
      {format.relative(iso)}
    </time>
  );
}
