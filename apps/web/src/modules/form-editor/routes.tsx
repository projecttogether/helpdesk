import { createRoute, type AnyRoute } from "@tanstack/react-router";
import { z } from "zod";
import { appRoute, requireRole } from "@/routes/app";
import { FormEditorPage } from "./form-editor-page";

const formEditorRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/form",
  beforeLoad: requireRole("admin"),
  validateSearch: z.object({
    tab: z.enum(["questions", "categories"]).optional().catch(undefined),
  }),
  component: function FormEditorRoute() {
    const { tab } = formEditorRoute.useSearch();
    const navigate = formEditorRoute.useNavigate();
    return (
      <FormEditorPage
        tab={tab ?? "questions"}
        onTabChange={(next) =>
          void navigate({ search: { tab: next === "questions" ? undefined : next }, replace: true })
        }
      />
    );
  },
});

export const routes: AnyRoute[] = [formEditorRoute];
