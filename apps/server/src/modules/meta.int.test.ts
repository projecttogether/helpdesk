import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTests } from "../config";
import { createUser, request, resetDatabase } from "../test/helpers";

vi.mock("../auth/resolve", () => import("../test/resolve-mock"));

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  delete process.env.APP_VERSION;
  resetConfigForTests();
});

describe("GET /api/v1/about", () => {
  it("shows superadmins the version that runs", async () => {
    const superadmin = await createUser("superadmin");
    process.env.APP_VERSION = "0123456789ab";
    resetConfigForTests();
    const response = await request("GET", "/api/v1/about", { userId: superadmin.id });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ version: "0123456789ab" });
  });

  it("has no version for a build from source", async () => {
    const superadmin = await createUser("superadmin");
    const response = await request("GET", "/api/v1/about", { userId: superadmin.id });
    expect(response.body).toEqual({ version: null });
  });

  it("is for superadmins only", async () => {
    const admin = await createUser("admin");
    expect((await request("GET", "/api/v1/about", { userId: admin.id })).status).toBe(403);
    expect((await request("GET", "/api/v1/about")).status).toBe(401);
  });
});
