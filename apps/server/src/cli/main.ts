import pg from "pg";
import { ConfigError } from "../config";
import { AppError } from "../http/errors";
import { isFailedQuery } from "../logger";
import { email } from "./email";
import { iam } from "./iam";
import { UsageError, type CliIo } from "./io";
import { settingsCommand, type Setting } from "./settings";
import { slack } from "./slack";

/** The settings of Admin › Integrations, in the page's order. */
export const SETTINGS: Setting[] = [email, slack, iam];

const DOCS =
  "https://github.com/projecttogether/helpdesk/blob/main/docs/deployment.md#settings-from-the-command-line";

function help(): string {
  const width = Math.max(...SETTINGS.map((setting) => setting.name.length));
  return `Helpdesk: the operator command. On a server with compose.yaml:
  docker compose run --rm -T migrate cli <command>
In a terminal of the app's container: cli <command>

Commands:
  cli settings list [--json]              every setting: set, not set or incomplete, with hints
  cli settings show <name>                the setting as JSON, as the admin page reads it
  cli settings show slack --channels      the channels the Slack bot can see
  cli settings apply <name> < body.json   save the admin page's JSON body from stdin
  cli settings test <name>                what the page's test button does
  cli settings test email --to <address>  send a test email
  cli help                                this text

Settings (Admin › Integrations):
${SETTINGS.map((setting) => `  ${setting.name.padEnd(width)}  ${setting.label}`).join("\n")}

Secrets go only on stdin, never in an argument; output shows hints only.
Exit codes: 0 done, 1 refused (the page's message on stderr), 2 wrong command
or a body that is not JSON. Example bodies: ${DOCS}
`;
}

/**
 * What went wrong, for stderr. A database error or an unexpected one gets the
 * page's generic message, with its code at most: its text can quote values,
 * and a failed query carries its parameters.
 */
function report(error: unknown, io: CliIo): number {
  if (error instanceof UsageError) {
    io.err(
      `${error.message}\n${error.usage ? `Usage: ${error.usage}\n` : ""}Run "cli help" for the commands.\n`,
    );
    return 2;
  }
  if (error instanceof AppError) {
    io.err(`${error.message}\n`);
    for (const [field, message] of Object.entries(error.fields ?? {})) io.err(`  ${field}: ${message}\n`);
    return 1;
  }
  if (isFailedQuery(error) || error instanceof pg.DatabaseError) {
    const code = ((isFailedQuery(error) ? error.cause : error) as { code?: unknown } | undefined)?.code;
    io.err(
      `Something went wrong. Try again.${typeof code === "string" ? ` (database error ${code})` : ""}\n`,
    );
    return 1;
  }
  if (error instanceof ConfigError) {
    io.err(`${error.message}\n`);
    return 1;
  }
  // Its text could quote anything, such as a header with a token; a code such as ECONNREFUSED stays.
  const code = (error as { code?: unknown } | null)?.code;
  io.err(
    `Something went wrong. Try again.${typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? ` (${code})` : ""}\n`,
  );
  return 1;
}

/** Runs `cli <args>` and returns the exit code. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  try {
    const [command, ...rest] = args;
    switch (command) {
      case "help":
      case "--help":
      case "-h":
        if (rest.length > 0) throw new UsageError("help takes no arguments.");
        io.out(help());
        return 0;
      case "settings":
        return await settingsCommand(rest, io, SETTINGS);
      case undefined:
        io.err(help());
        return 2;
      default:
        throw new UsageError("Unknown command.");
    }
  } catch (error) {
    return report(error, io);
  }
}
