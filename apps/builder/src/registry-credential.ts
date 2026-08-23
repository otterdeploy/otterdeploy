/**
 * How the builder gets a password for `docker login`, resolved at the moment
 * of the push and never before.
 *
 * The pipeline used to carry the whole `container_registry` row and decrypt it
 * inside the push step. That worked because a stored credential is valid for
 * as long as it sits in the table. A GHCR credential derived from the GitHub
 * App is not: an installation access token lives about an hour, and a build
 * that waits in the queue — or a slow multi-stage image — would push with a
 * token minted before the wait and fail at `docker login` with a bare auth
 * error, hours of log away from the cause.
 *
 * So the context carries a DESCRIPTOR of where the credential comes from, and
 * {@link resolvePushCredentials} turns it into a password immediately before
 * `dockerPush`. That keeps the late-resolution property the encrypted column
 * gave us for free, and makes it structurally impossible to mint early.
 */

import type { OrganizationId } from "@otterdeploy/shared/id";

import { GHCR_HOST, deriveGhcrCredential } from "@otterdeploy/api/git/ghcr-auth";
import { decryptSecret } from "@otterdeploy/api/lib/crypto";

import type { PushCredentials } from "./docker-push";

/**
 * Where a push credential comes from.
 *
 * `stored` carries the ciphertext, not the password: the plaintext should not
 * exist any earlier in the pipeline than it has to.
 */
export type RegistryCredentialSource =
  | {
      kind: "stored";
      host: string;
      username: string;
      encryptedPassword: string;
    }
  | {
      kind: "github-app";
      host: typeof GHCR_HOST;
      organizationId: OrganizationId;
    };

/** Thrown when a derivation that looked available at load time fails at push
 *  time — the installation was revoked mid-build, or GitHub is down. Named so
 *  the pipeline reports something an operator can act on instead of a
 *  `docker login` exit code. */
export class RegistryCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryCredentialError";
  }
}

export async function resolvePushCredentials(
  source: RegistryCredentialSource,
): Promise<PushCredentials> {
  if (source.kind === "stored") {
    return {
      host: source.host,
      username: source.username,
      password: await decryptSecret(source.encryptedPassword),
    };
  }

  const derived = await deriveGhcrCredential(source.organizationId);
  if (!derived) {
    throw new RegistryCredentialError(
      `could not mint a ${GHCR_HOST} token from the GitHub App installation. Re-install the App, or add a ${GHCR_HOST} credential under Registries`,
    );
  }
  return { host: derived.host, username: derived.username, password: derived.password };
}
