/**
 * Extra-network resolution for service specs. A service always joins its
 * project network; `spec.extraNetworks` names ADDITIONAL operator-created
 * networks to join. These helpers are pure so the dedupe/skip rules
 * unit-test without a daemon; the swarm driver feeds `partitionExtraNetworks`
 * the live network list before building the docker spec, because a swarm
 * service create/update fails WHOLE if any target network is missing or not
 * an overlay: a deleted extra network must degrade to a logged skip, never
 * a bricked deploy.
 */

import type { Docker } from "@otterdeploy/docker";
import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";

/** Dedupe the requested extra networks and drop the always-on project
 *  network (it is attached unconditionally with the service's DNS aliases -
 *  listing it again would duplicate the endpoint). Preserves first-seen
 *  order so specs stay byte-stable across deploys. */
export function resolveExtraNetworkTargets(
  extraNetworks: readonly string[] | undefined,
  projectNetwork: string,
): string[] {
  if (!extraNetworks || extraNetworks.length === 0) return [];
  const out: string[] = [];
  for (const name of extraNetworks) {
    if (name === projectNetwork || name.length === 0 || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

export interface ExtraNetworkPartition {
  /** Networks that exist with the required driver: safe to put in the spec. */
  apply: string[];
  /** Requested names that can't be joined right now, with the reason. */
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Split requested extra networks into applyable vs skipped against the
 * daemon's live network list. `requiredDriver` is "overlay" under swarm
 * (tasks can only join overlay networks); the plain-docker driver doesn't
 * pre-filter: its per-network connect is already non-fatal.
 */
export function partitionExtraNetworks(
  requested: readonly string[],
  existing: ReadonlyArray<{ name: string; driver: string }>,
  requiredDriver: string,
): ExtraNetworkPartition {
  const byName = new Map(existing.map((n) => [n.name, n]));
  const apply: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const name of requested) {
    const net = byName.get(name);
    if (!net) {
      skipped.push({ name, reason: "network not found (deleted?)" });
    } else if (net.driver !== requiredDriver) {
      skipped.push({ name, reason: `driver is ${net.driver}, needs ${requiredDriver}` });
    } else {
      apply.push(name);
    }
  }
  return { apply, skipped };
}

/**
 * The swarm driver's pre-filter: resolve the spec's extra networks against
 * the daemon's live overlay networks, logging every skip. When the list API
 * itself errors the requested names pass through unfiltered: the daemon is
 * already unhealthy and the service create will report the real failure.
 */
export async function applyableSwarmExtraNetworks(
  docker: Docker,
  spec: { extraNetworks?: string[] | null },
  projectNetwork: string,
  rlog?: RequestLogger,
): Promise<string[]> {
  const log = asStepLogger(rlog);
  const requested = resolveExtraNetworkTargets(spec.extraNetworks ?? undefined, projectNetwork);
  if (requested.length === 0) return [];

  const listed = await docker.networks.list();
  if (listed.isErr()) {
    log.warn({
      swarm: { step: "list-networks-for-extras", error: listed.error.message },
    });
    return requested;
  }
  const { apply, skipped } = partitionExtraNetworks(
    requested,
    listed.value.map((n) => ({ name: n.Name, driver: n.Driver })),
    "overlay",
  );
  for (const skip of skipped) {
    log.warn({
      swarm: { step: "skip-extra-network", network: skip.name, reason: skip.reason },
    });
  }
  return apply;
}
