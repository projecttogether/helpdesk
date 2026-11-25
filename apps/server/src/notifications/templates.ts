import type { Urgency } from "@helpdesk/shared/tickets";
import { REOPEN_DAYS } from "@helpdesk/shared/tickets";

/*
 * The texts of emails and Slack messages, in English like the app.
 * People write in the app, never by email: inbound email is not read.
 */

export type TicketFacts = {
  number: number;
  title: string;
  category: string | null;
  urgency: Urgency;
  requesterName: string;
  url: string;
};

const URGENCY: Record<Urgency, string> = {
  low: "Low",
  normal: "Normal",
  urgent: "Urgent",
  very_urgent: "Very urgent",
};

export type Rendered = { subject: string; text: string; html: string };

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ESCAPES[character]!);

/** A plain email: paragraphs, an optional quoted message, and a link. */
function email(parts: {
  subject: string;
  greeting: string;
  lines: string[];
  quote?: string;
  linkText: string;
  url: string;
  footer: string;
}): Rendered {
  const text = [
    parts.greeting,
    "",
    ...parts.lines.flatMap((line) => [line, ""]),
    ...(parts.quote ? [parts.quote.replace(/^/gm, "> "), ""] : []),
    `${parts.linkText}: ${parts.url}`,
    "",
    "--",
    parts.footer,
  ].join("\n");
  const paragraph = (line: string) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`;
  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:560px">`,
    paragraph(parts.greeting),
    ...parts.lines.map(paragraph),
    parts.quote
      ? `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #d1d5db;color:#374151;white-space:pre-wrap">${escapeHtml(parts.quote)}</blockquote>`
      : "",
    `<p style="margin:0 0 24px"><a href="${escapeHtml(parts.url)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none">${escapeHtml(parts.linkText)}</a></p>`,
    `<p style="margin:0;color:#6b7280;font-size:13px">${escapeHtml(parts.footer)}</p>`,
    `</div>`,
  ].join("\n");
  return { subject: parts.subject, text, html };
}

const tag = (ticket: TicketFacts) => `[#${ticket.number}]`;
const excerpt = (body: string, max = 600) => (body.length > max ? `${body.slice(0, max).trimEnd()}…` : body);

const footer = (appName: string) => `${appName}. Please reply in ${appName}, not to this email.`;

/** To the requester: their request arrived. */
export function ticketReceived(appName: string, name: string, ticket: TicketFacts): Rendered {
  return email({
    subject: `${tag(ticket)} We received your request: ${ticket.title}`,
    greeting: `Hello ${name},`,
    lines: [`we received your request #${ticket.number} "${ticket.title}". We will get back to you.`],
    linkText: "View your request",
    url: ticket.url,
    footer: footer(appName),
  });
}

/** To the requester: staff replied. */
export function staffReplied(
  appName: string,
  name: string,
  ticket: TicketFacts,
  author: string,
  body: string,
): Rendered {
  return email({
    subject: `${tag(ticket)} New reply: ${ticket.title}`,
    greeting: `Hello ${name},`,
    lines: [`${author} replied to your request #${ticket.number}:`],
    quote: body,
    linkText: "Reply or view the request",
    url: ticket.url,
    footer: footer(appName),
  });
}

/** To the requester: the ticket is done. */
export function ticketDone(appName: string, name: string, ticket: TicketFacts): Rendered {
  return email({
    subject: `${tag(ticket)} Your request is done: ${ticket.title}`,
    greeting: `Hello ${name},`,
    lines: [
      `your request #${ticket.number} "${ticket.title}" is done.`,
      `Is something still missing? Reply in ${appName} within ${REOPEN_DAYS} days to reopen it.`,
    ],
    linkText: "View your request",
    url: ticket.url,
    footer: footer(appName),
  });
}

/** To an assignee: a ticket was assigned to them. */
export function ticketAssigned(
  appName: string,
  name: string,
  ticket: TicketFacts,
  actor: string | null,
): { email: Rendered; slack: string } {
  const urgency = URGENCY[ticket.urgency];
  const lead = actor
    ? `${actor} assigned request #${ticket.number} "${ticket.title}" to you.`
    : `Request #${ticket.number} "${ticket.title}" is assigned to you.`;
  const details = `From ${ticket.requesterName} · ${ticket.category ?? "No category"} · Urgency: ${urgency}`;
  return {
    email: email({
      subject: `${tag(ticket)} Assigned to you: ${ticket.title}`,
      greeting: `Hello ${name},`,
      lines: [lead, details],
      linkText: "Open the ticket",
      url: ticket.url,
      footer: `${appName}`,
    }),
    slack: `${slackText(lead)}\n${slackText(details)}\n<${ticket.url}|Open the ticket>`,
  };
}

/** To an assignee: the requester replied (and maybe reopened the ticket). */
export function requesterReplied(
  appName: string,
  name: string,
  ticket: TicketFacts,
  body: string,
  reopened: boolean,
): { email: Rendered; slack: string } {
  const short = excerpt(body);
  const lead = reopened
    ? `${ticket.requesterName} replied to request #${ticket.number} "${ticket.title}" and reopened it:`
    : `${ticket.requesterName} replied to request #${ticket.number} "${ticket.title}":`;
  return {
    email: email({
      subject: `${tag(ticket)} ${ticket.requesterName} replied: ${ticket.title}`,
      greeting: `Hello ${name},`,
      lines: [lead],
      quote: short,
      linkText: "Open the ticket",
      url: ticket.url,
      footer: `${appName}`,
    }),
    slack: `${slackText(lead)}\n${slackQuote(short)}\n<${ticket.url}|Open the ticket>`,
  };
}

/** To the Slack channel: a new ticket. */
export function newTicketPost(ticket: TicketFacts): string {
  const urgency = URGENCY[ticket.urgency];
  return [
    `:inbox_tray: *New request #${ticket.number}:* ${slackText(ticket.title)}`,
    slackText(`${ticket.category ?? "No category"} · Urgency: ${urgency} · From ${ticket.requesterName}`),
    `<${ticket.url}|Open the ticket>`,
  ].join("\n");
}

/** To the Slack channel: the requester replied to a ticket nobody is assigned to. */
export function unassignedReplyPost(ticket: TicketFacts, reopened: boolean): string {
  const verb = reopened ? "replied and reopened" : "replied";
  return `:speech_balloon: ${slackText(`${ticket.requesterName} ${verb}: #${ticket.number} ${ticket.title} (not assigned)`)}\n<${ticket.url}|Open the ticket>`;
}

/** Text for Slack: &, < and > escaped so people's text cannot form links or mentions. */
export function slackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slackQuote(value: string): string {
  return slackText(value)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** A test email from the integrations page. */
export function testEmail(appName: string, url: string): Rendered {
  return email({
    subject: `Test email from ${appName}`,
    greeting: "Hello,",
    lines: [`this email shows that ${appName} can send email.`],
    linkText: appName,
    url,
    footer: appName,
  });
}
