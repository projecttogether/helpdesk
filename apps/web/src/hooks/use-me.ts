import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { Me } from "@helpdesk/shared/api/users";
import { hasRole, type Role } from "@helpdesk/shared/roles";
import { api } from "@/lib/api";

export const meQuery = { queryKey: ["me"] as const, queryFn: () => api.get<Me>("/me"), staleTime: 60_000 };

/** The signed-in person. Only use inside the signed-in app (its route loads it first). */
export function useMe(): Me {
  return useSuspenseQuery(meQuery).data;
}

/** The signed-in person, or undefined while loading or signed out. */
export function useMaybeMe(): Me | undefined {
  return useQuery({ ...meQuery, retry: false }).data;
}

/** True from this role up. Roles only hide affordances; the server checks access. */
export function useHasRole(role: Role): boolean {
  return hasRole(useMe().role, role);
}
