import type { Attachment } from "@helpdesk/shared/api/tickets";
import { maxLengthOf, type AnswerValue, type Question } from "@helpdesk/shared/form";
import { URGENCIES } from "@helpdesk/shared/tickets";
import { AttachmentPicker } from "@/components/attachments";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { formMessages } from "./messages";

export type Choice = { id: string; label: string };

/** The choices of a question: its own, the urgencies (in the form's language), or the categories. */
export function useChoices(categories: Choice[]) {
  const t = useT(formMessages);
  return (question: Question): Choice[] => {
    if (question.system === "urgency") return URGENCIES.map((id) => ({ id, label: t(id) }));
    if (question.system === "category") return categories;
    return question.options;
  };
}

/** One question of the request form, by its type. */
export function QuestionField(props: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  choices: Choice[];
  files: Attachment[];
  onFiles: (files: Attachment[]) => void;
  onBusyChange: (busy: boolean) => void;
  error?: string;
}) {
  const t = useT(formMessages);
  const { question, value, error } = props;
  const id = `q-${question.id}`;
  const invalid = Boolean(error);
  const describedBy = [question.help ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  const label = (
    <>
      {question.label}
      {question.required ? null : (
        <span className="text-muted-foreground font-normal"> ({t("optional")})</span>
      )}
    </>
  );
  const help = question.help ? <FieldDescription id={`${id}-help`}>{question.help}</FieldDescription> : null;
  const errorText = error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null;

  if (question.type === "single_choice" || question.type === "multiple_choice") {
    const choices = props.choices;
    if (question.type === "single_choice" && choices.length > 6) {
      return (
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {help}
          <Select
            value={typeof value === "string" ? value : ""}
            onValueChange={(next) => props.onChange(next)}
          >
            <SelectTrigger
              id={id}
              aria-invalid={invalid}
              aria-describedby={describedBy || undefined}
              className="w-full sm:w-80"
            >
              <SelectValue placeholder={t("choose")} />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.id} value={choice.id}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errorText}
        </Field>
      );
    }
    return (
      <FieldSet data-invalid={invalid || undefined} aria-describedby={describedBy || undefined}>
        <FieldLegend variant="label">{label}</FieldLegend>
        {help}
        {question.type === "single_choice" ? (
          <RadioGroup
            value={typeof value === "string" ? value : ""}
            onValueChange={(next) => props.onChange(next)}
            aria-invalid={invalid}
            className="gap-2"
          >
            {choices.map((choice) => (
              <div key={choice.id} className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-${choice.id}`} value={choice.id} />
                <Label htmlFor={`${id}-${choice.id}`} className="font-normal">
                  {choice.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        ) : (
          <div className="grid gap-2">
            {choices.map((choice) => {
              const selected = Array.isArray(value) ? value : [];
              return (
                <div key={choice.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-${choice.id}`}
                    checked={selected.includes(choice.id)}
                    onCheckedChange={(checked) =>
                      props.onChange(
                        checked ? [...selected, choice.id] : selected.filter((item) => item !== choice.id),
                      )
                    }
                  />
                  <Label htmlFor={`${id}-${choice.id}`} className="font-normal">
                    {choice.label}
                  </Label>
                </div>
              );
            })}
          </div>
        )}
        {errorText}
      </FieldSet>
    );
  }

  if (question.type === "checkbox") {
    return (
      <Field data-invalid={invalid || undefined}>
        <div className="flex items-start gap-2">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => props.onChange(checked === true)}
            aria-invalid={invalid}
            aria-describedby={describedBy || undefined}
            className="mt-0.5"
          />
          <div className="grid gap-1">
            <FieldLabel htmlFor={id} className="font-normal">
              {label}
            </FieldLabel>
            {help}
          </div>
        </div>
        {errorText}
      </Field>
    );
  }

  if (question.type === "file") {
    return (
      <Field data-invalid={invalid || undefined}>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {help}
        <AttachmentPicker
          id={id}
          value={props.files}
          onChange={(files) => {
            props.onFiles(files);
            props.onChange(files.map((file) => file.id));
          }}
          onBusyChange={props.onBusyChange}
        />
        {errorText}
      </Field>
    );
  }

  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const common_ = {
    id,
    value: text,
    "aria-invalid": invalid,
    "aria-describedby": describedBy || undefined,
  };
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {help}
      {question.type === "long_text" ? (
        <Textarea
          {...common_}
          rows={6}
          maxLength={maxLengthOf(question)}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : question.type === "date" ? (
        <Input
          {...common_}
          type="date"
          className="w-full sm:w-56"
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : question.type === "number" ? (
        <Input
          {...common_}
          type="number"
          inputMode="decimal"
          className="w-full sm:w-56"
          onChange={(event) => props.onChange(event.target.value === "" ? null : Number(event.target.value))}
        />
      ) : (
        <Input
          {...common_}
          type={question.type === "email" ? "email" : "text"}
          maxLength={question.type === "email" ? 320 : maxLengthOf(question)}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {errorText}
    </Field>
  );
}
