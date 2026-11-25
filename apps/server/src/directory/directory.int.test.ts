import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { accounts, settings, users } from "../db/schema";
import { logger } from "../logger";
import { resetConfigForTests } from "../config";
import { createUser, request, resetDatabase } from "../test/helpers";
import { createDirectory, type KeycloakClient, type KeycloakUser } from ".";

vi.mock("../auth/resolve", () => import("../test/resolve-mock"));

function idToken(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256" })}.${encode({ sub: "subject-1", ...claims })}.signature`;
}

async function signedIn(email: string, claims: Record<string, unknown>, subject = "subject-1") {
  const user = await createUser(null, { email });
  await getDb()
    .insert(accounts)
    .values({ accountId: subject, providerId: "oidc", userId: user.id, idToken: idToken(claims) });
  return { ...user, tokens: { idToken: idToken({ ...claims, sub: subject }) } };
}

const roleOf = async (id: string) => (await getDb().select().from(users).where(eq(users.id, id)))[0]!;

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DIRECTORY;
  delete process.env.OIDC_GROUPS_CLAIM;
  delete process.env.GROUP_ADMINS;
  delete process.env.GROUP_SUPERADMINS;
  resetConfigForTests();
});

describe("roles at sign-in from the groups claim (DIRECTORY=oidc)", () => {
  it("gives the highest role of the claimed groups, or none", async () => {
    const directory = createDirectory();
    const operator = await signedIn("op@example.org", {
      groups: ["/helpdesk/employees", "/helpdesk/operators/it"],
    });
    expect(await directory.admit(operator.id, operator.tokens)).toBe("operator");
    expect(await roleOf(operator.id)).toMatchObject({
      role: "operator",
      roleSource: "sign_in",
      directoryId: "subject-1",
    });

    const outsider = await signedIn("out@example.org", { groups: ["/marketing"] }, "subject-2");
    expect(await directory.admit(outsider.id, outsider.tokens)).toBeNull();
    expect((await roleOf(outsider.id)).role).toBeNull();
  });

  it("reads a nested claim", async () => {
    process.env.OIDC_GROUPS_CLAIM = "realm_access.roles";
    resetConfigForTests();
    const admin = await signedIn("admin@example.org", { realm_access: { roles: ["helpdesk/admins"] } });
    expect(await createDirectory().admit(admin.id, admin.tokens)).toBe("admin");
  });

  it("uses UserInfo groups only for the signed-in subject", async () => {
    const user = await signedIn("op@example.org", {});
    const tokens = { ...user.tokens, accessToken: "test-token" };
    const issuer = process.env.OIDC_ISSUER!;
    let subject = "subject-1";
    const fetchStub = vi.fn(async (url: string) => {
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({ issuer, userinfo_endpoint: `${issuer}/userinfo` });
      }
      return Response.json({ sub: subject, groups: ["helpdesk/operators"] });
    });
    vi.stubGlobal("fetch", fetchStub);
    const directory = createDirectory();

    expect(await directory.admit(user.id, tokens)).toBe("operator");
    subject = "different-subject";
    expect(await directory.admit(user.id, tokens)).toBeNull();

    const warn = vi.spyOn(logger, "warn");
    fetchStub.mockRejectedValueOnce(new Error("private request data"));
    try {
      expect(await directory.admit(user.id, tokens)).toBeNull();
      expect(warn).toHaveBeenLastCalledWith({ userId: user.id }, "could not read the groups at sign-in");
    } finally {
      warn.mockRestore();
    }
  });

  it("requires a current ID token and keeps an existing subject binding", async () => {
    const directory = createDirectory();
    const user = await signedIn("op@example.org", { groups: ["helpdesk/operators"] });
    expect(await directory.admit(user.id, {})).toBeNull();
    expect(await directory.admit(user.id, user.tokens)).toBe("operator");
    const other = { idToken: idToken({ sub: "other", groups: ["helpdesk/superadmins"] }) };
    expect(await directory.admit(user.id, other)).toBeNull();
    expect((await roleOf(user.id)).role).toBe("operator");
  });

  it("moves the subject to the person who signs in with it", async () => {
    const directory = createDirectory();
    const before = await signedIn("old@example.org", { groups: ["helpdesk/operators"] });
    expect(await directory.admit(before.id, before.tokens)).toBe("operator");
    // The provider changed the address: Better Auth creates a new entry.
    const after = await signedIn("new@example.org", { groups: ["helpdesk/operators"] });
    expect(await directory.admit(after.id, after.tokens)).toBe("operator");
    expect(await roleOf(after.id)).toMatchObject({ role: "operator", directoryId: "subject-1" });
    expect(await roleOf(before.id)).toMatchObject({ role: null, directoryId: null });
  });

  it("always lets SUPERADMIN_EMAILS in", async () => {
    const root = await signedIn("root@example.org", { groups: [] });
    expect(await createDirectory().admit(root.id, root.tokens)).toBe("superadmin");
  });

  it("matches groups and subgroups, reads the claim as a list, and skips turned-off groups", async () => {
    process.env.GROUP_ADMINS = "helpdesk/admins";
    process.env.GROUP_SUPERADMINS = "-";
    resetConfigForTests();
    const directory = createDirectory();
    const user = await signedIn("member@example.org", {});
    const roleFor = (groups: unknown) => directory.admit(user.id, { idToken: idToken({ groups }) });
    expect(await roleFor(["/helpdesk/operators"])).toBe("operator");
    expect(await roleFor(["helpdesk/operators/"])).toBe("operator");
    expect(await roleFor(["/helpdesk/operators/finance"])).toBe("operator");
    expect(await roleFor(["/helpdesk/operators-old"])).toBeNull();
    expect(await roleFor(["/helpdesk"])).toBeNull();
    expect(await roleFor(["/helpdesk/employees"])).toBe("requester");
    expect(await roleFor(["/helpdesk/employees", "/helpdesk/admins"])).toBe("admin");
    expect(await roleFor(["/helpdesk/superadmins"])).toBeNull();
    expect(await roleFor(["/other"])).toBeNull();
    expect(await roleFor([])).toBeNull();
    expect(await roleFor(["/a", 3, "/helpdesk/operators"])).toBe("operator");
    expect(await roleFor("/helpdesk/employees")).toBe("requester");
    expect(await roleFor({ path: "/helpdesk/operators" })).toBeNull();
  });

  it("has nothing to sync or check, and sessions end a week after sign-in", async () => {
    const directory = createDirectory();
    expect(directory.sync).toBeNull();
    expect(directory.roleMaxAgeSeconds).toBe(7 * 24 * 60 * 60);
    expect(await directory.status()).toEqual({
      mode: "oidc",
      groups: {
        requester: "/helpdesk/employees",
        operator: "/helpdesk/operators",
        admin: "/helpdesk/admins",
        superadmin: "/helpdesk/superadmins",
      },
      syncMinutes: null,
      lastSync: null,
    });

    const superadmin = await createUser("superadmin");
    const sync = await request("POST", "/api/v1/directory/sync", { userId: superadmin.id });
    expect(sync.status).toBe(409);
    expect(sync.body.error).toMatchObject({
      code: "conflict",
      message: "Roles come from the sign-in; there is nothing to sync",
    });
    const check = await request("POST", "/api/v1/directory/check", { userId: superadmin.id });
    expect(check.status).toBe(409);
    expect(check.body.error.message).toBe("Roles come from the sign-in; there is nothing to check");
    const status = await request("GET", "/api/v1/directory", { userId: superadmin.id });
    expect(status.body).toMatchObject({ mode: "oidc", syncMinutes: null, lastSync: null });
  });
});

