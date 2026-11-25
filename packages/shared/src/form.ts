import { z } from "zod";
import { MAX_ATTACHMENTS_PER_MESSAGE, URGENCIES } from "./tickets";

/*
 * The request form: pages of questions, each page and question optionally
 * shown only when earlier answers match ("show if"). Requesters see one page
 * at a time and skip hidden pages. The browser and the server use the same
 * rules here, so a hidden question is never required and its answer is
 * never stored.
 *
 * Three system questions are always on the first page and always required:
 * the title, the urgency and the category. They become ticket fields; their
 * options come from the app (urgencies) and the category list.
 *
 * The app is in English; each form has a language (English or German) that
 * its fixed texts follow for requesters: buttons, answer problems, urgencies.
 * Admins write the questions in that language.
 */

export const FORM_LANGUAGES = ["en", "de"] as const;
export const formLanguageSchema = z.enum(FORM_LANGUAGES);
export type FormLanguage = z.infer<typeof formLanguageSchema>;

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multiple_choice",
  "date",
  "number",
  "email",
  "checkbox",
  "file",
] as const;
export const questionTypeSchema = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const SYSTEM_QUESTIONS = ["title", "urgency", "category"] as const;
export type SystemQuestion = (typeof SYSTEM_QUESTIONS)[number];
const SYSTEM_TYPES: Record<SystemQuestion, QuestionType> = {
  title: "short_text",
  urgency: "single_choice",
  category: "single_choice",
};

export const OPERATORS = [
  "equals",
  "not_equals",
  "includes",
  "not_includes",
  "answered",
  "not_answered",
] as const;
export type Operator = (typeof OPERATORS)[number];

/** Which operators fit a question type. `answered` means checked for a checkbox. */
export function operatorsFor(type: QuestionType): Operator[] {
  switch (type) {
    case "single_choice":
      return ["equals", "not_equals", "answered", "not_answered"];
    case "multiple_choice":
      return ["includes", "not_includes", "answered", "not_answered"];
    case "checkbox":
    case "file":
      return ["answered", "not_answered"];
    default:
      return ["equals", "not_equals", "answered", "not_answered"];
  }
}

export const operatorNeedsValue = (operator: Operator) => !["answered", "not_answered"].includes(operator);

/** Stable ids of pages, questions and options: lowercase letters, digits, - and _. */
export const formKeySchema = z
  .string()
  .regex(/^[a-z0-9_-]{1,40}$/, "Use 1 to 40 lowercase letters, digits, - or _");

