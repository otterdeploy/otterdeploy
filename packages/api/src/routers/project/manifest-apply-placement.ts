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

import type { Manifest } from "../../stack/manifest";

import { PlacementNeedsSwarmError, resolvePlacementByName } from "../../lib/placement-seed";
import { isSwarmRuntime } from "../../runtime";
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

/**
 * Every server a manifest names for something to RUN on, keyed by where it is
 * named: a service, a stack, or a service inside an environment override.
 */
function namedPlacements(manifest: Manifest | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!manifest) return out;
  for (const [name, spec] of Object.entries(manifest.services)) {
    if (spec.server) out.set(`service:${name}`, spec.server);
  }
  for (const [name, spec] of Object.entries(manifest.composes)) {
    if (spec.server) out.set(`compose:${name}`, spec.server);
  }
  for (const [env, block] of Object.entries(manifest.environments ?? {})) {
    for (const [name, spec] of Object.entries(block.services ?? {})) {
      if (spec?.server) out.set(`${env}:service:${name}`, spec.server);
    }
  }
  return out;
}

/**
 * Refuse, at stage time, a placement the runtime cannot honour.
 *
 * Only a server this save NEWLY names is checked. One already in the stored
 * manifest was accepted before and is reported by apply; refusing it here
 * would block every unrelated edit to the project. An unknown name is left
 * to apply too: a manifest is portable, and apply already says which machine
 * this install does not have.
 */
export async function refuseUnrunnablePlacement(input: {
  previous: Manifest | null;
  next: Manifest;
  organizationId: OrganizationId;
}): Promise<Result<void, PlacementNeedsSwarmError>> {
  // Swarm schedules onto any node: nothing to refuse, and no query to run.
  if (isSwarmRuntime()) return Result.ok(undefined);
  const before = namedPlacements(input.previous);
  for (const [where, serverName] of namedPlacements(input.next)) {
    if (before.get(where) === serverName) continue;
    const resolved = await resolvePlacementByName({
      serverName,
      organizationId: input.organizationId,
    });
    if (resolved.isErr() && PlacementNeedsSwarmError.is(resolved.error)) {
      return Result.err(resolved.error);
    }
  }
  return Result.ok(undefined);
}
