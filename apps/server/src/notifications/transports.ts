import nodemailer from "nodemailer";
import { config } from "../config";
import { decryptSecret } from "../core/crypto";
import type { StoredEmail, StoredSlack } from "../core/settings";
import { smtpReply } from "./smtp-reply";

/*
 * Email over SMTP or the MailerSend API, and Slack over its Web API. Every
 * call is time-limited. Errors carry whether trying again can help.
 */

const TIMEOUT_MS = 15_000;

/**
 * A failed send. A permanent error (a bad password or token, a missing scope,
 * a rejected address) stays until someone changes something, so it is not
 * retried. Others are retried with backoff.
 */
export class DeliveryError extends Error {
  override name = "DeliveryError";
  constructor(
    message: string,
    readonly permanent = false,
    readonly code?: string,
  ) {
    super(message.slice(0, 300));
  }
}

/**
 * Why a request got no answer. Never the error's own text: fetch quotes a
 * header value it refuses, and that header carries the token.
 */
const requestFailure = (error: unknown) =>
  error instanceof Error && error.name === "TimeoutError" ? "timed out" : "request failed";

/** HTTP statuses that may pass: timeouts, rate limits, server errors. Other 4xx answers are permanent. */
const temporaryStatus = (status: number) => status === 408 || status === 429 || status >= 500;

export type Email = { to: string; toName?: string; subject: string; text: string; html: string };
export type EmailTransport = { kind: "smtp" | "mailersend"; send(email: Email): Promise<void> };