function fakeKeycloak(
  groups: Record<string, KeycloakUser[]>,
  userGroups: Record<string, string[]> = {},
): KeycloakClient {
  return {
    async membersOf(path) {
      return new Map((groups[path] ?? []).map((user) => [user.id, user]));
    },
    async userGroups(id) {
      return userGroups[id] ?? [];
    },
    async check() {},
  };
}

describe("Keycloak (DIRECTORY=keycloak)", () => {
  beforeEach(() => {
    process.env.DIRECTORY = "keycloak";
    resetConfigForTests();
  });

  it("reads the person's groups at sign-in", async () => {
    const directory = createDirectory({ keycloak: fakeKeycloak({}, { "kc-1": ["/helpdesk/superadmins"] }) });
    const user = await signedIn("ada@example.org", {}, "kc-1");
    expect(await directory.admit(user.id, user.tokens)).toBe("superadmin");
    expect((await roleOf(user.id)).roleSource).toBe("directory");
  });

  it("keeps the last known role when Keycloak cannot be read", async () => {
    const directory = createDirectory({
      keycloak: { ...fakeKeycloak({}), userGroups: async () => Promise.reject(new Error("down")) },
    });
    const user = await signedIn("op@example.org", {}, "kc-2");
    await getDb().update(users).set({ role: "operator", directoryId: "kc-2" }).where(eq(users.id, user.id));
    expect(await directory.admit(user.id, user.tokens)).toBe("operator");
  });

  it("syncs everyone in the groups and removes roles of people who left", async () => {
    const leaver = await createUser("operator", { email: "leaver@example.org" });
    await getDb().update(users).set({ directoryId: "kc-old" }).where(eq(users.id, leaver.id));
    const known = await createUser(null, { email: "erin@example.org" });
    const result = await createDirectory({
      keycloak: fakeKeycloak({
        "/helpdesk/employees": [
          { id: "kc-erin", email: "Erin@example.org", firstName: "Erin", lastName: "Employee" },
          { id: "kc-off", email: "off@example.org", enabled: false },
          { id: "kc-nomail", username: "nomail" },
        ],
        "/helpdesk/operators": [{ id: "kc-oscar", email: "oscar@example.org", firstName: "Oscar" }],
        "/helpdesk/admins": [{ id: "kc-erin", email: "erin@example.org" }],
      }),
    }).sync!.run();
    expect(result).toEqual({ people: 2 });
    expect(await roleOf(known.id)).toMatchObject({
      role: "admin",
      name: "Erin Employee",
      directoryId: "kc-erin",
    });
    const [oscar] = await getDb().select().from(users).where(eq(users.email, "oscar@example.org"));
    expect(oscar).toMatchObject({ role: "operator", roleSource: "directory", name: "Oscar" });
    expect((await roleOf(leaver.id)).role).toBeNull();
    const [status] = await getDb().select().from(settings).where(eq(settings.key, "directory"));
    expect(status!.value).toMatchObject({ ok: true, people: 2 });
  });

  it("reports the sync interval and the last sync, also a failed one", async () => {
    const directory = createDirectory({
      keycloak: fakeKeycloak({ "/helpdesk/operators": [{ id: "kc-oscar", email: "oscar@example.org" }] }),
    });
    expect(directory.roleMaxAgeSeconds).toBeNull();
    expect(await directory.status()).toMatchObject({ mode: "keycloak", syncMinutes: 15, lastSync: null });
    await directory.sync!.run();
    expect((await directory.status()).lastSync).toMatchObject({
      ok: true,
      message: "Synced 1 people",
      people: 1,
    });

    const failing = createDirectory({
      keycloak: { ...fakeKeycloak({}), membersOf: async () => Promise.reject(new Error("Keycloak is down")) },
    });
    await expect(failing.sync!.run()).rejects.toThrow("Keycloak is down");
    expect((await failing.status()).lastSync).toMatchObject({
      ok: false,
      message: "Keycloak is down",
      people: 0,
    });
  });

  it("checks that the service account can read every role group that is turned on", async () => {
    process.env.GROUP_ADMINS = "-";
    resetConfigForTests();
    const checked: string[][] = [];
    const directory = createDirectory({
      keycloak: {
        ...fakeKeycloak({}),
        async check(paths) {
          checked.push(paths);
          if (paths.includes("/helpdesk/operators"))
            throw new Error("The Keycloak group /helpdesk/operators does not exist");
        },
      },
    });
    await expect(directory.sync!.check()).rejects.toThrow(
      "The Keycloak group /helpdesk/operators does not exist",
    );
    expect(checked).toEqual([["/helpdesk/employees", "/helpdesk/operators", "/helpdesk/superadmins"]]);
  });
});
