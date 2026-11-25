import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Form } from "@helpdesk/shared/api/form";
import { DEFAULT_FORM, formDefinitionSchema } from "@helpdesk/shared/form";
import { renderWithProviders, stubFetch } from "@/test-utils";
import { FormRunner } from "./form-runner";

const IT = "11111111-1111-4111-8111-111111111111";
const HR = "22222222-2222-4222-8222-222222222222";

const form: Form = {
  versionId: "33333333-3333-4333-8333-333333333333",
  version: 2,
  updatedAt: "2026-11-16T09:00:00.000Z",
  updatedBy: null,
  categories: [
    { id: IT, name: "IT" },
    { id: HR, name: "HR" },
  ],
  definition: formDefinitionSchema.parse({
    ...DEFAULT_FORM,
    pages: [
      DEFAULT_FORM.pages[0],
      {
        id: "it",
        title: "Your device",
        showIf: { match: "all", rules: [{ questionId: "category", operator: "equals", value: IT }] },
        questions: [
          {
            id: "device",
            type: "single_choice",
            label: "What do you need?",
            required: true,
            options: [
              { id: "laptop", label: "Laptop" },
              { id: "phone", label: "Phone" },
            ],
          },
          {
            id: "model",
            type: "short_text",
            label: "Which model?",
            required: true,
            showIf: { match: "all", rules: [{ questionId: "device", operator: "equals", value: "laptop" }] },
          },
        ],
      },
      DEFAULT_FORM.pages[1],
    ],
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FormRunner", () => {
  it("shows pages and questions by their rules, checks each page, and sends the shown answers", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch({ status: 201, body: { number: 7 } });
    const sent = vi.fn();
    renderWithProviders(<FormRunner form={form} onSent={sent} />);

    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getAllByText("Answer this question")).toHaveLength(3);

    await user.type(screen.getByLabelText("What is your request about?"), "New laptop");
    await user.click(screen.getByLabelText("IT"));
    await user.click(screen.getByLabelText("Urgent"));
    await user.click(screen.getByRole("button", { name: /Next/ }));

    expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your device" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Which model?")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Laptop"));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Answer this question")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Which model?"), "X1");
    await user.click(screen.getByRole("button", { name: /Next/ }));

    // The details page, then the review.
    await user.type(screen.getByLabelText("Describe your request"), "For the new colleague.");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("heading", { name: "Check and send" })).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Send request/ }));
    await waitFor(() => expect(sent).toHaveBeenCalledWith(7));
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({
      formVersionId: form.versionId,
      answers: {
        title: "New laptop",
        category: IT,
        urgency: "urgent",
        device: "laptop",
        model: "X1",
        description: "For the new colleague.",
      },
    });
    expect(body.submissionKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("skips pages whose rules do not match and drops their answers", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch({ status: 201, body: { number: 8 } });
    renderWithProviders(<FormRunner form={form} onSent={() => undefined} />);
    await user.type(screen.getByLabelText("What is your request about?"), "Payslip");
    await user.click(screen.getByLabelText("HR"));
    await user.click(screen.getByLabelText("Normal"));
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Describe your request"), "Last month's.");
    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Send request/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(Object.keys(body.answers).sort()).toEqual(["category", "description", "title", "urgency"]);
  });

  it("speaks the form's language: German buttons, problems and urgencies", async () => {
    const user = userEvent.setup();
    stubFetch({
      status: 422,
      body: {
        error: {
          code: "validation_failed",
          message: "Check the highlighted fields",
          fields: { "answers.description": "This answer is too long" },
        },
      },
    });
    const german: Form = { ...form, definition: { ...form.definition, language: "de" } };
    const { container } = renderWithProviders(<FormRunner form={german} onSent={() => undefined} />);

    expect(container.querySelector('[lang="de"]')).not.toBeNull();
    expect(screen.getByText("Schritt 1 von 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(screen.getAllByText("Beantworte diese Frage")).toHaveLength(3);

    await user.type(screen.getByLabelText("What is your request about?"), "Gehaltsabrechnung");
    await user.click(screen.getByLabelText("HR"));
    await user.click(screen.getByLabelText("Dringend"));
    await user.click(screen.getByRole("button", { name: /Weiter/ }));
    expect(screen.getByLabelText("Attachments (optional)")).toHaveTextContent("Dateien hinzufügen");
    await user.type(screen.getByLabelText("Describe your request"), "Vom letzten Monat.");
    await user.click(screen.getByRole("button", { name: /Weiter/ }));

    expect(screen.getByRole("heading", { name: "Prüfen und senden" })).toBeInTheDocument();
    expect(screen.getByText("Dringend")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Anfrage senden/ }));
    // The server's problem, in the form's language, on the page of the question.
    expect(await screen.findByText("Diese Antwort ist zu lang")).toBeInTheDocument();
    expect(screen.getByText("Prüfe die markierten Antworten")).toBeInTheDocument();
  });
});
