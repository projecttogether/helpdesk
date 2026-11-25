import type { Role } from "@helpdesk/shared/roles";
import type { Status, Urgency } from "@helpdesk/shared/tickets";
import { defineMessages, useT } from "@/i18n";

/** Words for the app's fixed values: statuses, urgencies, roles. */
export const labelMessages = defineMessages({
  en: {
    new: "New",
    in_progress: "In progress",
    waiting_for_requester: "Waiting for requester",
    waiting_for_others: "Waiting for others",
    done: "Done",
    cancelled: "Canceled",
    low: "Low",
    normal: "Normal",
    urgent: "Urgent",
    very_urgent: "Very urgent",
    requester: "Requester",
    operator: "Operator",
    admin: "Admin",
    superadmin: "Superadmin",
    noRole: "No access",
  },
});

export function useStatusLabel() {
  const t = useT(labelMessages);
  return (status: Status) => t(status);
}

export function useUrgencyLabel() {
  const t = useT(labelMessages);
  return (urgency: Urgency) => t(urgency);
}

export function useRoleLabel() {
  const t = useT(labelMessages);
  return (role: Role | null) => (role ? t(role) : t("noRole"));
}
