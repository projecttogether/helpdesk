import { z } from "zod";
import { config } from "../config";

/*
 * Reads people and their groups through the Keycloak Admin API, with a
 * client-credentials token of a service account that has the realm-management
 * role `view-users` (docs/identity-and-access.md).
 */

export class DirectoryError extends Error {
  override name = "DirectoryError";
}

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;

const groupSchema = z.object({ id: z.string().min(1), name: z.string(), path: z.string().optional() });
const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  enabled: z.boolean().optional(),
});
export type KeycloakUser = z.infer<typeof userSchema>;
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

/** The Admin API base of a realm: …/realms/<realm> becomes …/admin/realms/<realm>. */
export function adminApiBase(issuer: string): string {
  const url = issuer.replace(/\/+$/, "");
  const match = /^(.*)\/realms\/([^/]+)$/.exec(url);
  if (!match) throw new DirectoryError(`${issuer} is not a Keycloak realm URL (…/realms/<realm>)`);
  return `${match[1]}/admin/realms/${match[2]}`;
}

/** "First Last", or the username or email when both are empty. */
export function displayNameOf(user: KeycloakUser): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name || user.username || user.email || user.id;
}

export type KeycloakClient = {
  /** The paths of a user's groups (direct memberships; subgroups imply their parents). */
  userGroups(userId: string): Promise<string[]>;
  /** Members of a group and of its subgroups, by user ID. */
  membersOf(groupPath: string): Promise<Map<string, KeycloakUser>>;
  /** Fails with a plain message when the service account cannot read the groups. */
  check(groupPaths: string[]): Promise<void>;
};

export function createKeycloakClient(options?: {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  fetch?: typeof fetch;
}): KeycloakClient {
  const settings = config();
  const issuer = (options?.issuer ?? settings.OIDC_ISSUER).replace(/\/+$/, "");
  const clientId = options?.clientId ?? settings.KEYCLOAK_CLIENT_ID ?? settings.OIDC_CLIENT_ID;
  const clientSecret =
    options?.clientSecret ?? settings.KEYCLOAK_CLIENT_SECRET ?? settings.OIDC_CLIENT_SECRET;
  const fetchImpl = options?.fetch ?? fetch;
  const base = adminApiBase(issuer);
  let token: { value: string; expiresAt: number } | undefined;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new DirectoryError(
        `Could not reach Keycloak at ${new URL(url).origin}: ${(error as Error).message}`,
      );
    }
  }

  async function getToken(): Promise<string> {
    if (token && token.expiresAt > Date.now() + 10_000) return token.value;
    const response = await send(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!response.ok) {
      throw new DirectoryError(
        `Keycloak refused the service account token (HTTP ${response.status}). Turn on "Service accounts roles" for client ${clientId}.`,
      );
    }
    const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new DirectoryError("Keycloak returned an invalid token response");
    token = {
      value: parsed.data.access_token,
      expiresAt: Date.now() + (parsed.data.expires_in ?? 60) * 1000,
    };
    return token.value;
  }

  /** GET on the Admin API; null for HTTP 404. One retry with a fresh token after HTTP 401. */
  async function getJson<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T> | null> {
    const url = `${base}${path}`;
    const request = async () =>
      send(url, { headers: { authorization: `Bearer ${await getToken()}`, accept: "application/json" } });
    let response = await request();
    if (response.status === 401) {
      token = undefined;
      response = await request();
    }
    // A fresh token and still 401: from 26.8.2, the Admin API wants the audience of kc-admin-api.
    if (response.status === 401) {
      throw new DirectoryError(
        `The Keycloak Admin API refused the service account token (HTTP 401). Keycloak 26.8.2 and later: add the client scope kc-admin-api to client ${clientId} as a Default scope.`,
      );
    }
    if (response.status === 404) return null;
    if (response.status === 403) {
      throw new DirectoryError(
        `Keycloak refused the request (HTTP 403). Give the service account of client ${clientId} the realm-management role view-users.`,
      );
    }
    if (!response.ok)
      throw new DirectoryError(`Keycloak Admin API ${path.split("?")[0]} answered HTTP ${response.status}`);
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success)
      throw new DirectoryError(`Keycloak Admin API ${path.split("?")[0]} returned an invalid body`);
    return parsed.data;
  }

  async function paged<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>[]> {
    const items: z.infer<T>[] = [];
    for (let first = 0; ; first += PAGE_SIZE) {
      const separator = path.includes("?") ? "&" : "?";
      const page = await getJson(`${path}${separator}first=${first}&max=${PAGE_SIZE}`, z.array(schema));
      if (!page) throw new DirectoryError(`Keycloak Admin API ${path.split("?")[0]} was not found`);
      items.push(...page);
      if (page.length < PAGE_SIZE) return items;
    }
  }

  async function groupByPath(path: string) {
    const encoded = path
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const group = await getJson(`/group-by-path/${encoded}`, groupSchema);
    if (!group) throw new DirectoryError(`The Keycloak group ${path} does not exist`);
    return group;
  }

  const children = (groupId: string) =>
    paged(`/groups/${encodeURIComponent(groupId)}/children?briefRepresentation=true`, groupSchema);

  async function membersOfId(groupId: string, seen: Set<string>): Promise<Map<string, KeycloakUser>> {
    const members = new Map<string, KeycloakUser>();
    if (seen.has(groupId)) return members;
    seen.add(groupId);
    const list = await paged(
      `/groups/${encodeURIComponent(groupId)}/members?briefRepresentation=true`,
      userSchema,
    );
    for (const user of list) members.set(user.id, user);
    for (const child of await children(groupId)) {
      for (const [id, user] of await membersOfId(child.id, seen)) members.set(id, user);
    }
    return members;
  }

  return {
    async userGroups(userId) {
      const groups = await paged(
        `/users/${encodeURIComponent(userId)}/groups?briefRepresentation=true`,
        groupSchema,
      ).catch((error: unknown) => {
        if (error instanceof DirectoryError && /was not found/.test(error.message)) return [];
        throw error;
      });
      return groups.map((group) => group.path ?? `/${group.name}`);
    },
    async membersOf(groupPath) {
      return membersOfId((await groupByPath(groupPath)).id, new Set());
    },
    async check(groupPaths) {
      for (const path of groupPaths) await groupByPath(path);
    },
  };
}
