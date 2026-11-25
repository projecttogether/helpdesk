import { defineMessages } from "@/i18n";

export const messages = defineMessages({
  en: {
    title: "Audit log",
    description:
      "Who changed the request form, categories, email, Slack and updates, and every directory sync. Entries never contain secrets.",
    empty: "No entries yet",
    emptyHint: "Changes appear here as they happen.",
    colWhen: "When",
    colWho: "Who",
    colWhat: "What",
    system: "System",
  },
});
