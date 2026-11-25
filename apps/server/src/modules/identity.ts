import { Hono, type Context } from "hono";
import {
  iamSettingsInputSchema,
  identityRequestInputSchema,
  type IdentityOptions,
} from "@helpdesk/shared/api/identity";
import { idSchema } from "@helpdesk/shared/api/common";
import { getDb } from "../db/client";
import { getStoredIam } from "../core/settings";
import type { AppEnv } from "../http/env";
import { AppError, notFound } from "../http/errors";
import { jsonBody, numberParam, requireStaff, requireSuperadmin } from "../http/middleware";
import { loadTicketDetail } from "../tickets/queries";
import { iamClient, iamConfigured, IamError } from "../identity/iam";
import { readIam, saveIam, testIam } from "../identity/settings";
import { cancelIdentityRequest, resendIdentityRequest, sendIdentityRequest } from "../identity/service";

/**
 * IAM: the connection (superadmins; `cli settings` runs the same
 * functions, identity/settings.ts) and identity requests from tickets (staff).
 */
const router = new Hono<AppEnv>();

router.get("/integrations/iam", async (c) => {
  requireSuperadmin(c);
  return c.json(await readIam());
});

router.put("/integrations/iam", async (c) => {
  const actor = requireSuperadmin(c);
  return c.json(await saveIam(actor, await jsonBody(c, iamSettingsInputSchema)));
});

/** Checks the saved connection: IAM answers with the person types it accepts. */
router.post("/integrations/iam/test", async (c) => {
  requireSuperadmin(c);
  return c.json(await testIam());
});

/** What the request dialog needs. Without a connection: `configured` is false. */
router.get("/identity/options", async (c) => {
  requireStaff(c);
  const stored = await getStoredIam(getDb());
  const empty: IdentityOptions = { configured: false, personTypes: [], teams: [], mapping: stored.mapping };
  if (!iamConfigured(stored)) return c.json(empty);
  try {
    const options = await iamClient(stored).options();
    return c.json({ ...empty, configured: true, ...options } satisfies IdentityOptions);
  } catch (error) {
    if (!(error instanceof IamError)) throw error;
    throw new AppError(502, "iam_unavailable", error.message);
  }
});

async function ticketDetail(number: number) {
  const ticket = await loadTicketDetail(getDb(), number);
  if (!ticket) throw notFound("Ticket not found");
  return ticket;
}

/** 201: IAM has the request. 202: saved, IAM has not confirmed it yet (the worker goes on trying). */
router.post("/tickets/:number/identity-requests", async (c) => {
  const actor = requireStaff(c);
  const number = numberParam(c);
  const outcome = await sendIdentityRequest(actor, number, await jsonBody(c, identityRequestInputSchema));
  return c.json(await ticketDetail(number), outcome === "confirmed" ? 201 : 202);
});

function requestId(c: Context<AppEnv>): string {
  const id = idSchema.safeParse(c.req.param("id"));
  if (!id.success) throw notFound("Request not found");
  return id.data;
}

/** Send again: a request IAM has not confirmed, with its stored details. */
router.post("/tickets/:number/identity-requests/:id/send", async (c) => {
  requireStaff(c);
  const number = numberParam(c);
  const outcome = await resendIdentityRequest(number, requestId(c));
  return c.json(await ticketDetail(number), outcome === "confirmed" ? 200 : 202);
});

router.post("/tickets/:number/identity-requests/:id/cancel", async (c) => {
  const actor = requireStaff(c);
  const number = numberParam(c);
  await cancelIdentityRequest(actor, number, requestId(c));
  return c.json(await ticketDetail(number));
});

export default router;
