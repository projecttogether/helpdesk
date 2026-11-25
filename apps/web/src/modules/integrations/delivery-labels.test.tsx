import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test-utils";
import {
  DELIVERY_KINDS,
  useDeliveryChannelLabel,
  useDeliveryKindLabel,
  useDeliveryStatusLabel,
} from "./delivery-labels";

function Labels({ kinds }: { kinds: string[] }) {
  const kind = useDeliveryKindLabel();
  const channel = useDeliveryChannelLabel();
  const status = useDeliveryStatusLabel();
  return (
    <ul>
      {kinds.map((value) => (
        <li key={value}>{kind(value)}</li>
      ))}
      <li>{channel("slack_dm")}</li>
      <li>{status("skipped")}</li>
    </ul>
  );
}

describe("delivery labels", () => {
  it("names every kind the server sends in plain words", () => {
    renderWithProviders(<Labels kinds={[...DELIVERY_KINDS]} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Request received",
      "New ticket",
      "Ticket assigned",
      "Answer to the requester",
      "Request done",
      "Reply from the requester",
      "Slack direct message",
      "Skipped",
    ]);
  });

  it("shows unknown kinds as they are", () => {
    renderWithProviders(<Labels kinds={["ticket_assigned", "something_new"]} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Ticket assigned",
      "something_new",
      "Slack direct message",
      "Skipped",
    ]);
  });
});
