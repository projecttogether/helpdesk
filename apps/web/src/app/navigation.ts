import type { Role } from "@helpdesk/shared/roles";
import { defineMessages } from "@/i18n";

export const navMessages = defineMessages({
  en: {
    requests: "Requests",
    newRequest: "New request",
    newTicket: "New ticket",
    myRequests: "My requests",
    work: "Tickets",
    board: "Board",
    tickets: "All tickets",
    admin: "Administration",
    form: "Request form",
    people: "People",
    integrations: "Integrations",
    audit: "Audit log",
  },
});

export type NavKey = keyof typeof navMessages.en;
/** `shortcut`: "G then this letter" opens the page (main pages only, each letter once). */
export type NavItem = { key: NavKey; to: string; role?: Role; shortcut?: string };
export type NavGroup = { key: NavKey; items: NavItem[]; role: Role };

/**
 * The sidebar, as text. Each group and item shows from its role up; the
 * server checks access too. The main action ("New request") sits in the
 * page header, not here.
 */
export const NAVIGATION: NavGroup[] = [
  {
    key: "work",
    role: "operator",
    items: [
      { key: "board", to: "/board", shortcut: "b" },
      { key: "tickets", to: "/tickets", shortcut: "t" },
    ],
  },
  {
    key: "requests",
    role: "requester",
    items: [{ key: "myRequests", to: "/requests", shortcut: "r" }],
  },
  {
    key: "admin",
    role: "admin",
    items: [
      { key: "form", to: "/admin/form" },
      { key: "people", to: "/admin/people" },
      { key: "integrations", to: "/admin/integrations", role: "superadmin" },
      { key: "audit", to: "/admin/audit", role: "superadmin" },
    ],
  },
];

export type Crumb = { label: string; href?: string };

/**
 * Where a page sits: the sidebar item it belongs to, then a ticket's number
 * or the new form. Pages outside the sidebar (settings) pass their own.
 */
export function breadcrumbsFor(
  pathname: string,
  items: { label: string; href: string }[],
  labels: { newTicket: string; newRequest: string },
): Crumb[] {
  const item = items
    .filter((candidate) => pathname === candidate.href || pathname.startsWith(`${candidate.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!item) return [];
  if (pathname === item.href) return [{ label: item.label }];
  const parent = { label: item.label, href: item.href };
  const rest = pathname.slice(item.href.length + 1);
  if (rest === "new")
    return [parent, { label: item.href === "/tickets" ? labels.newTicket : labels.newRequest }];
  if (/^\d+$/.test(rest)) return [parent, { label: `#${rest}` }];
  return [parent];
}
