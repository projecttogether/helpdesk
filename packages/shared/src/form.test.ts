import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORM,
  definitionProblems,
  formDefinitionSchema,
  validateAnswers,
  visibleForm,
  type FormDefinition,
  type Question,
} from "./form";

const CATEGORY_IT = "11111111-1111-4111-8111-111111111111";
const CATEGORY_HR = "22222222-2222-4222-8222-222222222222";
const context = { categoryIds: [CATEGORY_IT, CATEGORY_HR] };

const question = (overrides: Partial<Question> & Pick<Question, "id" | "type">): Question => ({
  label: overrides.id,
  help: "",
  required: false,
  options: [],
  showIf: null,
  ...overrides,
});

/** The default first page, then a page only for IT, with a follow-up question. */
const form: FormDefinition = formDefinitionSchema.parse({
  ...DEFAULT_FORM,
  pages: [
    DEFAULT_FORM.pages[0],
    {
      id: "it",
      title: "IT",
      showIf: { match: "all", rules: [{ questionId: "category", operator: "equals", value: CATEGORY_IT }] },
      questions: [
        question({
          id: "device",
          type: "single_choice",
          required: true,
          options: [
            { id: "laptop", label: "Laptop" },
            { id: "phone", label: "Phone" },
          ],
        }),
        question({
          id: "model",
          type: "short_text",
          required: true,
          showIf: { match: "all", rules: [{ questionId: "device", operator: "equals", value: "laptop" }] },
        }),
        question({ id: "accessories", type: "multiple_choice", options: [{ id: "mouse", label: "Mouse" }] }),
      ],
    },
    {
      id: "end",
      title: "Anything else",
      questions: [
        question({
          id: "note",
          type: "long_text",
          showIf: {
            match: "any",
            rules: [
              { questionId: "urgency", operator: "equals", value: "very_urgent" },
              { questionId: "accessories", operator: "includes", value: "mouse" },
            ],
          },
        }),
        question({ id: "agree", type: "checkbox", required: true }),
      ],
    },
  ],
});

const base = { title: "New laptop", category: CATEGORY_IT, urgency: "normal", agree: true };

describe("visibleForm", () => {
  it("shows a page only when its condition matches", () => {
    const it = visibleForm(form, { ...base }).map((page) => page.page.id);
    expect(it).toEqual(["start", "it", "end"]);
    const hr = visibleForm(form, { ...base, category: CATEGORY_HR }).map((page) => page.page.id);
    expect(hr).toEqual(["start", "end"]);
  });

  it("shows a question when an earlier answer matches", () => {
    const ids = (answers: Record<string, unknown>) =>
      visibleForm(form, answers as never).flatMap((page) => page.questions.map((q) => q.id));
    expect(ids({ ...base, device: "phone" })).not.toContain("model");
    expect(ids({ ...base, device: "laptop" })).toContain("model");
    expect(ids({ ...base })).not.toContain("note");
    expect(ids({ ...base, urgency: "very_urgent" })).toContain("note");
    expect(ids({ ...base, accessories: ["mouse"] })).toContain("note");
  });

  it("compares text the way it is cleaned, so browser and server agree", () => {
    const withTitleRule: FormDefinition = {
      ...form,
      pages: form.pages.map((page) =>
        page.id === "end"
          ? {
              ...page,
              showIf: {
                match: "all",
                rules: [{ questionId: "title", operator: "equals", value: "New laptop" }],
              },
            }
          : page,
      ),
    };
    const shown = (title: string) =>
      visibleForm(withTitleRule, { ...base, title }).some((page) => page.page.id === "end");
    expect(shown("New  laptop")).toBe(true);
    expect(shown(" new laptop ")).toBe(true);
    expect(shown("New laptops")).toBe(false);
  });

  it("treats answers of hidden questions as unanswered", () => {
    // HR hides the IT page, so its mouse answer no longer shows the note.
    const ids = visibleForm(form, { ...base, category: CATEGORY_HR, accessories: ["mouse"] }).flatMap(
      (page) => page.questions.map((q) => q.id),
    );
    expect(ids).not.toContain("note");
  });
});

