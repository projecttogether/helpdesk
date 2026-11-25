import { afterEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import pg from "pg";
import { ConfigError } from "../config";
import { email } from "./email";
import { runCli } from "./main";

const SECRET = "xoxb-query-parameter-3e8a";

async function list() {
  let stdout = "";
  let stderr = "";
  const code = await runCli(["settings", "list"], {
    readStdin: async () => "",
    out: (text) => void (stdout += text),
    err: (text) => void (stderr += text),
  });
  return { code, stdout, stderr };
}

afterEach(() => vi.restoreAllMocks());

describe("a database error", () => {
  it("prints the page's generic message, never the query's values", async () => {
    const cause = Object.assign(new pg.DatabaseError(`value "${SECRET}" is too long`, 0, "error"), {
      code: "22001",
    });
    vi.spyOn(email, "status").mockRejectedValue(
      new DrizzleQueryError("update settings set value = $1", [SECRET], cause),
    );
    expect(await list()).toEqual({
      code: 1,
      stdout: "",
      stderr: "Something went wrong. Try again. (database error 22001)\n",
    });

    vi.spyOn(email, "status").mockRejectedValue(cause);
    expect((await list()).stderr).toBe("Something went wrong. Try again. (database error 22001)\n");
  });
});

describe("an unexpected error", () => {
  it("prints the page's generic message with its code, never its text", async () => {
    vi.spyOn(email, "status").mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" }),
    );
    expect(await list()).toEqual({
      code: 1,
      stdout: "",
      stderr: "Something went wrong. Try again. (ECONNREFUSED)\n",
    });
    vi.spyOn(email, "status").mockRejectedValue(new TypeError(`Invalid header value "Bearer ${SECRET}"`));
    expect((await list()).stderr).toBe("Something went wrong. Try again.\n");
  });

  it("names the variables of an invalid configuration", async () => {
    vi.spyOn(email, "status").mockRejectedValue(
      new ConfigError("Invalid configuration:\n  DATABASE_URL: Required"),
    );
    expect((await list()).stderr).toBe("Invalid configuration:\n  DATABASE_URL: Required\n");
  });
});
