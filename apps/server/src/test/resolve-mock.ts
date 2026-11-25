import { eq } from "drizzle-orm";
import { notifyChannelSchema, roleSchema } from "@helpdesk/shared/roles";
import type { Db } from "../db/client";
import { users } from "../db/schema";
import type { UserPrincipal } from "../auth/principal";

/**
 * Sign-in is the OIDC provider's job; API tests act as a person from the
 * database (header x-test-user). Use with
 * `vi.mock("../auth/resolve", () => import("../test/resolve-mock"))`.
 */
export async function resolvePrincipal(db: Db, headers: Headers): Promise<UserPrincipal | null> {
  const id = headers.get("x-test-user");
  if (!id) return null;
  const [user] = await db.select().from(users).where(eq(users.id, id));
  const role = roleSchema.safeParse(user?.role);
  if (!user || !role.success) return null;
  return {
    kind: "user",
    id: user.id,
    email: user.email,
    name: user.name,
    role: role.data,
    image: null,
    notifyVia: notifyChannelSchema.catch("email").parse(user.notifyVia),
  };
}
