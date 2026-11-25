import type { DirectoryStatus } from "@helpdesk/shared/api/integrations";
import type { Role } from "@helpdesk/shared/roles";
import { config, type Config } from "../config";
import { getDb } from "../db/client";
import { createClaimGroups } from "./claims";
import { roleGroups } from "./groups";
import { createKeycloakClient, type KeycloakClient } from "./keycloak";
import { admit, ownsSubject, type SignInGroups, type SignInTokens } from "./sign-in";
import { directoryStatus, syncDirectory } from "./sync";

export { ensureEnvironmentSuperadmins, isEnvironmentSuperadmin } from "./superadmins";
export type { KeycloakClient, KeycloakUser } from "./keycloak";
export type { SignInTokens } from "./sign-in";

/**
 * Where roles come from (DIRECTORY, docs/identity-and-access.md): the
 * Keycloak Admin API, or the groups claim of each sign-in. Only this module
 * knows which; SUPERADMIN_EMAILS win over the groups in both.
 */
export type Directory = {
  readonly mode: DirectoryStatus["mode"];
  /**
   * Decides a person's role at sign-in from their groups, stores it with the
   * provider subject, and returns it; null: no access, no session. Needs the
   * ID token of this sign-in. When Keycloak cannot be read, a person bound to
   * this subject keeps their last role; a groups claim that cannot be
   * verified gives null.
   */
  admit(userId: string, tokens: SignInTokens): Promise<Role | null>;
  /** False when the person is already bound to another provider subject. */
  ownsSubject(userId: string, subject: string): Promise<boolean>;
  /**
   * How long a session may rely on the role of its sign-in, in seconds; null
   * when the sync keeps roles current, so sessions may be renewed.
   */
  readonly roleMaxAgeSeconds: number | null;
  /** Everyone in the role groups (Keycloak); null when roles come from the sign-in. */
  readonly sync: DirectorySync | null;
  /** The mode, the role groups, the sync interval and the last sync. */
  status(): Promise<DirectoryStatus>;
};

export type DirectorySync = {
  readonly everyMinutes: number;
  /**
   * Updates everyone's role from the role groups and records the outcome for
   * `status`. Fails when Keycloak cannot be read; does nothing (0 people)
   * while another process syncs.
   */
  run(): Promise<{ people: number }>;
  /** Fails with a plain message unless the service account can read every role group. */
  check(): Promise<void>;
};

/** Claim-based roles change only at a sign-in, which the app requires after at most a week. */
const CLAIM_ROLE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function createDirectory(options: { keycloak?: KeycloakClient } = {}): Directory {
  const settings = config();
  const status = (syncMinutes: number | null) => directoryStatus(getDb(), settings.DIRECTORY, syncMinutes);

  if (settings.DIRECTORY === "keycloak") {
    // Sync and check get a new client (and token), so fixed permissions count at once.
    const newClient = () => options.keycloak ?? createKeycloakClient();
    let signInClient: KeycloakClient | undefined;
    const groups: SignInGroups = {
      source: "directory",
      read: (_claims, subject) => (signInClient ??= newClient()).userGroups(subject),
      keepRoleWhenUnreadable: true,
    };
    const everyMinutes = settings.DIRECTORY_SYNC_MINUTES;
    return {
      mode: "keycloak",
      admit: (userId, tokens) => admit(groups, userId, tokens),
      ownsSubject,
      roleMaxAgeSeconds: null,
      sync: {
        everyMinutes,
        run: async () => syncDirectory(newClient()),
        check: async () => {
          const paths = Object.values(roleGroups()).filter((group): group is string => Boolean(group));
          await newClient().check(paths);
        },
      },
      status: () => status(everyMinutes),
    };
  }

  const claimGroups = createClaimGroups();
  const groups: SignInGroups = {
    source: "sign_in",
    read: (claims, subject, tokens) => claimGroups(claims, subject, tokens.accessToken),
    keepRoleWhenUnreadable: false,
  };
  return {
    mode: "oidc",
    admit: (userId, tokens) => admit(groups, userId, tokens),
    ownsSubject,
    roleMaxAgeSeconds: CLAIM_ROLE_MAX_AGE_SECONDS,
    sync: null,
    status: () => status(null),
  };
}

let current: { settings: Config; directory: Directory } | undefined;

/** The directory of the current configuration (a new one when the configuration changes, as in tests). */
export function directory(): Directory {
  const settings = config();
  if (current?.settings !== settings) current = { settings, directory: createDirectory() };
  return current.directory;
}
