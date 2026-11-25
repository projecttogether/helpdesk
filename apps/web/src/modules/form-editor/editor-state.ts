import type { z } from "zod";
import {
  definitionProblems,
  formDefinitionSchema,
  newFormKey,
  operatorNeedsValue,
  operatorsFor,
  SYSTEM_QUESTIONS,
  type Condition,
  type FormDefinition,
  type Operator,
  type Option,
  type Page,
  type Question,
  type QuestionType,
  type Rule,
  type SystemQuestion,
} from "@helpdesk/shared/form";
import { URGENCIES } from "@helpdesk/shared/tickets";

/*
 * The form editor's state changes as pure functions: each takes the
 * definition (or a part of it) and returns a new one. The page components
 * only call these, so the rules (system questions stay on page 1, rules only
 * look back, deleting removes the rules that use a question) live here.
 */

export type Path = (string | number)[];
export type Problem = { path: Path; message: string };
/** Where a question is: its page and its place on the page. */
export type QuestionRef = { pageIndex: number; questionIndex: number };
export type Direction = -1 | 1;

export const CHOICE_TYPES: readonly QuestionType[] = ["single_choice", "multiple_choice"];
export const TEXT_TYPES: readonly QuestionType[] = ["short_text", "long_text"];
export const isChoiceType = (type: QuestionType) => CHOICE_TYPES.includes(type);
export const isTextType = (type: QuestionType) => TEXT_TYPES.includes(type);

/* Loading, comparing, saving ---------------------------------------------- */

/** Fills the defaults the schema would add, so the editor can rely on them. */
export function normalizeDefinition(definition: FormDefinition): FormDefinition {
  return {
    language: definition.language ?? "en",
    title: definition.title ?? "",
    description: definition.description ?? "",
    pages: definition.pages.map((page) => ({
      id: page.id,
      title: page.title ?? "",
      description: page.description ?? "",
      showIf: page.showIf ?? null,
      questions: page.questions.map((question) => ({
        ...question,
        help: question.help ?? "",
        required: question.system ? true : (question.required ?? false),
        options: question.options ?? [],
        showIf: question.showIf ?? null,
      })),
    })),
  };
}

export function sameDefinition(a: FormDefinition, b: FormDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Drops what the question type does not use (choices of text questions, lengths of choice questions). */
export function prepareForSave(definition: FormDefinition): FormDefinition {
  return mapQuestions(definition, (question) => {
    const next: Question = { ...question };
    if (question.system || !isChoiceType(question.type)) next.options = [];
    if (!isTextType(question.type) || (question.system && question.system !== "title")) {
      delete next.maxLength;
    }
    return next;
  });
}

/* Finding questions -------------------------------------------------------- */

export type Located = QuestionRef & { question: Question };

export function allQuestions(definition: FormDefinition): Located[] {
  return definition.pages.flatMap((page, pageIndex) =>
    page.questions.map((question, questionIndex) => ({ pageIndex, questionIndex, question })),
  );
}

export function findQuestion(definition: FormDefinition, id: string): Located | undefined {
  return allQuestions(definition).find((entry) => entry.question.id === id);
}

/**
 * The questions a rule may refer to: for a page, those on earlier pages; for
 * a question, also the ones before it on its page.
 */
export function earlierQuestions(
  definition: FormDefinition,
  target: { pageIndex: number; questionIndex?: number },
): Located[] {
  return allQuestions(definition).filter(
    (entry) =>
      entry.pageIndex < target.pageIndex ||
      (target.questionIndex !== undefined &&
        entry.pageIndex === target.pageIndex &&
        entry.questionIndex < target.questionIndex),
  );
}

/** A page or a question whose show-if rules use a question (or one of its choices). */
export type Reference =
  | { kind: "page"; pageIndex: number; page: Page }
  | { kind: "question"; pageIndex: number; questionIndex: number; question: Question };

function ruleUses(rule: Rule, questionIds: ReadonlySet<string>, optionId?: string): boolean {
  if (!questionIds.has(rule.questionId)) return false;
  if (optionId === undefined) return true;
  return operatorNeedsValue(rule.operator) && rule.value === optionId;
}

function conditionUses(condition: Condition | null, questionIds: ReadonlySet<string>, optionId?: string) {
  return condition?.rules.some((rule) => ruleUses(rule, questionIds, optionId)) ?? false;
}

/**
 * Pages and questions whose rules use these questions, leaving out the
 * questions themselves and the pages in `skipPages` (being deleted too).
 */
export function findReferences(
  definition: FormDefinition,
  questionIds: readonly string[],
  options: { optionId?: string; skipPages?: readonly number[] } = {},
): Reference[] {
  const ids = new Set(questionIds);
  const references: Reference[] = [];
  definition.pages.forEach((page, pageIndex) => {
    if (options.skipPages?.includes(pageIndex)) return;
    if (conditionUses(page.showIf, ids, options.optionId)) references.push({ kind: "page", pageIndex, page });
    page.questions.forEach((question, questionIndex) => {
      if (ids.has(question.id)) return;
      if (conditionUses(question.showIf, ids, options.optionId)) {
        references.push({ kind: "question", pageIndex, questionIndex, question });
      }
    });
  });
  return references;
}

/** Removes the rules that use these questions (or one choice); a condition without rules becomes "always show". */
export function removeRulesFor(
  definition: FormDefinition,
  questionIds: readonly string[],
  optionId?: string,
): FormDefinition {
  const ids = new Set(questionIds);
  const clean = (condition: Condition | null): Condition | null => {
    if (!condition || !conditionUses(condition, ids, optionId)) return condition;
    const rules = condition.rules.filter((rule) => !ruleUses(rule, ids, optionId));
    return rules.length ? { ...condition, rules } : null;
  };
  return {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      showIf: clean(page.showIf),
      questions: page.questions.map((question) => ({ ...question, showIf: clean(question.showIf) })),
    })),
  };
}

