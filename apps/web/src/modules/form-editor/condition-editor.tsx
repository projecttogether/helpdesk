import { useId } from "react";
import { Plus, X } from "lucide-react";
import {
  OPERATORS,
  operatorNeedsValue,
  operatorsFor,
  type Condition,
  type Operator,
  type Question,
  type Rule,
} from "@helpdesk/shared/form";
import { URGENCIES, type Urgency } from "@helpdesk/shared/tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/i18n";
import { useUrgencyLabel } from "@/lib/labels";
import {
  addRule,
  MAX_RULES,
  messagesAt,
  newRule,
  removeRule,
  setRuleOperator,
  setRuleQuestion,
  startCondition,
  updateRule,
  type Located,
  type Scoped,
} from "./editor-state";
import { messages } from "./messages";
import { FieldProblems, useOperatorLabel, type EditorContext } from "./parts";

const isOperator = (value: string): value is Operator => (OPERATORS as readonly string[]).includes(value);

/**
 * "Always show" or "Show only if…" with rules about earlier questions. Used
 * for pages and questions; `problems` are the owner's, with paths from
 * `showIf` on.
 */
export function ConditionEditor(props: {
  ctx: EditorContext;
  condition: Condition | null;
  onChange: (condition: Condition | null) => void;
  /** The questions the rules may use (those that come earlier). */
  available: readonly Located[];
  legend: string;
  emptyHint: string;
  problems: readonly Scoped[] | undefined;
}) {
  const t = useT(messages);
  const id = useId();
  const { condition, available } = props;
  const general = (props.problems ?? []).filter(
    (problem) => problem.rest[0] === "showIf" && typeof problem.rest[2] !== "number",
  );

  const setMode = (mode: string) => {
    if (mode === "always") props.onChange(null);
    else if (!condition) {
      const rule = newRule(available, props.ctx.activeCategoryIds);
      if (rule) props.onChange(startCondition(rule));
    }
  };

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-medium">{props.legend}</legend>
      <RadioGroup
        value={condition ? "if" : "always"}
        onValueChange={setMode}
        className="flex flex-wrap gap-x-6 gap-y-2"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="always" id={`${id}-always`} />
          <Label htmlFor={`${id}-always`} className="font-normal">
            {t("alwaysShow")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="if" id={`${id}-if`} disabled={!condition && available.length === 0} />
          <Label htmlFor={`${id}-if`} className="font-normal">
            {t("showOnlyIf")}
          </Label>
        </div>
      </RadioGroup>
      {!condition && available.length === 0 ? (
        <p className="text-muted-foreground text-sm">{props.emptyHint}</p>
      ) : null}

      {condition ? (
        <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
          {condition.rules.length > 1 ? (
            <Select
              value={condition.match}
              onValueChange={(match) =>
                props.onChange({ ...condition, match: match === "any" ? "any" : "all" })
              }
            >
              <SelectTrigger size="sm" aria-label={t("match")} className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("matchAll")}</SelectItem>
                <SelectItem value="any">{t("matchAny")}</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
          <ol className="space-y-3">
            {condition.rules.map((rule, index) => (
              <RuleRow
                // Rules have no ids; the index is their identity within the condition.
                key={index}
                ctx={props.ctx}
                rule={rule}
                index={index}
                available={available}
                problems={messagesAt(props.problems, "showIf", "rules", index)}
                onChange={(next) => props.onChange(updateRule(condition, index, next))}
                onRemove={() => props.onChange(removeRule(condition, index))}
              />
            ))}
          </ol>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={condition.rules.length >= MAX_RULES || available.length === 0}
            onClick={() => {
              const rule = newRule(available, props.ctx.activeCategoryIds);
              if (rule) props.onChange(addRule(condition, rule));
            }}
          >
            <Plus aria-hidden />
            {t("addRule")}
          </Button>
        </div>
      ) : null}
      <FieldProblems messages={general.map((problem) => problem.message)} />
    </fieldset>
  );
}

function RuleRow(props: {
  ctx: EditorContext;
  rule: Rule;
  index: number;
  available: readonly Located[];
  problems: string[];
  onChange: (rule: Rule) => void;
  onRemove: () => void;
}) {
  const t = useT(messages);
  const operatorLabel = useOperatorLabel();
  const { rule, available } = props;
  const n = props.index + 1;
  const question = available.find((entry) => entry.question.id === rule.questionId)?.question;
  const operators = question ? operatorsFor(question.type) : [rule.operator];
  const invalid = props.problems.length > 0;
  const pages = [...new Set(available.map((entry) => entry.pageIndex))];
  // Active categories first: a new value is an active one, a chosen inactive one is kept.
  const ruleCategoryIds = [
    ...props.ctx.activeCategoryIds,
    ...props.ctx.categories.filter((category) => !category.isActive).map((category) => category.id),
  ];

  return (
    <li className="space-y-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,4fr)_auto]">
        <Select
          value={question ? rule.questionId : ""}
          onValueChange={(questionId) => {
            const next = available.find((entry) => entry.question.id === questionId);
            if (next) props.onChange(setRuleQuestion(rule, next.question, props.ctx.activeCategoryIds));
          }}
        >
          <SelectTrigger
            className="bg-background w-full"
            aria-label={t("ruleQuestion", { n })}
            aria-invalid={invalid && !question}
          >
            <SelectValue placeholder={t("chooseQuestion")} />
          </SelectTrigger>
          <SelectContent>
            {pages.map((pageIndex) => (
              <SelectGroup key={pageIndex}>
                <SelectLabel>{t("pageGroup", { page: pageIndex + 1 })}</SelectLabel>
                {available
                  .filter((entry) => entry.pageIndex === pageIndex)
                  .map((entry) => (
                    <SelectItem key={entry.question.id} value={entry.question.id}>
                      <span className="truncate">{entry.question.label || t("untitled")}</span>
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="sm:order-last"
          aria-label={t("removeRule", { n })}
          onClick={props.onRemove}
        >
          <X aria-hidden />
        </Button>
        <Select
          value={rule.operator}
          disabled={!question}
          onValueChange={(operator) => {
            if (isOperator(operator))
              props.onChange(setRuleOperator(rule, operator, question, ruleCategoryIds));
          }}
        >
          <SelectTrigger
            className="bg-background col-span-2 w-full sm:col-span-1"
            aria-label={t("ruleOperator", { n })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operatorLabel(operator, question?.type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {question && operatorNeedsValue(rule.operator) ? (
          <RuleValue
            ctx={props.ctx}
            question={question}
            value={rule.value ?? ""}
            label={t("ruleValue", { n })}
            invalid={invalid}
            onChange={(value) => props.onChange({ ...rule, value })}
          />
        ) : (
          <span className="hidden sm:block" />
        )}
      </div>
      <FieldProblems messages={props.problems} />
    </li>
  );
}

const INPUT_TYPES: Partial<Record<Question["type"], string>> = {
  date: "date",
  number: "number",
  email: "email",
};

function RuleValue(props: {
  ctx: EditorContext;
  question: Question;
  value: string;
  label: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT(messages);
  const urgencyLabel = useUrgencyLabel();
  const { question } = props;

  let choices: { value: string; label: string }[] | null = null;
  if (question.system === "urgency") {
    choices = URGENCIES.map((urgency: Urgency) => ({ value: urgency, label: urgencyLabel(urgency) }));
  } else if (question.system === "category") {
    choices = props.ctx.categories.map((category) => ({
      value: category.id,
      label: category.isActive ? category.name : `${category.name} (${t("inactive")})`,
    }));
  } else if (question.type === "single_choice" || question.type === "multiple_choice") {
    choices = question.options.map((option, index) => ({
      value: option.id,
      label: option.label || t("choiceN", { n: index + 1 }),
    }));
  }

  if (choices) {
    const known = choices.some((choice) => choice.value === props.value);
    return (
      <Select value={known ? props.value : ""} onValueChange={props.onChange}>
        <SelectTrigger
          className="bg-background col-span-2 w-full sm:col-span-1"
          aria-label={props.label}
          aria-invalid={props.invalid}
        >
          <SelectValue placeholder={t("chooseValue")} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      type={INPUT_TYPES[question.type] ?? "text"}
      className="bg-background col-span-2 sm:col-span-1"
      aria-label={props.label}
      aria-invalid={props.invalid}
      placeholder={t("valuePlaceholder")}
      maxLength={200}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}
