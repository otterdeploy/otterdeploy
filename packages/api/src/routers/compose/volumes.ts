/**
 * The named volumes a compose stack owns, and their removal on stack delete.
 *
 * `compose.delete` used to remove the swarm services, the routes, the rows and
 * the bind-mount dir, and stop there. Named volumes (`od-<stack>-<name>`, see
 * `composeVolumeName`) are deterministic on purpose so a REDEPLOY reattaches
 * the same data; the same determinism meant a DELETED stack's volumes were
 * silently adopted by the next stack created under that name. For a bundled
 * Postgres that is fatal: the image only honours POSTGRES_PASSWORD on an empty
 * data dir, the new stack mints a fresh password, and every client of the
 * database crash-loops on "password authentication failed" with nothing in
 * the product able to explain or undo it (`volumes.remove` refuses volumes a
 * stack claims, and the stack's delete didn't touch them).
 *
 * Removal is BEST-EFFORT and retried: swarm tears tasks down asynchronously
 * after the service is removed, so the first attempt often lands while the
 * container still references the volume. Nothing here can fail the delete;
 * the rows are already gone and the volume is reported, not raised.
 */
import type { RequestLogger } from "evlog";

import { composeVolumeName } from "./reconcile-map";

/** Docker volume names for every named volume the stack's services mount,
 *  deduped. Derived from the stored service summaries (which carry the
 *  compose-file volume sources) so it works for git stacks too, whose compose
 *  file is not stored inline. */
export function stackVolumeNames(
  services: ReadonlyArray<{ volumes: ReadonlyArray<string> }>,
  stackName: string,
): string[] {
  const names = new Set<string>();
  for (const svc of services) {
    for (const source of svc.volumes) names.add(composeVolumeName(stackName, source));
  }
  return [...names];
}

export interface ReclaimedVolumes {
  removed: string[];
  failed: Array<{ name: string; reason: string }>;
}

const RETRY_DELAY_MS = 2_000;
const MAX_ATTEMPTS = 15;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Remove each of `volumeNames`, waiting out the container teardown that
 * follows a swarm service removal. "Not found" counts as removed (already
 * gone, or never created because the service never mounted it). "In use"
 * retries; anything else, or in-use past the deadline, is reported as failed.
 */
export async function reclaimStackVolumes(
  volumeNames: ReadonlyArray<string>,
  log?: RequestLogger,
): Promise<ReclaimedVolumes> {
  const out: ReclaimedVolumes = { removed: [], failed: [] };
  if (volumeNames.length === 0) return out;
  // Lazy-imported for the same reason as service/teardown.ts: @otterdeploy/
  // docker loads env/server at import, which env-less callers (tests of the
  // pure name derivation above) must not pull in.
  const { Docker, DockerConflictError, DockerNotFoundError } = await import("@otterdeploy/docker");
  const docker = Docker.fromEnv();
  try {
    for (const name of volumeNames) {
      let reason = "in use";
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const removed = await docker.volumes.getVolume(name).remove({ force: true });
        if (removed.isOk() || removed.error instanceof DockerNotFoundError) {
          out.removed.push(name);
          reason = "";
          break;
        }
        reason = removed.error.message;
        if (!(removed.error instanceof DockerConflictError)) break;
        await sleep(RETRY_DELAY_MS);
      }
      if (reason) out.failed.push({ name, reason });
    }
  } finally {
    docker.destroy();
  }
  log?.set({ composeVolumes: { removed: out.removed, failed: out.failed } });
  return out;
}