/* Ids ---------------------------------------------------------------------- */

export function takenKeys(definition: FormDefinition): Set<string> {
  const keys = new Set<string>();
  for (const page of definition.pages) {
    keys.add(page.id);
    for (const question of page.questions) keys.add(question.id);
  }
  return keys;
}

/** A new id with this prefix that is not in `taken`. */
export function uniqueKey(prefix: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const key = newFormKey(prefix);
    if (!taken.has(key)) return key;
  }
}

/* The form and its pages --------------------------------------------------- */

function mapQuestions(definition: FormDefinition, map: (question: Question) => Question): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page) => ({ ...page, questions: page.questions.map(map) })),
  };
}

function swap<T>(items: readonly T[], index: number, target: number): T[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

export function updateForm(
  definition: FormDefinition,
  patch: Partial<Pick<FormDefinition, "language" | "title" | "description">>,
): FormDefinition {
  return { ...definition, ...patch };
}

export function updatePage(
  definition: FormDefinition,
  pageIndex: number,
  patch: Partial<Pick<Page, "title" | "description" | "showIf">>,
): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, index) =>
      index === pageIndex
        ? {
            ...page,
            ...patch,
            showIf: pageIndex === 0 ? null : patch.showIf !== undefined ? patch.showIf : page.showIf,
          }
        : page,
    ),
  };
}

export function addPage(
  definition: FormDefinition,
  title: string,
): { definition: FormDefinition; pageId: string } {
  const pageId = uniqueKey("p", takenKeys(definition));
  const page: Page = { id: pageId, title, description: "", showIf: null, questions: [] };
  return { definition: { ...definition, pages: [...definition.pages, page] }, pageId };
}

/** The first page holds the system questions and stays first. */
export function canMovePage(definition: FormDefinition, pageIndex: number, direction: Direction): boolean {
  const target = pageIndex + direction;
  return pageIndex >= 1 && target >= 1 && target < definition.pages.length;
}

export function movePage(
  definition: FormDefinition,
  pageIndex: number,
  direction: Direction,
): FormDefinition {
  if (!canMovePage(definition, pageIndex, direction)) return definition;
  return { ...definition, pages: swap(definition.pages, pageIndex, pageIndex + direction) };
}

export const canDeletePage = (pageIndex: number) => pageIndex >= 1;

/** Pages and questions elsewhere whose rules use a question of this page. */
export function pageReferences(definition: FormDefinition, pageIndex: number): Reference[] {
  const page = definition.pages[pageIndex];
  if (!page) return [];
  return findReferences(
    definition,
    page.questions.map((question) => question.id),
    { skipPages: [pageIndex] },
  );
}

