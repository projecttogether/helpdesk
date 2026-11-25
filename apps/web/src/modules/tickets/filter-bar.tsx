import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search, UserRound, X } from "lucide-react";
import { URGENCIES, type Urgency } from "@helpdesk/shared/tickets";
import { peopleQuery } from "@/components/person-picker";
import { UrgencyBadge } from "@/components/ticket-badges";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounced } from "@/hooks/use-debounced";
import { useT } from "@/i18n";
import { useUrgencyLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";
import { categoriesQuery } from "./api";
import { hasFilters, type TicketFilters } from "./filters";
import { messages } from "./messages";

/** Radix Select needs a value for "all"; ids are UUIDs, so this never clashes. */
const ALL = "all";

/**
 * Search, category, assignee and urgency of the board and the list.
 * `children` adds controls (the list's status and sort).
 */
export function FilterBar(props: {
  value: TicketFilters;
  onChange: (patch: Partial<TicketFilters>) => void;
  children?: ReactNode;
}) {
  const t = useT(messages);
  const urgencyLabel = useUrgencyLabel();
  const categories = useQuery(categoriesQuery);
  const { value, onChange } = props;
  return (
    <div
      role="search"
      aria-label={t("filters")}
      className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
    >
      <SearchBox value={value.q} onChange={(q) => onChange({ q })} />
      <Select
        value={value.categoryId ?? ALL}
        onValueChange={(next) => onChange({ categoryId: next === ALL ? undefined : next })}
      >
        <SelectTrigger aria-label={t("category")} className="w-full sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allCategories")}</SelectItem>
          {value.categoryId && !categories.data ? (
            <SelectItem value={value.categoryId}>{t("category")}</SelectItem>
          ) : null}
          {categories.data?.items.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.name}
              {category.isActive ? null : <span className="text-muted-foreground">({t("inactive")})</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AssigneeFilter value={value.assignee} onChange={(assignee) => onChange({ assignee })} />
      <Select
        value={value.urgency ?? ALL}
        onValueChange={(next) => onChange({ urgency: next === ALL ? undefined : (next as Urgency) })}
      >
        <SelectTrigger aria-label={t("urgency")} className="w-full sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("allUrgencies")}</SelectItem>
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
      {props.children}
      {hasFilters(value) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            onChange({ q: undefined, categoryId: undefined, assignee: undefined, urgency: undefined })
          }
        >
          <X />
          {t("clearFilters")}
        </Button>
      ) : null}
    </div>
  );
}

/** The search text: it goes to the address once typing pauses, and follows the address back. */
function SearchBox(props: { value: string | undefined; onChange: (q: string | undefined) => void }) {
  const t = useT(messages);
  const [text, setText] = useState(props.value ?? "");
  const settled = useDebounced(text.trim(), 300);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const next = settled || undefined;
    if (next !== latest.current.value) latest.current.onChange(next);
  }, [settled]);

  // The address changed elsewhere (back button, "Clear filters"): show its text.
  const [shown, setShown] = useState(props.value);
  if (props.value !== shown) {
    setShown(props.value);
    if ((props.value ?? "") !== settled) setText(props.value ?? "");
  }

  return (
    <div className="relative col-span-2 sm:w-64">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={100}
        placeholder={t("searchPlaceholder")}
        aria-label={t("search")}
        className="pl-8"
      />
    </div>
  );
}

/** All, assigned to me, unassigned, or one staff member (searchable). */
function AssigneeFilter(props: { value: string | undefined; onChange: (value: string | undefined) => void }) {
  const t = useT(messages);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const people = useQuery(peopleQuery("staff", ""));
  const q = search.trim().toLowerCase();
  const staff = (people.data?.items ?? []).filter(
    (person) => !q || `${person.name} ${person.email}`.toLowerCase().includes(q),
  );
  const label =
    props.value === undefined
      ? t("anyAssignee")
      : props.value === "me"
        ? t("assignedToMe")
        : props.value === "none"
          ? t("unassigned")
          : (people.data?.items.find((person) => person.id === props.value)?.name ?? t("onePerson"));

  const pick = (value: string | undefined) => {
    props.onChange(value);
    setOpen(false);
    setSearch("");
  };
  const option = (value: string | undefined, text: string) => (
    <CommandItem key={value ?? "any"} value={value ?? "any"} onSelect={() => pick(value)}>
      {text}
      <Check className={cn("ml-auto", props.value === value ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${t("assignee")}: ${label}`}
          className="w-full justify-between font-normal sm:w-48"
        >
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("searchPeople")} value={search} onValueChange={setSearch} />
          <CommandList>
            {q ? null : (
              <>
                <CommandGroup>
                  {option(undefined, t("anyAssignee"))}
                  {option("me", t("assignedToMe"))}
                  {option("none", t("unassigned"))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandEmpty>{people.isLoading ? t("loadingPeople") : t("noPeople")}</CommandEmpty>
            <CommandGroup heading={t("staff")}>
              {staff.map((person) => (
                <CommandItem key={person.id} value={person.id} onSelect={() => pick(person.id)}>
                  <div className="grid min-w-0">
                    <span className="truncate">{person.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{person.email}</span>
                  </div>
                  <Check className={cn("ml-auto", props.value === person.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
