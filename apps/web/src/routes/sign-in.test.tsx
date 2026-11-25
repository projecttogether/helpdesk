import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppRouter } from "@/router";

afterEach(() => vi.unstubAllGlobals());

/** The API by path: not signed in, and the sign-in page's settings. */
function stubApi() {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const { pathname } = new URL(String(input), window.location.origin);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (pathname === "/api/v1/auth-config")
      return json(200, { appName: "Helpdesk", providerName: "Keycloak" });
    return json(401, { error: { code: "unauthorized", message: "Sign in first" } });
  });
}

describe("the sign-in page", () => {
  it("shows the app with its icon, and ProjectTogether as the organization that makes it", async () => {
    stubApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({
      history: createMemoryHistory({ initialEntries: ["/sign-in"] }),
      queryClient,
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Sign in with Keycloak" })).toBeEnabled();
    expect(container.querySelector('img[src="/favicon.svg"]')).not.toBeNull();
    expect(screen.getAllByText(/Helpdesk is open source, made by ProjectTogether\./).length).toBeGreaterThan(
      0,
    );
    for (const link of screen.getAllByRole("link", { name: /Source code/ })) {
      expect(link).toHaveAttribute("href", "https://github.com/projecttogether/helpdesk");
    }
  });
});
