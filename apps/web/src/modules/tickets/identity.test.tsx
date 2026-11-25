import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IdentityOptions } from "@helpdesk/shared/api/identity";
import type { Answer, TicketDetail } from "@helpdesk/shared/api/tickets";
import type { Me } from "@helpdesk/shared/api/users";
import { renderWithProviders } from "@/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/** Renders with a query client the test can drive. */
function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
}
import { IdentityRequests, valuesFromAnswers } from "./identity";

const me = vi.hoisted(() => ({ current: null as Me | null }));
vi.mock("@/hooks/use-me", () => ({ useMe: () => me.current }));

afterEach(() => vi.unstubAllGlobals());

const operator: Me = {
  id: "7d9f3c56-63c4-4a3e-9d1b-4f7f6e2f9a10",
  email: "hanna@example.org",
  name: "Hanna HR",
  role: "operator",
  image: null,
  notifyVia: "email",
  slackAvailable: false,
  identityRequests: true,
};

const answer = (questionId: string, display: string[]): Answer => ({
  questionId,
  label: questionId,
  type: "short_text",
  display,
  attachments: [],
});

const ANSWERS = [
  answer("name-first", ["Grace"]),
  answer("name-last", ["Hopper"]),
  answer("kind", ["intern"]),
  answer("team", ["research"]),
  answer("start", ["2027-01-04"]),
  answer("needs", ["Laptop", "Slack"]),
];

const OPTIONS: IdentityOptions = {
  configured: true,
  personTypes: [
    { value: "intern", label: "Intern" },
    { value: "volunteer", label: "Volunteer" },
  ],
  teams: [{ id: 3, name: "Research" }],
  mapping: {
    firstName: "name-first",
    lastName: "name-last",
    personalEmail: null,
    jobTitle: null,
    personType: "kind",
    team: "team",
    managerEmail: null,
    startDate: "start",
    endDate: null,
    notes: "needs",
  },
};

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    number: 12,
    title: "New team member",
    status: "in_progress",
    urgency: "normal",
    category: null,
    requester: null,
    assignee: null,
    dueDate: null,
    createdAt: "2026-11-23T09:00:00.000Z",
    updatedAt: "2026-11-23T09:00:00.000Z",
    closedAt: null,
    revision: 1,
    messageCount: 0,
    source: "form",
    createdBy: null,
    formVersion: 1,
    answers: ANSWERS,
    messages: [],
    events: [],
    identityRequests: [],
    ...overrides,
  };
}