/** Deletes a page (not the first) with its questions and the rules that use them. */
export function deletePage(definition: FormDefinition, pageIndex: number): FormDefinition {
  const page = definition.pages[pageIndex];
  if (!page || !canDeletePage(pageIndex)) return definition;
  const rest = { ...definition, pages: definition.pages.filter((_, index) => index !== pageIndex) };
  return removeRulesFor(
    rest,
    page.questions.map((question) => question.id),
  );
}

/* Questions ------------------------------------------------------------------ */

export function getQuestion(definition: FormDefinition, ref: QuestionRef): Question | undefined {
  return definition.pages[ref.pageIndex]?.questions[ref.questionIndex];
}

function replaceQuestions(
  definition: FormDefinition,
  pageIndex: number,
  update: (questions: Question[]) => Question[],
): FormDefinition {
  return {
    ...definition,
    pages: definition.pages.map((page, index) =>
      index === pageIndex ? { ...page, questions: update(page.questions) } : page,
    ),
  };
}

/** The fields an admin may change on a system question. */
const SYSTEM_EDITABLE = ["label", "help"] as const;

/** Changes a question; on system questions only the label and help text change. */
export function updateQuestion(
  definition: FormDefinition,
  ref: QuestionRef,
  patch: Partial<Omit<Question, "id" | "system" | "type">>,
): FormDefinition {
  return replaceQuestions(definition, ref.pageIndex, (questions) =>
    questions.map((question, index) => {
      if (index !== ref.questionIndex) return question;
      if (!question.system) return { ...question, ...patch };
      const allowed: Partial<Question> = {};
      for (const key of SYSTEM_EDITABLE) if (patch[key] !== undefined) allowed[key] = patch[key];
      return { ...question, ...allowed };
    }),
  );
}

const SWITCHED_OPERATOR: Partial<Record<Operator, Operator>> = {
  equals: "includes",
  not_equals: "not_includes",
  includes: "equals",
  not_includes: "not_equals",
};

/**
 * Changes the type of a (non-system) question. A choice question gets a
 * first choice when it has none; rules that use the question keep their
 * meaning between single and multiple choice ("is" ↔ "includes").
 */
export function changeQuestionType(
  definition: FormDefinition,
  ref: QuestionRef,
  type: QuestionType,
  firstChoiceLabel: string,
): FormDefinition {
  const question = getQuestion(definition, ref);
  if (!question || question.system || question.type === type) return definition;
  const options =
    isChoiceType(type) && question.options.length === 0
      ? [{ id: uniqueKey("o", new Set()), label: firstChoiceLabel }]
      : question.options;
  const changed: Question = { ...question, type, options };
  if (!isTextType(type)) delete changed.maxLength;
  const next = replaceQuestions(definition, ref.pageIndex, (questions) =>
    questions.map((item, index) => (index === ref.questionIndex ? changed : item)),
  );
  const fits = operatorsFor(type);
  const adapt = (condition: Condition | null): Condition | null =>
    condition && {
      ...condition,
      rules: condition.rules.map((rule) => {
        if (rule.questionId !== question.id || fits.includes(rule.operator)) return rule;
        const switched = SWITCHED_OPERATOR[rule.operator];
        return switched && fits.includes(switched) ? { ...rule, operator: switched } : rule;
      }),
    };
  return {
    ...next,
    pages: next.pages.map((page) => ({
      ...page,
      showIf: adapt(page.showIf),
      questions: page.questions.map((item) => ({ ...item, showIf: adapt(item.showIf) })),
    })),
  };
}

/** A new question of a type; choice questions start with the given choices. */
export function createQuestion(
  definition: FormDefinition,
  type: QuestionType,
  label: string,
  choiceLabels: readonly string[],
): Question {
  const taken = new Set<string>();
  return {
    id: uniqueKey("q", takenKeys(definition)),
    type,
    label,
    help: "",
    required: false,
    options: isChoiceType(type)
      ? choiceLabels.map((choice) => {
          const id = uniqueKey("o", taken);
          taken.add(id);
          return { id, label: choice };
        })
      : [],
    showIf: null,
  };
}

/** Adds a question at the end of a page. */
export function addQuestion(
  definition: FormDefinition,
  pageIndex: number,
  question: Question,
): FormDefinition {
  return replaceQuestions(definition, pageIndex, (questions) => [...questions, question]);
}

export function canMoveQuestion(definition: FormDefinition, ref: QuestionRef, direction: Direction): boolean {
  const page = definition.pages[ref.pageIndex];
  const target = ref.questionIndex + direction;
  return !!page && target >= 0 && target < page.questions.length;
}

