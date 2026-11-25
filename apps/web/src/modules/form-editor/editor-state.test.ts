import { describe, expect, it } from "vitest";
import { DEFAULT_FORM, type FormDefinition, type Question } from "@helpdesk/shared/form";
import {
  addOption,
  addPage,
  addQuestion,
  canMovePage,
  canMoveQuestionToPage,
  changeQuestionType,
  classifyProblem,
  collectProblems,
  createQuestion,
  deleteOption,
  deletePage,
  deleteQuestion,
  duplicateQuestion,
  earlierQuestions,
  findReferences,
  indexProblems,
  messagesAt,
  messagesExcept,
  moveOption,
  movePage,
  moveQuestion,
  moveQuestionToPage,
  newRule,
  normalizeDefinition,
  pageReferences,
  parsePath,
  prepareForSave,
  problemTarget,
  removeRule,
  ruleFor,
  sameDefinition,
  serverProblems,
  setRuleOperator,
  setRuleQuestion,
  updatePage,
  updateQuestion,
} from "./editor-state";

const CATEGORY = "0b5a3e5e-3c1f-4d8e-9f3a-111111111111";

function question(id: string, patch: Partial<Question> = {}): Question {
  return {
    id,
    type: "short_text",
    label: id,
    help: "",
    required: false,
    options: [],
    showIf: null,
    ...patch,
  };
}

/**
 * Page 1: the system questions; page 2: "device" (choice) and "model" (shown
 * if device is laptop); page 3 (shown if device is answered): "notes".
 */
function sample(): FormDefinition {
  const base = structuredClone(DEFAULT_FORM);
  return {
    ...base,
    pages: [
      base.pages[0]!,
      {
        id: "hardware",
        title: "Hardware",
        description: "",
        showIf: null,
        questions: [
          question("device", {
            type: "single_choice",
            options: [
              { id: "laptop", label: "Laptop" },
              { id: "phone", label: "Phone" },
            ],
          }),
          question("model", {
            showIf: { match: "all", rules: [{ questionId: "device", operator: "equals", value: "laptop" }] },
          }),
        ],
      },
      {
        id: "more",
        title: "More",
        description: "",
        showIf: { match: "any", rules: [{ questionId: "device", operator: "answered" }] },
        questions: [question("notes", { type: "long_text" })],
      },
    ],
  };
}

describe("loading and saving", () => {
  it("fills missing defaults", () => {
    const loose = { title: "T", pages: [{ id: "p", questions: [{ id: "q", type: "date", label: "When" }] }] };
    const definition = normalizeDefinition(loose as unknown as FormDefinition);
    expect(definition.description).toBe("");
    expect(definition.pages[0]).toMatchObject({ title: "", description: "", showIf: null });
    expect(definition.pages[0]!.questions[0]).toMatchObject({
      help: "",
      required: false,
      options: [],
      showIf: null,
    });
  });

  it("compares definitions by content", () => {
    expect(sameDefinition(sample(), sample())).toBe(true);
    expect(sameDefinition(sample(), updatePage(sample(), 1, { title: "Other" }))).toBe(false);
  });

  it("drops choices and lengths the type does not use", () => {
    let definition = sample();
    definition = updateQuestion(
      definition,
      { pageIndex: 1, questionIndex: 1 },
      {
        options: [{ id: "x", label: "X" }],
        maxLength: 50,
      },
    );
    definition = updateQuestion(definition, { pageIndex: 1, questionIndex: 0 }, { maxLength: 10 });
    const saved = prepareForSave(definition);
    expect(saved.pages[1]!.questions[1]).toMatchObject({ options: [], maxLength: 50 });
    expect(saved.pages[1]!.questions[0]!.maxLength).toBeUndefined();
    expect(saved.pages[1]!.questions[0]!.options).toHaveLength(2);
    expect(saved.pages[0]!.questions.find((q) => q.system === "title")!.maxLength).toBe(120);
  });
});

