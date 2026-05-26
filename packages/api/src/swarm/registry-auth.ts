/**
 * Registry credentials resolver.
 *
 * Given an image reference like `ghcr.io/acme/api:latest`, returns the
 * credentials the daemon should use to pull it — or `null` for anonymous
 * (Docker Hub public images, etc.). The lookup runs at deploy time so
 * users can change a token without redeploying every service that
 * references the affected registry.
 *
 * Today the function is a stub: there's no credentials table yet, so it
 * always returns null. Wiring the call sites now (createPostgresStream,
 * provisionSwarmService, etc.) means a future "Registry credentials"
 * settings page only needs a single point of integration — add a DB
 * lookup here and every pull picks up the auth automatically.
 *
 * When the storage layer lands, the planned shape is:
 *   table registry_credential {
 *     id, organizationId, host, username, encryptedPassword, createdAt
 *   }
 * with `host` matched against the image's registry host (the part before
 * the first `/`, defaulting to `docker.io` when omitted).
 */

import type { RegistryAuth } from "./image-pull";

/** Extract the registry hostname from an image ref. */
function imageRegistry(image: string): string {
  // No slash → bare image like "postgres" or "postgres:18" → docker.io.
  const slashIdx = image.indexOf("/");
  if (slashIdx === -1) return "docker.io";

  const firstSegment = image.slice(0, slashIdx);
  // A first segment with a dot, colon, or "localhost" is a host (e.g.
  // "ghcr.io", "registry:5000", "localhost:5000"). Otherwise it's a
  // Docker Hub user/org prefix.
  if (
    firstSegment.includes(".") ||
    firstSegment.includes(":") ||
    firstSegment === "localhost"
  ) {
    return firstSegment;
  }
  return "docker.io";
}

/**
 * Resolve credentials for the given image's registry under the given org.
 * Returns null when no credentials are configured (public registries +
 * the current bootstrap state where no credential table exists yet).
 */
export async function resolveRegistryAuth(_input: {
  image: string;
  organizationId: string;
}): Promise<RegistryAuth | null> {
  // Stub. When the registry-credential table lands, query by
  // (organizationId, host = imageRegistry(image)) and return the row's
  // username + decrypted password + serveraddress.
  void imageRegistry(_input.image);
  return null;
}
