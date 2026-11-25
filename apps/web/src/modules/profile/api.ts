import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Me, MeUpdate } from "@helpdesk/shared/api/users";
import { api } from "@/lib/api";
import { meQuery } from "@/hooks/use-me";

/** Changes the signed-in person's own settings (how they hear about tickets). */
export function useUpdateMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: MeUpdate) => api.patch<Me>("/me", input),
    onSuccess: (me) => client.setQueryData(meQuery.queryKey, me),
  });
}
