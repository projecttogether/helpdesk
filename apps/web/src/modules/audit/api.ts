import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { auditListSchema } from "@helpdesk/shared/api/users";
import { api } from "@/lib/api";

export type AuditList = z.infer<typeof auditListSchema>;

/** Superadmins: the newest changes first. */
export function useAudit(limit: number, offset: number) {
  return useQuery({
    queryKey: ["audit", { limit, offset }],
    queryFn: ({ signal }) => api.get<AuditList>("/audit", { limit, offset }, signal),
    placeholderData: keepPreviousData,
  });
}
