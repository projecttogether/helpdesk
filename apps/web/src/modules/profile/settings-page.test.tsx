import { Suspense } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me } from "@helpdesk/shared/api/users";
import { renderWithProviders, stubFetch } from "@/test-utils";
import { SettingsPage } from "./settings-page";

const operator: Me = {
  id: "7d9f3c56-63c4-4a3e-9d1b-4f7f6e2f9a10",
  email: "kim@example.org",
  name: "Kim Example",
  role: "operator",
  image: null,
  notifyVia: "email",
  slackAvailable: true,
  identityRequests: false,
};

afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  return renderWithProviders(
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>,
  );
}

describe("SettingsPage", () => {
  it("lets staff choose Slack direct messages", async () => {
    const fetch = stubFetch({ body: operator }, { body: { ...operator, notifyVia: "slack" } });
    renderPage();

    await userEvent.click(await screen.findByRole("radio", { name: /Slack direct message/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe("/api/v1/me");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ notifyVia: "slack" });
    await waitFor(() => expect(screen.getByRole("radio", { name: /Slack direct message/ })).toBeChecked());
  });

  it("disables Slack until it is set up", async () => {
    stubFetch({ body: { ...operator, slackAvailable: false } });
    renderPage();

    expect(await screen.findByRole("radio", { name: /Slack direct message/ })).toBeDisabled();
    expect(screen.getByText("Slack isn't set up for the helpdesk yet.")).toBeInTheDocument();
  });

  it("shows superadmins the version that runs, linked to its commit", async () => {
    const fetch = stubFetch(
      { body: { ...operator, role: "superadmin" } },
      { body: { version: "0123456789ab" } },
    );
    renderPage();

    const link = await screen.findByRole("link", { name: "Version 0123456789ab" });
    expect(link).toHaveAttribute("href", "https://github.com/projecttogether/helpdesk/commit/0123456789ab");
    expect(fetch.mock.calls[1]![0]).toBe("/api/v1/about");
  });

  it("asks for no version for other roles", async () => {
    const fetch = stubFetch({ body: operator });
    renderPage();

    expect(await screen.findByText(/open-source helpdesk/)).toBeInTheDocument();
    expect(screen.queryByText(/^Version/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("tells requesters they get emails", async () => {
    stubFetch({ body: { ...operator, role: "requester" } });
    renderPage();

    expect(await screen.findByText(/You get emails about your requests/)).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Slack direct message/ })).not.toBeInTheDocument();
    expect(screen.getByText("Requester")).toBeInTheDocument();
  });
});
