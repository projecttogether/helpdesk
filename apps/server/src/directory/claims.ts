import { config } from "../config";
import { claimGroups } from "./groups";
import { DirectoryError } from "./keycloak";

/** The claims of a JWT, without checking its signature (the sign-in already verified the ID token). */
export function jwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A claim by name; a dotted name reads a nested claim, e.g. `realm_access.roles`. */
function readClaim(claims: Record<string, unknown> | null, name: string): unknown {
  if (!claims) return undefined;
  if (name in claims) return claims[name];
  let value: unknown = claims;
  for (const part of name.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * DIRECTORY=oidc: the groups of a sign-in from the groups claim of the ID
 * token, else from the provider's userinfo response, which must name the
 * same subject. Remembers the userinfo endpoint once discovered.
 */
export function createClaimGroups() {
  let userInfoEndpoint: string | null | undefined;

  async function userInfoClaims(
    accessToken: string,
    subject: string,
  ): Promise<Record<string, unknown> | null> {
    if (userInfoEndpoint === undefined) {
      const issuer = config().OIDC_ISSUER.replace(/\/+$/, "");
      const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!discovery.ok) throw new DirectoryError("Could not read the provider's discovery document");
      const body = (await discovery.json().catch(() => null)) as {
        issuer?: unknown;
        userinfo_endpoint?: unknown;
      } | null;
      if (body?.issuer !== issuer && body?.issuer !== config().OIDC_ISSUER) {
        throw new DirectoryError("The discovery document has a different issuer");
      }
      userInfoEndpoint = typeof body?.userinfo_endpoint === "string" ? body.userinfo_endpoint : null;
    }
    if (!userInfoEndpoint) return null;
    const response = await fetch(userInfoEndpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new DirectoryError(`The provider's userinfo endpoint answered HTTP ${response.status}`);
    const claims = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    // OIDC requires UserInfo to refer to the subject of the verified ID token.
    if (claims?.sub !== subject) throw new DirectoryError("UserInfo does not match the signed-in identity");
    return claims;
  }

  return async function signInGroups(
    claims: Record<string, unknown>,
    subject: string,
    accessToken: string | null | undefined,
  ): Promise<string[]> {
    const claim = config().OIDC_GROUPS_CLAIM;
    const fromIdToken = readClaim(claims, claim);
    if (fromIdToken !== undefined) return claimGroups(fromIdToken);
    if (!accessToken) return [];
    return claimGroups(readClaim(await userInfoClaims(accessToken, subject), claim));
  };
}
