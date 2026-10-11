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
import { isSwarmRuntime } from "../runtime";

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
 * The plain-Docker runtime talks to one Docker daemon: the one on the machine
 * otterdeploy runs on. Every container it starts lands there, whatever the
 * resource says, so a pin to any other server cannot be honoured. Accepting it
 * would record a placement the runtime then ignores: the resource reads as
 * living on the worker and runs on the control plane.
 */
export class PlacementNeedsSwarmError extends TaggedError("PlacementNeedsSwarmError")<{
  message: string;
  target: string;
}>() {
  constructor(args: { target: string }) {
    super({
      target: args.target,
      message: `This install runs services on the control plane only; placing one on "${args.target}" needs the Swarm runtime (DEPLOY_RUNTIME=swarm).`,
    });
  }
}

/** The bootstrap row's address: the machine otterdeploy itself runs on (see
 *  `bootstrapLocalhostIfMissing`). */
const CONTROL_PLANE_HOST = "127.0.0.1";

/**
 * Can the active runtime actually start a workload on this server?
 *
 * Swarm schedules onto any node. Plain Docker only onto the control plane, so
 * a pin there is satisfied by definition and a pin anywhere else is refused.
 */
function runnableOn(server: {
  name: string;
  host: string;
}): Result<void, PlacementNeedsSwarmError> {
  if (isSwarmRuntime() || server.host === CONTROL_PLANE_HOST) return Result.ok(undefined);
  return Result.err(new PlacementNeedsSwarmError({ target: server.name }));
}

/** The server an operator-supplied id names in this org, null for "no pin". */
async function serverById(input: {
  serverId: string | null | undefined;
  organizationId: OrganizationId;
}): Promise<
  Result<{ id: ServerId; name: string; host: string } | null, UnknownPlacementServerError>
> {
  const raw = input.serverId ?? null;
  if (raw === null || raw === "") return Result.ok(null);
  if (!hasPrefix(raw, ID_PREFIX.server)) {
    return Result.err(new UnknownPlacementServerError({ target: raw }));
  }
  const server = await getServerInOrg({ serverId: raw, organizationId: input.organizationId });
  if (!server) return Result.err(new UnknownPlacementServerError({ target: raw }));
  return Result.ok(server);
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
  const server = await serverById(input);
  if (server.isErr()) return Result.err(server.error);
  return Result.ok(server.value?.id ?? null);
}

/**
 * `resolvePlacementSeed` for where a workload RUNS: the same lookup, plus a
 * refusal when the runtime cannot start anything on that server. A build
 * server is a different question (a builder process drains its lane on any
 * runtime), which is why this is a second entry point rather than a change to
 * the first.
 */
export async function resolveRunPlacementSeed(input: {
  serverId: string | null | undefined;
  organizationId: OrganizationId;
}): Promise<Result<ServerId | null, UnknownPlacementServerError | PlacementNeedsSwarmError>> {
  const server = await serverById(input);
  if (server.isErr()) return Result.err(server.error);
  if (server.value === null) return Result.ok(null);
  const runnable = runnableOn(server.value);
  if (runnable.isErr()) return Result.err(runnable.error);
  return Result.ok(server.value.id);
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
}): Promise<Result<ServerId | null, UnknownPlacementServerError | PlacementNeedsSwarmError>> {
  const name = input.serverName?.trim() ?? "";
  if (name === "") return Result.ok(null);
  const server = await getServerByNameInOrg({ name, organizationId: input.organizationId });
  if (!server) return Result.err(new UnknownPlacementServerError({ target: name }));
  // A manifest names where a workload runs (there is no build-server field
  // in it), so the runtime has to be able to start one there.
  const runnable = runnableOn(server);
  if (runnable.isErr()) return Result.err(runnable.error);
  return Result.ok(server.id);
}
