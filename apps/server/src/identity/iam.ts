import { z } from "zod";
import { decryptSecret } from "../core/crypto";
import type { StoredIam } from "../core/settings";

/**
 * The API of IAM (https://github.com/projecttogether/iam) for identity requests (IAM's docs/api.md):
 * `<url>/api/integration/v1/identity-requests`, with an API key.
 */

/** Why IAM did not answer as hoped. Messages are shown to staff; they never hold the key. */
export class IamError extends Error {
  constructor(
    readonly kind:
      | "not_configured"
      | "unreachable"
      | "unauthorized"
      | "off"
      | "invalid"
      | "closed"
      | "not_found"
      | "failed",
    message: string,
    /** IAM's messages by field, for `invalid`. */
    readonly fields?: Record<string, string>,
    /** IAM's error code, e.g. `reference_reused`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "IamError";
  }
}

export const iamRequestSchema = z.object({
  id: z.number().int(),
  externalId: z.string(),
  status: z.enum(["open", "approved", "rejected", "cancelled"]),
  reason: z.string().default(""),
  url: z.string().default(""),
  person: z
    .object({ status: z.string(), workEmail: z.string().nullable(), startDate: z.string().nullable() })
    .nullable()
    .default(null),
});
export type IamRequest = z.infer<typeof iamRequestSchema>;

export const iamOptionsSchema = z.object({
  personTypes: z.array(z.object({ value: z.string(), label: z.string() })),
  teams: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type IamOptions = z.infer<typeof iamOptionsSchema>;

/** What the helpdesk sends for a new request. */
export type IamRequestCreate = {
  externalId: string;
  externalUrl: string;
  requestedBy: { name: string; email: string };
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  personType: string;
  teamId: number | null;
  managerEmail: string;
  startDate: string | null;
  endDate: string | null;
  notes: string;
};

const TIMEOUT_MS = 15_000;

export function iamConfigured(stored: StoredIam): boolean {
  return Boolean(stored.url && stored.apiKeyEncrypted);
}

/** A client for the stored connection; `not_configured` when it lacks the address or key. */
export function iamClient(stored: StoredIam) {
  if (!iamConfigured(stored)) throw new IamError("not_configured", "Set up IAM first (Integrations).");
  const base = new URL("api/integration/v1/", stored.url.endsWith("/") ? stored.url : `${stored.url}/`);
  const key = decryptSecret(stored.apiKeyEncrypted!);

  async function call<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, base), {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new IamError("unreachable", "Could not reach IAM. Try again later.");
    }
    const data = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; fields?: Record<string, string> };
    } | null;
    if (response.ok) {
      const parsed = schema.safeParse(data);
      if (!parsed.success)
        throw new IamError("failed", "IAM sent an answer the helpdesk does not understand.");
      return parsed.data;
    }
    const message = typeof data?.error?.message === "string" ? data.error.message.slice(0, 300) : null;
    switch (response.status) {
      case 401:
        throw new IamError("unauthorized", "IAM did not accept the API key. Check it under Integrations.");
      case 403:
        throw new IamError("off", message ?? "IAM accepts no identity requests.");
      case 404:
        throw new IamError("not_found", "IAM does not know this request.");
      case 409:
        throw new IamError(
          "closed",
          message ?? "IAM already decided this request.",
          undefined,
          typeof data?.error?.code === "string" ? data.error.code : undefined,
        );
      case 422:
        throw new IamError("invalid", message ?? "IAM refused the request.", data?.error?.fields);
      default:
        throw new IamError(
          "failed",
          `IAM answered with an error (HTTP ${response.status}). Try again later.`,
        );
    }
  }

  return {
    options: () => call("GET", "identity-requests/options", iamOptionsSchema),
    create: (body: IamRequestCreate) => call("POST", "identity-requests", iamRequestSchema, body),
    get: (id: number) => call("GET", `identity-requests/${id}`, iamRequestSchema),
    cancel: (id: number) => call("POST", `identity-requests/${id}/cancel`, iamRequestSchema),
  };
}
