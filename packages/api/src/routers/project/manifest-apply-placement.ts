/**
 * Resolve a manifest's portable `server: "<name>"` to this install's server id.
 *
 * The sibling of `manifest-apply-git.ts#resolveManifestRepo`, and it exists for
 * the same reason: the manifest addresses things by a name that survives being
 * checked into a repo, and apply is where that name meets one install's ids.
 *
 * A name this org does not have is a SKIP, not a silent "anywhere". The deploy
 * path deliberately degrades an unresolvable pin so a rollout is never blocked
 * by a dead node (swarm/resolve-placement.ts) — but that is a runtime accident,
 * whereas a manifest naming a machine that was never here is a manifest for a
 * different install. Creating the resource unpinned would look like success and
 * put its volume on whatever box the scheduler picked.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import { resolvePlacementByName } from "../../lib/placement-seed";
import { ManifestApplySkipError } from "./errors";

export async function resolveManifestPlacement(input: {
  serverName: string | undefined;
  organizationId: OrganizationId;
  /** For the skip message: which resource named the missing machine. */
  resource: "service" | "compose";
  name: string;
}): Promise<Result<ServerId | null, ManifestApplySkipError>> {
  const resolved = await resolvePlacementByName({
    serverName: input.serverName,
    organizationId: input.organizationId,
  });
  if (resolved.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: input.resource,
        name: input.name,
        reason: resolved.error.message,
      }),
    );
  }
  return Result.ok(resolved.value);
}
