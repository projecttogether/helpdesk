import { describe, expect, it } from "vitest";
import { breadcrumbsFor } from "./navigation";

const items = [
  { label: "Board", href: "/board" },
  { label: "All tickets", href: "/tickets" },
  { label: "My requests", href: "/requests" },
  { label: "Request form", href: "/admin/form" },
];
const labels = { newTicket: "New ticket", newRequest: "New request" };

describe("breadcrumbsFor", () => {
  it("names the sidebar page itself", () => {
    expect(breadcrumbsFor("/tickets", items, labels)).toEqual([{ label: "All tickets" }]);
    expect(breadcrumbsFor("/admin/form", items, labels)).toEqual([{ label: "Request form" }]);
  });

  it("leads back from a ticket or a request by its number", () => {
    expect(breadcrumbsFor("/tickets/42", items, labels)).toEqual([
      { label: "All tickets", href: "/tickets" },
      { label: "#42" },
    ]);
    expect(breadcrumbsFor("/requests/7", items, labels)).toEqual([
      { label: "My requests", href: "/requests" },
      { label: "#7" },
    ]);
  });

  it("names the new forms", () => {
    expect(breadcrumbsFor("/tickets/new", items, labels).at(-1)).toEqual({ label: "New ticket" });
    expect(breadcrumbsFor("/requests/new", items, labels).at(-1)).toEqual({ label: "New request" });
  });

  it("has nothing for pages outside the sidebar", () => {
    expect(breadcrumbsFor("/settings", items, labels)).toEqual([]);
    expect(breadcrumbsFor("/requests-old", items, labels)).toEqual([]);
  });
});
