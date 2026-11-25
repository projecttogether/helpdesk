import { z } from "zod";
import { STATUSES, urgencySchema } from "@helpdesk/shared/tickets";

const optionalText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => value || undefined)
  .catch(undefined);

/** Filters of the board and the list, kept in the address (?q=…&categoryId=…). */
export const filterSearchSchema = z.object({
  q: optionalText,
  categoryId: z.uuid().optional().catch(undefined),
  assignee: z
    .union([z.enum(["me", "none"]), z.uuid()])
    .optional()
    .catch(undefined),
  urgency: urgencySchema.optional().catch(undefined),
});
export type TicketFilters = z.infer<typeof filterSearchSchema>;

export const STATUS_FILTERS = ["open", "closed", "all", ...STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SORTS = ["updated", "created", "number", "urgency"] as const;
export type Sort = (typeof SORTS)[number];

/** The list's address: the filters, plus status, sort and page. */
export const listSearchSchema = filterSearchSchema.extend({
  status: z.enum(STATUS_FILTERS).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
});
export type ListSearch = z.infer<typeof listSearchSchema>;

/** True when any filter narrows the tickets. */
export const hasFilters = (filters: TicketFilters) =>
  Boolean(filters.q || filters.categoryId || filters.assignee || filters.urgency);

/** Only the filters (drops other search params, e.g. the list's page). */
export const pickFilters = (search: TicketFilters): TicketFilters => ({
  q: search.q,
  categoryId: search.categoryId,
  assignee: search.assignee,
  urgency: search.urgency,
});
