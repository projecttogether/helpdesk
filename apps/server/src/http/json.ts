import type { z } from "zod";
import { AppError, badRequest, parseWith } from "./errors";

/** PostgreSQL stores neither NUL characters nor lone surrogates; refuse them instead of failing on the write. */
export function storableText(value: unknown): void {
  if (typeof value === "string" && (value.includes("\u0000") || !value.isWellFormed())) {
    throw badRequest("The request contains characters that cannot be stored");
  }
}

/**
 * A JSON text validated with a shared schema: the body of an API request, or
 * the body that `cli settings apply` reads from stdin.
 */
export function parseJsonBody<T extends z.ZodType>(text: string, schema: T): z.infer<T> {
  let body: unknown;
  try {
    body = JSON.parse(text, (key, value: unknown) => {
      storableText(key);
      storableText(value);
      return value;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw badRequest("The request body must be JSON");
  }
  return parseWith(schema, body);
}
