import { useId, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import type { Category, CategoryInput } from "@helpdesk/shared/api/form";
import { PersonPicker } from "@/components/person-picker";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/components/ui/utils";
import {
  categoryInput,
  useCategories,
  useCreateCategory,
  useReorderCategories,
  useUpdateCategory,
} from "./api";
import { messages } from "./messages";
import { refocus } from "./parts";

/** The categories: the answers to the category question and the board filter. Each change saves at once. */
export function CategoriesEditor() {
  const t = useT(messages);
  const categories = useCategories();
  const reorder = useReorderCategories();

  if (categories.isLoading) return <LoadingState />;
  if (categories.isError || !categories.data) {
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;
  }
  const items = categories.data.items;

  const move = (index: number, direction: -1 | 1) => {
    const ids = items.map((category) => category.id);
    const [id] = ids.splice(index, 1);
    if (!id) return;
    ids.splice(index + direction, 0, id);
    reorder.mutate(ids, {
      onSuccess: () =>
        refocus(`[data-category="${id}"] [data-action="move-${direction}"]`, `[data-category="${id}"] input`),
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t("categoriesIntro")}</p>
      {items.length === 0 ? (
        <EmptyState icon={<Tags />} title={t("noCategoriesTitle")} description={t("noCategoriesText")} />
      ) : (
        <Card className="gap-0 py-0">
          <div
            aria-hidden
            className="text-muted-foreground hidden gap-4 border-b px-4 py-2 text-xs font-medium sm:flex"
          >
            <span className="flex-1 pl-3">{t("categoryColumn")}</span>
            <span className="w-56">{t("defaultAssignee")}</span>
            <span className="w-[8.75rem]">{t("active")}</span>
          </div>
          <ol className="divide-y">
            {items.map((category, index) => (
              <CategoryRow
                key={category.id}
                category={category}
                index={index}
                count={items.length}
                reordering={reorder.isPending}
                onMove={(direction) => move(index, direction)}
              />
            ))}
          </ol>
        </Card>
      )}
      <AddCategory />
    </div>
  );
}

function CategoryRow(props: {
  category: Category;
  index: number;
  count: number;
  reordering: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const t = useT(messages);
  const update = useUpdateCategory();
  const { category } = props;
  const n = props.index + 1;
  const pickerId = useId();

  const save = (patch: Partial<CategoryInput>) =>
    update.mutateAsync({ id: category.id, ...categoryInput(category, patch) }).catch((error: unknown) => {
      toast.error(
        error instanceof ApiError && error.status === 409 && patch.isActive === false
          ? t("keepOneActive")
          : errorMessage(error),
      );
      throw error;
    });

  return (
    <li
      data-category={category.id}
      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4 sm:px-4"
    >
      <div className={cn("flex min-w-0 flex-1 items-center gap-2", !category.isActive && "opacity-60")}>
        {/* Remount when the saved name changes, so the field shows it. */}
        <CategoryName
          key={category.name}
          name={category.name}
          label={t("categoryName", { n })}
          onSave={(name) => save({ name })}
        />
        {category.isActive ? null : <Badge variant="outline">{t("inactiveBadge")}</Badge>}
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        <div className={cn("min-w-0 flex-1 sm:w-56 sm:flex-none", !category.isActive && "opacity-60")}>
          {/* PersonPicker takes no aria-label: a hidden label names its button, with the current person. */}
          <label htmlFor={pickerId} className="sr-only">
            {t("defaultAssigneeOf", {
              name: category.name,
              person: category.defaultAssigneeName ?? t("nobody"),
            })}
          </label>
          <PersonPicker
            id={pickerId}
            scope="staff"
            allowNone
            value={
              category.defaultAssigneeId
                ? { id: category.defaultAssigneeId, name: category.defaultAssigneeName ?? "", email: "" }
                : null
            }
            disabled={update.isPending}
            onChange={(person) => void save({ defaultAssigneeId: person?.id ?? null }).catch(() => undefined)}
          />
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={category.isActive}
            disabled={update.isPending}
            aria-label={t("activeLabel", { name: category.name })}
            onCheckedChange={(isActive) => void save({ isActive }).catch(() => undefined)}
          />
          <span aria-hidden>{t("active")}</span>
        </label>
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="move--1"
            aria-label={t("moveCategoryUp", { name: category.name })}
            disabled={props.index === 0 || props.reordering}
            onClick={() => props.onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="move-1"
            aria-label={t("moveCategoryDown", { name: category.name })}
            disabled={props.index === props.count - 1 || props.reordering}
            onClick={() => props.onMove(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
        </div>
        {update.isPending ? <Spinner className="shrink-0" /> : null}
      </div>
    </li>
  );
}

/** The name, edited in place: saved on Enter or when leaving the field; Escape restores it. */
function CategoryName(props: { name: string; label: string; onSave: (name: string) => Promise<unknown> }) {
  const t = useT(messages);
  const [value, setValue] = useState(props.name);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const name = value.trim();
    if (name === props.name) return setValue(props.name);
    if (!name) return setError(t("enterName"));
    setError(null);
    void props.onSave(name).catch(() => setValue(props.name));
  };

  return (
    <div className="min-w-0 flex-1">
      <Input
        value={value}
        maxLength={80}
        aria-label={props.label}
        aria-invalid={!!error}
        className="hover:border-input focus-visible:border-ring h-8 border-transparent shadow-none dark:bg-transparent"
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setValue(props.name);
            setError(null);
          }
        }}
      />
      {error ? <p className="text-destructive mt-1 text-sm">{error}</p> : null}
    </div>
  );
}

function AddCategory() {
  const t = useT(messages);
  const create = useCreateCategory();
  const [name, setName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, isActive: true, defaultAssigneeId: null },
      {
        onSuccess: () => {
          setName("");
          toast.success(t("categoryAdded"));
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        value={name}
        maxLength={80}
        aria-label={t("newCategory")}
        placeholder={t("newCategory")}
        className="sm:max-w-sm"
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
        {create.isPending ? <Spinner /> : <Plus aria-hidden />}
        {t("addCategory")}
      </Button>
    </form>
  );
}