describe("earlier questions", () => {
  it("lists earlier pages for a page and earlier questions for a question", () => {
    const definition = sample();
    expect(earlierQuestions(definition, { pageIndex: 1 }).map((entry) => entry.question.id)).toEqual([
      "title",
      "category",
      "urgency",
    ]);
    expect(
      earlierQuestions(definition, { pageIndex: 1, questionIndex: 1 }).map((e) => e.question.id),
    ).toEqual(["title", "category", "urgency", "device"]);
    expect(earlierQuestions(definition, { pageIndex: 0, questionIndex: 0 })).toEqual([]);
  });
});

describe("references", () => {
  it("finds the pages and questions whose rules use a question", () => {
    const references = findReferences(sample(), ["device"]);
    expect(
      references.map((ref) => (ref.kind === "page" ? `page ${ref.pageIndex}` : ref.question.id)),
    ).toEqual(["model", "page 2"]);
  });

  it("finds the rules that compare with one choice", () => {
    expect(findReferences(sample(), ["device"], { optionId: "laptop" })).toHaveLength(1);
    expect(findReferences(sample(), ["device"], { optionId: "phone" })).toHaveLength(0);
  });

  it("finds references to a page's questions from other pages only", () => {
    expect(pageReferences(sample(), 1).map((ref) => ref.kind)).toEqual(["page"]);
    expect(pageReferences(sample(), 2)).toEqual([]);
  });
});

describe("pages", () => {
  it("adds a page with a new id", () => {
    const { definition, pageId } = addPage(sample(), "Extra");
    expect(definition.pages.at(-1)).toMatchObject({ id: pageId, title: "Extra", questions: [] });
    expect(pageId).toMatch(/^p_/);
  });

  it("keeps the first page first", () => {
    const definition = sample();
    expect(canMovePage(definition, 0, 1)).toBe(false);
    expect(canMovePage(definition, 1, -1)).toBe(false);
    expect(canMovePage(definition, 1, 1)).toBe(true);
    expect(canMovePage(definition, 2, 1)).toBe(false);
    expect(movePage(definition, 1, -1)).toBe(definition);
    expect(movePage(definition, 2, -1).pages.map((page) => page.id)).toEqual(["start", "more", "hardware"]);
  });

  it("never sets a condition on the first page and can clear one", () => {
    const rule = { questionId: "title", operator: "answered" as const };
    expect(updatePage(sample(), 0, { showIf: { match: "all", rules: [rule] } }).pages[0]!.showIf).toBeNull();
    expect(updatePage(sample(), 2, { showIf: null }).pages[2]!.showIf).toBeNull();
    expect(updatePage(sample(), 2, { title: "X" }).pages[2]!.showIf).not.toBeNull();
  });

  it("deletes a page with the rules that use its questions", () => {
    const definition = deletePage(sample(), 1);
    expect(definition.pages.map((page) => page.id)).toEqual(["start", "more"]);
    expect(definition.pages[1]!.showIf).toBeNull();
    expect(deletePage(sample(), 0)).toEqual(sample());
  });
});