/** Moves a question up or down on its page. */
export function moveQuestion(
  definition: FormDefinition,
  ref: QuestionRef,
  direction: Direction,
): FormDefinition {
  if (!canMoveQuestion(definition, ref, direction)) return definition;
  return replaceQuestions(definition, ref.pageIndex, (questions) =>
    swap(questions, ref.questionIndex, ref.questionIndex + direction),
  );
}

/** System questions stay on the first page. */
export function canMoveQuestionToPage(
  definition: FormDefinition,
  ref: QuestionRef,
  direction: Direction,
): boolean {
  const question = getQuestion(definition, ref);
  const target = ref.pageIndex + direction;
  return !!question && !question.system && target >= 0 && target < definition.pages.length;
}

/**
 * Moves a question to the previous page (at its end) or the next page (at
 * its start), so it keeps its place in the order of all questions.
 */
export function moveQuestionToPage(
  definition: FormDefinition,
  ref: QuestionRef,
  direction: Direction,
): { definition: FormDefinition; ref: QuestionRef } {
  const question = getQuestion(definition, ref);
  if (!question || !canMoveQuestionToPage(definition, ref, direction)) return { definition, ref };
  const targetIndex = ref.pageIndex + direction;
  const target = definition.pages[targetIndex]!;
  const questionIndex = direction === -1 ? target.questions.length : 0;
  const pages = definition.pages.map((page, index) => {
    if (index === ref.pageIndex) {
      return { ...page, questions: page.questions.filter((_, i) => i !== ref.questionIndex) };
    }
    if (index === targetIndex) {
      const questions = [...page.questions];
      questions.splice(questionIndex, 0, question);
      return { ...page, questions };
    }
    return page;
  });
  return { definition: { ...definition, pages }, ref: { pageIndex: targetIndex, questionIndex } };
}

/** Copies a (non-system) question right after itself, with a new id. */
export function duplicateQuestion(
  definition: FormDefinition,
  ref: QuestionRef,
  copyLabel: (label: string) => string,
): { definition: FormDefinition; questionId: string | null } {
  const question = getQuestion(definition, ref);
  if (!question || question.system) return { definition, questionId: null };
  const copy: Question = {
    ...structuredClone(question),
    id: uniqueKey("q", takenKeys(definition)),
    label: copyLabel(question.label).slice(0, 300),
  };
  return {
    definition: replaceQuestions(definition, ref.pageIndex, (questions) => {
      const next = [...questions];
      next.splice(ref.questionIndex + 1, 0, copy);
      return next;
    }),
    questionId: copy.id,
  };
}

/** Deletes a (non-system) question and the rules that use it. */
export function deleteQuestion(definition: FormDefinition, ref: QuestionRef): FormDefinition {
  const question = getQuestion(definition, ref);
  if (!question || question.system) return definition;
  const rest = replaceQuestions(definition, ref.pageIndex, (questions) =>
    questions.filter((_, index) => index !== ref.questionIndex),
  );
  return removeRulesFor(rest, [question.id]);
}

/* Choices ---------------------------------------------------------------------- */

export function addOption(question: Question, label: string): { question: Question; optionId: string } {
  const optionId = uniqueKey("o", new Set(question.options.map((option) => option.id)));
  return { question: { ...question, options: [...question.options, { id: optionId, label }] }, optionId };
}

export function renameOption(question: Question, optionIndex: number, label: string): Question {
  return {
    ...question,
    options: question.options.map((option, index) => (index === optionIndex ? { ...option, label } : option)),
  };
}

export function moveOption(question: Question, optionIndex: number, direction: Direction): Question {
  const target = optionIndex + direction;
  if (target < 0 || target >= question.options.length) return question;
  return { ...question, options: swap(question.options, optionIndex, target) };
}

/** Deletes a choice and the rules that compare with it. */
export function deleteOption(
  definition: FormDefinition,
  ref: QuestionRef,
  optionIndex: number,
): FormDefinition {
  const question = getQuestion(definition, ref);
  const option: Option | undefined = question?.options[optionIndex];
  if (!question || !option) return definition;
  const next = replaceQuestions(definition, ref.pageIndex, (questions) =>
    questions.map((item, index) =>
      index === ref.questionIndex
        ? { ...item, options: item.options.filter((_, i) => i !== optionIndex) }
        : item,
    ),
  );
  return removeRulesFor(next, [question.id], option.id);
}

