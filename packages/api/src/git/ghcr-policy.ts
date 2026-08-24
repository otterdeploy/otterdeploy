/**
 * The decisions behind GHCR-from-the-GitHub-App, with no database and no env
 * import.
 *
 * Split from ./ghcr-auth.ts on exactly the same grounds as
 * packages/auth/src/audit-policy.ts: this is the part worth unit-testing, and
 * pulling `@otterdeploy/db` in behind it would make those tests require a
 * configured environment to run. The half that queries and mints lives next
 * door and re-exports everything here, so callers import one module.
 */

/** The one registry this derivation applies to. */
export const GHCR_HOST = "ghcr.io";

/**
 * The literal login GHCR expects when the password is a token rather than a
 * password. The `container_registry.username` column already documents this
 * case ("or the literal `x-access-token` for some hosts").
 */
export const GHCR_TOKEN_USERNAME = "x-access-token";

/** GitHub's prefix for installation access tokens. Private: the check below
 *  is the only thing that should ever need it. */
const GITHUB_INSTALLATION_TOKEN_PREFIX = "ghs_";

/**
 * Does this secret look like a GitHub installation access token?
 *
 * Guards the stored-credential form. Pasting one in is the single most likely
 * way to get this feature wrong: it authenticates perfectly during testing and
 * then stops working about an hour later, and the failure surfaces at deploy
 * time on a completely different screen from where it was entered. Rejecting
 * it at the boundary turns a silent, hour-delayed outage into an immediate and
 * explicable error.
 */
export function looksLikeInstallationToken(secret: string): boolean {
  return secret.trim().startsWith(GITHUB_INSTALLATION_TOKEN_PREFIX);
}

type GhcrCapabilityReason = "ok" | "no-app" | "no-installation" | "missing-packages-permission";

export interface GhcrCapability {
  available: boolean;
  installationId: string | null;
  reason: GhcrCapabilityReason;
  /** The account the App is installed on, for UI copy ("as @acme"). */
  accountLogin: string | null;
  /** Organization installs live under a different settings path than personal
   *  ones, which is the only reason this is carried. */
  accountType: "Organization" | "User" | null;
}

/**
 * Can this org authenticate to GHCR through its GitHub App?
 *
 * The `missing-packages-permission` reason drives UI copy and NOTHING else. In
 * particular it must never gate the auth path: the `permissions` snapshot on
 * the installation row is documented as diagnostics-only ("we never re-grant
 * based on this snapshot"), and it goes stale the moment the App's requested
 * permissions change, because GitHub makes every existing installation
 * re-authorize before the new grant appears. Gating availability on it would
 * dark-launch this feature for every org that installed the App before it
 * shipped. Mint the token and let GitHub be the authority.
 */
export function decideGhcrCapability(input: {
  /** The org's live (not suspended, not revoked) GitHub installation. */
  installation: {
    installationId: string;
    accountLogin: string;
    accountType: string;
    permissions: Record<string, string>;
  } | null;
  /** Whether a GitHub provider row exists at all for the org. */
  hasProvider: boolean;
}): GhcrCapability {
  if (input.installation === null) {
    // Distinguishing "no App connected" from "App connected, not installed
    // anywhere" is what lets the UI send the operator to the right screen.
    return {
      available: false,
      installationId: null,
      accountLogin: null,
      accountType: null,
      reason: input.hasProvider ? "no-installation" : "no-app",
    };
  }

  const packages = input.installation.permissions["packages"];
  return {
    available: true,
    installationId: input.installation.installationId,
    accountLogin: input.installation.accountLogin,
    accountType: input.installation.accountType === "Organization" ? "Organization" : "User",
    reason: packages === "read" || packages === "write" ? "ok" : "missing-packages-permission",
  };
}

/**
 * Should this lookup derive a GHCR credential instead of using the table?
 *
 * Only for GHCR, and only when the operator has NOT stored one. Someone who
 * typed a credential for ghcr.io meant it — quite possibly a bot account with
 * access to packages the App installation cannot see — and silently preferring
 * a derived token over their explicit choice is the kind of surprise that is
 * very hard to diagnose from a deploy log. The stored row wins.
 */
export function shouldDeriveGhcr(input: { host: string; storedCredentialCount: number }): boolean {
  return input.host === GHCR_HOST && input.storedCredentialCount === 0;
}

/**
 * Where an owner approves the App's updated permissions.
 *
 * Organization installs live under a different path than personal ones — the
 * same split the git-providers card already handles. Null when there is
 * nothing to approve, so the UI has one thing to check rather than two.
 */
export function installationPermissionUrl(capability: GhcrCapability): string | null {
  if (capability.reason !== "missing-packages-permission") return null;
  if (capability.installationId === null || capability.accountLogin === null) return null;
  return capability.accountType === "Organization"
    ? `https://github.com/organizations/${capability.accountLogin}/settings/installations/${capability.installationId}/permissions/update`
    : `https://github.com/settings/installations/${capability.installationId}/permissions/update`;
}
