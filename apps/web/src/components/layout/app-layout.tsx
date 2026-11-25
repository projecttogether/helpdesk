import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { hasRole, isStaff } from "@helpdesk/shared/roles";
import type { TicketSummary } from "@helpdesk/shared/api/tickets";
import { AppFrame, type FrameLink, type NavGroup, type SearchResult } from "@/components/ui/app-frame";
import { AppIcon, SidebarOrganization } from "@/components/brand";
import { useMe } from "@/hooks/use-me";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useAuthConfig } from "@/lib/auth-config";
import { queryClient } from "@/lib/query";
import { useT } from "@/i18n";
import { breadcrumbsFor, NAVIGATION, navMessages } from "@/app/navigation";
import { useRoleLabel, useStatusLabel } from "@/lib/labels";
import { messages as settingsMessages } from "@/modules/profile/messages";

const DEFAULT_APP_NAME = "Helpdesk";

/** TanStack Router's link for the frame: every other prop goes on to the <a>. */
// `exact`: otherwise TanStack marks every link the address starts with as the current page
// (breadcrumb parents, the sidebar's sections).
const AppLink: FrameLink = ({ href, ...props }) => (
  <Link to={href} activeOptions={{ exact: true }} {...props} />
);

/** The signed-in application frame: the AppFrame with Helpdesk's navigation. */
export function AppLayout() {
  const me = useMe();
  const t = useT(navMessages);
  const ts = useT(settingsMessages);
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const roleLabel = useRoleLabel();
  const statusLabel = useStatusLabel();
  const { theme, setTheme } = useTheme();
  const appName = useAuthConfig()?.appName || DEFAULT_APP_NAME;
  useEffect(() => {
    document.title = appName;
  }, [appName]);

  const nav: NavGroup[] = NAVIGATION.filter((group) => hasRole(me.role, group.role)).map((group) => ({
    label: t(group.key),
    items: group.items
      .filter((item) => !item.role || hasRole(me.role, item.role))
      .map((item) => ({ label: t(item.key), href: item.to, shortcut: item.shortcut })),
  }));
  const breadcrumbs =
    pathname === "/settings"
      ? [{ label: ts("title") }]
      : breadcrumbsFor(
          pathname,
          nav.flatMap((group) => group.items),
          { newTicket: t("newTicket"), newRequest: t("newRequest") },
        );

  // Staff find tickets by number or text; requesters find the pages.
  const findTickets = async (query: string, signal: AbortSignal): Promise<SearchResult[]> => {
    const { items } = await api.get<{ items: TicketSummary[] }>(
      "/tickets",
      { q: query, status: "all", limit: 8 },
      signal,
    );
    return items.map((ticket) => ({
      href: `/tickets/${ticket.number}`,
      title: ticket.title,
      reference: `#${ticket.number}`,
      kind: statusLabel(ticket.status),
    }));
  };

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    window.location.assign("/sign-in");
  };

  return (
    <AppFrame
      app={{ name: appName, icon: <AppIcon /> }}
      sidebarFooter={<SidebarOrganization />}
      nav={nav}
      pathname={pathname}
      link={AppLink}
      navigate={(href) => void router.navigate({ to: href })}
      user={{ name: me.name || me.email, email: me.email, detail: roleLabel(me.role), image: me.image }}
      theme={theme}
      onThemeChange={setTheme}
      settingsHref="/settings"
      onSignOut={() => void signOut()}
      breadcrumbs={breadcrumbs}
      search={
        isStaff(me.role)
          ? {
              find: findTickets,
              allResultsHref: (q) => `/tickets?${new URLSearchParams({ q, status: "all" })}`,
            }
          : undefined
      }
    >
      <Outlet />
    </AppFrame>
  );
}
