import type { DbOrTx } from "../db/client";
import { encryptSecret } from "../core/crypto";
import { putSetting } from "../core/settings";

/** Email over MailerSend (a stand-in in tests) and Slack with a channel. */
export async function setUpIntegrations(db: DbOrTx, options: { email?: boolean; slack?: boolean } = {}) {
  if (options.email ?? true) {
    await putSetting(db, "email", {
      provider: "mailersend",
      fromAddress: "helpdesk@example.org",
      fromName: "Helpdesk",
      mailersend: { tokenEncrypted: encryptSecret("mlsn.test"), tokenHint: "…test" },
    });
  }
  if (options.slack ?? true) {
    await putSetting(db, "slack", {
      botTokenEncrypted: encryptSecret("xoxb-test"),
      botTokenHint: "…test",
      channelId: "C0HELPDESK",
      channelName: "helpdesk",
    });
  }
}
