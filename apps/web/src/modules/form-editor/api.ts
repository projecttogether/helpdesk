import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Category, CategoryInput, Form, FormUpdate } from "@helpdesk/shared/api/form";
import { api } from "@/lib/api";
import { categoriesQuery as staffCategoriesQuery } from "@/modules/tickets/api";

export const formQuery = { queryKey: ["form"] as const, queryFn: () => api.get<Form>("/form") };

type CategoryList = { items: Category[] };
export const categoriesQuery = {
  queryKey: ["categories"] as const,
  queryFn: () => api.get<CategoryList>("/categories"),
};

export function useFormQuery() {
  return useQuery(formQuery);
}

export function useCategories() {
  return useQuery(categoriesQuery);
}

/** Publishes a new version of the form. */
export function usePublishForm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FormUpdate) => api.put<Form>("/form", input),
    onSuccess: (form) => queryClient.setQueryData(formQuery.queryKey, form),
  });
}

/**
 * Category changes reply with the whole list: it replaces this list and the
 * one of the ticket pages; the form's category choices change too.
 */
function useCategoryMutation<Variables>(call: (variables: Variables) => Promise<CategoryList>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: call,
    onSuccess: (list) => {
      queryClient.setQueryData(categoriesQuery.queryKey, list);
      queryClient.setQueryData(staffCategoriesQuery.queryKey, list);
      void queryClient.invalidateQueries({ queryKey: formQuery.queryKey });
    },
  });
}

export function useCreateCategory() {
  return useCategoryMutation((input: CategoryInput) => api.post<CategoryList>("/categories", input));
}

export function useUpdateCategory() {
  return useCategoryMutation(({ id, ...input }: CategoryInput & { id: string }) =>
    api.put<CategoryList>(`/categories/${id}`, input),
  );
}

export function useReorderCategories() {
  return useCategoryMutation((ids: string[]) => api.put<CategoryList>("/categories/order", { ids }));
}

/** The full input of a category, for a PUT with one field changed. */
export function categoryInput(category: Category, patch: Partial<CategoryInput> = {}): CategoryInput {
  return {
    name: category.name,
    isActive: category.isActive,
    defaultAssigneeId: category.defaultAssigneeId,
    ...patch,
  };
}
