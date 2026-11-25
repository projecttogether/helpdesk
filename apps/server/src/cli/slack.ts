import { REQUIRED_SLACK_SCOPES, slackSettingsInputSchema } from "@helpdesk/shared/api/integrations";
import { getStoredSlack } from "../core/settings";
import { getDb } from "../db/client";
import { parseJsonBody } from "../http/json";
import { listSlackChannels, postSlackTest, readSlack, saveSlack } from "../integrations/slack";
import type { Setting } from "./settings";

/** `slack`: Admin › Integrations › Slack (PUT /api/v1/integrations/slack). */
export const slack: Setting = {
  name: "slack",
  label: "Slack: the bot token, and the channel for new tickets",
  async status() {
    const stored = await getStoredSlack(getDb());
    if (!stored.botTokenEncrypted) return { state: "not set", hints: [] };
    const hints = [`token ${stored.botTokenHint ?? "…"}`];
    if (stored.teamName) hints.push(`workspace ${stored.teamName}`);
    hints.push(stored.channelId ? `channel #${stored.channelName ?? stored.channelId}` : "no channel");
    if (stored.missingScopes.length) hints.push(`missing scopes ${stored.missingScopes.join(" ")}`);
    const lacksRequired = stored.missingScopes.some((scope) =>
      (REQUIRED_SLACK_SCOPES as readonly string[]).includes(scope),
    );
    return { state: lacksRequired ? "incomplete" : "set", hints };
  },
  // The channels the bot can see: the body needs a channel ID.
  show: ({ channels }) => (channels ? listSlackChannels() : readSlack()),
  showOptions: { options: { channels: { type: "boolean" } }, usage: "cli settings show slack [--channels]" },
  apply: (actor, body) => saveSlack(actor, parseJsonBody(body, slackSettingsInputSchema)),
  test: () => postSlackTest(),
};
