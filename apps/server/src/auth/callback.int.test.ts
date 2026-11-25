import { expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../http/app";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { createUser } from "../test/helpers";
import { auth } from "./auth";

it("returns to the sign-in page when an OIDC callback has no state", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}));
  try {
    const response = await createApp().request("http://localhost:3000/api/auth/callback/oidc");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/sign-in?error=state_not_found");
  } finally {
    fetchMock.mockRestore();
  }
});

it("rejects direct ID-token sign-in at the public auth endpoint", async () => {
  const response = await createApp().request("http://localhost:3000/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ provider: "oidc", idToken: { token: "unused" } }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ message: "Sign in through the OpenID Connect provider" });
});

it("accepts the existing subject and rejects a changed subject before account linking", async () => {
  const account = await createUser("operator", { email: "bound@example.org" });
  await getDb().update(users).set({ directoryId: "bound-subject" }).where(eq(users.id, account.id));
  const validate = auth().options.user.validateUserInfo;
  const candidate = (sub: string) =>
    ({
      user: { id: account.id },
      source: { action: "link-account", method: "oauth", oauth: { providerId: "oidc", profile: { sub } } },
    }) as const;
  await expect(validate(candidate("bound-subject"))).resolves.toBeUndefined();
  await expect(validate(candidate("changed-subject"))).resolves.toEqual({
    error: "oidc_subject_mismatch",
  });
});
