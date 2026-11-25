import type { z } from "zod";
import type { CheckResult } from "@helpdesk/shared/api/common";
import {
  OPTIONAL_SLACK_SCOPES,
  REQUIRED_SLACK_SCOPES,
  type SlackSettings,
  type slackChannelsSchema,
  type slackSettingsInputSchema,
} from "@helpdesk/shared/api/integrations";
import type { Actor } from "../auth/principal";
import { config } from "../config";
import { audit } from "../core/audit";
import { decryptSecret, encryptSecret, secretHint } from "../core/crypto";
import { getStoredSlack, putSetting, type StoredSlack } from "../core/settings";
import { getDb } from "../db/client";
import { conflict, validationError } from "../http/errors";
import { createSlackApi, DeliveryError } from "../notifications/transports";

/*
 * The Slack connection: what superadmins set under Integrations, and what
 * `cli settings … slack` sets. Both run these functions.
 */

export function slackView(stored: StoredSlack): SlackSettings {
  return {
    configured: Boolean(stored.botTokenEncrypted),
    botTokenHint: stored.botTokenHint,
    teamName: stored.teamName,
    botName: stored.botName,
    channelId: stored.channelId,
    channelName: stored.channelName,
    missingScopes: stored.missingScopes,
  };
}

export async function readSlack(): Promise<SlackSettings> {
  return slackView(await getStoredSlack(getDb()));
}

/** auth.test with the scopes Slack reports in its response header. */
async function slackAuthTest(token: string) {
  let response: Response;
  try {
    response = await fetch(new URL("auth.test", config().SLACK_API_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw validationError({ botToken: "Could not reach Slack. Try again." });
  }
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    team?: string;
    user?: string;
  } | null;
  if (!body?.ok) {
    throw validationError({
      botToken: `Slack rejected the token (${body?.error ?? `HTTP ${response.status}`})`,
    });
  }
  const scopes = new Set(
    (response.headers.get("x-oauth-scopes") ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
  return {
    teamName: body.team ?? null,
    botName: body.user ?? null,
    missingScopes: [...REQUIRED_SLACK_SCOPES, ...OPTIONAL_SLACK_SCOPES].filter((scope) => !scopes.has(scope)),
  };
}

async function channelName(token: string, channelId: string): Promise<string | null> {
  try {
    const result = await createSlackApi(token).call("conversations.info", { channel: channelId });
    const channel = result.channel as { name?: string } | undefined;
    return channel?.name ?? null;
  } catch {
    return null;
  }
}

/** Saves the connection. An empty token keeps the stored one; null disconnects Slack. */
export async function saveSlack(
  actor: Actor,
  input: z.infer<typeof slackSettingsInputSchema>,
): Promise<SlackSettings> {
  const current = await getStoredSlack(getDb());
  let next: StoredSlack;
  if (input.botToken === null) {
    next = {
      ...current,
      botTokenEncrypted: null,
      botTokenHint: null,
      teamName: null,
      botName: null,
      missingScopes: [],
    };
  } else if (input.botToken) {
    if (!input.botToken.startsWith("xoxb-"))
      throw validationError({ botToken: "A bot token starts with xoxb-" });
    const check = await slackAuthTest(input.botToken);
    next = {
      ...current,
      ...check,
      botTokenEncrypted: encryptSecret(input.botToken),
      botTokenHint: secretHint(input.botToken),
    };
  } else {
    next = { ...current };
  }
  next.channelId = input.channelId;
  next.channelName =
    input.channelId && next.botTokenEncrypted
      ? ((await channelName(decryptSecret(next.botTokenEncrypted), input.channelId)) ??
        (input.channelId === current.channelId ? current.channelName : null))
      : null;
  await getDb().transaction(async (tx) => {
    await putSetting(tx, "slack", next);
    await audit(tx, actor, {
      action: "integration.slack",
      entityType: "integration",
      entityId: "slack",
      summary: next.botTokenEncrypted
        ? `Set up Slack${next.channelName ? ` with the channel #${next.channelName}` : ""}`
        : "Disconnected Slack",
    });
  });
  return slackView(next);
}

/** Channels the bot can see, for choosing where new tickets are posted. */
export async function listSlackChannels(): Promise<z.infer<typeof slackChannelsSchema>> {
  const stored = await getStoredSlack(getDb());
  if (!stored.botTokenEncrypted) throw conflict("Connect Slack first");
  const api = createSlackApi(decryptSecret(stored.botTokenEncrypted));
  const items: { id: string; name: string; isPrivate: boolean; isMember: boolean }[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 10; page++) {
      const result = await api.call("conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const channels = (result.channels ?? []) as {
        id: string;
        name: string;
        is_private?: boolean;
        is_member?: boolean;
      }[];
      for (const channel of channels) {
        items.push({
          id: channel.id,
          name: channel.name,
          isPrivate: Boolean(channel.is_private),
          isMember: Boolean(channel.is_member),
        });
      }
      cursor = (result.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "";
      if (!cursor) break;
    }
  } catch (error) {
    throw conflict(
      error instanceof DeliveryError && error.code === "missing_scope"
        ? "The bot token lacks channels:read or groups:read. Enter the channel ID instead."
        : "Slack did not list the channels. Enter the channel ID instead.",
      "slack_channels",
    );
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { items };
}

/** Posts a test message to the saved channel. */
export async function postSlackTest(): Promise<CheckResult> {
  const stored = await getStoredSlack(getDb());
  if (!stored.botTokenEncrypted || !stored.channelId)
    throw conflict("Connect Slack and choose a channel first");
  const started = Date.now();
  try {
    await createSlackApi(decryptSecret(stored.botTokenEncrypted)).call("chat.postMessage", {
      channel: stored.channelId,
      text: `:white_check_mark: ${config().APP_NAME} can post to this channel.`,
    });
    return { ok: true, message: "Posted a test message to the channel", latencyMs: Date.now() - started };
  } catch (error) {
    const code = error instanceof DeliveryError ? error.code : undefined;
    return {
      ok: false,
      message:
        code === "not_in_channel" || code === "channel_not_found"
          ? "The bot is not in this channel. Invite it in Slack (/invite @bot), then test again."
          : error instanceof DeliveryError
            ? error.message
            : "Posting failed",
      latencyMs: Date.now() - started,
    };
  }
}