describe("questions", () => {
  it("changes only label and help text of system questions", () => {
    const definition = updateQuestion(
      sample(),
      { pageIndex: 0, questionIndex: 0 },
      {
        label: "Subject",
        help: "Short",
        required: false,
        showIf: { match: "all", rules: [{ questionId: "x", operator: "answered" }] },
      },
    );
    expect(definition.pages[0]!.questions[0]).toMatchObject({
      label: "Subject",
      help: "Short",
      required: true,
      showIf: null,
    });
  });

  it("creates questions with choices for choice types", () => {
    const choice = createQuestion(sample(), "multiple_choice", "Pick", ["A", "B"]);
    expect(choice.options.map((option) => option.label)).toEqual(["A", "B"]);
    expect(new Set(choice.options.map((option) => option.id)).size).toBe(2);
    expect(createQuestion(sample(), "date", "When", ["A"]).options).toEqual([]);
    const definition = addQuestion(sample(), 2, choice);
    expect(definition.pages[2]!.questions.at(-1)!.id).toBe(choice.id);
  });

  it("moves questions within a page", () => {
    const definition = moveQuestion(sample(), { pageIndex: 1, questionIndex: 0 }, 1);
    expect(definition.pages[1]!.questions.map((q) => q.id)).toEqual(["model", "device"]);
    expect(moveQuestion(definition, { pageIndex: 1, questionIndex: 1 }, 1)).toBe(definition);
    // Now "model" comes before "device", which its rule uses.
    expect(collectProblems(definition).map((problem) => problem.message)).toContain(
      "Choose a question that comes earlier",
    );
  });

  it("moves questions between pages but keeps system questions on page 1", () => {
    const definition = sample();
    expect(canMoveQuestionToPage(definition, { pageIndex: 0, questionIndex: 0 }, 1)).toBe(false);
    expect(canMoveQuestionToPage(definition, { pageIndex: 1, questionIndex: 0 }, -1)).toBe(true);
    expect(canMoveQuestionToPage(definition, { pageIndex: 2, questionIndex: 0 }, 1)).toBe(false);

    const back = moveQuestionToPage(definition, { pageIndex: 1, questionIndex: 0 }, -1);
    expect(back.ref).toEqual({ pageIndex: 0, questionIndex: 3 });
    expect(back.definition.pages[0]!.questions.at(-1)!.id).toBe("device");

    const forward = moveQuestionToPage(definition, { pageIndex: 1, questionIndex: 1 }, 1);
    expect(forward.ref).toEqual({ pageIndex: 2, questionIndex: 0 });
    expect(forward.definition.pages[2]!.questions.map((q) => q.id)).toEqual(["model", "notes"]);

    const system = moveQuestionToPage(definition, { pageIndex: 0, questionIndex: 1 }, 1);
    expect(system.definition).toBe(definition);
  });

  it("duplicates a question after itself, not system questions", () => {
    const { definition, questionId } = duplicateQuestion(
      sample(),
      { pageIndex: 1, questionIndex: 0 },
      (label) => `${label} (copy)`,
    );
    expect(definition.pages[1]!.questions[1]).toMatchObject({ id: questionId, label: "device (copy)" });
    expect(questionId).not.toBe("device");
    expect(duplicateQuestion(sample(), { pageIndex: 0, questionIndex: 0 }, (l) => l).questionId).toBeNull();
  });

  it("deletes a question with the rules that use it", () => {
    const definition = deleteQuestion(sample(), { pageIndex: 1, questionIndex: 0 });
    expect(definition.pages[1]!.questions.map((q) => q.id)).toEqual(["model"]);
    expect(definition.pages[1]!.questions[0]!.showIf).toBeNull();
    expect(definition.pages[2]!.showIf).toBeNull();
    expect(collectProblems(definition)).toEqual([]);
  });

  it("keeps the other rules of a condition when deleting", () => {
    let definition = updatePage(sample(), 2, {
      showIf: {
        match: "any",
        rules: [
          { questionId: "device", operator: "answered" },
          { questionId: "title", operator: "answered" },
        ],
      },
    });
    definition = deleteQuestion(definition, { pageIndex: 1, questionIndex: 0 });
    expect(definition.pages[2]!.showIf?.rules).toEqual([{ questionId: "title", operator: "answered" }]);
  });

  it("does not delete system questions", () => {
    expect(deleteQuestion(sample(), { pageIndex: 0, questionIndex: 0 })).toEqual(sample());
  });

  it("changes the type and keeps rules meaningful", () => {
    const ref = { pageIndex: 1, questionIndex: 0 };
    const multiple = changeQuestionType(sample(), ref, "multiple_choice", "Choice 1");
    expect(multiple.pages[1]!.questions[1]!.showIf!.rules[0]).toMatchObject({
      operator: "includes",
      value: "laptop",
    });
    expect(collectProblems(multiple)).toEqual([]);

    const text = changeQuestionType(
      sample(),
      { pageIndex: 1, questionIndex: 1 },
      "single_choice",
      "Choice 1",
    );
    expect(text.pages[1]!.questions[1]!.options).toMatchObject([{ label: "Choice 1" }]);

    const checkbox = changeQuestionType(sample(), ref, "checkbox", "Choice 1");
    expect(collectProblems(checkbox).map((p) => p.message)).toContain(
      "This comparison does not fit the question",
    );

    const system = changeQuestionType(sample(), { pageIndex: 0, questionIndex: 0 }, "date", "x");
    expect(system).toEqual(sample());
  });
});

