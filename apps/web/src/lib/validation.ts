import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Path, Resolver, UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { defineMessages, translate } from "@/i18n";
import { ApiError } from "./api";

/**
 * Validation messages. The shared schemas carry their own messages; zod's
 * built-in ones are replaced by plain ones (`issueMessage`).
 */
const generic = defineMessages({
  en: {
    required: "Required",
    tooLong: "At most {max} characters",
    tooFew: "Choose at least {min}",
    tooMany: "At most {max}",
    min: "At least {min}",
    max: "At most {max}",
    url: "Enter a full address, e.g. https://example.org",
    email: "Enter an email address",
    format: "Check the format",
    number: "Enter a number",
    choose: "Choose an option",
    invalid: "Check this value",
  },
});

type Issue = {
  code: string;
  origin?: string;
  format?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  expected?: string;
  input?: unknown;
};

const t = translate(generic, "en");

/** A plain message for zod's built-in checks (custom messages of the schemas win). */
export function issueMessage(issue: Issue): string {
  switch (issue.code) {
    case "too_small":
      if (issue.origin === "string")
        return Number(issue.minimum) <= 1 ? t("required") : t("min", { min: String(issue.minimum) });
      if (issue.origin === "array") return t("tooFew", { min: String(issue.minimum) });
      return t("min", { min: String(issue.minimum) });
    case "too_big":
      if (issue.origin === "string") return t("tooLong", { max: String(issue.maximum) });
      if (issue.origin === "array") return t("tooMany", { max: String(issue.maximum) });
      return t("max", { max: String(issue.maximum) });
    case "invalid_format":
      if (issue.format === "url") return t("url");
      if (issue.format === "email") return t("email");
      return t("format");
    case "invalid_type":
      if (issue.expected === "number") return t("number");
      if (issue.input === null || issue.input === undefined || issue.input === "") return t("required");
      return t("invalid");
    case "invalid_value":
      return t("choose");
    default:
      return t("invalid");
  }
}

/**
 * A react-hook-form resolver for a shared schema, with plain messages.
 * `Values` are the form's values (text fields stay strings; the schema turns
 * blanks into null), `Output` the API input.
 */
export function useSchemaResolver<Values extends FieldValues, Output>(
  schema: z.ZodType<Output, unknown>,
): Resolver<Values, unknown, Output> {
  return useMemo(() => schemaResolver<Values, Output>(schema), [schema]);
}

export function schemaResolver<Values extends FieldValues, Output>(
  schema: z.ZodType<Output, unknown>,
): Resolver<Values, unknown, Output> {
  return zodResolver(schema as never, {
    error: (issue: Issue) => issueMessage(issue),
  }) as unknown as Resolver<Values, unknown, Output>;
}

/** Plain error objects and lists, never the field's element (`ref`). */
function childErrors(error: object): object[] {
  return Object.entries(error)
    .filter(([key, value]) => key !== "ref" && key !== "types" && isPlain(value))
    .map(([, value]) => value as object);
}

function isPlain(value: unknown): value is object {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}

/**
 * Shows the field messages of a failed request next to the fields
 * (`fields` keys are paths such as `config.url`). Returns the messages
 * that match no field, to show elsewhere.
 */
export function applyServerErrors<Values extends FieldValues>(
  form: Pick<UseFormReturn<Values>, "setError" | "getValues">,
  error: unknown,
  aliases: Record<string, Path<Values>> = {},
): string[] {
  if (!(error instanceof ApiError) || !error.fields) return [];
  const unmatched: string[] = [];
  const values = form.getValues() as Record<string, unknown>;
  for (const [key, message] of Object.entries(error.fields)) {
    const path = aliases[key] ?? key;
    const root = path.split(".")[0]!;
    if (root in values) form.setError(path as Path<Values>, { type: "server", message });
    else unmatched.push(message);
  }
  return unmatched;
}

/** The first message of a field error, also of a list field whose items have errors. */
export function firstMessage(error: unknown): string | undefined {
  if (!isPlain(error)) return undefined;
  const value = error as { message?: unknown };
  if (typeof value.message === "string" && value.message) return value.message;
  for (const child of childErrors(error)) {
    const message = firstMessage(child);
    if (message) return message;
  }
  return undefined;
}
