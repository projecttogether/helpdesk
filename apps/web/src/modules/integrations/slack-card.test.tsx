import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SlackSettings } from "@helpdesk/shared/api/integrations";
import { renderWithProviders } from "@/test-utils";
import { SlackForm } from "./slack-card";

const connected: SlackSettings = {
  configured: true,
  botTokenHint: "…wxyz",
  teamName: "Example",
  botName: "helpdesk",
  channelId: "C0123456789",
  channelName: "it-requests",
  missingScopes: ["channels:read", "groups:read"],
};

type Reply = { status?: number; body?: unknown };

/** Answers by method and path; records every request. */
function routeFetch(routes: Record<string, Reply>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = routes[`${init?.method ?? "GET"} ${url.split("?")[0]}`] ?? {
      status: 500,
      body: { error: { code: "internal_error", message: "No reply" } },
    };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function puts(fetch: ReturnType<typeof routeFetch>) {
  return fetch.mock.calls
    .filter(([, init]) => init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
}

afterEach(() => vi.unstubAllGlobals());

describe("SlackForm", () => {
  it("falls back to a channel ID when Slack doesn't list the channels", async () => {
    const fetch = routeFetch({
      "GET /api/v1/integrations/slack/channels": {
        status: 409,
        body: {
          error: {
            code: "slack_channels",
            message: "The bot token lacks channels:read or groups:read. Enter the channel ID instead.",
          },
        },
      },
      "PUT /api/v1/integrations/slack": {
        body: { ...connected, channelId: "C0999999999", channelName: null },
      },
    });
    renderWithProviders(<SlackForm settings={connected} />);

    expect(screen.getByText("No channel list")).toBeInTheDocument();
    const input = await screen.findByLabelText("Channel ID");
    await userEvent.clear(input);
    await userEvent.type(input, "c0999999999");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts(fetch)).toEqual([{ botToken: "", channelId: "C0999999999" }]));
  });

  it("checks the token's prefix before saving", async () => {
    const fetch = routeFetch({ "GET /api/v1/integrations/slack/channels": { body: { items: [] } } });
    renderWithProviders(<SlackForm settings={{ ...connected, configured: false, botTokenHint: null }} />);

    await userEvent.type(screen.getByLabelText("Bot token"), "xapp-123");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A bot token starts with xoxb-")).toBeInTheDocument();
    expect(puts(fetch)).toEqual([]);
  });

  it("hides the bot token until the eye button shows it", async () => {
    routeFetch({ "GET /api/v1/integrations/slack/channels": { body: { items: [] } } });
    renderWithProviders(<SlackForm settings={{ ...connected, configured: false, botTokenHint: null }} />);

    const input = screen.getByLabelText("Bot token");
    await userEvent.type(input, "xoxb-example");
    expect(input).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("xoxb-example");

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("disconnects after confirming", async () => {
    const fetch = routeFetch({
      "GET /api/v1/integrations/slack/channels": {
        body: { items: [{ id: "C0123456789", name: "it-requests", isPrivate: false, isMember: true }] },
      },
      "PUT /api/v1/integrations/slack": {
        body: { ...connected, configured: false, botTokenHint: null, teamName: null, botName: null },
      },
    });
    renderWithProviders(<SlackForm settings={connected} />);

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(puts(fetch)).toEqual([{ botToken: null, channelId: "C0123456789" }]));
  });
});
