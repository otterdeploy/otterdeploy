/**
 * `migrate.detect` for a chosen server, rather than only the control plane.
 *
 * Connecting is the part with failure modes worth naming, so they are named
 * rather than collapsed into an empty list. "No platforms found here" and
 * "we could not look" are different answers, and reporting the second as the
 * first is how a Coolify install stays invisible on a box otterdeploy is
 * about to provision an edge proxy onto (od-90a6).
 */

import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { idSchema } from "@otterdeploy/shared/id";

import type { DetectedPlatform } from "./coolify";

import { decryptForDomain } from "../../lib/crypto";
import { getServerInOrg } from "../server/queries";
import { SshSession } from "../server/ssh-exec";
import { getSshKeyInOrg } from "../sshKeys/queries";
import { matchPlatforms } from "./coolify";
import { listRemoteContainers } from "./detect-remote";

export interface ServerDetection {
  serverId: ServerId;
  serverName: string;
  platforms: DetectedPlatform[];
  /** Why the scan could not run, or null when it did. */
  unreachable: string | null;
}

/**
 * Scan one server.
 *
 * Never throws: a detection sweep over several servers must report the ones it
 * could read rather than failing on the first box that is down.
 */
export async function detectPlatformsOnServer(input: {
  serverId: ServerId;
  organizationId: OrganizationId;
}): Promise<ServerDetection> {
  const server = await getServerInOrg(input);
  if (!server) {
    return {
      serverId: input.serverId,
      serverName: input.serverId,
      platforms: [],
      unreachable: "That server is not in this workspace.",
    };
  }

  const base = { serverId: server.id, serverName: server.name, platforms: [] };

  // The bootstrap localhost row IS the control plane, and reaching it over SSH
  // would be both wasteful and less reliable than the daemon we already hold.
  // Callers route that case to `detectPlatforms()`; saying so here keeps the
  // failure legible if one forgets.
  if (server.sshKeyId === null) {
    return {
      ...base,
      unreachable:
        "This server has no stored SSH key, so it cannot be scanned. A node joined with a " +
        "one-time password keeps no credential to reconnect with: re-add it with a managed key.",
    };
  }

  const keyId: SshKeyId = idSchema.sshKey.parse(server.sshKeyId);
  const key = await getSshKeyInOrg({ id: keyId, organizationId: input.organizationId });
  if (!key?.privateKeyCiphertext) {
    return { ...base, unreachable: "The server's SSH key has no private half stored." };
  }

  let session: SshSession | undefined;
  try {
    const privateKey = await decryptForDomain(key.privateKeyCiphertext, "ssh-keys");
    session = await SshSession.connect({
      host: server.host,
      port: server.sshPort,
      user: server.sshUser,
      privateKey,
    });
    const containers = await listRemoteContainers(session);
    return { ...base, platforms: matchPlatforms(containers), unreachable: null };
  } catch (error) {
    return {
      ...base,
      unreachable: error instanceof Error ? error.message : String(error),
    };
  } finally {
    session?.dispose();
  }
}
