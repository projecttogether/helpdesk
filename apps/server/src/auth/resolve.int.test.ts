import { expect, it, vi } from "vitest";
import { createUser, resetDatabase } from "../test/helpers";
import { getDb } from "../db/client";
import { sessions } from "../db/schema";
import { resolvePrincipal } from "./resolve";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  auth: () => ({ api: { getSession } }),
}));

it("requires a new sign-in when a claim-based session is more than a week old", async () => {
  await resetDatabase();
  const user = await createUser("operator");
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const [recent, old] = await getDb()
    .insert(sessions)
    .values([
      {
        token: "recent-test-session",
        userId: user.id,
        createdAt: new Date(now - day),
        expiresAt: new Date(now + day),
      },
      {
        token: "old-test-session",
        userId: user.id,
        createdAt: new Date(now - 8 * day),
        expiresAt: new Date(now + day),
      },
    ])
    .returning({ id: sessions.id });
  getSession.mockResolvedValueOnce({ session: recent }).mockResolvedValueOnce({ session: old });

  expect(await resolvePrincipal(getDb(), new Headers())).toMatchObject({ id: user.id, role: "operator" });
  expect(await resolvePrincipal(getDb(), new Headers())).toBeNull();
});