describe("choices", () => {
  const ref = { pageIndex: 1, questionIndex: 0 };

  it("adds, moves and deletes choices", () => {
    const device = sample().pages[1]!.questions[0]!;
    const { question: added, optionId } = addOption(device, "Tablet");
    expect(added.options.at(-1)).toEqual({ id: optionId, label: "Tablet" });
    expect(moveOption(added, 0, 1).options.map((o) => o.id)).toEqual(["phone", "laptop", optionId]);
    expect(moveOption(added, 0, -1)).toBe(added);
  });

  it("deletes the rules that compare with a deleted choice", () => {
    const definition = deleteOption(sample(), ref, 0);
    expect(definition.pages[1]!.questions[0]!.options.map((o) => o.id)).toEqual(["phone"]);
    expect(definition.pages[1]!.questions[1]!.showIf).toBeNull();
    // "is answered" does not compare with a choice and stays.
    expect(definition.pages[2]!.showIf).not.toBeNull();
  });

  it("reports a choice question without choices", () => {
    const definition = deleteOption(deleteOption(sample(), ref, 0), ref, 0);
    expect(collectProblems(definition)).toEqual([
      { path: ["pages", 1, "questions", 0, "options"], message: "Add at least one choice" },
    ]);
  });
});

describe("rules", () => {
  const definition = sample();
  const device = definition.pages[1]!.questions[0]!;
  const urgency = definition.pages[0]!.questions.find((q) => q.system === "urgency")!;
  const category = definition.pages[0]!.questions.find((q) => q.system === "category")!;
  const notes = definition.pages[2]!.questions[0]!;

  it("starts with a complete rule for each kind of question", () => {
    expect(ruleFor(device, [])).toEqual({ questionId: "device", operator: "equals", value: "laptop" });
    expect(ruleFor(urgency, [])).toEqual({ questionId: "urgency", operator: "equals", value: "low" });
    expect(ruleFor(category, [CATEGORY])).toEqual({
      questionId: "category",
      operator: "equals",
      value: CATEGORY,
    });
    expect(ruleFor(category, [])).toEqual({ questionId: "category", operator: "answered" });
    expect(ruleFor(notes, [])).toEqual({ questionId: "notes", operator: "answered" });
    expect(ruleFor(question("ok", { type: "checkbox" }), [])).toEqual({
      questionId: "ok",
      operator: "answered",
    });
  });

  it("uses the nearest earlier question for a new rule", () => {
    expect(newRule(earlierQuestions(definition, { pageIndex: 2 }), [])?.questionId).toBe("model");
    expect(newRule([], [])).toBeNull();
  });

  it("resets the rule when its question changes", () => {
    const rule = ruleFor(device, []);
    expect(setRuleQuestion(rule, device, [])).toBe(rule);
    expect(setRuleQuestion(rule, notes, [])).toEqual({ questionId: "notes", operator: "answered" });
  });

  it("keeps or fills the value when the operator changes", () => {
    const rule = { questionId: "device", operator: "equals" as const, value: "phone" };
    expect(setRuleOperator(rule, "not_equals", device, [])).toEqual({ ...rule, operator: "not_equals" });
    expect(setRuleOperator(rule, "answered", device, [])).toEqual({
      questionId: "device",
      operator: "answered",
    });
    expect(setRuleOperator({ questionId: "device", operator: "answered" }, "equals", device, [])).toEqual({
      questionId: "device",
      operator: "equals",
      value: "laptop",
    });
    expect(setRuleOperator({ questionId: "notes", operator: "answered" }, "equals", notes, [])).toEqual({
      questionId: "notes",
      operator: "equals",
      value: "",
    });
  });

  it("drops the condition with its last rule", () => {
    const condition = {
      match: "all" as const,
      rules: [{ questionId: "device", operator: "answered" as const }],
    };
    expect(removeRule(condition, 0)).toBeNull();
    expect(
      removeRule({ ...condition, rules: [...condition.rules, ...condition.rules] }, 0)?.rules,
    ).toHaveLength(1);
  });
});