describe("identity requests", () => {
  it("fills the dialog from the mapped answers", () => {
    expect(valuesFromAnswers(ANSWERS, OPTIONS)).toEqual({
      firstName: "Grace",
      lastName: "Hopper",
      personalEmail: "",
      jobTitle: "",
      personType: "intern",
      teamId: "3",
      managerEmail: "",
      startDate: "2027-01-04",
      endDate: "",
      notes: "Laptop, Slack",
    });
  });

  it("sends a checked request to IAM and shows it on the ticket", async () => {
    me.current = operator;
    const sent = ticket({
      identityRequests: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Grace Hopper",
          personType: "intern",
          status: "open",
          reason: "",
          lastError: null,
          personStatus: null,
          workEmail: null,
          url: "https://iam.example.org/requests/4",
          sentBy: "Hanna HR",
          createdAt: "2026-11-23T10:00:00.000Z",
          checkedAt: null,
        },
      ],
    });
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = url === "/api/v1/identity/options" ? OPTIONS : sent;
      return new Response(JSON.stringify(body), {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderWithProviders(<IdentityRequests ticket={ticket()} />);
    expect(screen.getByText("None yet.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Request identity" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByLabelText("First name")).toHaveValue("Grace");
    await user.type(within(dialog).getByLabelText("Personal email"), "grace@personal.example.org");
    await user.click(within(dialog).getByRole("button", { name: "Send to IAM" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/v1/tickets/12/identity-requests");
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      personalEmail: "grace@personal.example.org",
      personType: "intern",
      teamId: 3,
      startDate: "2027-01-04",
      endDate: null,
      notes: "Laptop, Slack",
      submissionKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("sends a retry after a failed send as the same request, also after closing the dialog", async () => {
    me.current = operator;
    let posts = 0;
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/v1/identity/options") return new Response(JSON.stringify(OPTIONS), { status: 200 });
      posts += 1;
      return posts === 1
        ? new Response(
            JSON.stringify({ error: { code: "iam_unavailable", message: "Could not reach IAM." } }),
            {
              status: 502,
            },
          )
        : new Response(JSON.stringify(ticket()), { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderWithProviders(<IdentityRequests ticket={ticket()} />);
    await user.click(screen.getByRole("button", { name: "Request identity" }));
    await user.click(
      await within(await screen.findByRole("dialog")).findByRole("button", { name: "Send to IAM" }),
    );
    await waitFor(() => expect(posts).toBe(1));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Request identity" }));
    await user.click(
      await within(await screen.findByRole("dialog")).findByRole("button", { name: "Send to IAM" }),
    );
    await waitFor(() => expect(posts).toBe(2));
    const keys = fetch.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => (JSON.parse(String(init?.body)) as { submissionKey: string }).submissionKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("keeps the dialog open while a send runs", async () => {
    me.current = operator;
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/v1/identity/options"
          ? new Response(JSON.stringify(OPTIONS), { status: 200 })
          : new Promise<Response>((resolve) => {
              answer = resolve;
            }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<IdentityRequests ticket={ticket()} />);
    await user.click(screen.getByRole("button", { name: "Request identity" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Send to IAM" }));
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    answer(new Response(JSON.stringify(ticket()), { status: 201 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the form when a later check of IAM's options fails", async () => {
    me.current = operator;
    let optionCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        optionCalls += 1;
        return optionCalls === 1
          ? new Response(JSON.stringify(OPTIONS), { status: 200 })
          : new Response(JSON.stringify({ error: { code: "iam_unavailable", message: "Down" } }), {
              status: 502,
            });
      }),
    );
    const user = userEvent.setup();
    const { client } = renderWithClient(<IdentityRequests ticket={ticket()} />);
    await user.click(screen.getByRole("button", { name: "Request identity" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByLabelText("First name")).toHaveValue("Grace");
    await user.clear(within(dialog).getByLabelText("First name"));
    await user.type(within(dialog).getByLabelText("First name"), "Gracie");
    await client.refetchQueries({ queryKey: ["identity-options"] });
    // The page has seen the failed check before the form is looked at again.
    await waitFor(() => expect(client.getQueryState(["identity-options"])?.status).toBe("error"));
    await waitFor(() => expect(screen.queryByText("Down")).not.toBeInTheDocument());
    expect(within(dialog).getByLabelText("First name")).toHaveValue("Gracie");
  });

  it("shows a send IAM has not confirmed, and sends it again", async () => {
    me.current = operator;
    const unconfirmed = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Grace Hopper",
      personType: "intern",
      status: "sending" as const,
      reason: "",
      lastError: "Could not reach IAM. Try again later.",
      personStatus: null,
      workEmail: null,
      url: "",
      sentBy: "Hanna HR",
      createdAt: "2026-11-23T10:00:00.000Z",
      checkedAt: null,
    };
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify(
            ticket({
              identityRequests: [
                {
                  ...unconfirmed,
                  status: "open",
                  lastError: null,
                  url: "https://iam.example.org/requests/4",
                },
              ],
            }),
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderWithProviders(<IdentityRequests ticket={ticket({ identityRequests: [unconfirmed] })} />);
    expect(screen.getByText("Not confirmed by IAM yet")).toBeVisible();
    expect(screen.getByText("Last try: Could not reach IAM. Try again later.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0]![0]).toBe(
      "/api/v1/tickets/12/identity-requests/11111111-1111-4111-8111-111111111111/send",
    );
  });

  it("sends corrected details as a new request after IAM refused them", async () => {
    me.current = operator;
    let posts = 0;
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/v1/identity/options") return new Response(JSON.stringify(OPTIONS), { status: 200 });
      posts += 1;
      return posts === 1
        ? new Response(
            JSON.stringify({
              error: {
                code: "iam_refused",
                message: "Check the highlighted fields",
                fields: { personType: "No interns." },
              },
            }),
            { status: 422 },
          )
        : new Response(JSON.stringify(ticket()), { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderWithProviders(<IdentityRequests ticket={ticket()} />);
    await user.click(screen.getByRole("button", { name: "Request identity" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Send to IAM" }));
    expect(await within(dialog).findByText("No interns.")).toBeVisible();
    await user.selectOptions(within(dialog).getByLabelText("Person type"), "volunteer");
    await user.click(within(dialog).getByRole("button", { name: "Send to IAM" }));
    await waitFor(() => expect(posts).toBe(2));
    const keys = fetch.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => (JSON.parse(String(init?.body)) as { submissionKey: string }).submissionKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keeps the key when the send fails for a reason that is not IAM's refusal", async () => {
    me.current = operator;
    let posts = 0;
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "/api/v1/identity/options") return new Response(JSON.stringify(OPTIONS), { status: 200 });
      posts += 1;
      return posts === 1
        ? new Response(
            // Helpdesk's own check, e.g. after the answer to a saved send got lost: the key stays.
            JSON.stringify({
              error: {
                code: "validation_error",
                message: "Check",
                fields: { firstName: "Enter the first name" },
              },
            }),
            { status: 422 },
          )
        : new Response(JSON.stringify(ticket()), { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderWithProviders(<IdentityRequests ticket={ticket()} />);
    await user.click(screen.getByRole("button", { name: "Request identity" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Send to IAM" }));
    await waitFor(() => expect(posts).toBe(1));
    await user.click(within(dialog).getByRole("button", { name: "Send to IAM" }));
    await waitFor(() => expect(posts).toBe(2));
    const keys = fetch.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => (JSON.parse(String(init?.body)) as { submissionKey: string }).submissionKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("stays away while IAM is not set up and the ticket has no requests", () => {
    me.current = { ...operator, identityRequests: false };
    const { container } = renderWithProviders(<IdentityRequests ticket={ticket()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
