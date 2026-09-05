/**
 * Validate a create-time placement target: "run this on that machine".
 *
 * Placement has exactly ONE writable surface — `routers/service/placement.ts`
 * — because CHANGING it has to roll the service to take effect, and two
 * surfaces disagreeing means a resource that says it lives on one machine and
 * runs on another. This does not add a second one. At create there is no
 * running task to move, so the value is a SEED that simply rides the first
 * rollout, the same shape as `exposedSeeds` in the stack reconciler: applied
 * once, owned by Settings from then on.
 *
 * Why validate here instead of letting the deploy sort it out: at deploy time
 * an unresolvable pin DEGRADES to "schedule anywhere" (see
 * swarm/resolve-placement.ts), which is right for a rollout that must not be
 * blocked by a dead node, and wrong for a form the operator just submitted.
 * Silently ignoring the machine they picked is how you get a database whose
 * volume is on the wrong disk and nobody knows why. So a bad target is an
 * error at the boundary and a warning at deploy.
 */

import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { hasPrefix, ID_PREFIX } from "@otterdeploy/shared/id";
import { Result, TaggedError } from "better-result";

import { getServerByNameInOrg, getServerInOrg } from "../routers/server/queries";

/** `target` is whatever the caller was given — an id from a form, a name from
 *  a manifest — so the message can quote it back verbatim. */
export class UnknownPlacementServerError extends TaggedError("UnknownPlacementServerError")<{
  message: string;
  target: string;
}>() {
  constructor(args: { target: string }) {
    super({
      target: args.target,
      message: `"${args.target}" is not a server in this organization`,
    });
  }
}

/**
 * Narrow an operator-supplied server id to a `ServerId` that exists in this
 * org, or `null` for "let the scheduler place it" (the default).
 *
 * The brand is recovered by a real prefix check plus the org lookup, never an
 * assertion: an id that is not a server id, or belongs to someone else's org,
 * comes back as the same typed error either way, so the caller cannot leak
 * cross-tenant existence by telling the two apart.
 */
export async function resolvePlacementSeed(input: {
  serverId: string | null | undefined;
  organizationId: OrganizationId;
}): Promise<Result<ServerId | null, UnknownPlacementServerError>> {
  const raw = input.serverId ?? null;
  if (raw === null || raw === "") return Result.ok(null);
  if (!hasPrefix(raw, ID_PREFIX.server)) {
    return Result.err(new UnknownPlacementServerError({ target: raw }));
  }
  const server = await getServerInOrg({ serverId: raw, organizationId: input.organizationId });
  if (!server) return Result.err(new UnknownPlacementServerError({ target: raw }));
  return Result.ok(server.id);
}

/**
 * The manifest's flavour of the same thing: a server NAME, not an id.
 *
 * Kept separate from `resolvePlacementSeed` rather than folded into one
 * "id-or-name" resolver, because guessing which one a string is means a server
 * literally named after an id resolves to the wrong machine, and the two
 * callers always know which they hold.
 *
 * An unknown NAME is an error, not a fallback to "anywhere": a manifest that
 * names a machine this install does not have is a manifest written for a
 * different install, and applying it half-way is worse than refusing it.
 */
export async function resolvePlacementByName(input: {
  serverName: string | null | undefined;
  organizationId: OrganizationId;
}): Promise<Result<ServerId | null, UnknownPlacementServerError>> {
  const name = input.serverName?.trim() ?? "";
  if (name === "") return Result.ok(null);
  const server = await getServerByNameInOrg({ name, organizationId: input.organizationId });
  if (!server) return Result.err(new UnknownPlacementServerError({ target: name }));
  return Result.ok(server.id);
}
