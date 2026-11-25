import { expect, it, vi } from "vitest";
import { auth } from "./auth";
import { logger } from "../logger";

it("rejects an OIDC provider whose discovery response lacks signing keys", async () => {
  const issuer = process.env.OIDC_ISSUER;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        id_token_signing_alg_values_supported: ["RS256"],
      }),
    ),
  );
  try {
    expect((await auth().$context).socialProviders.map((provider) => provider.id)).not.toContain("oidc");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not copy raw authentication errors to the app log", async () => {
  const log = vi.spyOn(logger, "error");
  try {
    (await auth().$context).logger.error("provider response", new Error("private data"));
    expect(log).toHaveBeenLastCalledWith("authentication library reported a problem");
  } finally {
    log.mockRestore();
  }
});
