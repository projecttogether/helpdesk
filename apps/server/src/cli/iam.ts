import { iamSettingsInputSchema } from "@helpdesk/shared/api/identity";
import { getStoredIam } from "../core/settings";
import { getDb } from "../db/client";
import { parseJsonBody } from "../http/json";
import { iamConfigured } from "../identity/iam";
import { readIam, saveIam, testIam } from "../identity/settings";
import type { Setting } from "./settings";

/** `iam`: Admin › Integrations › IAM (PUT /api/v1/integrations/iam). */
export const iam: Setting = {
  name: "iam",
  label: "IAM: its address and API key, for identity requests",
  async status() {
    const stored = await getStoredIam(getDb());
    const hints = [];
    if (stored.url) hints.push(stored.url);
    if (stored.apiKeyHint) hints.push(`API key ${stored.apiKeyHint}`);
    const mapped = Object.values(stored.mapping).filter(Boolean).length;
    if (mapped) hints.push(`${mapped} ${mapped === 1 ? "field" : "fields"} from the form`);
    if (iamConfigured(stored)) return { state: "set", hints };
    return { state: stored.url || stored.apiKeyEncrypted ? "incomplete" : "not set", hints };
  },
  show: () => readIam(),
  apply: (actor, body) => saveIam(actor, parseJsonBody(body, iamSettingsInputSchema)),
  test: () => testIam(),
};
