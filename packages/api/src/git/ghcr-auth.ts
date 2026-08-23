/**
 * GHCR credentials derived from the org's GitHub App installation.
 *
 * `ghcr.io` accepts an installation access token as a registry password:
 *
 *     docker login ghcr.io -u x-access-token --password-stdin
 *
 * which means an org that has already connected the GitHub App needs no
 * container-registry credential at all for its own packages. Nothing to
 * create, nothing to rotate, and — the part that matters — no long-lived
 * secret sitting in `container_registry` waiting to leak.
 *
 * Only GHCR. Docker Hub and every other registry are unrelated identity
 * providers where no GitHub credential works, so they keep the stored path
 * untouched.
 *
 * ## The expiry rule
 *
 * Installation tokens last about an hour. Every caller here MUST mint at the
 * moment the credential is used, never at the moment work is scheduled. A
 * token minted when a build is enqueued and used when it finally runs is the
 * bug this module exists to prevent, and it fails as a bare `docker login`
 * auth error hours away from its cause.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { gitInstallation, gitProvider } from "@otterdeploy/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "evlog";

import {
  GHCR_HOST,
  GHCR_TOKEN_USERNAME,
  type GhcrCapability,
  decideGhcrCapability,
} from "./ghcr-policy";
import { GithubInstallationInvalidError, getInstallationToken } from "./github-app-core";

/**
 * Can this org authenticate to GHCR through its GitHub App?
 *
 * Two selects and no branching: the decision itself is in ./ghcr-policy.ts,
 * where it can be tested without a database.
 */
export async function orgGhcrCapability(organizationId: OrganizationId): Promise<GhcrCapability> {
  const [row] = await db
    .select({
      installationId: gitInstallation.installationId,
      accountLogin: gitInstallation.accountLogin,
      accountType: gitInstallation.accountType,
      permissions: gitInstallation.permissions,
    })
    .from(gitInstallation)
    .innerJoin(gitProvider, eq(gitInstallation.providerId, gitProvider.id))
    .where(
      and(
        eq(gitProvider.organizationId, organizationId),
        eq(gitProvider.kind, "github"),
        // A suspended or revoked install cannot mint anything.
        isNull(gitInstallation.suspendedAt),
        isNull(gitInstallation.revokedAt),
      ),
    )
    .limit(1);

  if (row) return decideGhcrCapability({ installation: row, hasProvider: true });

  const [provider] = await db
    .select({ id: gitProvider.id })
    .from(gitProvider)
    .where(and(eq(gitProvider.organizationId, organizationId), eq(gitProvider.kind, "github")))
    .limit(1);
  return decideGhcrCapability({ installation: null, hasProvider: Boolean(provider) });
}

/** A registry credential derived at the moment of use. */
export interface DerivedRegistryCredential {
  username: string;
  password: string;
  host: string;
  /** For the audit trail. Never log the password alongside it. */
  installationId: string;
}

/**
 * Mint a GHCR credential for this org, or null when one cannot be derived.
 *
 * Never throws. Every failure — no App, no installation, GitHub no longer
 * recognising the installation, a transport error — returns null so the caller
 * falls back to whatever it did before. This path can make an unauthenticated
 * pull authenticated; it must never make a working pull start failing.
 */
export async function deriveGhcrCredential(
  organizationId: OrganizationId,
): Promise<DerivedRegistryCredential | null> {
  const capability = await orgGhcrCapability(organizationId);
  if (!capability.available || capability.installationId === null) return null;

  try {
    const minted = await getInstallationToken(capability.installationId);
    // A durable record that a derived credential was used, and for which
    // installation. Never the token, and never its length or prefix: the whole
    // point of deriving is that no GHCR secret exists outside the ~hour it is
    // alive, and a log line is exactly the place that guarantee gets broken.
    log.info({
      registry: {
        event: "ghcr-derived",
        host: GHCR_HOST,
        organizationId,
        installationId: capability.installationId,
      },
    });
    return {
      username: GHCR_TOKEN_USERNAME,
      password: minted.token,
      host: GHCR_HOST,
      installationId: capability.installationId,
    };
  } catch (error) {
    log.warn({
      registry: {
        event: "ghcr-derive-failed",
        host: GHCR_HOST,
        installationId: capability.installationId,
        // A 404 means GitHub no longer has this installation, which is an
        // operator-actionable "reinstall the App" rather than an outage.
        invalidInstallation: error instanceof GithubInstallationInvalidError,
      },
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
