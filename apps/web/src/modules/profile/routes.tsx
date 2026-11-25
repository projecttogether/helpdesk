import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { appRoute, requireRole } from "@/routes/app";
import { SettingsPage } from "./settings-page";

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  beforeLoad: requireRole("requester"),
  component: SettingsPage,
});

export const routes: AnyRoute[] = [settingsRoute];