export const ruleSchema = z.object({
  questionId: formKeySchema,
  operator: z.enum(OPERATORS),
  value: z.string().trim().max(200).optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const conditionSchema = z.object({
  match: z.enum(["all", "any"]),
  rules: z.array(ruleSchema).min(1).max(10),
});
export type Condition = z.infer<typeof conditionSchema>;

export const optionSchema = z.object({
  id: formKeySchema,
  label: z.string().trim().min(1, "Enter a label").max(200),
});
export type Option = z.infer<typeof optionSchema>;

export const questionSchema = z.object({
  id: formKeySchema,
  type: questionTypeSchema,
  system: z.enum(SYSTEM_QUESTIONS).optional(),
  label: z.string().trim().min(1, "Enter a question").max(300),
  help: z.string().trim().max(1000).default(""),
  required: z.boolean().default(false),
  /** Choices of single_choice and multiple_choice questions (not of system questions). */
  options: z.array(optionSchema).max(50).default([]),
  /** Text questions: the longest answer. */
  maxLength: z.number().int().min(1).max(10_000).optional(),
  showIf: conditionSchema.nullable().default(null),
});
export type Question = z.infer<typeof questionSchema>;

export const pageSchema = z.object({
  id: formKeySchema,
  title: z.string().trim().max(200).default(""),
  description: z.string().trim().max(2000).default(""),
  showIf: conditionSchema.nullable().default(null),
  questions: z.array(questionSchema).max(50),
});
export type Page = z.infer<typeof pageSchema>;

const formDefinitionBaseSchema = z.object({
  language: formLanguageSchema.default("en"),
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: z.string().trim().max(2000).default(""),
  pages: z.array(pageSchema).min(1).max(30),
});

export const formDefinitionSchema = formDefinitionBaseSchema.superRefine((definition, ctx) => {
  for (const problem of definitionProblems(definition)) {
    ctx.addIssue({ code: "custom", path: problem.path, message: problem.message });
  }
});
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

export const DEFAULT_TEXT_MAX = 200;
export const DEFAULT_LONG_TEXT_MAX = 5000;
export const TITLE_MAX = 120;

export function maxLengthOf(question: Question): number {
  if (question.system === "title") return Math.min(question.maxLength ?? TITLE_MAX, TITLE_MAX);
  return question.maxLength ?? (question.type === "long_text" ? DEFAULT_LONG_TEXT_MAX : DEFAULT_TEXT_MAX);
}

type Problem = { path: (string | number)[]; message: string };

/** Everything wrong with a definition beyond its shape; empty when it can be published. */
export function definitionProblems(definition: z.infer<typeof formDefinitionBaseSchema>): Problem[] {
  const problems: Problem[] = [];
  const pageIds = new Set<string>();
  /** Questions defined so far, in order: rules may only refer to these. */
  const earlier = new Map<string, Question>();
  const seenSystem = new Set<SystemQuestion>();

  definition.pages.forEach((page, pageIndex) => {
    const pagePath = ["pages", pageIndex];
    if (pageIds.has(page.id)) problems.push({ path: [...pagePath, "id"], message: "Two pages have this id" });
    pageIds.add(page.id);
    if (pageIndex === 0 && page.showIf) {
      problems.push({ path: [...pagePath, "showIf"], message: "The first page is always shown" });
    }
    if (page.showIf) {
      problems.push(...conditionProblems(page.showIf, earlier, [...pagePath, "showIf"]));
    }
    page.questions.forEach((question, questionIndex) => {
      const path = [...pagePath, "questions", questionIndex];
      if (earlier.has(question.id))
        problems.push({ path: [...path, "id"], message: "Two questions have this id" });
      if (question.system) {
        if (seenSystem.has(question.system)) {
          problems.push({ path, message: `The ${question.system} question appears twice` });
        }
        seenSystem.add(question.system);
        if (pageIndex !== 0) {
          problems.push({ path, message: `The ${question.system} question must be on the first page` });
        }
        if (question.type !== SYSTEM_TYPES[question.system]) {
          problems.push({
            path: [...path, "type"],
            message: `The ${question.system} question has a fixed type`,
          });
        }
        if (!question.required) {
          problems.push({
            path: [...path, "required"],
            message: `The ${question.system} question is required`,
          });
        }
        if (question.showIf) {
          problems.push({
            path: [...path, "showIf"],
            message: `The ${question.system} question is always shown`,
          });
        }
      } else if (question.type === "single_choice" || question.type === "multiple_choice") {
        if (question.options.length === 0) {
          problems.push({ path: [...path, "options"], message: "Add at least one choice" });
        }
        const optionIds = new Set<string>();
        question.options.forEach((option, optionIndex) => {
          if (optionIds.has(option.id)) {
            problems.push({
              path: [...path, "options", optionIndex, "id"],
              message: "Two choices have this id",
            });
          }
          optionIds.add(option.id);
        });
      }
      if (question.showIf) {
        problems.push(...conditionProblems(question.showIf, earlier, [...path, "showIf"]));
      }
      earlier.set(question.id, question);
    });
  });

  for (const system of SYSTEM_QUESTIONS) {
    if (!seenSystem.has(system))
      problems.push({ path: ["pages"], message: `The ${system} question is missing` });
  }
  return problems;
}

function conditionProblems(
  condition: Condition,
  earlier: Map<string, Question>,
  path: (string | number)[],
): Problem[] {
  const problems: Problem[] = [];
  condition.rules.forEach((rule, index) => {
    const rulePath = [...path, "rules", index];
    const question = earlier.get(rule.questionId);
    if (!question) {
      problems.push({ path: [...rulePath, "questionId"], message: "Choose a question that comes earlier" });
      return;
    }
    if (!operatorsFor(question.type).includes(rule.operator)) {
      problems.push({
        path: [...rulePath, "operator"],
        message: "This comparison does not fit the question",
      });
      return;
    }
    if (operatorNeedsValue(rule.operator) && !rule.value) {
      problems.push({ path: [...rulePath, "value"], message: "Choose a value" });
      return;
    }
    if (
      operatorNeedsValue(rule.operator) &&
      (question.type === "single_choice" || question.type === "multiple_choice") &&
      !question.system &&
      !question.options.some((option) => option.id === rule.value)
    ) {
      problems.push({ path: [...rulePath, "value"], message: "Choose one of the question's choices" });
    }
    if (
      operatorNeedsValue(rule.operator) &&
      question.system === "urgency" &&
      !(URGENCIES as readonly string[]).includes(rule.value ?? "")
    ) {
      problems.push({ path: [...rulePath, "value"], message: "Choose an urgency" });
    }
  });
  return problems;
}

/* Answers ---------------------------------------------------------------- */

export type AnswerValue = string | string[] | boolean | number | null;
export type Answers = Record<string, AnswerValue>;
export const answersSchema = z.record(
  formKeySchema,
  z.union([z.string().max(10_000), z.array(z.string().max(200)).max(50), z.boolean(), z.number(), z.null()]),
);

export function isAnswered(question: Question, value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (question.type === "checkbox") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/** Text for comparing: case and spacing do not matter, as the cleaned answer collapses spaces. */
const comparable = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

function sameText(a: AnswerValue | undefined, b: string | undefined): boolean {
  if (typeof a === "number") return b !== undefined && b.trim() !== "" && Number(b) === a;
  if (typeof a !== "string") return false;
  return comparable(a) === comparable(b ?? "");
}

function ruleMatches(rule: Rule, question: Question | undefined, answers: Answers): boolean {
  // A question that is not shown counts as unanswered.
  const value = question ? answers[question.id] : undefined;
  const answered = question ? isAnswered(question, value) : false;
  switch (rule.operator) {
    case "answered":
      return answered;
    case "not_answered":
      return !answered;
    case "equals":
      return answered && sameText(value, rule.value);
    case "not_equals":
      return !answered || !sameText(value, rule.value);
    case "includes":
      return answered && Array.isArray(value) && value.includes(rule.value ?? "");
    case "not_includes":
      return !answered || !Array.isArray(value) || !value.includes(rule.value ?? "");
  }
}

export function conditionMatches(
  condition: Condition | null,
  visible: Map<string, Question>,
  answers: Answers,
): boolean {
  if (!condition) return true;
  const results = condition.rules.map((rule) => ruleMatches(rule, visible.get(rule.questionId), answers));
  return condition.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

export type VisiblePage = { page: Page; questions: Question[] };

/**
 * The pages and questions shown for these answers, in order. Conditions only
 * look back, so one pass decides everything.
 */
export function visibleForm(definition: FormDefinition, answers: Answers): VisiblePage[] {
  const visible = new Map<string, Question>();
  const pages: VisiblePage[] = [];
  for (const page of definition.pages) {
    if (!conditionMatches(page.showIf, visible, answers)) continue;
    const questions: Question[] = [];
    for (const question of page.questions) {
      if (!conditionMatches(question.showIf, visible, answers)) continue;
      questions.push(question);
      visible.set(question.id, question);
    }
    pages.push({ page, questions });
  }
  return pages;
}

export type AnswerIssue = "required" | "invalid" | "too_long" | "unknown_option" | "too_many";

export type AnswerContext = {
  /** Ids of the categories a requester may choose. */
  categoryIds: readonly string[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function choiceIds(question: Question, context: AnswerContext): readonly string[] {
  if (question.system === "urgency") return URGENCIES;
  if (question.system === "category") return context.categoryIds;
  return question.options.map((option) => option.id);
}

/** Checks one answer; returns the cleaned value, or an issue. */
export function checkAnswer(
  question: Question,
  value: AnswerValue | undefined,
  context: AnswerContext,
): { value: AnswerValue } | { issue: AnswerIssue } {
  if (!isAnswered(question, value)) {
    return question.required ? { issue: "required" } : { value: null };
  }
  switch (question.type) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") return { issue: "invalid" };
      const text = question.type === "short_text" ? value.trim().replace(/\s+/g, " ") : value.trim();
      return text.length > maxLengthOf(question) ? { issue: "too_long" } : { value: text };
    }
    case "email": {
      if (typeof value !== "string") return { issue: "invalid" };
      const text = value.trim();
      return z.email().max(320).safeParse(text).success ? { value: text } : { issue: "invalid" };
    }
    case "date":
      return typeof value === "string" && validDate(value) ? { value } : { issue: "invalid" };
    case "number": {
      const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      return Number.isFinite(number) && Math.abs(number) < 1e12 ? { value: number } : { issue: "invalid" };
    }
    case "checkbox":
      return value === true ? { value: true } : { issue: "invalid" };
    case "single_choice":
      if (typeof value !== "string") return { issue: "invalid" };
      return choiceIds(question, context).includes(value) ? { value } : { issue: "unknown_option" };
    case "multiple_choice": {
      if (!Array.isArray(value)) return { issue: "invalid" };
      const ids = choiceIds(question, context);
      const unique = [...new Set(value)];
      return unique.every((id) => ids.includes(id)) ? { value: unique } : { issue: "unknown_option" };
    }
    case "file": {
      if (!Array.isArray(value)) return { issue: "invalid" };
      const unique = [...new Set(value)];
      if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE) return { issue: "too_many" };
      return unique.every((id) => UUID.test(id))
        ? { value: unique.map((id) => id.toLowerCase()) }
        : { issue: "invalid" };
    }
  }
}

/**
 * Validates a submission: only shown questions count, and answers to hidden
 * or unknown questions are dropped. Returns the cleaned answers of the shown
 * questions and the issues by question id.
 */
export function validateAnswers(
  definition: FormDefinition,
  answers: Answers,
  context: AnswerContext,
  /** Only these pages (by id); the browser checks one page at a time. */
  onlyPages?: ReadonlySet<string>,
): { values: Answers; issues: Record<string, AnswerIssue>; visible: VisiblePage[] } {
  const visible = visibleForm(definition, answers);
  const values: Answers = {};
  const issues: Record<string, AnswerIssue> = {};
  for (const { page, questions } of visible) {
    if (onlyPages && !onlyPages.has(page.id)) continue;
    for (const question of questions) {
      const result = checkAnswer(question, answers[question.id], context);
      if ("issue" in result) issues[question.id] = result.issue;
      else if (result.value !== null) values[question.id] = result.value;
    }
  }
  return { values, issues, visible };
}

export const systemQuestion = (definition: FormDefinition, system: SystemQuestion): Question | undefined =>
  definition.pages[0]?.questions.find((question) => question.system === system);

/** A short random id for new pages, questions and choices. */
export function newFormKey(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${prefix}_${random}`;
}

/** The form a new installation starts with. */
export const DEFAULT_FORM: FormDefinition = {
  language: "en",
  title: "New request",
  description: "Tell us what you need. We will get back to you.",
  pages: [
    {
      id: "start",
      title: "Your request",
      description: "",
      showIf: null,
      questions: [
        {
          id: "title",
          system: "title",
          type: "short_text",
          label: "What is your request about?",
          help: 'A short title, e.g. "New laptop for a new colleague".',
          required: true,
          options: [],
          maxLength: TITLE_MAX,
          showIf: null,
        },
        {
          id: "category",
          system: "category",
          type: "single_choice",
          label: "Category",
          help: "",
          required: true,
          options: [],
          showIf: null,
        },
        {
          id: "urgency",
          system: "urgency",
          type: "single_choice",
          label: "How urgent is it?",
          help: "",
          required: true,
          options: [],
          showIf: null,
        },
      ],
    },
    {
      id: "details",
      title: "Details",
      description: "",
      showIf: null,
      questions: [
        {
          id: "description",
          type: "long_text",
          label: "Describe your request",
          help: "",
          required: true,
          options: [],
          showIf: null,
        },
        {
          id: "files",
          type: "file",
          label: "Attachments",
          help: "Optional: documents or screenshots.",
          required: false,
          options: [],
          showIf: null,
        },
      ],
    },
  ],
};
