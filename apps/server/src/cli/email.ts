import { emailSettingsInputSchema, emailTestSchema } from "@helpdesk/shared/api/integrations";
import { getStoredEmail } from "../core/settings";
import { getDb } from "../db/client";
import { parseWith } from "../http/errors";
import { parseJsonBody } from "../http/json";
import { readEmail, saveEmail, sendTestEmail } from "../integrations/email";
import { emailConfigured } from "../notifications/transports";
import { UsageError } from "./io";
import type { Setting } from "./settings";

const TEST_USAGE = "cli settings test email --to <address>";

/** `email`: Admin › Integrations › Email (PUT /api/v1/integrations/email). */
export const email: Setting = {
  name: "email",
  label: "Email: SMTP or MailerSend, and the sender",
  async status() {
    const stored = await getStoredEmail(getDb());
    if (stored.provider === "none") return { state: "not set", hints: [] };
    const hints: string[] = [stored.provider];
    if (stored.fromAddress) hints.push(`from ${stored.fromAddress}`);
    if (stored.provider === "smtp") {
      if (stored.smtp.host) hints.push(`server ${stored.smtp.host}:${stored.smtp.port}`);
      if (stored.smtp.passwordHint) hints.push(`password ${stored.smtp.passwordHint}`);
    } else if (stored.mailersend.tokenHint) {
      hints.push(`token ${stored.mailersend.tokenHint}`);
    }
    return { state: emailConfigured(stored) ? "set" : "incomplete", hints };
  },
  show: () => readEmail(),
  apply: (actor, body) => saveEmail(actor, parseJsonBody(body, emailSettingsInputSchema)),
  testOptions: { options: { to: { type: "string" } }, usage: TEST_USAGE },
  async test({ to }) {
    if (typeof to !== "string") throw new UsageError("Name the address for the test email.", TEST_USAGE);
    return sendTestEmail(parseWith(emailTestSchema, { to }).to);
  },
};
