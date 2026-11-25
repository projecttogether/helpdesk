import type { Form } from "@helpdesk/shared/api/form";
import type { RequestDetail, RequestSummary } from "@helpdesk/shared/api/tickets";
import { api } from "@/lib/api";

export const formQuery = {
  queryKey: ["form"] as const,
  queryFn: () => api.get<Form>("/form"),
  staleTime: 60_000,
};

export const requestsQuery = (status: "open" | "closed" | "all", page: number) => ({
  queryKey: ["requests", status, page] as const,
  queryFn: () =>
    api.get<{ items: RequestSummary[]; total: number }>("/requests", {
      status,
      limit: 25,
      offset: (page - 1) * 25,
    }),
});

export const requestQuery = (number: number) => ({
  queryKey: ["request", number] as const,
  queryFn: () => api.get<RequestDetail>(`/requests/${number}`),
  refetchInterval: 60_000,
});
