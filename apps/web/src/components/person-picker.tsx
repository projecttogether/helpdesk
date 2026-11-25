import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, UserRound, UserX } from "lucide-react";
import type { Person } from "@helpdesk/shared/api/users";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import { defineMessages, useT } from "@/i18n";
import { cn } from "@/components/ui/utils";

const messages = defineMessages({
  en: { search: "Search people…", empty: "No one found", nobody: "Nobody", choose: "Choose a person" },
});

export type PickedPerson = { id: string; name: string; email: string };

export const peopleQuery = (scope: "staff" | "all", q: string) => ({
  queryKey: ["people", scope, q] as const,
  queryFn: () => api.get<{ items: Person[] }>("/people", { scope, q: q || undefined }),
  staleTime: 60_000,
});

/**
 * Chooses a person: `staff` lists everyone who can be assigned, `all`
 * everyone with access (searched on the server). `allowNone` offers
 * "Nobody", which passes null.
 */
export function PersonPicker(props: {
  scope: "staff" | "all";
  value: PickedPerson | null;
  onChange: (person: PickedPerson | null) => void;
  allowNone?: boolean;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const t = useT(messages);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 200);
  const people = useQuery({ ...peopleQuery(props.scope, props.scope === "staff" ? "" : q), enabled: open });
  const items = (people.data?.items ?? []).filter(
    (person) =>
      props.scope !== "staff" ||
      !q ||
      `${person.name} ${person.email}`.toLowerCase().includes(q.toLowerCase()),
  );

  const pick = (person: PickedPerson | null) => {
    props.onChange(person);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={props["aria-invalid"]}
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          disabled={props.disabled}
          className={cn("w-full justify-between font-normal", props.className)}
        >
          <span className={cn("flex min-w-0 items-center gap-2", !props.value && "text-muted-foreground")}>
            <UserRound className="size-4 shrink-0" aria-hidden />
            <span className="truncate">
              {props.value
                ? props.value.name
                : (props.placeholder ?? (props.allowNone ? t("nobody") : t("choose")))}
            </span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("search")} value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{people.isLoading ? "…" : t("empty")}</CommandEmpty>
            <CommandGroup>
              {props.allowNone ? (
                <CommandItem value="__none" onSelect={() => pick(null)}>
                  <UserX className="text-muted-foreground" aria-hidden />
                  {t("nobody")}
                  <Check className={cn("ml-auto", props.value ? "opacity-0" : "opacity-100")} />
                </CommandItem>
              ) : null}
              {items.map((person) => (
                <CommandItem
                  key={person.id}
                  value={person.id}
                  onSelect={() => pick({ id: person.id, name: person.name, email: person.email })}
                >
                  <div className="grid min-w-0">
                    <span className="truncate">{person.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{person.email}</span>
                  </div>
                  <Check
                    className={cn("ml-auto", props.value?.id === person.id ? "opacity-100" : "opacity-0")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
