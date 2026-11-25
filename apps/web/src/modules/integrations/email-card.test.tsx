import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmailSettings } from "@helpdesk/shared/api/integrations";
import { renderWithProviders, stubFetch } from "@/test-utils";
import { EmailForm } from "./email-card";

const smtp: EmailSettings = {
  provider: "smtp",
  fromAddress: "helpdesk@example.org",
  fromName: "IT Helpdesk",
  smtp: {
    host: "mail.example.org",
    port: 587,
    security: "starttls",
    username: "helpdesk",
    passwordHint: "…3f9a",
  },
  mailersend: { tokenHint: null },
};

const off: EmailSettings = {
  provider: "none",
  fromAddress: "",
  fromName: "",
  smtp: { host: "", port: 587, security: "starttls", username: "", passwordHint: null },
  mailersend: { tokenHint: null },
};

afterEach(() => vi.unstubAllGlobals());

function body(fetch: ReturnType<typeof stubFetch>, call = 0) {
  const [url, init] = fetch.mock.calls[call]!;
  return { url, method: init?.method, body: JSON.parse(String(init?.body)) as unknown };
}

describe("EmailForm", () => {
  it("keeps the stored password when its field stays empty", async () => {
    const fetch = stubFetch({ body: { ...smtp, fromName: "Support" } });
    renderWithProviders(<EmailForm settings={smtp} defaultTo="admin@example.org" />);

    expect(screen.getByText("Stored (…3f9a)")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Sender name"));
    await userEvent.type(screen.getByLabelText("Sender name"), "Support");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(body(fetch)).toEqual({
      url: "/api/v1/integrations/email",
      method: "PUT",
      body: {
        provider: "smtp",
        fromAddress: "helpdesk@example.org",
        fromName: "Support",
        smtp: {
          host: "mail.example.org",
          port: 587,
          security: "starttls",
          username: "helpdesk",
          password: "",
        },
        mailersend: { token: "" },
      },
    });
  });

  it("sends a new MailerSend token and keeps the SMTP fields", async () => {
    const fetch = stubFetch({
      body: { ...smtp, provider: "mailersend", mailersend: { tokenHint: "…abcd" } },
    });
    renderWithProviders(<EmailForm settings={smtp} defaultTo="admin@example.org" />);

    await userEvent.click(screen.getByRole("radio", { name: /MailerSend/ }));
    await userEvent.type(screen.getByLabelText("API token"), "mlsn.example");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(body(fetch).body).toMatchObject({
      provider: "mailersend",
      smtp: { host: "mail.example.org", password: "" },
      mailersend: { token: "mlsn.example" },
    });
  });

  it("checks the sender address before saving", async () => {
    const fetch = stubFetch();
    renderWithProviders(<EmailForm settings={off} defaultTo="admin@example.org" />);

    await userEvent.click(screen.getByRole("radio", { name: /SMTP/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter the sender address")).toBeInTheDocument();
    expect(screen.getByText("Enter the mail server")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the server's field errors next to the fields", async () => {
    stubFetch({
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message: "Check the highlighted fields",
          fields: { "mailersend.token": "Enter the API token" },
        },
      },
    });
    renderWithProviders(<EmailForm settings={smtp} defaultTo="admin@example.org" />);

    await userEvent.click(screen.getByRole("radio", { name: /MailerSend/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter the API token")).toBeInTheDocument();
  });

  it("sends a test email to the signed-in person by default", async () => {
    const fetch = stubFetch({
      body: { ok: true, message: "Sent a test email to admin@example.org", latencyMs: 120 },
    });
    renderWithProviders(<EmailForm settings={smtp} defaultTo="admin@example.org" />);

    await userEvent.click(screen.getByRole("button", { name: "Send test email" }));

    expect(await screen.findByText("Sent a test email to admin@example.org")).toBeInTheDocument();
    expect(body(fetch)).toEqual({
      url: "/api/v1/integrations/email/test",
      method: "POST",
      body: { to: "admin@example.org" },
    });
  });
});
