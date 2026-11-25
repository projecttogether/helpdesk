import { createRoute, notFound, type AnyRoute } from "@tanstack/react-router";
import { z } from "zod";
import { appRoute } from "@/routes/app";
import { NewRequestPage } from "./new-request-page";
import { RequestPage } from "./request-page";
import { RequestsPage } from "./requests-page";

const newRequestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/requests/new",
  component: NewRequestPage,
});

const requestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/requests",
  validateSearch: z.object({
    status: z.enum(["open", "closed", "all"]).optional().catch(undefined),
    page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined),
  }),
  component: function RequestsRoute() {
    const search = requestsRoute.useSearch();
    const navigate = requestsRoute.useNavigate();
    return (
      <RequestsPage
        status={search.status ?? "all"}
        page={search.page ?? 1}
        onChange={(next) => {
          const status = next.status ?? search.status;
          const page = next.page ?? search.page;
          void navigate({
            search: {
              status: status === "all" ? undefined : status,
              page: page && page > 1 ? page : undefined,
            },
          });
        }}
      />
    );
  },
});

const requestRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/requests/$number",
  beforeLoad: ({ params }) => {
    if (!/^[1-9]\d{0,9}$/.test(params.number)) throw notFound();
  },
  component: function RequestRoute() {
    const { number } = requestRoute.useParams();
    return <RequestPage key={number} number={Number(number)} />;
  },
});

export const routes: AnyRoute[] = [newRequestRoute, requestsRoute, requestRoute];
