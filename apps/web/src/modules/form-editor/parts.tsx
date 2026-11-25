import { useCallback, type ReactNode } from "react";
import {
  AlignLeft,
  AtSign,
  CalendarDays,
  CircleDot,
  Hash,
  ListChecks,
  Paperclip,
  SquareCheck,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import type { FormDefinition, Operator, QuestionType } from "@helpdesk/shared/form";
import { useT } from "@/i18n";
import { cn } from "@/components/ui/utils";
import { classifyProblem, type Reference } from "./editor-state";
import { messages } from "./messages";

export const TYPE_ICONS: Record<QuestionType, LucideIcon> = {
  short_text: TextCursorInput,
  long_text: AlignLeft,
  single_choice: CircleDot,
  multiple_choice: ListChecks,
  date: CalendarDays,
  number: Hash,
  email: AtSign,
  checkbox: SquareCheck,
  file: Paperclip,
};

/** Problem messages in the interface language (unknown ones as they are). */
export function useProblemText() {
  const t = useT(messages);
  return useCallback(
    (message: string) => {
      const known = classifyProblem(message);
      if (!known) return message;
      return t(`problem_${known.key}`, known.system ? { system: t(`system_${known.system}`) } : undefined);
    },
    [t],
  );
}

/** Plain words for a comparison; checkboxes are ticked, files are there. */
export function useOperatorLabel() {
  const t = useT(messages);
  return useCallback(
    (operator: Operator, type: QuestionType | undefined) => {
      if (type === "checkbox" && operator === "answered") return t("op_ticked");
      if (type === "checkbox" && operator === "not_answered") return t("op_not_ticked");
      if (type === "file" && operator === "answered") return t("op_has_file");
      if (type === "file" && operator === "not_answered") return t("op_no_file");
      return t(`op_${operator}`);
    },
    [t],
  );
}

/** Problems shown under a field. */
export function FieldProblems(props: { messages: readonly string[]; id?: string; className?: string }) {
  const text = useProblemText();
  const unique = [...new Set(props.messages)];
  if (unique.length === 0) return null;
  return (
    <div id={props.id} className={cn("text-destructive space-y-0.5 text-sm", props.className)}>
      {unique.map((message) => (
        <p key={message}>{text(message)}</p>
      ))}
    </div>
  );
}

/** The pages and questions whose rules use something about to be deleted. */
export function ReferenceList(props: { references: readonly Reference[]; intro: string }) {
  const t = useT(messages);
  if (props.references.length === 0) return null;
  return (
    <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-sm">
      <p>{props.intro}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {props.references.map((reference) => (
          <li key={reference.kind === "page" ? reference.page.id : reference.question.id}>
            {reference.kind === "page"
              ? t("referencePage", {
                  page: reference.pageIndex + 1,
                  title: reference.page.title || t("untitledPage"),
                })
              : t("referenceQuestion", {
                  page: reference.pageIndex + 1,
                  label: reference.question.label || t("untitled"),
                })}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t("referencesNote")}</p>
    </div>
  );
}

/** Asks before a change; the editor shows one dialog at a time. */
export type ConfirmRequest = {
  title: string;
  description?: string;
  confirmLabel: string;
  details?: ReactNode;
  onConfirm: () => void;
};
export type AskConfirm = (request: ConfirmRequest) => void;

/** What every part of the editor needs: the draft, how to change it, and shared lookups. */
export type EditorContext = {
  definition: FormDefinition;
  onChange: (definition: FormDefinition) => void;
  askConfirm: AskConfirm;
  /** All categories (also inactive ones) by id, for rule values. */
  categories: readonly { id: string; name: string; isActive: boolean }[];
  /** Ids of the active categories, in order: the choices of the category question. */
  activeCategoryIds: readonly string[];
};

/**
 * Moves focus after a change has rendered: a moved or new element loses or
 * lacks focus, and menus return focus to their trigger when they close.
 * Falls back when the target is missing or disabled; `select` selects an
 * input's text.
 */
export function refocus(selector: string, fallback?: string, options: { select?: boolean } = {}) {
  requestAnimationFrame(() =>
    setTimeout(() => {
      const found = document.querySelector<HTMLElement>(selector);
      const target =
        found && !found.hasAttribute("disabled")
          ? found
          : fallback
            ? document.querySelector<HTMLElement>(fallback)
            : null;
      target?.focus();
      if (options.select && target instanceof HTMLInputElement) target.select();
    }, 0),
  );
}
