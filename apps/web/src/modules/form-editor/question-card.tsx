import { useId } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  Copy,
  CornerLeftUp,
  CornerRightDown,
  Ellipsis,
  GitBranch,
  Lock,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_LONG_TEXT_MAX,
  DEFAULT_TEXT_MAX,
  QUESTION_TYPES,
  type Question,
  type QuestionType,
} from "@helpdesk/shared/form";
import { URGENCIES } from "@helpdesk/shared/tickets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { common } from "@/i18n/common";
import { useUrgencyLabel } from "@/lib/labels";
import { cn } from "@/components/ui/utils";
import { ChoicesEditor } from "./choices-editor";
import { ConditionEditor } from "./condition-editor";
import {
  canMoveQuestion,
  canMoveQuestionToPage,
  changeQuestionType,
  deleteQuestion,
  duplicateQuestion,
  earlierQuestions,
  findReferences,
  isChoiceType,
  isTextType,
  messagesAt,
  messagesExcept,
  moveQuestion,
  moveQuestionToPage,
  updateQuestion,
  type Direction,
  type QuestionRef,
  type Scoped,
} from "./editor-state";
import { messages } from "./messages";
import { FieldProblems, ReferenceList, refocus, TYPE_ICONS, type EditorContext } from "./parts";

const isQuestionType = (value: string): value is QuestionType =>
  (QUESTION_TYPES as readonly string[]).includes(value);

/** Selectors of a question's controls, to move focus after changes. */
export const questionSelector = (id: string, action?: string) =>
  action ? `[data-question="${id}"] [data-action="${action}"]` : `[data-question="${id}"]`;

