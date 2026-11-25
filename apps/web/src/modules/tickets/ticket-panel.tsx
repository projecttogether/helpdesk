import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, UserCheck, X } from "lucide-react";
import type { TicketDetail } from "@helpdesk/shared/api/tickets";
import { STATUSES, URGENCIES, type Status, type Urgency } from "@helpdesk/shared/tickets";
import { PersonPicker } from "@/components/person-picker";
import { UrgencyBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMe } from "@/hooks/use-me";
import { useT } from "@/i18n";
import { useFormatter } from "@/lib/format";
import { useStatusLabel, useUrgencyLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";
import { categoriesQuery, type TicketChange } from "./api";
import { RelativeTime, StatusDot } from "./bits";
import { isOverdue } from "./display";
import { messages } from "./messages";
import { personName } from "./timeline";

/** One labelled row of the panel. */
function PanelField(props: { label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", props.className)}>
      {props.htmlFor ? (
        <label htmlFor={props.htmlFor} className="text-muted-foreground text-xs font-medium">
          {props.label}
        </label>
      ) : (
        <span className="text-muted-foreground text-xs font-medium">{props.label}</span>
      )}
      {props.children}
    </div>
  );
}

/**
 * The ticket's fields. `ticket` holds the values being saved (shown at
 * once); every change calls `onChange`, which saves it.
 */
export function TicketPanel(props: { ticket: TicketDetail; onChange: (change: TicketChange) => void }) {
  const t = useT(messages);
  const format = useFormatter();
  const statusLabel = useStatusLabel();
  const urgencyLabel = useUrgencyLabel();
  const me = useMe();
  const id = useId();
  const categories = useQuery(categoriesQuery);
  const { ticket, onChange } = props;

  const choices = (categories.data?.items ?? []).filter(
    (category) => category.isActive || category.id === ticket.category?.id,
  );
  if (ticket.category && !choices.some((category) => category.id === ticket.category?.id)) {
    choices.unshift({
      id: ticket.category.id,
      name: ticket.category.name,
      position: -1,
      isActive: true,
      defaultAssigneeId: null,
      defaultAssigneeName: null,
    });
  }
  const requester = ticket.requester;
  const overdue = isOverdue(ticket.dueDate, ticket.status);

  return (
    <div className="bg-card grid gap-5 rounded-lg border p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-1">
      <PanelField label={t("status")} htmlFor={`${id}-status`}>
        <Select value={ticket.status} onValueChange={(status) => onChange({ status: status as Status })}>
          <SelectTrigger id={`${id}-status`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                <StatusDot status={status} />
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>

      <PanelField label={t("urgency")} htmlFor={`${id}-urgency`}>
        <Select value={ticket.urgency} onValueChange={(urgency) => onChange({ urgency: urgency as Urgency })}>
          <SelectTrigger id={`${id}-urgency`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {URGENCIES.map((urgency) => (
              <SelectItem key={urgency} value={urgency}>
                <span aria-hidden>
                  <UrgencyBadge urgency={urgency} compact />
                </span>
                {urgencyLabel(urgency)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>

      <PanelField label={t("category")} htmlFor={`${id}-category`}>
        <Select
          value={ticket.category?.id ?? ""}
          onValueChange={(categoryId) => {
            const category = choices.find((choice) => choice.id === categoryId);
            if (category) onChange({ category: { id: category.id, name: category.name } });
          }}
        >
          <SelectTrigger id={`${id}-category`} className="w-full">
            <SelectValue placeholder={t("noCategory")} />
          </SelectTrigger>
          <SelectContent>
            {choices.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>

      <PanelField label={t("assignee")} htmlFor={`${id}-assignee`}>
        <PersonPicker
          id={`${id}-assignee`}
          scope="staff"
          allowNone
          value={ticket.assignee}
          onChange={(assignee) => onChange({ assignee })}
          placeholder={t("unassigned")}
        />
        {ticket.assignee?.id !== me.id ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto justify-self-start p-0 text-xs"
            onClick={() => onChange({ assignee: { id: me.id, name: me.name, email: me.email } })}
          >
            <UserCheck />
            {t("assignToMe")}
          </Button>
        ) : null}
      </PanelField>

      <PanelField label={t("dueDate")} htmlFor={`${id}-due`}>
        <DueDateField
          id={`${id}-due`}
          value={ticket.dueDate}
          overdue={overdue}
          onCommit={(dueDate) => onChange({ dueDate })}
        />
        {overdue ? <p className="text-destructive text-xs font-medium">{t("overdue")}</p> : null}
      </PanelField>

      <PanelField label={t("requester")}>
        {requester ? (
          <div className="grid min-w-0 gap-0.5 text-sm">
            <span className="truncate font-medium">{personName(requester)}</span>
            <a
              href={`mailto:${requester.email}`}
              className="text-muted-foreground hover:text-foreground inline-flex min-w-0 items-center gap-1.5 underline-offset-4 hover:underline"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{requester.email}</span>
            </a>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">{t("unknownPerson")}</span>
        )}
      </PanelField>

      <PanelField label={t("created")} className="sm:col-span-2 lg:col-span-1">
        <div className="text-muted-foreground grid gap-0.5 text-sm">
          <span className="text-foreground">{format.dateTime(ticket.createdAt)}</span>
          <span>
            {ticket.source === "staff"
              ? t("recordedBy", { name: personName(ticket.createdBy) ?? t("someone") })
              : t("viaForm")}
            {ticket.formVersion !== null ? ` · ${t("formVersion", { version: ticket.formVersion })}` : null}
          </span>
          <span>
            {t("updated")} <RelativeTime iso={ticket.updatedAt} />
          </span>
          {ticket.closedAt ? <span>{t("closedOn", { date: format.dateTime(ticket.closedAt) })}</span> : null}
        </div>
      </PanelField>
    </div>
  );
}

const plausibleDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100;
};

/**
 * A date input that saves once the date is complete: shortly after the last
 * change, on Enter, or when leaving the field. Typing a year digit by digit
 * saves no half-typed dates.
 */
function DueDateField(props: {
  id: string;
  value: string | null;
  overdue: boolean;
  onCommit: (value: string | null) => void;
}) {
  const t = useT(messages);
  const [draft, setDraft] = useState(props.value ?? "");
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(props);
  latest.current = props;

  // Someone saved another date: show it, unless the field is being edited.
  const [saved, setSaved] = useState(props.value);
  if (props.value !== saved) {
    setSaved(props.value);
    if (!focused.current) setDraft(props.value ?? "");
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (value: string) => {
    window.clearTimeout(timer.current);
    const next = value === "" ? null : value;
    if (next !== null && !plausibleDate(next)) return false;
    if (next !== latest.current.value) latest.current.onCommit(next);
    return true;
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        id={props.id}
        type="date"
        value={draft}
        className={cn("min-w-0 flex-1", props.overdue && "text-destructive")}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          window.clearTimeout(timer.current);
          if (value === "" || plausibleDate(value))
            timer.current = window.setTimeout(() => commit(value), 800);
        }}
        onBlur={() => {
          focused.current = false;
          if (!commit(draft)) setDraft(latest.current.value ?? "");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
        }}
      />
      {props.value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("clearDueDate")}
          title={t("clearDueDate")}
          onClick={() => {
            setDraft("");
            commit("");
          }}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
