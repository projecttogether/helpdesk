import { Hono } from "hono";
import {
  boardQuerySchema,
  messageCreateSchema,
  staffTicketCreateSchema,
  ticketListQuerySchema,
  ticketMoveSchema,
  ticketPatchSchema,
} from "@helpdesk/shared/api/tickets";
import { getDb } from "../db/client";
import type { AppEnv } from "../http/env";
import { notFound } from "../http/errors";
import { jsonBody, numberParam, queryOf, requireStaff } from "../http/middleware";
import { listTickets, loadBoard, loadTicketDetail } from "../tickets/queries";
import { addStaffMessage, createByStaff, moveTicket, updateTicket } from "../tickets/service";

/** Staff work on tickets: the board, the list, a ticket's page. */
const router = new Hono<AppEnv>();

router.get("/board", async (c) => {
  const viewer = requireStaff(c);
  return c.json(await loadBoard(getDb(), queryOf(c, boardQuerySchema), viewer));
});

router.get("/tickets", async (c) => {
  const viewer = requireStaff(c);
  return c.json(await listTickets(getDb(), queryOf(c, ticketListQuerySchema), viewer));
});

router.post("/tickets", async (c) => {
  const actor = requireStaff(c);
  const input = await jsonBody(c, staffTicketCreateSchema);
  return c.json(await createByStaff(actor, input), 201);
});

async function detail(number: number) {
  const ticket = await loadTicketDetail(getDb(), number);
  if (!ticket) throw notFound("Ticket not found");
  return ticket;
}

router.get("/tickets/:number", async (c) => {
  requireStaff(c);
  return c.json(await detail(numberParam(c)));
});

router.patch("/tickets/:number", async (c) => {
  const actor = requireStaff(c);
  const number = numberParam(c);
  await updateTicket(actor, number, await jsonBody(c, ticketPatchSchema));
  return c.json(await detail(number));
});

router.post("/tickets/:number/move", async (c) => {
  const actor = requireStaff(c);
  const revision = await moveTicket(actor, numberParam(c), await jsonBody(c, ticketMoveSchema));
  return c.json({ revision });
});

router.post("/tickets/:number/messages", async (c) => {
  const actor = requireStaff(c);
  const number = numberParam(c);
  await addStaffMessage(actor, number, await jsonBody(c, messageCreateSchema));
  return c.json(await detail(number), 201);
});

export default router;
