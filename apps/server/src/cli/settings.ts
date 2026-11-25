import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { CheckResult } from "@helpdesk/shared/api/common";
import { operator, type Actor } from "../auth/principal";
import { UsageError, type CliIo } from "./io";

export type SettingStatus = {
  state: "set" | "not set" | "incomplete";
  /** What the admin page shows at a glance: addresses, `token …a1b2`. Never a secret. */
  hints: string[];
};

export type OptionValues = Record<string, string | boolean | undefined>;

/**
 * One setting of the admin page for `cli settings`. Each one calls the same
 * functions as the page's routes; it adds no checks of its own.
 */
export type Setting = {
  /** Kebab-case, as on the admin page. */
  name: string;
  /** One line for `cli help`. */
  label: string;
  status(): Promise<SettingStatus>;
  /** What the admin API's read answers: hints, never a secret. */
  show(options: OptionValues): Promise<unknown>;
  /** Options of `show` beyond the standard ones, e.g. Slack's `--channels`. */
  showOptions?: { options: ParseArgsOptionsConfig; usage: string };
  /** Saves the JSON body the admin page sends (the text from stdin); answers what `show` answers. */
  apply(actor: Actor, body: string): Promise<unknown>;
  /** What the page's test button does, where it has one. */
  test?(options: OptionValues): Promise<CheckResult>;
  testOptions?: { options: ParseArgsOptionsConfig; usage: string };
};

const USAGE = "cli settings list|show|apply|test <name>";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The options of a command. Messages never repeat what was typed: it could be a secret. */
function parse(args: string[], options: ParseArgsOptionsConfig, usage: string): OptionValues {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, options, strict: true, allowPositionals: true });
  } catch (error) {
    const known = (error as { code?: unknown }).code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE";
    throw new UsageError(known ? `${(error as Error).message}.` : "Unknown option.", usage);
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError("Too many arguments. A body goes on stdin, never in an argument.", usage);
  }
  return parsed.values as OptionValues;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * `cli settings …`: list, show, apply and test the settings of the admin
 * page, as an operator with a superadmin's rights. Returns the exit code.
 */
export async function settingsCommand(args: string[], io: CliIo, settings: Setting[]): Promise<number> {
  const names = settings.map((setting) => setting.name).join(", ");
  const [command, ...rest] = args;

  if (command === "list") {
    const values = parse(rest, { json: { type: "boolean" } }, "cli settings list [--json]");
    const rows = [];
    for (const setting of settings) rows.push({ name: setting.name, ...(await setting.status()) });
    if (values.json) {
      io.out(json(rows));
    } else {
      const width = Math.max(...rows.map((row) => row.name.length));
      for (const row of rows) {
        io.out(
          `${row.name.padEnd(width)}  ${row.state.padEnd(10)}  ${row.hints.join(", ")}`.trimEnd() + "\n",
        );
      }
    }
    return 0;
  }

  if (command !== "show" && command !== "apply" && command !== "remove" && command !== "test") {
    throw new UsageError("Unknown command.", USAGE);
  }
  const [name, ...optionArgs] = rest;
  const usage = `cli settings ${command} <name>`;
  if (!name || name.startsWith("-")) throw new UsageError(`Name the setting: ${names}.`, usage);
  const setting = settings.find((candidate) => candidate.name === name);
  if (!setting) throw new UsageError(`Unknown setting. The settings are ${names}.`, usage);
  // Every setting of the helpdesk is a single one; none is a list of entries.
  const single = (values: OptionValues) => {
    if (values.id !== undefined) throw new UsageError(`${setting.name} is a single setting: leave out --id.`);
  };
  const id = { id: { type: "string" } } as const;

  switch (command) {
    case "show": {
      const extra = setting.showOptions;
      const values = parse(optionArgs, { ...id, ...extra?.options }, extra?.usage ?? usage);
      single(values);
      io.out(json(await setting.show(values)));
      return 0;
    }
    case "apply": {
      single(parse(optionArgs, id, usage));
      const body = await io.readStdin();
      if (!isJson(body)) throw new UsageError("The body on stdin is not JSON.", `${usage} < body.json`);
      io.out(json(await setting.apply(operator(`cli settings apply ${setting.name}`), body)));
      return 0;
    }
    case "remove":
      throw new UsageError(`${setting.name} is a single setting, not a list: apply a body to change it.`);
    case "test": {
      if (!setting.test) throw new UsageError(`${setting.name} has no test.`);
      const extra = setting.testOptions;
      const values = parse(optionArgs, { ...id, ...extra?.options }, extra?.usage ?? usage);
      single(values);
      const result = await setting.test(values);
      io.out(json(result));
      if (result.ok) return 0;
      io.err(`${result.message}\n`);
      return 1;
    }
  }
}
