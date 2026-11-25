import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { appRoute, requireRole } from "@/routes/app";
import { IntegrationsPage } from "./integrations-page";

const integrationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/integrations",
  beforeLoad: requireRole("superadmin"),
  component: IntegrationsPage,
});

export const routes: AnyRoute[] = [integrationsRoute];