/* Show-if rules ------------------------------------------------------------------ */

/**
 * The values a rule can compare with: choice ids, urgencies or category ids;
 * null when the value is free text.
 */
export function ruleValues(question: Question, categoryIds: readonly string[]): readonly string[] | null {
  if (question.system === "urgency") return URGENCIES;
  if (question.system === "category") return categoryIds;
  if (isChoiceType(question.type)) return question.options.map((option) => option.id);
  return null;
}

/**
 * A rule for a question: "is <first choice>" for choice questions,
 * "is answered" (ticked) otherwise, so a new rule is complete right away.
 */
export function ruleFor(question: Question, categoryIds: readonly string[]): Rule {
  const values = ruleValues(question, categoryIds);
  const operators = operatorsFor(question.type);
  if (values && values.length > 0) {
    return { questionId: question.id, operator: operators[0]!, value: values[0] };
  }
  return { questionId: question.id, operator: "answered" };
}

/** A new rule for a condition: about the nearest earlier question. */
export function newRule(available: readonly Located[], categoryIds: readonly string[]): Rule | null {
  const last = available.at(-1);
  return last ? ruleFor(last.question, categoryIds) : null;
}

export function setRuleQuestion(rule: Rule, question: Question, categoryIds: readonly string[]): Rule {
  return rule.questionId === question.id ? rule : ruleFor(question, categoryIds);
}

export function setRuleOperator(
  rule: Rule,
  operator: Operator,
  question: Question | undefined,
  categoryIds: readonly string[],
): Rule {
  if (!operatorNeedsValue(operator)) return { questionId: rule.questionId, operator };
  const values = question ? ruleValues(question, categoryIds) : null;
  const keep = rule.value !== undefined && (values === null || values.includes(rule.value));
  return { questionId: rule.questionId, operator, value: keep ? rule.value : (values?.[0] ?? "") };
}

export function startCondition(rule: Rule): Condition {
  return { match: "all", rules: [rule] };
}

export function updateRule(condition: Condition, index: number, rule: Rule): Condition {
  return { ...condition, rules: condition.rules.map((item, i) => (i === index ? rule : item)) };
}

export function addRule(condition: Condition, rule: Rule): Condition {
  return { ...condition, rules: [...condition.rules, rule] };
}

/** Removes a rule; without rules the condition is gone ("always show"). */
export function removeRule(condition: Condition, index: number): Condition | null {
  const rules = condition.rules.filter((_, i) => i !== index);
  return rules.length ? { ...condition, rules } : null;
}

export const MAX_RULES = 10;

/* Problems -------------------------------------------------------------------------- */

type IssueDescriber = (issue: z.core.$ZodRawIssue) => string | undefined;

function problemKey(problem: Problem) {
  return `${problem.path.join(".")}|${problem.message}`;
}

export function dedupeProblems(problems: readonly Problem[]): Problem[] {
  const seen = new Map<string, Problem>();
  for (const problem of problems) if (!seen.has(problemKey(problem))) seen.set(problemKey(problem), problem);
  return [...seen.values()];
}

/**
 * Everything that keeps the definition from being published: the shape
 * (empty labels, too long texts, too many items) and the form rules
 * (`definitionProblems`). `describe` words zod's own messages.
 */
export function collectProblems(definition: FormDefinition, describe?: IssueDescriber): Problem[] {
  const result = formDefinitionSchema.safeParse(definition, describe ? { error: describe } : undefined);
  const shape: Problem[] = result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.filter((key): key is string | number => typeof key !== "symbol"),
        message: issue.message,
      }));
  return dedupeProblems([...shape, ...definitionProblems(definition)]);
}

/** Field messages of a failed save (`definition.pages.1.questions.0.label`) as problems. */
export function serverProblems(fields: Record<string, string> | undefined): Problem[] {
  return Object.entries(fields ?? {}).map(([key, message]) => ({ path: parsePath(key), message }));
}

/** A dotted path as a list; numbers become numbers and a leading `definition` is dropped. */
export function parsePath(path: string): Path {
  const parts: Path = path
    .split(".")
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  return parts[0] === "definition" ? parts.slice(1) : parts;
}

