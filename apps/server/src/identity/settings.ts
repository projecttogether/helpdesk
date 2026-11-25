import type { z } from "zod";
import type { CheckResult } from "@helpdesk/shared/api/common";
import type { IamSettings, iamSettingsInputSchema } from "@helpdesk/shared/api/identity";
import type { Actor } from "../auth/principal";
import { audit } from "../core/audit";
import { encryptSecret, secretHint } from "../core/crypto";
import { getStoredIam, putSetting, type StoredIam } from "../core/settings";
import { getDb } from "../db/client";
import { validationError } from "../http/errors";
import { iamClient, iamConfigured, IamError } from "./iam";

/*
 * The connection to IAM: what superadmins set under Integrations,
 * and what `cli settings … iam` sets. Both run these functions.
 */

const origin = (url: string) => (URL.canParse(url) ? new URL(url).origin : url);

export function iamView(stored: StoredIam): IamSettings {
  return { url: stored.url, apiKeyHint: stored.apiKeyHint, mapping: stored.mapping };
}

export async function readIam(): Promise<IamSettings> {
  return iamView(await getStoredIam(getDb()));
}

/** Saves the connection. An empty key keeps the stored one (for the same address); null removes it. */
export async function saveIam(
  actor: Actor,
  input: z.infer<typeof iamSettingsInputSchema>,
): Promise<IamSettings> {
  const stored = await getDb().transaction(async (tx) => {
    const current = await getStoredIam(tx);
    // The stored key goes only to the address it was entered for.
    if (input.apiKey === "" && current.apiKeyEncrypted && origin(current.url) !== origin(input.url)) {
      throw validationError({ apiKey: "Enter the API key again: the address of IAM changed." });
    }
    const next: StoredIam = {
      url: input.url.replace(/\/+$/, ""),
      apiKeyEncrypted:
        input.apiKey === null ? null : input.apiKey ? encryptSecret(input.apiKey) : current.apiKeyEncrypted,
      apiKeyHint: input.apiKey === null ? null : input.apiKey ? secretHint(input.apiKey) : current.apiKeyHint,
      mapping: input.mapping,
    };
    await putSetting(tx, "iam", next);
    await audit(tx, actor, {
      action: "integration.iam",
      entityType: "integration",
      entityId: "iam",
      summary: iamConfigured(next) ? "Set up IAM for identity requests" : "Turned identity requests off",
    });
    return next;
  });
  return iamView(stored);
}

/** Checks the saved connection: IAM answers with the person types it accepts. */
export async function testIam(): Promise<CheckResult> {
  const started = Date.now();
  try {
    const options = await iamClient(await getStoredIam(getDb())).options();
    return {
      ok: true,
      message:
        options.personTypes.length === 0
          ? "Connected. IAM accepts no identity requests yet: choose person types in IAM's Admin › Settings."
          : `Connected. IAM accepts requests for: ${options.personTypes.map((type) => type.label).join(", ")}.`,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (!(error instanceof IamError)) throw error;
    return { ok: false, message: error.message, latencyMs: Date.now() - started };
  }
}
