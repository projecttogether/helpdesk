import { expect, test, type Page } from "@playwright/test";
import { apiCall, clearMailpit, signIn, waitForEmail } from "./helpers";

/*
 * The whole way of a request, with real sign-ins through Keycloak: a
 * superadmin sets up email, a category and a conditional page; a requester
 * sends the form; an operator works on the ticket on the board; the
 * requester answers and reopens it. Emails arrive in Mailpit.
 */
test.describe.configure({ mode: "serial" });

type Person = { id: string; name: string; email: string };
const TITLE = "New laptop for the new colleague";

let ada: Page;
let erin: Page;
let oscar: Page;

test.beforeAll(async () => {
  await clearMailpit();
});

test("someone in none of the groups cannot sign in", async ({ browser }) => {
  const page = await signIn(browser, "nora");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByText("This account has no access.")).toBeVisible();
  await page.context().close();
});

test("a superadmin sets up email, a category and a conditional page", async ({ browser }) => {
  ada = await signIn(browser, "ada");
  await expect(ada).toHaveURL(/\/board/);

  // The Keycloak sync knows every operator before their first sign-in.
  let operator: Person | undefined;
  await expect
    .poll(async () => {
      const people = await apiCall<{ items: Person[] }>(ada, "GET", "/people?scope=staff");
      operator = people.items.find((person) => person.email === "oscar@example.org");
      return Boolean(operator);
    })
    .toBe(true);

  await apiCall(ada, "PUT", "/integrations/email", {
    provider: "smtp",
    fromAddress: "helpdesk@example.org",
    fromName: "Helpdesk",
    smtp: { host: "localhost", port: 1028, security: "none", username: "", password: "" },
  });
  const { items } = await apiCall<{ items: { id: string; name: string }[] }>(ada, "POST", "/categories", {
    name: "IT",
    isActive: true,
    defaultAssigneeId: operator!.id,
  });
  const it = items.find((category) => category.name === "IT")!;
  const form = await apiCall<{ version: number; definition: { pages: unknown[] } }>(ada, "GET", "/form");
  const [first, ...rest] = form.definition.pages;
  await apiCall(ada, "PUT", "/form", {
    baseVersion: form.version,
    definition: {
      ...form.definition,
      pages: [
        first,
        {
          id: "device",
          title: "Your device",
          description: "",
          showIf: { match: "all", rules: [{ questionId: "category", operator: "equals", value: it.id }] },
          questions: [
            {
              id: "kind",
              type: "single_choice",
              label: "What do you need?",
              help: "",
              required: true,
              options: [
                { id: "laptop", label: "Laptop" },
                { id: "phone", label: "Phone" },
              ],
              showIf: null,
            },
            {
              id: "model",
              type: "short_text",
              label: "Which model?",
              help: "",
              required: true,
              options: [],
              showIf: { match: "all", rules: [{ questionId: "kind", operator: "equals", value: "laptop" }] },
            },
          ],
        },
        ...rest,
      ],
    },
  });

  // The editor shows the new page.
  await ada.goto("/admin/form");
  await expect(ada.getByText("Your device").first()).toBeVisible();
});

test("a requester sends the form; pages and questions follow the answers", async ({ browser }) => {
  erin = await signIn(browser, "erin");
  await expect(erin).toHaveURL(/\/requests\/new/);
  await expect(erin.getByText("Step 1 of 3")).toBeVisible();

  await erin.getByLabel("What is your request about?").fill(TITLE);
  await erin.getByLabel("IT", { exact: true }).check();
  await erin.getByLabel("Urgent", { exact: true }).check();
  await erin.getByRole("button", { name: "Next" }).click();

  // Choosing IT added the device page.
  await expect(erin.getByRole("heading", { name: "Your device" })).toBeVisible();
  await expect(erin.getByText("Step 2 of 4")).toBeVisible();
  await expect(erin.getByLabel("Which model?")).toHaveCount(0);
  await erin.getByLabel("Laptop", { exact: true }).check();
  await erin.getByLabel("Which model?").fill("ThinkPad X1");
  await erin.getByRole("button", { name: "Next" }).click();

  await erin.getByLabel("Describe your request").fill("She starts on Monday.");
  await erin.locator('input[type="file"]').setInputFiles({
    name: "quote.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 quote"),
  });
  await expect(erin.getByText("quote.pdf")).toBeVisible();
  await erin.getByRole("button", { name: "Next" }).click();

  await expect(erin.getByRole("heading", { name: "Check and send" })).toBeVisible();
  await expect(erin.getByText("ThinkPad X1")).toBeVisible();
  await erin.getByRole("button", { name: "Send request" }).click();

  await expect(erin).toHaveURL(/\/requests\/1$/);
  await expect(erin.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(erin.getByText("Oscar Operator")).toBeVisible();

  const received = await waitForEmail("erin@example.org", "We received your request");
  expect(received.subject).toBe(`[#1] We received your request: ${TITLE}`);
  expect(received.text).toContain("http://localhost:3000/requests/1");
  // The category's default assignee hears about it.
  await waitForEmail("oscar@example.org", "Assigned to you");
});

