import { Hono } from "hono";
import {
  messageCreateSchema,
  requestCreateSchema,
  requestListQuerySchema,
} from "@helpdesk/shared/api/tickets";
import { getDb } from "../db/client";
import type { AppEnv } from "../http/env";
import { notFound } from "../http/errors";
import { jsonBody, numberParam, queryOf, requireUser } from "../http/middleware";
import { listRequests, loadRequestDetail } from "../tickets/queries";
import { addRequesterMessage, createFromForm } from "../tickets/service";

/** Everyone with access: send the form, follow and answer their own requests. */
const router = new Hono<AppEnv>();

router.post("/requests", async (c) => {
  const actor = requireUser(c);
  return c.json(await createFromForm(actor, await jsonBody(c, requestCreateSchema)), 201);
});

router.get("/requests", async (c) => {
  const actor = requireUser(c);
  return c.json(await listRequests(getDb(), actor.id, queryOf(c, requestListQuerySchema)));
});

async function detail(requesterId: string, number: number) {
  const request = await loadRequestDetail(getDb(), requesterId, number);
  if (!request) throw notFound("Request not found");
  return request;
}

router.get("/requests/:number", async (c) => {
  const actor = requireUser(c);
  return c.json(await detail(actor.id, numberParam(c)));
});

router.post("/requests/:number/messages", async (c) => {
  const actor = requireUser(c);
  const number = numberParam(c);
  await addRequesterMessage(actor, number, await jsonBody(c, messageCreateSchema));
  return c.json(await detail(actor.id, number), 201);
});

export default router;