export function createMailerSendTransport(options: {
  token: string;
  from: string;
  fromName: string;
  fetch?: typeof fetch;
}): EmailTransport {
  const fetchImpl = options.fetch ?? fetch;
  return {
    kind: "mailersend",
    async send(email) {
      let response: Response;
      try {
        response = await fetchImpl(new URL("email", config().MAILERSEND_API_URL), {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            "x-requested-with": "XMLHttpRequest",
          },
          body: JSON.stringify({
            from: { email: options.from, ...(options.fromName ? { name: options.fromName } : {}) },
            to: [email.toName ? { email: email.to, name: email.toName } : { email: email.to }],
            subject: email.subject,
            text: email.text,
            html: email.html,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new DeliveryError(`MailerSend: ${requestFailure(error)}`);
      }
      if (response.ok) return;
      const body = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new DeliveryError(
        `MailerSend answered HTTP ${response.status} ${body}`.trim(),
        !temporaryStatus(response.status),
      );
    },
  };
}

type SmtpError = Error & { response?: string; responseCode?: number; code?: string; command?: string };

export function createSmtpTransport(options: {
  host: string;
  port: number;
  security: "tls" | "starttls" | "none";
  username: string;
  password: string | null;
  from: string;
  fromName: string;
}): EmailTransport {
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.security === "tls",
    requireTLS: options.security === "starttls",
    ignoreTLS: options.security === "none",
    auth: options.username ? { user: options.username, pass: options.password ?? "" } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  return {
    kind: "smtp",
    async send(email) {
      try {
        await transporter.sendMail({
          from: options.fromName ? { name: options.fromName, address: options.from } : options.from,
          to: email.toName ? { name: email.toName, address: email.to } : email.to,
          subject: email.subject,
          text: email.text,
          html: email.html,
        });
      } catch (error) {
        const smtp = error as SmtpError;
        const detail = smtp.responseCode ? `SMTP ${smtp.responseCode}` : (smtp.code ?? "SMTP");
        const reply = smtpReply(smtp, options);
        throw new DeliveryError(
          reply
            ? `The mail server answered: ${reply}`
            : // With an answer smtpReply does not quote, the message would.
              `${detail}: ${smtp.response ? `unexpected answer (${smtp.command})` : smtp.message}`,
          (smtp.responseCode ?? 0) >= 500 || smtp.code === "EAUTH",
          smtp.code,
        );
      }
    },
  };
}

/** Whether the stored settings name everything sending needs; a stored secret is not decrypted here. */
export function emailConfigured(stored: StoredEmail): boolean {
  if (!stored.fromAddress) return false;
  if (stored.provider === "smtp") return Boolean(stored.smtp.host);
  if (stored.provider === "mailersend") return Boolean(stored.mailersend.tokenEncrypted);
  return false;
}

/** The email transport for the stored settings, or null when email is off. */
export function emailTransportFor(stored: StoredEmail): EmailTransport | null {
  if (!emailConfigured(stored)) return null;
  if (stored.provider === "smtp") {
    return createSmtpTransport({
      host: stored.smtp.host,
      port: stored.smtp.port,
      security: stored.smtp.security,
      username: stored.smtp.username,
      password: stored.smtp.passwordEncrypted ? decryptSecret(stored.smtp.passwordEncrypted) : null,
      from: stored.fromAddress,
      fromName: stored.fromName,
    });
  }
  return createMailerSendTransport({
    token: decryptSecret(stored.mailersend.tokenEncrypted!),
    from: stored.fromAddress,
    fromName: stored.fromName,
  });
}

/* Slack ------------------------------------------------------------------ */

/** Slack errors that may pass; every other one (bad token, missing scope, unknown channel) is permanent. */
const SLACK_TEMPORARY = new Set([
  "ratelimited",
  "rate_limited",
  "internal_error",
  "fatal_error",
  "service_unavailable",
  "request_timeout",
]);

type SlackResponse = Record<string, unknown> & { ok: boolean; error?: string };

export type SlackApi = {
  call(method: string, body: Record<string, string | number | boolean>): Promise<SlackResponse>;
};

export function createSlackApi(token: string, fetchImpl: typeof fetch = fetch): SlackApi {
  return {
    async call(method, body) {
      let response: Response;
      try {
        response = await fetchImpl(new URL(method, config().SLACK_API_URL), {
          method: "POST",
          // Form encoding works for every method; JSON only for some.
          headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(
            Object.entries(body).map(([key, value]) => [
              key,
              typeof value === "string" ? value : JSON.stringify(value),
            ]),
          ),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new DeliveryError(`Slack ${method}: ${requestFailure(error)}`);
      }
      if (response.status === 429)
        throw new DeliveryError(`Slack ${method}: rate limited`, false, "ratelimited");
      if (!response.ok) {
        throw new DeliveryError(
          `Slack ${method}: HTTP ${response.status}`,
          !temporaryStatus(response.status),
        );
      }
      const result = (await response.json().catch(() => null)) as SlackResponse | null;
      if (!result) throw new DeliveryError(`Slack ${method}: invalid response`);
      if (!result.ok) {
        const code = result.error ?? "unknown_error";
        throw new DeliveryError(`Slack ${method}: ${code}`, !SLACK_TEMPORARY.has(code), code);
      }
      return result;
    },
  };
}

export type SlackTransport = {
  postMessage(channel: string, text: string): Promise<void>;
  /** The Slack user ID for an email address, or null when no active user has it. */
  lookupUserByEmail(email: string): Promise<string | null>;
};

export function slackTransportFor(stored: StoredSlack, fetchImpl?: typeof fetch): SlackTransport | null {
  if (!stored.botTokenEncrypted) return null;
  const api = createSlackApi(decryptSecret(stored.botTokenEncrypted), fetchImpl);
  return {
    async postMessage(channel, text) {
      await api.call("chat.postMessage", { channel, text, unfurl_links: false, unfurl_media: false });
    },
    async lookupUserByEmail(email) {
      try {
        const result = await api.call("users.lookupByEmail", { email });
        const user = result.user as { id?: string; deleted?: boolean } | undefined;
        return user?.id && !user.deleted ? user.id : null;
      } catch (error) {
        if (error instanceof DeliveryError && error.code === "users_not_found") return null;
        throw error;
      }
    },
  };
}
