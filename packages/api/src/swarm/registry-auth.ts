/**
 * Registry credentials resolver.
 *
 * Given an image reference like `ghcr.io/acme/api:latest`, returns the
 * credentials the daemon should use to pull it, or `null` for anonymous
 * (Docker Hub public images, etc.). The lookup runs at deploy time so
 * users can change a token without redeploying every service that
 * references the affected registry.
 *
 * Backed by the `container_registry` table introduced in the build-
 * pipeline phase. Passwords are encrypted at rest via
 * `encryptForDomain(..., "registry-creds")` (HKDF-derived AES-GCM, domain-
 * separated from every other secret category); we decrypt on each call
 * rather than caching plaintext.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { containerRegistry } from "@otterdeploy/db/schema";
import { idSchema } from "@otterdeploy/shared/id";
import { and, eq } from "drizzle-orm";

import type { RegistryAuth } from "./image-pull";

import { GHCR_HOST, deriveGhcrCredential, shouldDeriveGhcr } from "../git/ghcr-auth";
import { decryptForDomain } from "../lib/crypto";

/** The resolver's callers pass a plain string; the derivation path is typed on
 *  the branded id. Parsed rather than asserted, per the repo's no-assertions
 *  rule, and it throws only on an id that was never an organization id. */
function brandOrgId(value: string): OrganizationId {
  return idSchema.organization.parse(value);
}

/** Extract the registry hostname from an image ref. */
function imageRegistry(image: string): string {
  // No slash → bare image like "postgres" or "postgres:18" → docker.io.
  const slashIdx = image.indexOf("/");
  if (slashIdx === -1) return "docker.io";

  const firstSegment = image.slice(0, slashIdx);
  // A first segment with a dot, colon, or "localhost" is a host (e.g.
  // "ghcr.io", "registry:5000", "localhost:5000"). Otherwise it's a
  // Docker Hub user/org prefix.
  if (firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost") {
    return firstSegment;
  }
  return "docker.io";
}

/**
 * Resolve credentials for the given image's registry under the given org.
 * Returns null when no credentials are configured (public registries, or
 * the org hasn't added a credential for that host yet).
 *
 * If multiple credentials exist for the same host (e.g. a personal account
 * and a CI bot account), the most recently updated one wins. A credential
 * rotation is the strongest "use this one now" signal we have without
 * giving the user a per-image override surface.
 */
export async function resolveRegistryAuth(input: {
  image: string;
  organizationId: string;
}): Promise<RegistryAuth | null> {
  const host = imageRegistry(input.image);
  const rows = await db
    .select()
    .from(containerRegistry)
    .where(
      and(
        eq(containerRegistry.organizationId, input.organizationId),
        eq(containerRegistry.host, host),
      ),
    );

  // GHCR can be authenticated from the org's GitHub App instead of a stored
  // credential. Checked only when the operator has NOT typed one in: someone
  // who entered a credential for ghcr.io meant it — perhaps a bot account with
  // access to packages the App installation cannot see — and silently
  // preferring a derived token over their explicit choice would be the kind of
  // surprise that is very hard to debug from the deploy log.
  //
  // Derivation returns null on every failure, so this can only ever turn an
  // anonymous pull into an authenticated one, never break a working one.
  if (shouldDeriveGhcr({ host, storedCredentialCount: rows.length })) {
    const derived = await deriveGhcrCredential(brandOrgId(input.organizationId));
    if (derived) {
      return {
        username: derived.username,
        password: derived.password,
        serveraddress: GHCR_HOST,
      };
    }
  }

  if (rows.length === 0) return null;

  // Pick the most-recently-updated credential as the active one.
  const cred = rows.reduce((a, b) => (a.updatedAt.getTime() >= b.updatedAt.getTime() ? a : b));

  const password = await decryptForDomain(cred.encryptedPassword, "registry-creds");
  return {
    username: cred.username,
    password,
    // Docker expects the serveraddress field to be the host (no scheme).
    serveraddress: host,
  };
}
