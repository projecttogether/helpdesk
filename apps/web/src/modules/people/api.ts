import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CheckResult } from "@helpdesk/shared/api/common";
import type { DirectoryStatus } from "@helpdesk/shared/api/integrations";
import type { User } from "@helpdesk/shared/api/users";
import { api } from "@/lib/api";

export type Access = "with" | "without" | "all";

export const peopleKeys = {
  users: ["users"] as const,
  list: (access: Access, q: string) => ["users", { access, q }] as const,
  directory: ["directory"] as const,
};

/** Admins: everyone the app knows, with their role and where it came from. */
export function useUsers(access: Access, q: string) {
  return useQuery({
    queryKey: peopleKeys.list(access, q),
    queryFn: ({ signal }) => api.get<{ items: User[] }>("/users", { access, q }, signal),
    placeholderData: keepPreviousData,
  });
}

/** Admins: where roles come from, the role groups and the last sync. */
export function useDirectory() {
  return useQuery({
    queryKey: peopleKeys.directory,
    queryFn: ({ signal }) => api.get<DirectoryStatus>("/directory", undefined, signal),
  });
}

/** Superadmins, Keycloak only: can the service account read every role group? */
export function useCheckDirectory() {
  return useMutation({ mutationFn: () => api.post<CheckResult>("/directory/check") });
}

/** Superadmins, Keycloak only: reads the role groups now and updates everyone's role. */
export function useSyncDirectory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CheckResult>("/directory/sync"),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: peopleKeys.users }),
        client.invalidateQueries({ queryKey: peopleKeys.directory }),
        // The person pickers (assignees, requesters) list the synced people too.
        client.invalidateQueries({ queryKey: ["people"] }),
      ]),
  });
}
