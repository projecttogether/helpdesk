import { describe, expect, it } from "vitest";
import { createKeycloakClient } from "./keycloak";

const ISSUER = "http://keycloak.test/realms/helpdesk";

/** A Keycloak that issues tokens and answers every Admin API request with `adminStatus`. */
function fakeKeycloak(adminStatus: (call: number) => number) {
  const calls: string[] = [];
  let adminCalls = 0;
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url.replace("http://keycloak.test", ""));
    if (url.endsWith("/protocol/openid-connect/token")) {
      return Response.json({ access_token: `token-${calls.length}`, expires_in: 300 });
    }
    const status = adminStatus(++adminCalls);
    return status === 200 ? Response.json({ id: "g-1", name: "operators" }) : new Response(null, { status });
  };
  const client = createKeycloakClient({
    issuer: ISSUER,
    clientId: "helpdesk",
    clientSecret: "secret",
    fetch,
  });
  return { client, calls };
}

describe("createKeycloakClient", () => {
  it("reads a group with a service account token", async () => {
    const { client, calls } = fakeKeycloak(() => 200);

    await client.check(["/helpdesk/operators"]);

    expect(calls).toEqual([
      "/realms/helpdesk/protocol/openid-connect/token",
      "/admin/realms/helpdesk/group-by-path/helpdesk/operators",
    ]);
  });

  it("tries once more with a fresh token after HTTP 401", async () => {
    const { client, calls } = fakeKeycloak((call) => (call === 1 ? 401 : 200));

    await client.check(["/helpdesk/operators"]);

    expect(calls.filter((call) => call.endsWith("/token"))).toHaveLength(2);
  });

  it("names the kc-admin-api scope when the Admin API refuses a fresh token", async () => {
    const { client, calls } = fakeKeycloak(() => 401);

    await expect(client.check(["/helpdesk/operators"])).rejects.toThrow(
      "The Keycloak Admin API refused the service account token (HTTP 401). Keycloak 26.8.2 and later: add the client scope kc-admin-api to client helpdesk as a Default scope.",
    );
    expect(calls.filter((call) => call.endsWith("/token"))).toHaveLength(2);
  });

  it("names the view-users role for HTTP 403", async () => {
    const { client } = fakeKeycloak(() => 403);

    await expect(client.check(["/helpdesk/operators"])).rejects.toThrow(
      "Keycloak refused the request (HTTP 403). Give the service account of client helpdesk the realm-management role view-users.",
    );
  });

  it("names the service account setting when Keycloak issues no token", async () => {
    const fetch: typeof globalThis.fetch = async () => new Response(null, { status: 401 });
    const client = createKeycloakClient({
      issuer: ISSUER,
      clientId: "helpdesk",
      clientSecret: "secret",
      fetch,
    });

    await expect(client.check(["/helpdesk/operators"])).rejects.toThrow(
      'Keycloak refused the service account token (HTTP 401). Turn on "Service accounts roles" for client helpdesk.',
    );
  });
});
