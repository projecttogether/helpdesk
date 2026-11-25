import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Form } from "@helpdesk/shared/api/form";
import { DEFAULT_FORM } from "@helpdesk/shared/form";
import { stubFetch } from "@/test-utils";
import { FormEditorPage } from "./form-editor-page";

const CATEGORY: Category = {
  id: "0b5a3e5e-3c1f-4d8e-9f3a-111111111111",
  name: "IT",
  position: 1,
  isActive: true,
  defaultAssigneeId: null,
  defaultAssigneeName: null,
};

function form(version: number): Form {
  return {
    versionId: "0b5a3e5e-3c1f-4d8e-9f3a-222222222222",
    version,
    definition: structuredClone(DEFAULT_FORM),
    categories: [{ id: CATEGORY.id, name: CATEGORY.name }],
    updatedAt: new Date().toISOString(),
    updatedBy: "Admin",
  };
}

function renderPage() {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/form",
    component: () => <FormEditorPage tab="questions" onTabChange={() => undefined} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/admin/form"] }),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Answers by path, so the order of the page's requests does not matter. */
function stubApi(handlers: Record<string, (init?: RequestInit) => { status?: number; body: unknown }>) {
  const mock = stubFetch();
  mock.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace(/^\/api\/v1/, "").split("?")[0]}`;
    const reply = handlers[key]?.(init) ?? { status: 500, body: { error: { code: "x", message: key } } };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  return mock;
}

// The router restores scroll positions; jsdom has no scrolling.
beforeEach(() => vi.spyOn(window, "scrollTo").mockImplementation(() => undefined));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FormEditorPage", () => {
  it("shows the pages, blocks saving with problems and publishes", async () => {
    const user = userEvent.setup();
    const fetch = stubApi({
      "GET /form": () => ({ body: form(3) }),
      "GET /categories": () => ({ body: { items: [CATEGORY] } }),
      "PUT /form": () => ({ body: form(4) }),
    });
    renderPage();

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    expect(await screen.findByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("Fix 1 problem to save")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await user.type(title, "IT requests");
    const save = screen.getByRole("button", { name: "Save" });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
    const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body)) as { baseVersion: number; definition: { title: string } };
    expect(body.baseVersion).toBe(3);
    expect(body.definition.title).toBe("IT requests");
  });

  it("publishes the form's language", async () => {
    const user = userEvent.setup();
    const fetch = stubApi({
      "GET /form": () => ({ body: form(3) }),
      "GET /categories": () => ({ body: { items: [CATEGORY] } }),
      "PUT /form": () => ({ body: form(4) }),
    });
    renderPage();

    const language = await screen.findByRole("combobox", { name: "Language" });
    expect(language).toHaveTextContent("English");
    await user.click(language);
    await user.click(await screen.findByRole("option", { name: "German" }));
    expect(language).toHaveTextContent("German");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body)) as { definition: { language: string } };
    expect(body.definition.language).toBe("de");
  });

  it("explains a conflict and offers to reload", async () => {
    const user = userEvent.setup();
    let version = 3;
    stubApi({
      "GET /form": () => ({ body: form(version) }),
      "GET /categories": () => ({ body: { items: [CATEGORY] } }),
      "PUT /form": () => {
        version = 4;
        return { status: 409, body: { error: { code: "form_changed", message: "Someone else saved" } } };
      },
    });
    renderPage();

    await user.type(await screen.findByLabelText("Intro text"), " More.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Someone else published the form")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("Reload the form?")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Reload" }).at(-1)!);
    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
    expect(screen.getByText(/Version 4, published/)).toBeInTheDocument();
  });

  it("opens a question and lists who uses it before deleting", async () => {
    const user = userEvent.setup();
    const definition = structuredClone(DEFAULT_FORM);
    definition.pages[1]!.questions[1]!.showIf = {
      match: "all",
      rules: [{ questionId: "description", operator: "answered" }],
    };
    stubApi({
      "GET /form": () => ({ body: { ...form(1), definition } }),
      "GET /categories": () => ({ body: { items: [CATEGORY] } }),
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Actions for “Describe your request”" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete question" }));
    expect(await screen.findByText("Delete this question?")).toBeInTheDocument();
    expect(screen.getByText("Page 2: “Attachments”")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("Describe your request")).not.toBeInTheDocument());
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Conditional")).not.toBeInTheDocument();
  });
});
