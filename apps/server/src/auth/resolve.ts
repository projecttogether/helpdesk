import { and, eq, gt } from "drizzle-orm";
import { notifyChannelSchema, roleSchema } from "@helpdesk/shared/roles";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { auth } from "./auth";
import { directory } from "../directory";
import type { UserPrincipal } from "./principal";

/** The signed-in person of a request, or null (no session, revoked session, no role). */
export async function resolvePrincipal(db: Db, headers: Headers): Promise<UserPrincipal | null> {
  const session = await auth().api.getSession({ headers });
  if (!session) return null;
  // The cookie cache can outlive a revoked session by a minute; check the row.
  const now = new Date();
  // Sessions created before rolling renewal was disabled can still have a later expiry.
  const roleMaxAge = directory().roleMaxAgeSeconds;
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      image: users.image,
      notifyVia: users.notifyVia,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, session.session.id),
        gt(sessions.expiresAt, now),
        roleMaxAge === null ? undefined : gt(sessions.createdAt, new Date(now.getTime() - roleMaxAge * 1000)),
      ),
    );
  if (!row) return null;
  const role = roleSchema.safeParse(row.role);
  if (!role.success) return null;
  return {
    kind: "user",
    id: row.id,
    email: row.email,
    name: row.name,
    role: role.data,
    image: row.image,
    notifyVia: notifyChannelSchema.safeParse(row.notifyVia).data ?? "email",
  };
}
