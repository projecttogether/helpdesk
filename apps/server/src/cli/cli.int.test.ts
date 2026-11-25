import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { encryptSecret } from "../core/crypto";
import { putSetting } from "../core/settings";
import { getDb } from "../db/client";
import { auditLog, settings } from "../db/schema";
import { logger } from "../logger";
import { SERVER_ROOT } from "../paths";
import { createUser, request, resetDatabase } from "../test/helpers";
import { runCli } from "./main";

vi.mock("../auth/resolve", () => import("../test/resolve-mock"));

const SMTP_PASSWORD = "smtp-password-7f3a";
const MAILERSEND_TOKEN = "mlsn.cli-token-5c1e";
const HEADER_TOKEN = "mlsn.header-token-7b9d";
const SLACK_TOKEN = "xoxb-cli-token-9d2b";
const IAM = "https://iam.example.org";
const IAM_KEY = `iam_${"c".repeat(39)}8e4f`;
const SECRETS = [SMTP_PASSWORD, MAILERSEND_TOKEN, HEADER_TOKEN, SLACK_TOKEN, IAM_KEY];

const MAPPING = {
  firstName: "first",
  lastName: "last",
  personalEmail: null,
  jobTitle: null,
  personType: "type",
  team: null,
  managerEmail: null,
  startDate: null,
  endDate: null,
  notes: null,
};

/** Everything the command printed in this test, and every log call. */
let printed: string[];

/** Runs `cli <args>` with `stdin` (a JSON value, or text as is). */
async function cli(args: string[], stdin?: unknown) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, {
    readStdin: async () =>
      typeof stdin === "string" ? stdin : stdin === undefined ? "" : JSON.stringify(stdin),
    out: (text) => void (stdout += text),
    err: (text) => void (stderr += text),
  });
  printed.push(stdout, stderr);
  return { code, stdout, stderr, json: () => JSON.parse(stdout) as Record<string, unknown> };
}

type Call = { url: string; authorization: string | null; body: string };

/** Slack, MailerSend and IAM stand-ins, by URL. */
function stubFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
      body: String(init?.body ?? ""),
    });
    const route = routes[url];
    return route ? route() : new Response(JSON.stringify({ ok: false, error: "unknown_method" }));
  });
  return calls;
}

const slackOk =
  (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify({ ok: true, ...body }), {
      headers: { "content-type": "application/json", ...headers },
    });

const SLACK_SCOPES = "chat:write,users:read,users:read.email,channels:read,groups:read";

function stubSlack(scopes = SLACK_SCOPES) {
  return stubFetch({
    "http://slack.test/api/auth.test": slackOk(
      { team: "Example", user: "helpdesk" },
      { "x-oauth-scopes": scopes },
    ),
    "http://slack.test/api/conversations.info": slackOk({ channel: { name: "helpdesk" } }),
    "http://slack.test/api/conversations.list": slackOk({
      channels: [{ id: "C0HELPDESK1", name: "helpdesk", is_member: true }],
    }),
    "http://slack.test/api/chat.postMessage": slackOk({}),
  });
}

async function auditEntries(action: string) {
  return getDb().select().from(auditLog).where(eq(auditLog.action, action));
}

async function stored(key: string) {
  const [row] = await getDb().select().from(settings).where(eq(settings.key, key));
  return row?.value;
}

