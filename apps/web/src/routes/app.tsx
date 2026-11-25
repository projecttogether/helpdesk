import { createRoute, notFound, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { hasRole, isStaff, type Role } from "@helpdesk/shared/roles";
import { ApiError } from "@/lib/api";
import { meQuery } from "@/hooks/use-me";
import { AppLayout } from "@/components/layout/app-layout";
import { rootRoute } from "./root";

/**
 * The signed-in application. Every module's routes are children of this
 * route (`getParentRoute: () => appRoute`); it loads the signed-in person
 * first and sends everyone else to the sign-in page.
 */
export const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({ to: "/sign-in", search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AppLayout,
});

/** `beforeLoad` of pages from a role up: others see "not found" (the server enforces access too). */
export function requireRole(role: Role) {
  return async ({ context }: { context: { queryClient: QueryClient } }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!hasRole(me.role, role)) throw notFound();
  };
}

/** The start page: staff work on the board, everyone else sends a request. */
export const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    throw redirect({ to: isStaff(me.role) ? "/board" : "/requests/new", replace: true });
  },
});
