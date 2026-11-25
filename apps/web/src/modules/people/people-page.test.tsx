import { Suspense } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectoryStatus } from "@helpdesk/shared/api/integrations";
import type { Me, User } from "@helpdesk/shared/api/users";
import { renderWithProviders } from "@/test-utils";
import { PeoplePage } from "./people-page";

const superadmin: Me = {
  id: "7d9f3c56-63c4-4a3e-9d1b-4f7f6e2f9a10",
  email: "admin@example.org",
  name: "Alex Admin",
  role: "superadmin",
  image: null,
  notifyVia: "email",
  slackAvailable: false,
  identityRequests: false,
};

const users: User[] = [
  {
    id: "0b5c6d1e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
    email: "kim@example.org",
    name: "Kim Example",
    role: "operator",
    fromEnvironment: false,
    roleSource: "directory",
    roleCheckedAt: "2026-11-16T09:00:00.000Z",
    lastSignInAt: null,
    createdAt: "2026-11-01T10:00:00.000Z",
  },
  {
    id: "1c6d7e2f-2a3b-4c4d-9e5f-6a7b8c9d0e1f",
    email: "former@example.org",
    name: "",
    role: null,
    fromEnvironment: false,
    roleSource: "sign_in",
    roleCheckedAt: null,
    lastSignInAt: "2026-10-01T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
  },
];

const keycloak: DirectoryStatus = {
  mode: "keycloak",
  groups: {
    requester: "/helpdesk/requesters",
    operator: "/helpdesk/operators",
    admin: null,
    superadmin: null,
  },
  syncMinutes: 15,
  lastSync: { at: "2026-11-16T09:00:00.000Z", ok: true, message: "Synced 2 people", people: 2 },
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

afterEach(() => vi.unstubAllGlobals());

function renderPage(onAccess = vi.fn()) {
  renderWithProviders(
    <Suspense fallback={null}>
      <PeoplePage access="all" onAccess={onAccess} />
    </Suspense>,
  );
  return onAccess;
}

describe("PeoplePage", () => {
  it("lists people with their role and where it comes from", async () => {
    routeFetch({
      "GET /api/v1/me": { body: superadmin },
      "GET /api/v1/users": { body: { items: users } },
      "GET /api/v1/directory": { body: keycloak },
    });
    renderPage();

    const kim = (await screen.findByText("kim@example.org")).closest("tr")!;
    expect(within(kim).getByText("Operator")).toBeInTheDocument();
    expect(within(kim).getByText("Directory sync")).toBeInTheDocument();
    const former = screen.getByText("former@example.org").closest("tr")!;
    expect(within(former).getByText("No access")).toBeInTheDocument();
    expect(within(former).getByText("Sign-in")).toBeInTheDocument();
    expect(screen.getByText(/synced every 15 minutes and at each sign-in/)).toBeInTheDocument();
    expect(screen.getByText("/helpdesk/operators")).toBeInTheDocument();
  });

  it("syncs the directory and lists people again", async () => {
    const fetch = routeFetch({
      "GET /api/v1/me": { body: superadmin },
      "GET /api/v1/users": { body: { items: users } },
      "GET /api/v1/directory": { body: keycloak },
      "POST /api/v1/directory/sync": { body: { ok: true, message: "Synced 2 people", latencyMs: 80 } },
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(await screen.findByText("Connection works")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([url]) => url.startsWith("/api/v1/users")).length).toBe(2),
    );
  });

  it("explains sign-in roles and hides the sync for OIDC", async () => {
    routeFetch({
      "GET /api/v1/me": { body: superadmin },
      "GET /api/v1/users": { body: { items: [] } },
      "GET /api/v1/directory": {
        body: { ...keycloak, mode: "oidc", syncMinutes: null, lastSync: null } satisfies DirectoryStatus,
      },
    });
    const onAccess = renderPage();

    expect(await screen.findByText(/Roles come from the groups claim at each sign-in/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
    expect(await screen.findByText("No people yet")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Without access" }));
    expect(onAccess).toHaveBeenCalledWith("without");
  });
});
