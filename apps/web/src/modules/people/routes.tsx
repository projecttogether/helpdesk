import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { z } from "zod";
import { appRoute, requireRole } from "@/routes/app";
import { PeoplePage } from "./people-page";

const peopleRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/people",
  beforeLoad: requireRole("admin"),
  validateSearch: z.object({
    access: z.enum(["without", "all"]).optional().catch(undefined),
  }),
  component: function PeopleRoute() {
    const { access } = peopleRoute.useSearch();
    const navigate = peopleRoute.useNavigate();
    return (
      <PeoplePage
        access={access ?? "with"}
        onAccess={(next) =>
          void navigate({ search: { access: next === "with" ? undefined : next }, replace: true })
        }
      />
    );
  },
});

export const routes: AnyRoute[] = [peopleRoute];