describe("validateAnswers", () => {
  it("requires shown questions only and drops hidden answers", () => {
    const result = validateAnswers(
      form,
      { ...base, category: CATEGORY_HR, device: "laptop", model: "X1" },
      context,
    );
    expect(result.issues).toEqual({});
    expect(result.values).toEqual({
      title: "New laptop",
      category: CATEGORY_HR,
      urgency: "normal",
      agree: true,
    });
  });

  it("reports missing, invalid and unknown answers", () => {
    const result = validateAnswers(
      form,
      { title: "  ", category: "33333333-3333-4333-8333-333333333333", urgency: "whenever", agree: false },
      context,
    );
    expect(result.issues).toEqual({
      title: "required",
      category: "unknown_option",
      urgency: "unknown_option",
      agree: "required",
    });
  });

  it("cleans text, numbers and choices", () => {
    const result = validateAnswers(
      form,
      { ...base, title: "  New   laptop ", device: "laptop", model: " X1 ", accessories: ["mouse", "mouse"] },
      context,
    );
    expect(result.issues).toEqual({});
    expect(result.values).toMatchObject({ title: "New laptop", model: "X1", accessories: ["mouse"] });
  });

  it("checks one page at a time when asked", () => {
    const result = validateAnswers(form, { ...base, device: "laptop" }, context, new Set(["start"]));
    expect(result.issues).toEqual({});
    const second = validateAnswers(form, { ...base, device: "laptop" }, context, new Set(["it"]));
    expect(second.issues).toEqual({ model: "required" });
  });
});

describe("definitionProblems", () => {
  it("accepts the default form", () => {
    expect(definitionProblems(DEFAULT_FORM)).toEqual([]);
    expect(formDefinitionSchema.safeParse(DEFAULT_FORM).success).toBe(true);
  });

  it("keeps the form's language, English unless set", () => {
    const { language: _language, ...withoutLanguage } = DEFAULT_FORM;
    expect(formDefinitionSchema.parse(withoutLanguage).language).toBe("en");
    expect(formDefinitionSchema.parse({ ...DEFAULT_FORM, language: "de" }).language).toBe("de");
    expect(formDefinitionSchema.safeParse({ ...DEFAULT_FORM, language: "fr" }).success).toBe(false);
  });

  it("refuses conditions on later questions, missing system questions and empty choices", () => {
    const broken = {
      ...DEFAULT_FORM,
      pages: [
        {
          ...DEFAULT_FORM.pages[0]!,
          questions: [
            ...DEFAULT_FORM.pages[0]!.questions.filter((q) => q.system !== "urgency"),
            question({
              id: "early",
              type: "short_text",
              showIf: { match: "all", rules: [{ questionId: "late", operator: "answered" }] },
            }),
            question({ id: "late", type: "single_choice" }),
          ],
        },
      ],
    };
    const messages = definitionProblems(broken).map((problem) => problem.message);
    expect(messages).toContain("Choose a question that comes earlier");
    expect(messages).toContain("Add at least one choice");
    expect(messages).toContain("The urgency question is missing");
  });

  it("keeps system questions on the first page, required and always shown", () => {
    const [first, second] = [DEFAULT_FORM.pages[0]!, DEFAULT_FORM.pages[1]!];
    const title = first.questions.find((q) => q.system === "title")!;
    const moved = {
      ...DEFAULT_FORM,
      pages: [
        { ...first, questions: first.questions.filter((q) => q.system !== "title") },
        { ...second, questions: [...second.questions, { ...title, required: false }] },
      ],
    };
    const messages = definitionProblems(moved).map((problem) => problem.message);
    expect(messages).toContain("The title question must be on the first page");
    expect(messages).toContain("The title question is required");
  });

  it("checks rule values against the question's choices", () => {
    const withRule = {
      ...form,
      pages: form.pages.map((page) =>
        page.id === "end"
          ? {
              ...page,
              questions: [
                question({
                  id: "x",
                  type: "short_text",
                  showIf: {
                    match: "all",
                    rules: [{ questionId: "device", operator: "equals", value: "tablet" }],
                  },
                }),
              ],
            }
          : page,
      ),
    };
    expect(definitionProblems(withRule).map((problem) => problem.message)).toEqual([
      "Choose one of the question's choices",
    ]);
  });
});
