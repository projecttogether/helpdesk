import { createServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { smtpReply } from "./smtp-reply";
import { createSmtpTransport } from "./transports";

const login = { username: "helpdesk@example.org", password: "pass word+1" };
const base64 = (text: string) => Buffer.from(text).toString("base64");
const failure = (response: unknown) => Object.assign(new Error("Message failed"), { response });

describe("smtpReply", () => {
  it("is the server's answer on one line", () => {
    expect(
      smtpReply(failure("550-5.7.1 Sender address rejected\r\n550 5.7.1\tsee the docs\u0007"), login),
    ).toBe("550-5.7.1 Sender address rejected 550 5.7.1 see the docs");
  });

  it("holds no login, also encoded", () => {
    const reply = smtpReply(
      failure(
        `535 5.7.8 ${login.username} ${login.password} ${base64(login.username)} ${base64(login.password)} ${base64(`\0${login.username}\0${login.password}`)}`,
      ),
      login,
    );
    expect(reply).toBe("535 5.7.8 *** *** *** *** ***");
  });

  it("hides a login before it cuts the line", () => {
    const reply = smtpReply(failure(`535 ${"x".repeat(190)}${login.password}`), login)!;
    expect(reply).toHaveLength(197);
    expect(reply.endsWith("x***")).toBe(true);
    expect(smtpReply(failure(`535 ${"x".repeat(500)}`), login)).toHaveLength(200);
  });

  it("is the code when the server sends no text", () => {
    expect(smtpReply(failure("550"), login)).toBe("550");
  });

  it("works without a login", () => {
    expect(smtpReply(failure("550 5.1.1 No such user"), { username: "", password: null })).toBe(
      "550 5.1.1 No such user",
    );
  });

  it.each([
    ["no answer", failure(undefined)],
    ["an answer that is no refusal", failure("220 ftp.example.org ready")],
    ["another kind of server", failure("HTTP/1.1 400 Bad Request")],
    ["a longer number", failure("4501")],
    ["a server that does not know EHLO", { ...failure("500 what?"), command: "HELO" }],
    ["no error", null],
  ])("is null for %s", (_, error) => {
    expect(smtpReply(error, login)).toBeNull();
  });
});

describe("a failed email over SMTP", () => {
  let stop = async () => {};
  afterEach(() => stop());

  /** A server that greets, then answers each line with `answer`; its port. */
  async function listen(greeting: string, answer: (line: string) => string): Promise<number> {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.write(`${greeting}\r\n`);
      socket.on("data", (data) => socket.write(`${answer(String(data).trim())}\r\n`));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    stop = async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    };
    return (server.address() as AddressInfo).port;
  }

  const send = (port: number) =>
    createSmtpTransport({
      host: "127.0.0.1",
      port,
      security: "none",
      ...login,
      from: "helpdesk@example.org",
      fromName: "",
    }).send({ to: "ada@example.org", subject: "Test", text: "Test", html: "<p>Test</p>" });

  it("says what the mail server answered, without the login", async () => {
    const port = await listen("220 mail.example.org ESMTP", (line) =>
      line.startsWith("EHLO")
        ? "250-mail.example.org\r\n250 AUTH PLAIN"
        : `535 5.7.8 Authentication failed: ${line} is not ${login.password}`,
    );
    await expect(send(port)).rejects.toThrow(
      "The mail server answered: 535 5.7.8 Authentication failed: AUTH PLAIN *** is not ***",
    );
  });

  it.each([
    ["HTTP/1.1 400 internal-only text", "", "EPROTOCOL: unexpected answer (CONN)"],
    ["220 FTP server ready", "500 internal-only text", "SMTP 500: unexpected answer (HELO)"],
  ])("quotes nothing of a server that is no mail server (%s)", async (greeting, answer, message) => {
    const port = await listen(greeting, () => answer);
    const error = await send(port).catch((thrown: Error) => thrown);
    expect(error).toMatchObject({ message });
  });

  it("says why there was no answer", async () => {
    const port = await listen("220 mail.example.org ESMTP", () => "");
    await stop();
    stop = async () => {};
    await expect(send(port)).rejects.toThrow(`ESOCKET: connect ECONNREFUSED 127.0.0.1:${port}`);
  });
});