const cardIn = (page: Page, column: string) =>
  page.getByRole("region", { name: new RegExp(`^${column}`) }).getByRole("link", { name: new RegExp(TITLE) });

test("an operator drags the ticket on the board, replies, notes and closes it", async ({ browser }) => {
  oscar = await signIn(browser, "oscar");
  await expect(oscar).toHaveURL(/\/board/);
  const card = cardIn(oscar, "New");
  await expect(card).toBeVisible();

  // Drag the card from New to In progress.
  const from = (await card.boundingBox())!;
  const target = (await oscar.getByRole("region", { name: /^In progress/ }).boundingBox())!;
  await oscar.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await oscar.mouse.down();
  await oscar.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await oscar.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 20 });
  await oscar.mouse.up();
  await expect(cardIn(oscar, "In progress")).toBeVisible();
  await oscar.reload();
  await expect(cardIn(oscar, "In progress")).toBeVisible();

  await cardIn(oscar, "In progress").click();
  await expect(oscar).toHaveURL(/\/tickets\/1$/);
  await expect(oscar.getByText("ThinkPad X1")).toBeVisible();
  await expect(oscar.getByText("Assigned to Oscar Operator automatically")).toBeVisible();
  await expect(oscar.getByText(/changed the status from New to In progress/)).toBeVisible();

  await oscar
    .getByRole("textbox", { name: "Reply to requester" })
    .fill("We ordered it. It arrives on Friday.");
  await oscar.getByRole("button", { name: "Send" }).click();
  await expect(oscar.getByText("Reply sent")).toBeVisible();

  await oscar.getByRole("tab", { name: "Internal note" }).click();
  await oscar.getByRole("textbox", { name: "Internal note" }).fill("Order number 4711");
  await oscar.getByRole("button", { name: "Add note" }).click();
  await expect(oscar.getByText("Note added")).toBeVisible();

  await oscar.getByLabel("Status").click();
  await oscar.getByRole("option", { name: "Done" }).click();
  await expect(oscar.getByText(/changed the status from In progress to Done/)).toBeVisible();

  const reply = await waitForEmail("erin@example.org", "New reply");
  expect(reply.text).toContain("We ordered it. It arrives on Friday.");
  expect(reply.text).not.toContain("4711");
  await waitForEmail("erin@example.org", "Your request is done");
});

test("the requester sees the reply but not the note, and her answer reopens the request", async () => {
  await erin.goto("/requests/1");
  await expect(erin.getByText("We ordered it. It arrives on Friday.")).toBeVisible();
  await expect(erin.getByText("Order number 4711")).toHaveCount(0);
  await expect(erin.getByText("This request is done. Your reply reopens it.")).toBeVisible();
  await erin.getByRole("textbox", { name: "Reply" }).fill("Thanks! One more thing: a mouse, please.");
  await erin.getByRole("button", { name: "Reply" }).click();
  await expect(erin.getByText("Message sent")).toBeVisible();
  await expect(erin.getByText("In progress").first()).toBeVisible();

  const replied = await waitForEmail("oscar@example.org", "replied");
  expect(replied.text).toContain("and reopened it");
  await oscar.goto("/board");
  await expect(cardIn(oscar, "In progress")).toBeVisible();
  await oscar.goto("/tickets/1");
  await expect(oscar.getByText("Erin Employee reopened the request")).toBeVisible();
});

test("staff pages stay closed to requesters", async () => {
  await erin.goto("/board");
  await expect(erin.getByText("Not found")).toBeVisible();
  const response = await erin.request.get("/api/v1/tickets/1");
  expect(response.status()).toBe(403);
});

test("an admin makes the form German; the rest of the app stays English", async () => {
  await ada.goto("/admin/form");
  await ada.getByRole("combobox", { name: "Language" }).click();
  await ada.getByRole("option", { name: "German" }).click();
  await ada.getByRole("button", { name: "Save" }).click();
  await expect(ada.getByText(/^Published version/)).toBeVisible();

  await erin.goto("/requests/new");
  await expect(erin.getByText("Schritt 1 von 3")).toBeVisible();
  await expect(erin.getByLabel("Dringend", { exact: true })).toBeVisible();
  await erin.getByRole("button", { name: "Weiter" }).click();
  await expect(erin.getByText("Beantworte diese Frage").first()).toBeVisible();
  // The sidebar stays English; the breadcrumb links "My requests" too, so look in the sidebar.
  await expect(
    erin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My requests" }),
  ).toBeVisible();
});
