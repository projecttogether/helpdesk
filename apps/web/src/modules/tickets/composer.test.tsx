import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, stubFetch } from "@/test-utils";
import { Composer } from "./composer";

const detail = { number: 12, messages: [], events: [] };

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("Composer", () => {
  it("sends a reply, then clears the draft", async () => {
    const fetch = stubFetch({ status: 201, body: detail });
    const user = userEvent.setup();
    renderWithProviders(<Composer number={12} requesterName="Erin" />);

    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeDisabled();
    const box = screen.getByRole("textbox", { name: "Reply to requester" });
    await user.type(box, "  Printer is fixed.  ");
    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => expect(box).toHaveValue(""));
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/v1/tickets/12/messages");
    expect(JSON.parse(String(init?.body))).toEqual({
      body: "Printer is fixed.",
      visibility: "public",
      attachmentIds: [],
    });
  });

  it("writes internal notes from the second tab", async () => {
    const fetch = stubFetch({ status: 201, body: detail });
    const user = userEvent.setup();
    renderWithProviders(<Composer number={12} requesterName="Erin" />);

    await user.click(screen.getByRole("tab", { name: "Internal note" }));
    await user.type(screen.getByRole("textbox", { name: "Internal note" }), "Called the vendor");
    await user.click(screen.getByRole("button", { name: /add note/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({ visibility: "internal" });
  });

  it("keeps the draft for the next visit and when sending fails", async () => {
    stubFetch({ status: 500, body: { error: { code: "internal_error", message: "Down" } } });
    const user = userEvent.setup();
    const first = renderWithProviders(<Composer number={7} requesterName={null} />);
    await user.type(screen.getByRole("textbox"), "Half a reply");
    await user.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /send/i })).toBeEnabled());
    expect(screen.getByRole("textbox")).toHaveValue("Half a reply");
    first.unmount();

    renderWithProviders(<Composer number={7} requesterName={null} />);
    expect(screen.getByRole("textbox")).toHaveValue("Half a reply");
  });
});