/** One question: a compact row that opens to edit it. */
export function QuestionCard(props: {
  ctx: EditorContext;
  questionRef: QuestionRef;
  question: Question;
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens a question (after duplicating). */
  onOpenQuestion: (id: string) => void;
  problems: readonly Scoped[] | undefined;
}) {
  const t = useT(messages);
  const tc = useT(common);
  const id = useId();
  const { ctx, question, questionRef } = props;
  const definition = ctx.definition;
  const system = question.system;
  const Icon = TYPE_ICONS[question.type];
  const label = question.label.trim() || t("untitled");
  const problemCount = props.problems?.length ?? 0;
  const contentId = `${id}-content`;

  const move = (direction: Direction) => {
    ctx.onChange(moveQuestion(definition, questionRef, direction));
    refocus(questionSelector(question.id, `move-${direction}`), questionSelector(question.id, "toggle"));
  };

  const moveToPage = (direction: Direction) => {
    ctx.onChange(moveQuestionToPage(definition, questionRef, direction).definition);
    refocus(questionSelector(question.id, "menu"));
  };

  const duplicate = () => {
    const result = duplicateQuestion(definition, questionRef, (text) => t("copyLabel", { label: text }));
    if (!result.questionId) return;
    ctx.onChange(result.definition);
    props.onOpenQuestion(result.questionId);
    refocus(`#label-${result.questionId}`, undefined, { select: true });
  };

  const remove = () => {
    const references = findReferences(definition, [question.id]);
    const apply = () => {
      ctx.onChange(deleteQuestion(ctx.definition, questionRef));
      refocus(`[data-page="${props.pageId}"] [data-action="add-question"]`);
    };
    if (references.length === 0) return apply();
    ctx.askConfirm({
      title: t("deleteQuestionTitle"),
      description: t("deleteQuestionText", { label }),
      details: <ReferenceList references={references} intro={t("referencesIntro")} />,
      confirmLabel: tc("delete"),
      onConfirm: apply,
    });
  };

  return (
    <Collapsible open={props.open} onOpenChange={props.onOpenChange} asChild>
      <li
        data-question={question.id}
        id={`question-${question.id}`}
        className={cn(
          "bg-card scroll-mt-24 rounded-lg border transition-shadow",
          props.open && "shadow-sm",
          problemCount > 0 && "border-destructive/60",
        )}
      >
        <div className="flex items-center gap-1 py-1.5 pr-1.5 pl-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-action="toggle"
              aria-controls={contentId}
              className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-3 rounded-md py-1 text-left outline-none focus-visible:ring-[3px]"
            >
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-sm font-medium",
                    !question.label.trim() && "text-muted-foreground italic",
                  )}
                >
                  {label}
                </span>
                <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span>{t(`type_${question.type}`)}</span>
                  {system ? (
                    <Badge variant="secondary">
                      <Lock aria-hidden />
                      {t("alwaysAsked")}
                    </Badge>
                  ) : question.required ? (
                    <Badge variant="outline">{t("required")}</Badge>
                  ) : null}
                  {question.showIf ? (
                    <Badge variant="outline">
                      <GitBranch aria-hidden />
                      {t("conditional")}
                    </Badge>
                  ) : null}
                  {problemCount > 0 ? (
                    <Badge variant="destructive">
                      <CircleAlert aria-hidden />
                      {t("problems", { count: problemCount })}
                    </Badge>
                  ) : null}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  props.open && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </CollapsibleTrigger>
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden sm:inline-flex"
              data-action="move--1"
              aria-label={t("moveUp")}
              disabled={!canMoveQuestion(definition, questionRef, -1)}
              onClick={() => move(-1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden sm:inline-flex"
              data-action="move-1"
              aria-label={t("moveDown")}
              disabled={!canMoveQuestion(definition, questionRef, 1)}
              onClick={() => move(1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-action="menu"
                  aria-label={t("questionActions", { label })}
                >
                  <Ellipsis aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!canMoveQuestion(definition, questionRef, -1)}
                  onSelect={() => move(-1)}
                >
                  <ArrowUp aria-hidden />
                  {t("moveUp")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canMoveQuestion(definition, questionRef, 1)}
                  onSelect={() => move(1)}
                >
                  <ArrowDown aria-hidden />
                  {t("moveDown")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canMoveQuestionToPage(definition, questionRef, -1)}
                  onSelect={() => moveToPage(-1)}
                >
                  <CornerLeftUp aria-hidden />
                  {t("moveToPreviousPage")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canMoveQuestionToPage(definition, questionRef, 1)}
                  onSelect={() => moveToPage(1)}
                >
                  <CornerRightDown aria-hidden />
                  {t("moveToNextPage")}
                </DropdownMenuItem>
                {system ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={duplicate}>
                      <Copy aria-hidden />
                      {t("duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={remove}>
                      <Trash2 aria-hidden />
                      {t("deleteQuestion")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <CollapsibleContent id={contentId}>
          {props.open ? <QuestionFields {...props} /> : null}
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

function QuestionFields(props: Parameters<typeof QuestionCard>[0]) {
  const t = useT(messages);
  const urgencyLabel = useUrgencyLabel();
  const { ctx, question, questionRef, problems } = props;
  const system = question.system;
  const update = (patch: Parameters<typeof updateQuestion>[2]) =>
    ctx.onChange(updateQuestion(ctx.definition, questionRef, patch));
  const labelId = `label-${question.id}`;
  const helpId = `help-${question.id}`;
  const typeId = `type-${question.id}`;
  const requiredId = `required-${question.id}`;
  const maxId = `max-${question.id}`;
  const labelProblems = messagesAt(problems, "label");
  const helpProblems = messagesAt(problems, "help");
  const maxProblems = messagesAt(problems, "maxLength");
  const other = messagesExcept(problems, ["label", "help", "maxLength", "options", "showIf"]);
  const activeCategories = ctx.categories.filter((category) => category.isActive);

  return (
    <div className="space-y-5 border-t px-4 pt-4 pb-5">
      {system ? <p className="text-muted-foreground text-sm">{t(`systemNote_${system}`)}</p> : null}
      <FieldProblems messages={other} />

      <Field data-invalid={labelProblems.length > 0 || undefined}>
        <FieldLabel htmlFor={labelId}>{t("label")}</FieldLabel>
        <Input
          id={labelId}
          value={question.label}
          maxLength={300}
          aria-invalid={labelProblems.length > 0}
          aria-describedby={labelProblems.length ? `${labelId}-problems` : undefined}
          onChange={(event) => update({ label: event.target.value })}
        />
        <FieldProblems id={`${labelId}-problems`} messages={labelProblems} />
      </Field>

      <Field data-invalid={helpProblems.length > 0 || undefined}>
        <FieldLabel htmlFor={helpId}>{t("help")}</FieldLabel>
        <Textarea
          id={helpId}
          rows={2}
          value={question.help}
          maxLength={1000}
          aria-invalid={helpProblems.length > 0}
          aria-describedby={`${helpId}-hint`}
          onChange={(event) => update({ help: event.target.value })}
        />
        <FieldDescription id={`${helpId}-hint`}>{t("helpHint")}</FieldDescription>
        <FieldProblems messages={helpProblems} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={typeId}>{t("type")}</FieldLabel>
          <Select
            value={question.type}
            disabled={!!system}
            onValueChange={(type) => {
              if (isQuestionType(type)) {
                ctx.onChange(changeQuestionType(ctx.definition, questionRef, type, t("choiceN", { n: 1 })));
              }
            }}
          >
            <SelectTrigger
              id={typeId}
              className="w-full"
              aria-describedby={system ? `${typeId}-hint` : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPES.map((type) => {
                const TypeIcon = TYPE_ICONS[type];
                return (
                  <SelectItem key={type} value={type}>
                    <TypeIcon aria-hidden />
                    {t(`type_${type}`)}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {system ? <FieldDescription id={`${typeId}-hint`}>{t("typeFixed")}</FieldDescription> : null}
        </Field>

        <Field orientation="horizontal" className="items-start sm:pt-6">
          <Switch
            id={requiredId}
            checked={system ? true : question.required}
            disabled={!!system}
            aria-describedby={`${requiredId}-hint`}
            onCheckedChange={(required) => update({ required })}
          />
          <div className="grid gap-1">
            <FieldLabel htmlFor={requiredId}>{t("required")}</FieldLabel>
            <FieldDescription id={`${requiredId}-hint`}>
              {system
                ? t("requiredSystemHint")
                : question.type === "checkbox"
                  ? t("requiredCheckboxHint")
                  : t("requiredHint")}
            </FieldDescription>
          </div>
        </Field>
      </div>

      {isTextType(question.type) && !system ? (
        <Field data-invalid={maxProblems.length > 0 || undefined} className="sm:max-w-56">
          <FieldLabel htmlFor={maxId}>{t("maxLength")}</FieldLabel>
          <Input
            id={maxId}
            type="number"
            inputMode="numeric"
            min={1}
            max={10_000}
            value={question.maxLength ?? ""}
            placeholder={String(question.type === "long_text" ? DEFAULT_LONG_TEXT_MAX : DEFAULT_TEXT_MAX)}
            aria-invalid={maxProblems.length > 0}
            aria-describedby={`${maxId}-hint`}
            onChange={(event) =>
              update({ maxLength: event.target.value === "" ? undefined : Number(event.target.value) })
            }
          />
          <FieldDescription id={`${maxId}-hint`}>
            {t("maxLengthHint", {
              count: question.type === "long_text" ? DEFAULT_LONG_TEXT_MAX : DEFAULT_TEXT_MAX,
            })}
          </FieldDescription>
          <FieldProblems messages={maxProblems} />
        </Field>
      ) : null}

      {isChoiceType(question.type) && !system ? (
        <ChoicesEditor ctx={ctx} questionRef={questionRef} question={question} problems={problems} />
      ) : null}

      {system === "urgency" ? (
        <p className="text-muted-foreground text-sm">
          {t("urgencyChoices", { list: URGENCIES.map(urgencyLabel).join(", ") })}
        </p>
      ) : null}
      {system === "category" ? (
        <p className="text-muted-foreground text-sm">
          {activeCategories.length
            ? t("categoryChoices", { list: activeCategories.map((category) => category.name).join(", ") })
            : t("noCategories")}
        </p>
      ) : null}

      {system ? null : (
        <ConditionEditor
          ctx={ctx}
          condition={question.showIf}
          onChange={(showIf) => update({ showIf })}
          available={earlierQuestions(ctx.definition, questionRef)}
          legend={t("showQuestion")}
          emptyHint={t("noEarlierQuestion")}
          problems={problems}
        />
      )}
    </div>
  );
}
