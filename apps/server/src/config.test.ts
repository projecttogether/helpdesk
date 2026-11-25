import { afterEach, describe, expect, it } from "vitest";
import { config, resetConfigForTests } from "./config";

const original = { ...process.env };

function configWith(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigForTests();
  return () => config();
}

describe("config", () => {
  afterEach(() => {
    process.env = { ...original };
    resetConfigForTests();
  });

  it("has no version in a build from source", () => {
    expect(configWith({ APP_VERSION: undefined })().APP_VERSION).toBeUndefined();
    expect(configWith({ APP_VERSION: "" })().APP_VERSION).toBeUndefined();
  });

  it("reads the version the Deploy workflow builds in", () => {
    expect(configWith({ APP_VERSION: "0123456789ab" })().APP_VERSION).toBe("0123456789ab");
  });

  it("needs a 32-byte encryption key", () => {
    expect(configWith({ ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") })).toThrow(
      /ENCRYPTION_KEY: Must be 32 bytes/,
    );
  });

  it("reads the superadmins' addresses", () => {
    expect(
      configWith({ SUPERADMIN_EMAILS: " Ada@Example.org , grace@example.org" })().superadminEmails,
    ).toEqual(["ada@example.org", "grace@example.org"]);
    expect(configWith({ SUPERADMIN_EMAILS: "not-an-address" })).toThrow(/SUPERADMIN_EMAILS/);
  });
});
