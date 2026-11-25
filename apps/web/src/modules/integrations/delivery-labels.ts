import type { Delivery } from "@helpdesk/shared/api/integrations";
import { useT } from "@/i18n";
import { messages } from "./messages";

/** What the server sends (`notifications.kind`). Unknown kinds show as they are. */
export const DELIVERY_KINDS = [
  "ticket_received",
  "ticket_created",
  "ticket_assigned",
  "staff_reply",
  "ticket_done",
  "requester_reply",
] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export function isDeliveryKind(kind: string): kind is DeliveryKind {
  return (DELIVERY_KINDS as readonly string[]).includes(kind);
}

/** Plain words for a delivery's kind, e.g. `ticket_assigned` → "Ticket assigned". */
export function useDeliveryKindLabel() {
  const t = useT(messages);
  return (kind: string) => (isDeliveryKind(kind) ? t(`kind_${kind}`) : kind);
}

export function useDeliveryChannelLabel() {
  const t = useT(messages);
  return (channel: Delivery["channel"]) => t(`channel_${channel}`);
}

export function useDeliveryStatusLabel() {
  const t = useT(messages);
  return (status: Delivery["status"]) => t(`status_${status}`);
}
