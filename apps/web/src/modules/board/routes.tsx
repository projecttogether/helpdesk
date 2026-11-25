import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { appRoute, requireRole } from "@/routes/app";
import { filterSearchSchema, type TicketFilters } from "@/modules/tickets/filters";
import { BoardPage } from "./board-page";

const boardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/board",
  beforeLoad: requireRole("operator"),
  validateSearch: filterSearchSchema,
  component: function BoardRoute() {
    const filters = boardRoute.useSearch();
    const navigate = boardRoute.useNavigate();
    return (
      <BoardPage
        filters={filters}
        onFilters={(patch) =>
          void navigate({ search: (previous: TicketFilters) => ({ ...previous, ...patch }), replace: true })
        }
      />
    );
  },
});

export const routes: AnyRoute[] = [boardRoute];
