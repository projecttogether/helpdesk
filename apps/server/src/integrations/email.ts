import type { z } from "zod";
import type { CheckResult } from "@helpdesk/shared/api/common";
import type { EmailSettings, emailSettingsInputSchema } from "@helpdesk/shared/api/integrations";
import type { Actor } from "../auth/principal";
import { config } from "../config";
import { audit } from "../core/audit";
import { encryptSecret, secretHint } from "../core/crypto";
import { getStoredEmail, putSetting, type StoredEmail } from "../core/settings";
import { getDb } from "../db/client";
import { conflict, validationError } from "../http/errors";
import { testEmail } from "../notifications/templates";
import { DeliveryError, emailTransportFor } from "../notifications/transports";

/*
 * Email (SMTP or MailerSend): what superadmins set under Integrations, and
 * what `cli settings … email` sets. Both run these functions.
 */

export function emailView(stored: StoredEmail): EmailSettings {
  return {
    provider: stored.provider,
    fromAddress: stored.fromAddress,
    fromName: stored.fromName,
    smtp: {
      host: stored.smtp.host,
      port: stored.smtp.port,
      security: stored.smtp.security,
      username: stored.smtp.username,
      passwordHint: stored.smtp.passwordHint,
    },
    mailersend: { tokenHint: stored.mailersend.tokenHint },
  };
}

export async function readEmail(): Promise<EmailSettings> {
  return emailView(await getStoredEmail(getDb()));
}

/** Saves the settings. An empty password or token keeps the stored one. */
export async function saveEmail(
  actor: Actor,
  input: z.infer<typeof emailSettingsInputSchema>,
): Promise<EmailSettings> {
  const stored = await getDb().transaction(async (tx) => {
    const current = await getStoredEmail(tx);
    if (input.provider === "mailersend" && !input.mailersend.token && !current.mailersend.tokenEncrypted) {
      throw validationError({ "mailersend.token": "Enter the API token" });
    }
    const next: StoredEmail = {
      provider: input.provider,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      smtp: {
        host: input.smtp.host,
        port: input.smtp.port,
        security: input.smtp.security,
        username: input.smtp.username,
        passwordEncrypted: input.smtp.password
          ? encryptSecret(input.smtp.password)
          : current.smtp.passwordEncrypted,
        passwordHint: input.smtp.password ? secretHint(input.smtp.password) : current.smtp.passwordHint,
      },
      mailersend: {
        tokenEncrypted: input.mailersend.token
          ? encryptSecret(input.mailersend.token)
          : current.mailersend.tokenEncrypted,
        tokenHint: input.mailersend.token ? secretHint(input.mailersend.token) : current.mailersend.tokenHint,
      },
    };
    await putSetting(tx, "email", next);
    await audit(tx, actor, {
      action: "integration.email",
      entityType: "integration",
      entityId: "email",
      summary: input.provider === "none" ? "Turned email off" : `Set up email over ${input.provider}`,
    });
    return next;
  });
  return emailView(stored);
}

/** Sends a test email to `to` with the saved settings. */
export async function sendTestEmail(to: string): Promise<CheckResult> {
  const transport = emailTransportFor(await getStoredEmail(getDb()));
  if (!transport) throw conflict("Set up email first");
  const started = Date.now();
  try {
    await transport.send({ to, ...testEmail(config().APP_NAME, config().APP_URL) });
    return { ok: true, message: `Sent a test email to ${to}`, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof DeliveryError ? error.message : "Sending failed",
      latencyMs: Date.now() - started,
    };
  }
}
