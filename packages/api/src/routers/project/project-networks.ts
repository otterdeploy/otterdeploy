/**
 * Take a deleted project's overlay networks down with it.
 *
 * Every deploy ensures `otterdeploy-<slug>` (plus `-<env>` per additional
 * environment, see swarm/network-name.ts), but nothing ever removed one: the
 * project delete had no network step, and the orphan GC that could remove
 * them was never handed any. Every deleted project left its overlay network
 * on the swarm, each still holding an endpoint for the edge.
 *
 * A network the daemon will not remove yet (a service of the project still
 * draining its tasks, or the daemon unreachable) is recorded for the orphan GC
 * to retry, the same as every other runtime object a delete could not reach.
 */
import type { EnvironmentId, OrganizationId, ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { networkScopeSuffix } from "../../lib/environment/scoping";
import { removeProjectNetwork } from "../../swarm";
import { projectNetworkName } from "../../swarm/network-name";
import { recordOrphanedResource } from "../../system-health/orphan-gc";
import { sanitizeSlug } from "../service/views";
import { sanitizeProjectSlug } from "./view-helpers";

export interface ProjectNetworkCandidate {
  networkName: string;
  /** The `otterdeploy.project` label the network carries if this project
   *  created it: removal is refused for any other value. */
  projectSlug: string;
}

/**
 * Every network name this project can have created: its main network and one
 * per additional environment. Both slug spellings are listed: services render
 * the slug through `sanitizeSlug` (capped at 32 characters) and databases
 * through `sanitizeProjectSlug` (uncapped), so a long slug can own two.
 */
export function projectNetworkCandidates(input: {
  slug: string;
  environments: ReadonlyArray<{ id: EnvironmentId; slug: string }>;
  mainEnvironmentId: EnvironmentId | null;
}): ProjectNetworkCandidate[] {
  const slugs = new Set([sanitizeProjectSlug(input.slug), sanitizeSlug(input.slug)]);
  const suffixes = new Set([
    "",
    ...input.environments.map((env) =>
      networkScopeSuffix({
        kind: "environment",
        slug: env.slug,
        isMain: env.id === input.mainEnvironmentId,
      }),
    ),
  ]);
  const out = new Map<string, ProjectNetworkCandidate>();
  for (const projectSlug of slugs) {
    for (const suffix of suffixes) {
      const networkName = projectNetworkName(projectSlug, suffix);
      out.set(networkName, { networkName, projectSlug });
    }
  }
  return [...out.values()];
}

/** Remove each candidate; one the daemon will not remove yet goes to the GC. */
export async function removeProjectNetworks(
  candidates: readonly ProjectNetworkCandidate[],
  owner: { organizationId: OrganizationId; projectId: ProjectId },
  log: RequestLogger,
): Promise<{ removed: string[]; deferred: string[] }> {
  const removed: string[] = [];
  const deferred: string[] = [];
  for (const candidate of candidates) {
    const outcome = await removeProjectNetwork(candidate, log);
    if (outcome.isOk()) {
      if (outcome.value === "removed") removed.push(candidate.networkName);
      continue;
    }
    deferred.push(candidate.networkName);
    await recordOrphanedResource({
      organizationId: owner.organizationId,
      projectId: owner.projectId,
      resourceType: "network",
      ref: candidate.networkName,
      label: `project network ${candidate.networkName}: ${outcome.error.message}`,
      payload: { projectSlug: candidate.projectSlug },
    });
  }
  return { removed, deferred };
}