describe("problems", () => {
  it("finds none in the default form", () => {
    expect(collectProblems(structuredClone(DEFAULT_FORM))).toEqual([]);
  });

  it("finds shape problems and form rule problems once each", () => {
    let definition = updateQuestion(sample(), { pageIndex: 1, questionIndex: 1 }, { label: " " });
    definition = { ...definition, title: "" };
    definition = updateQuestion(
      definition,
      { pageIndex: 1, questionIndex: 1 },
      {
        showIf: { match: "all", rules: [{ questionId: "device", operator: "equals", value: "tablet" }] },
      },
    );
    const problems = collectProblems(definition, () => "zod message");
    expect(problems).toEqual(
      expect.arrayContaining([
        { path: ["title"], message: "Enter a title" },
        { path: ["pages", 1, "questions", 1, "label"], message: "Enter a question" },
        {
          path: ["pages", 1, "questions", 1, "showIf", "rules", 0, "value"],
          message: "Choose one of the question's choices",
        },
      ]),
    );
    const keys = problems.map((problem) => `${problem.path.join(".")}|${problem.message}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("words zod's own messages with the describer", () => {
    const definition = updateQuestion(sample(), { pageIndex: 1, questionIndex: 1 }, { maxLength: 0 });
    expect(collectProblems(definition, () => "Too small")).toEqual([
      { path: ["pages", 1, "questions", 1, "maxLength"], message: "Too small" },
    ]);
  });

  it("reads server field paths", () => {
    expect(parsePath("definition.pages.1.questions.0.label")).toEqual(["pages", 1, "questions", 0, "label"]);
    expect(parsePath("baseVersion")).toEqual(["baseVersion"]);
    expect(serverProblems({ "definition.title": "Enter a title" })).toEqual([
      { path: ["title"], message: "Enter a title" },
    ]);
    expect(serverProblems(undefined)).toEqual([]);
  });

  it("maps paths to the form, a page or a question", () => {
    expect(problemTarget(["title"])).toEqual({ scope: "form", rest: ["title"] });
    expect(problemTarget(["pages"])).toEqual({ scope: "form", rest: ["pages"] });
    expect(problemTarget(["pages", 2, "showIf", "rules", 0, "value"])).toEqual({
      scope: "page",
      pageIndex: 2,
      rest: ["showIf", "rules", 0, "value"],
    });
    expect(problemTarget(["pages", 1, "questions", 3, "options", 0, "label"])).toEqual({
      scope: "question",
      pageIndex: 1,
      questionIndex: 3,
      rest: ["options", 0, "label"],
    });
    expect(problemTarget(["pages", 1, "questions"])).toEqual({
      scope: "page",
      pageIndex: 1,
      rest: ["questions"],
    });
  });

  it("groups problems and picks them by field", () => {
    const index = indexProblems([
      { path: ["title"], message: "A" },
      { path: ["pages", 2, "showIf", "rules", 0, "value"], message: "B" },
      { path: ["pages", 1, "questions", 0, "label"], message: "C" },
      { path: ["pages", 1, "questions", 0, "options", 1, "label"], message: "D" },
      { path: ["pages", 1, "questions", 0], message: "E" },
    ]);
    expect(index.total).toBe(5);
    expect(index.form.map((p) => p.message)).toEqual(["A"]);
    expect(messagesAt(index.pages.get(2), "showIf", "rules", 0)).toEqual(["B"]);
    const first = index.questions.get("1:0");
    expect(messagesAt(first, "label")).toEqual(["C"]);
    expect(messagesAt(first, "options", 1)).toEqual(["D"]);
    expect(messagesAt(first, "options", 0)).toEqual([]);
    expect(messagesExcept(first, ["label", "options"])).toEqual(["E"]);
  });

  it("classifies known messages, also of system questions", () => {
    expect(classifyProblem("Choose a value")).toEqual({ key: "ruleValue" });
    expect(classifyProblem("The urgency question must be on the first page")).toEqual({
      key: "systemFirstPage",
      system: "urgency",
    });
    expect(classifyProblem("The title question is missing")).toEqual({
      key: "systemMissing",
      system: "title",
    });
    expect(classifyProblem("Something new")).toBeNull();
    expect(classifyProblem("The foo question is missing")).toBeNull();
  });
});