beforeEach(async () => {
  await resetDatabase();
  printed = [];
  for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
    vi.spyOn(logger, level).mockImplementation((...args: unknown[]) => {
      printed.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  // No secret in any output, message or log line of the test.
  for (const text of printed) for (const secret of SECRETS) expect(text).not.toContain(secret);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cli settings list", () => {
  it("names every setting, set or not, with hints only", async () => {
    const empty = await cli(["settings", "list"]);
    expect(empty).toMatchObject({ code: 0, stderr: "" });
    expect(empty.stdout).toBe("email  not set\nslack  not set\niam    not set\n");

    await cli(["settings", "apply", "email"], {
      provider: "mailersend",
      fromAddress: "helpdesk@example.org",
      mailersend: { token: MAILERSEND_TOKEN },
    });
    await cli(["settings", "apply", "iam"], { url: IAM, apiKey: "", mapping: MAPPING });
    const list = await cli(["settings", "list"]);
    expect(list.stdout).toBe(
      "email  set         mailersend, from helpdesk@example.org, token …5c1e\n" +
        "slack  not set\n" +
        `iam    incomplete  ${IAM}, 3 fields from the form\n`,
    );
    const json = await cli(["settings", "list", "--json"]);
    expect(JSON.parse(json.stdout)).toEqual([
      { name: "email", state: "set", hints: ["mailersend", "from helpdesk@example.org", "token …5c1e"] },
      { name: "slack", state: "not set", hints: [] },
      { name: "iam", state: "incomplete", hints: [IAM, "3 fields from the form"] },
    ]);
  });
});

describe("cli settings … email", () => {
  const SMTP = {
    provider: "smtp",
    fromAddress: "helpdesk@example.org",
    fromName: "Helpdesk",
    smtp: { host: "mail.example.org", port: 587, security: "starttls", username: "helpdesk" },
  };

  it("saves the page's body, encrypts the password and records the operator", async () => {
    const applied = await cli(["settings", "apply", "email"], {
      ...SMTP,
      smtp: { ...SMTP.smtp, password: SMTP_PASSWORD },
    });
    expect(applied).toMatchObject({ code: 0, stderr: "" });
    expect(applied.json()).toEqual({
      provider: "smtp",
      fromAddress: "helpdesk@example.org",
      fromName: "Helpdesk",
      smtp: {
        host: "mail.example.org",
        port: 587,
        security: "starttls",
        username: "helpdesk",
        passwordHint: "…7f3a",
      },
      mailersend: { tokenHint: null },
    });
    expect(JSON.stringify(await stored("email"))).toMatch(/"passwordEncrypted":"v1:/);

    const shown = await cli(["settings", "show", "email"]);
    expect(shown.stdout).toBe(applied.stdout);
    expect((await cli(["settings", "list"])).stdout).toContain(
      "email  set         smtp, from helpdesk@example.org, server mail.example.org:587, password …7f3a",
    );

    const [entry] = await auditEntries("integration.email");
    expect(entry).toMatchObject({
      actorUserId: null,
      actorEmail: "operator",
      summary: "Set up email over smtp (cli settings apply email)",
    });

    // An omitted password keeps the saved one, as on the page.
    const again = await cli(["settings", "apply", "email"], { ...SMTP, fromName: "IT" });
    expect(again.json()).toMatchObject({ fromName: "IT", smtp: { passwordHint: "…7f3a" } });
  });

  it("refuses what the page refuses, with its message, and saves nothing", async () => {
    const noToken = await cli(["settings", "apply", "email"], {
      provider: "mailersend",
      fromAddress: "helpdesk@example.org",
    });
    expect(noToken).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "Check the highlighted fields\n  mailersend.token: Enter the API token\n",
    });
    const noHost = await cli(["settings", "apply", "email"], { provider: "smtp", fromAddress: "nobody" });
    expect(noHost.code).toBe(1);
    expect(noHost.stderr).toContain("  fromAddress: Enter the sender address\n");
    expect(noHost.stderr).toContain("  smtp.host: Enter the mail server\n");
    const unstorable = await cli(["settings", "apply", "email"], '{"provider":"none","fromName":"a\\u0000"}');
    expect(unstorable).toMatchObject({
      code: 1,
      stderr: "The request contains characters that cannot be stored\n",
    });
    expect(await stored("email")).toBeUndefined();
    expect(await auditEntries("integration.email")).toHaveLength(0);
  });

  it("sends a test email as the page's test button does", async () => {
    expect(await cli(["settings", "test", "email", "--to", "ada@example.org"])).toMatchObject({
      code: 1,
      stderr: "Set up email first\n",
    });
    await cli(["settings", "apply", "email"], {
      provider: "mailersend",
      fromAddress: "helpdesk@example.org",
      mailersend: { token: MAILERSEND_TOKEN },
    });
    const calls = stubFetch({ "http://mailersend.test/v1/email": () => new Response(null, { status: 202 }) });
    const sent = await cli(["settings", "test", "email", "--to", "ada@example.org"]);
    expect(sent).toMatchObject({ code: 0, stderr: "" });
    expect(sent.json()).toMatchObject({ ok: true, message: "Sent a test email to ada@example.org" });
    expect(calls).toEqual([expect.objectContaining({ authorization: `Bearer ${MAILERSEND_TOKEN}` })]);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ to: [{ email: "ada@example.org" }] });

    stubFetch({ "http://mailersend.test/v1/email": () => new Response("{}", { status: 401 }) });
    const failed = await cli(["settings", "test", "email", "--to", "ada@example.org"]);
    expect(failed.code).toBe(1);
    expect(failed.json()).toMatchObject({ ok: false });
    expect(failed.stderr).toBe(`${failed.json().message as string}\n`);

    expect((await cli(["settings", "test", "email"])).code).toBe(2);
    expect(await cli(["settings", "test", "email", "--to", "nobody"])).toMatchObject({
      code: 1,
      stderr: "Check the highlighted fields\n  to: Invalid email address\n",
    });
  });

  it("never prints a token that fetch refuses as a header value", async () => {
    await cli(["settings", "apply", "email"], {
      provider: "mailersend",
      fromAddress: "helpdesk@example.org",
      mailersend: { token: `${HEADER_TOKEN}\nline` },
    });
    // fetch quotes the refused header in its error; nothing is sent.
    expect(await cli(["settings", "test", "email", "--to", "ada@example.org"])).toMatchObject({
      code: 1,
      stderr: "MailerSend: request failed\n",
    });
  });

  // Needs Mailpit (compose.dev.yaml, or the CI service): MAILPIT_SMTP_PORT and MAILPIT_API_URL.
  it.skipIf(!process.env.MAILPIT_API_URL)("sends the test email over SMTP", async () => {
    await cli(["settings", "apply", "email"], {
      provider: "smtp",
      fromAddress: "helpdesk@example.org",
      smtp: { host: "localhost", port: Number(process.env.MAILPIT_SMTP_PORT ?? 1028), security: "none" },
    });
    const to = `cli-${Date.now()}@example.org`;
    const sent = await cli(["settings", "test", "email", "--to", to]);
    expect(sent).toMatchObject({ code: 0, stderr: "" });
    const search = await fetch(
      `${process.env.MAILPIT_API_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    expect(((await search.json()) as { messages_count: number }).messages_count).toBe(1);
  });
});

describe("cli settings … slack", () => {
  it("connects the bot, lists channels, tests and disconnects", async () => {
    const calls = stubSlack();
    const applied = await cli(["settings", "apply", "slack"], {
      botToken: SLACK_TOKEN,
      channelId: "C0HELPDESK1",
    });
    expect(applied).toMatchObject({ code: 0, stderr: "" });
    expect(applied.json()).toEqual({
      configured: true,
      botTokenHint: "…9d2b",
      teamName: "Example",
      botName: "helpdesk",
      channelId: "C0HELPDESK1",
      channelName: "helpdesk",
      missingScopes: [],
    });
    expect(calls[0]).toMatchObject({
      url: "http://slack.test/api/auth.test",
      authorization: `Bearer ${SLACK_TOKEN}`,
    });
    expect(JSON.stringify(await stored("slack"))).toMatch(/"botTokenEncrypted":"v1:/);
    expect((await cli(["settings", "list"])).stdout).toContain(
      "slack  set         token …9d2b, workspace Example, channel #helpdesk\n",
    );
    const [entry] = await auditEntries("integration.slack");
    expect(entry).toMatchObject({
      actorEmail: "operator",
      summary: "Set up Slack with the channel #helpdesk (cli settings apply slack)",
    });

    const channels = await cli(["settings", "show", "slack", "--channels"]);
    expect(channels.json()).toEqual({
      items: [{ id: "C0HELPDESK1", name: "helpdesk", isPrivate: false, isMember: true }],
    });
    expect((await cli(["settings", "show", "email", "--channels"])).code).toBe(2);

    const tested = await cli(["settings", "test", "slack"]);
    expect(tested).toMatchObject({ code: 0, stderr: "" });
    expect(tested.json()).toMatchObject({ ok: true, message: "Posted a test message to the channel" });
    expect(calls.at(-1)).toMatchObject({ url: "http://slack.test/api/chat.postMessage" });

    const off = await cli(["settings", "apply", "slack"], { botToken: null });
    expect(off.json()).toMatchObject({ configured: false, botTokenHint: null, channelId: null });
    expect((await cli(["settings", "list"])).stdout).toContain("slack  not set\n");
  });

  it("refuses a token the page refuses and marks missing scopes", async () => {
    stubSlack("chat:write");
    expect(await cli(["settings", "apply", "slack"], { botToken: "not-a-bot-token" })).toMatchObject({
      code: 1,
      stderr: "Check the highlighted fields\n  botToken: A bot token starts with xoxb-\n",
    });
    expect(await stored("slack")).toBeUndefined();

    await cli(["settings", "apply", "slack"], { botToken: SLACK_TOKEN });
    expect((await cli(["settings", "list"])).stdout).toContain(
      "slack  incomplete  token …9d2b, workspace Example, no channel, missing scopes users:read users:read.email channels:read groups:read\n",
    );
    expect(await cli(["settings", "test", "slack"])).toMatchObject({
      code: 1,
      stderr: "Connect Slack and choose a channel first\n",
    });
  });
});

describe("cli settings … iam", () => {
  it("saves the connection, keeps the key for its address only, and tests it", async () => {
    const applied = await cli(["settings", "apply", "iam"], {
      url: `${IAM}/`,
      apiKey: IAM_KEY,
      mapping: MAPPING,
    });
    expect(applied).toMatchObject({ code: 0, stderr: "" });
    expect(applied.json()).toEqual({ url: IAM, apiKeyHint: "…8e4f", mapping: MAPPING });
    expect(JSON.stringify(await stored("iam"))).toMatch(/"apiKeyEncrypted":"v1:/);
    expect((await cli(["settings", "show", "iam"])).stdout).toBe(applied.stdout);
    expect((await cli(["settings", "list"])).stdout).toContain(
      `iam    set         ${IAM}, API key …8e4f, 3 fields from the form\n`,
    );
    expect((await auditEntries("integration.iam"))[0]).toMatchObject({
      actorEmail: "operator",
      summary: "Set up IAM for identity requests (cli settings apply iam)",
    });

    expect(
      await cli(["settings", "apply", "iam"], {
        url: "https://other.example.org",
        apiKey: "",
        mapping: MAPPING,
      }),
    ).toMatchObject({
      code: 1,
      stderr:
        "Check the highlighted fields\n  apiKey: Enter the API key again: the address of IAM changed.\n",
    });

    const calls = stubFetch({
      [`${IAM}/api/integration/v1/identity-requests/options`]: () =>
        Response.json({ personTypes: [{ value: "intern", label: "Intern" }], teams: [] }),
    });
    const tested = await cli(["settings", "test", "iam"]);
    expect(tested).toMatchObject({ code: 0, stderr: "" });
    expect(tested.json()).toMatchObject({
      ok: true,
      message: "Connected. IAM accepts requests for: Intern.",
    });
    expect(calls[0]!.authorization).toBe(`Bearer ${IAM_KEY}`);

    stubFetch({
      [`${IAM}/api/integration/v1/identity-requests/options`]: () =>
        Response.json({ error: {} }, { status: 401 }),
    });
    expect(await cli(["settings", "test", "iam"])).toMatchObject({
      code: 1,
      stderr: "IAM did not accept the API key. Check it under Integrations.\n",
    });
  });
});

describe("cli usage", () => {
  it("prints help with the commands and setting names", async () => {
    const help = await cli(["help"]);
    expect(help.code).toBe(0);
    for (const text of [
      "cli settings list",
      "cli settings apply <name>",
      "email",
      "slack",
      "iam",
      "deployment.md",
    ]) {
      expect(help.stdout).toContain(text);
    }
    expect(await cli([])).toMatchObject({ code: 2, stdout: "", stderr: help.stdout });
  });

  it("answers 2 for wrong commands and never repeats what was typed", async () => {
    const wrong = [
      ["tokens", "create", "x"],
      ["settings", "rename", "email"],
      ["settings", "show"],
      ["settings", "show", "smtp"],
      ["settings", "show", "email", "--id", "1"],
      ["settings", "remove", "email", "--id", "1"],
      ["settings", "apply", "slack", SLACK_TOKEN],
      ["settings", "apply", "slack", `--token=${SLACK_TOKEN}`],
      ["settings", "apply", "slack", `-${SLACK_TOKEN}`],
      ["settings", "list", "--json=yes"],
      ["help", "settings"],
      ["--help", `--token=${SLACK_TOKEN}`],
    ];
    for (const args of wrong) {
      const result = await cli(args);
      expect({ args, code: result.code, stdout: result.stdout }).toEqual({ args, code: 2, stdout: "" });
      expect(result.stderr).toContain('Run "cli help" for the commands.');
    }
    expect(await cli(["settings", "apply", "email"], "provider=smtp")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("The body on stdin is not JSON."),
    });
    expect(await cli(["settings", "apply", "email"], "")).toMatchObject({ code: 2 });
    expect(await stored("email")).toBeUndefined();
  });
});

describe("the admin page and the command", () => {
  it("run the same code: the page saves as the signed-in superadmin", async () => {
    const superadmin = await createUser("superadmin", { email: "ada@example.org" });
    const saved = await request("PUT", "/api/v1/integrations/email", {
      userId: superadmin.id,
      body: {
        provider: "smtp",
        fromAddress: "helpdesk@example.org",
        smtp: { host: "mail.example.org", password: SMTP_PASSWORD },
      },
    });
    expect(saved.status).toBe(200);
    expect((await cli(["settings", "show", "email"])).json()).toEqual(saved.body);
    expect((await auditEntries("integration.email"))[0]).toMatchObject({
      actorUserId: superadmin.id,
      actorEmail: "ada@example.org",
      summary: "Set up email over smtp",
    });
    const refused = await request("PUT", "/api/v1/integrations/email", {
      userId: superadmin.id,
      body: { provider: "mailersend", fromAddress: "helpdesk@example.org" },
    });
    expect(refused.body.error).toEqual({
      code: "validation_error",
      message: "Check the highlighted fields",
      fields: { "mailersend.token": "Enter the API token" },
    });
  });
});

/** Runs the command in a process of its own, as the image does. `readAfterMs`: a reader that starts late. */
function runProcess(
  args: string[],
  options: { stdin?: string; env?: Record<string, string>; readAfterMs?: number } = {},
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(SERVER_ROOT, "src/cli.ts"), ...args],
      {
        cwd: SERVER_ROOT,
        env: { ...process.env, LOG_LEVEL: "debug", ...options.env },
        timeout: 20_000,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    if (options.readAfterMs) {
      child.stdout.pause();
      setTimeout(() => child.stdout.resume(), options.readAfterMs);
    }
    child.on("error", reject);
    child.on("close", (code) => {
      printed.push(stdout, stderr);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(options.stdin ?? "");
  });
}

describe("the cli process", () => {
  it("reads the body from stdin, keeps stdout for its output, logs to stderr and exits", async () => {
    const applied = await runProcess(["settings", "apply", "slack"], {
      stdin: JSON.stringify({ botToken: null, channelId: null }),
    });
    expect(applied.code).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ configured: false });
    const listed = await runProcess(["settings", "list", "--json"]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toHaveLength(3);
    const refused = await runProcess(["settings", "apply", "email"], { stdin: "{}" });
    expect(refused).toMatchObject({ code: 1, stdout: "" });
    expect(refused.stderr).toContain("provider:");
  });

  it("writes all of a long output to a slow reader before it exits", async () => {
    const channels = Array.from({ length: 2000 }, (_, index) => ({
      id: `C${index}`,
      name: `channel-${index}`,
    }));
    const slack = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, channels }));
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => slack.once("listening", resolve));
    await putSetting(getDb(), "slack", {
      botTokenEncrypted: encryptSecret(SLACK_TOKEN),
      botTokenHint: "…9d2b",
    });
    try {
      const shown = await runProcess(["settings", "show", "slack", "--channels"], {
        env: { SLACK_API_URL: `http://127.0.0.1:${(slack.address() as AddressInfo).port}/api/` },
        readAfterMs: 1000,
      });
      expect(shown.code).toBe(0);
      expect(shown.stdout.length).toBeGreaterThan(200_000);
      expect((JSON.parse(shown.stdout) as { items: unknown[] }).items).toHaveLength(2000);
    } finally {
      slack.close();
    }
  });
});
