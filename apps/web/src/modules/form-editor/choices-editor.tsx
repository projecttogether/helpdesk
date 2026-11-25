import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Question } from "@helpdesk/shared/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import {
  addOption,
  deleteOption,
  findReferences,
  messagesAt,
  moveOption,
  renameOption,
  updateQuestion,
  type Direction,
  type QuestionRef,
  type Scoped,
} from "./editor-state";
import { messages } from "./messages";
import { FieldProblems, ReferenceList, refocus, type EditorContext } from "./parts";

const MAX_OPTIONS = 50;

/** The choices of a single or multiple choice question: add, rename, reorder, delete. */
export function ChoicesEditor(props: {
  ctx: EditorContext;
  questionRef: QuestionRef;
  question: Question;
  problems: readonly Scoped[] | undefined;
}) {
  const t = useT(messages);
  const tc = useT(common);
  const { ctx, question, questionRef } = props;
  const general = (props.problems ?? []).filter(
    (problem) => problem.rest[0] === "options" && typeof problem.rest[1] !== "number",
  );
  const inputSelector = (optionId: string) =>
    `[data-question="${question.id}"] [data-option="${optionId}"] input`;

  const setOptions = (next: Question) =>
    ctx.onChange(updateQuestion(ctx.definition, questionRef, { options: next.options }));

  const add = () => {
    const { question: next, optionId } = addOption(
      question,
      t("choiceN", { n: question.options.length + 1 }),
    );
    setOptions(next);
    refocus(inputSelector(optionId), undefined, { select: true });
  };

  const move = (index: number, direction: Direction) => {
    const option = question.options[index];
    if (!option) return;
    setOptions(moveOption(question, index, direction));
    refocus(
      `[data-question="${question.id}"] [data-option="${option.id}"] [data-action="move-${direction}"]`,
      inputSelector(option.id),
    );
  };

  const remove = (index: number) => {
    const option = question.options[index];
    if (!option) return;
    const references = findReferences(ctx.definition, [question.id], { optionId: option.id });
    const apply = () => {
      ctx.onChange(deleteOption(ctx.definition, questionRef, index));
      const neighbour = question.options[index + 1] ?? question.options[index - 1];
      refocus(
        neighbour
          ? inputSelector(neighbour.id)
          : `[data-question="${question.id}"] [data-action="add-choice"]`,
      );
    };
    if (references.length === 0) return apply();
    ctx.askConfirm({
      title: t("deleteChoiceTitle"),
      description: t("deleteChoiceText", { label: option.label || t("choiceN", { n: index + 1 }) }),
      details: <ReferenceList references={references} intro={t("referencesIntro")} />,
      confirmLabel: tc("delete"),
      onConfirm: apply,
    });
  };

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t("choices")}</legend>
      <ol className="space-y-2">
        {question.options.map((option, index) => {
          const n = index + 1;
          const problems = messagesAt(props.problems, "options", index);
          return (
            <li key={option.id} data-option={option.id} className="space-y-1">
              <div className="flex items-center gap-1">
                <span
                  className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums"
                  aria-hidden
                >
                  {n}.
                </span>
                <Input
                  className="ml-1 h-8"
                  value={option.label}
                  maxLength={200}
                  aria-label={t("choiceLabel", { n })}
                  aria-invalid={problems.length > 0}
                  onChange={(event) => setOptions(renameOption(question, index, event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const next = question.options[index + 1];
                    if (next) refocus(inputSelector(next.id));
                    else if (question.options.length < MAX_OPTIONS) add();
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-action="move--1"
                  aria-label={t("moveChoiceUp", { n })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-action="move-1"
                  aria-label={t("moveChoiceDown", { n })}
                  disabled={index === question.options.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("deleteChoice", { n })}
                  onClick={() => remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <FieldProblems messages={problems} className="pl-8" />
            </li>
          );
        })}
      </ol>
      <FieldProblems messages={general.map((problem) => problem.message)} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-action="add-choice"
        disabled={question.options.length >= MAX_OPTIONS}
        onClick={add}
      >
        <Plus aria-hidden />
        {t("addChoice")}
      </Button>
    </fieldset>
  );
}
