import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "helpdesk-dev";
export const MAILPIT = "http://localhost:8028";
export const APP = "http://localhost:3000";

/** Signs in through Keycloak in a fresh browser context; returns its page. */
export async function signIn(browser: Browser, user: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with Keycloak" }).click();
  await page.locator("#username").fill(`${user}@example.org`);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#kc-login").click();
  return page;
}

/** A JSON API call with the page's session, as the web app makes it. */
export async function apiCall<T>(page: Page, method: string, path: string, data?: unknown): Promise<T> {
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { origin: APP, accept: "application/json" },
  });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

type MailpitMessage = { ID: string; Subject: string; To: { Address: string }[] };

/** Waits for an email to `to` whose subject contains `subject`; returns its plain text. */
export async function waitForEmail(to: string, subject: string): Promise<{ subject: string; text: string }> {
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:${to} subject:"${subject}"`);
        const response = await fetch(`${MAILPIT}/api/v1/search?query=${query}`);
        const body = (await response.json()) as { messages: MailpitMessage[] };
        found = body.messages[0];
        return Boolean(found);
      },
      { timeout: 30_000, message: `email "${subject}" to ${to}` },
    )
    .toBe(true);
  const message = (await (await fetch(`${MAILPIT}/api/v1/message/${found!.ID}`)).json()) as {
    Subject: string;
    Text: string;
  };
  return { subject: message.Subject, text: message.Text };
}

export async function clearMailpit() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}
