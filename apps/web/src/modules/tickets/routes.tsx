import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { appRoute, requireRole } from "@/routes/app";
import { listSearchSchema, type ListSearch } from "./filters";
import { NewTicketPage } from "./new-ticket-page";
import { TicketPage } from "./ticket-page";
import { TicketsPage } from "./tickets-page";

const listRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tickets",
  beforeLoad: requireRole("operator"),
  validateSearch: listSearchSchema,
  component: function TicketsRoute() {
    const search = listRoute.useSearch();
    const navigate = listRoute.useNavigate();
    return (
      <TicketsPage
        search={search}
        onSearch={(patch) =>
          // Filters replace the history entry; turning pages adds one (back goes to the previous page).
          void navigate({
            search: (previous: ListSearch) => ({ ...previous, ...patch }),
            replace: patch.page === undefined,
          })
        }
      />
    );
  },
});

const newRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tickets/new",
  beforeLoad: requireRole("operator"),
  component: NewTicketPage,
});

const ticketRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/tickets/$number",
  beforeLoad: requireRole("operator"),
  component: function TicketRoute() {
    const { number } = ticketRoute.useParams();
    return <TicketPage number={Number(number)} />;
  },
});

export const routes: AnyRoute[] = [listRoute, newRoute, ticketRoute];
