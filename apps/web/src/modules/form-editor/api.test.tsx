import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category } from "@helpdesk/shared/api/form";
import { categoriesQuery as staffCategoriesQuery } from "@/modules/tickets/api";
import { stubFetch } from "@/test-utils";
import { categoryInput, useCategories, useUpdateCategory } from "./api";

const IT: Category = {
  id: "0b5a3e5e-3c1f-4d8e-9f3a-111111111111",
  name: "IT",
  position: 1,
  isActive: true,
  defaultAssigneeId: null,
  defaultAssigneeName: null,
};
const RENAMED: Category = { ...IT, name: "Hardware" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("category changes", () => {
  it("reach the category lists of the ticket pages at once", async () => {
    const fetch = stubFetch({ body: { items: [IT] } }, { body: { items: [RENAMED] } });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    // The board, a ticket or the new-ticket page loaded the list a moment ago.
    client.setQueryData(staffCategoriesQuery.queryKey, { items: [IT] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    // An admin renames the category under Form → Categories.
    const editor = renderHook(() => ({ list: useCategories(), update: useUpdateCategory() }), { wrapper });
    await waitFor(() => expect(editor.result.current.list.data?.items).toEqual([IT]));
    editor.result.current.update.mutate({ id: IT.id, ...categoryInput(IT, { name: RENAMED.name }) });
    await waitFor(() => expect(editor.result.current.update.isSuccess).toBe(true));
    expect(editor.result.current.list.data?.items).toEqual([RENAMED]);

    // Then opens the new-ticket page in the same tab.
    const page = renderHook(() => useQuery(staffCategoriesQuery), { wrapper });
    expect(page.result.current.data?.items).toEqual([RENAMED]);
    expect(fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual([
      "GET /api/v1/categories",
      `PUT /api/v1/categories/${IT.id}`,
    ]);
  });
});