/** What a problem is about, and the rest of its path inside that thing. */
export type ProblemTarget =
  | { scope: "form"; rest: Path }
  | { scope: "page"; pageIndex: number; rest: Path }
  | { scope: "question"; pageIndex: number; questionIndex: number; rest: Path };

export function problemTarget(path: Path): ProblemTarget {
  const [pages, pageIndex, questions, questionIndex, ...rest] = path;
  if (pages !== "pages" || typeof pageIndex !== "number") return { scope: "form", rest: path };
  if (questions === "questions" && typeof questionIndex === "number") {
    return { scope: "question", pageIndex, questionIndex, rest };
  }
  return { scope: "page", pageIndex, rest: path.slice(2) };
}

export type Scoped = { message: string; rest: Path };
export type ProblemIndex = {
  form: Scoped[];
  pages: Map<number, Scoped[]>;
  questions: Map<string, Scoped[]>;
  total: number;
};

export const questionKey = (ref: QuestionRef) => `${ref.pageIndex}:${ref.questionIndex}`;

/** Groups problems by the form, each page and each question. */
export function indexProblems(problems: readonly Problem[]): ProblemIndex {
  const index: ProblemIndex = { form: [], pages: new Map(), questions: new Map(), total: problems.length };
  const push = <K>(map: Map<K, Scoped[]>, key: K, scoped: Scoped) =>
    map.set(key, [...(map.get(key) ?? []), scoped]);
  for (const problem of problems) {
    const target = problemTarget(problem.path);
    const scoped = { message: problem.message, rest: target.rest };
    if (target.scope === "form") index.form.push(scoped);
    else if (target.scope === "page") push(index.pages, target.pageIndex, scoped);
    else push(index.questions, questionKey(target), scoped);
  }
  return index;
}

/** The messages whose rest path starts with this prefix. */
export function messagesAt(scoped: readonly Scoped[] | undefined, ...prefix: Path): string[] {
  return (scoped ?? [])
    .filter((problem) => prefix.every((part, index) => problem.rest[index] === part))
    .map((problem) => problem.message);
}

/** The messages whose rest path starts with none of these fields. */
export function messagesExcept(scoped: readonly Scoped[] | undefined, fields: readonly string[]): string[] {
  return (scoped ?? [])
    .filter((problem) => !fields.includes(String(problem.rest[0] ?? "")))
    .map((problem) => problem.message);
}

/** The known problem messages, to translate them. */
const PROBLEM_KEYS = {
  "Two pages have this id": "duplicatePage",
  "The first page is always shown": "firstPageShown",
  "Two questions have this id": "duplicateQuestion",
  "Add at least one choice": "noChoices",
  "Two choices have this id": "duplicateChoice",
  "Choose a question that comes earlier": "ruleQuestion",
  "This comparison does not fit the question": "ruleOperator",
  "Choose a value": "ruleValue",
  "Choose one of the question's choices": "ruleChoice",
  "Choose an urgency": "ruleUrgency",
  "Use 1 to 40 lowercase letters, digits, - or _": "badKey",
  "Enter a label": "choiceLabel",
  "Enter a question": "questionLabel",
  "Enter a title": "formTitle",
} as const;

/** Problems of a system question: "The <system> question <ending>". */
const SYSTEM_PROBLEM_KEYS = {
  "appears twice": "systemTwice",
  "must be on the first page": "systemFirstPage",
  "has a fixed type": "systemType",
  "is required": "systemRequired",
  "is always shown": "systemShown",
  "is missing": "systemMissing",
} as const;

export type ProblemKey =
  | (typeof PROBLEM_KEYS)[keyof typeof PROBLEM_KEYS]
  | (typeof SYSTEM_PROBLEM_KEYS)[keyof typeof SYSTEM_PROBLEM_KEYS];

const SYSTEM_PROBLEM = new RegExp(`^The (${SYSTEM_QUESTIONS.join("|")}) question (.+)$`);

/** Which known problem a message is, to show it in the interface language; null when unknown. */
export function classifyProblem(message: string): { key: ProblemKey; system?: SystemQuestion } | null {
  const system = SYSTEM_PROBLEM.exec(message);
  if (system) {
    const key = (SYSTEM_PROBLEM_KEYS as Record<string, ProblemKey | undefined>)[system[2]!];
    return key ? { key, system: system[1] as SystemQuestion } : null;
  }
  const key = (PROBLEM_KEYS as Record<string, ProblemKey | undefined>)[message];
  return key ? { key } : null;
}
