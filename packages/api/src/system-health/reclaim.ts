/**
 * Space reclamation — the one-click fixes behind the health recommendations.
 * Three deliberately safe targets:
 *
 *   images      → `image prune` with dangling=false (all images unused by any
 *                 container — old deploy images live here; re-pulled if needed)
 *   build-cache → BuildKit cache prune (idle entries only; next build re-warms)
 *   containers  → stopped containers, LIMITED to otterdeploy-managed ones so a
 *                 shared host's other stopped containers are never touched
 *
 * Volumes are intentionally NOT reclaimable from here: an unreferenced volume
 * can be a detached database's data. That stays a manual, informed decision.
 */
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import { log } from "evlog";

import type { ReclaimTarget } from "./host-health";

export interface ReclaimResult {
  target: ReclaimTarget;
  ok: boolean;
  reclaimedBytes: number;
  error: string | null;
}

async function pruneOne(docker: Docker, target: ReclaimTarget): Promise<ReclaimResult> {
  const run = async (): Promise<number> => {
    switch (target) {
      case "images": {
        const res = await docker.images.prune({ filters: { dangling: ["false"] } });
        if (res.isErr()) throw res.error;
        return res.value.SpaceReclaimed;
      }
      case "build-cache": {
        const res = await docker.system.pruneBuilder({ all: true });
        if (res.isErr()) throw res.error;
        return res.value.SpaceReclaimed;
      }
      case "containers": {
        const res = await docker.containers.prune({
          filters: { label: ["otterdeploy.managed=true"] },
        });
        if (res.isErr()) throw res.error;
        return res.value.SpaceReclaimed;
      }
    }
  };

  const pruned = await Result.tryPromise({ try: run, catch: (cause) => cause });
  if (pruned.isErr()) {
    const message = pruned.error instanceof Error ? pruned.error.message : String(pruned.error);
    log.warn({ health: { step: "reclaim", target }, error: message });
    return { target, ok: false, reclaimedBytes: 0, error: message };
  }
  return { target, ok: true, reclaimedBytes: pruned.value, error: null };
}

/** Run the requested prunes in sequence (they contend on the daemon anyway).
 *  Per-target failures are reported, never thrown — a locked build cache must
 *  not stop the image prune from freeing space. */
export async function reclaimSpace(targets: ReclaimTarget[]): Promise<{
  results: ReclaimResult[];
  reclaimedBytes: number;
}> {
  const docker = Docker.fromEnv();
  try {
    const results: ReclaimResult[] = [];
    for (const target of new Set(targets)) {
      results.push(await pruneOne(docker, target));
    }
    const reclaimedBytes = results.reduce((sum, r) => sum + r.reclaimedBytes, 0);
    log.info({ health: { step: "reclaim-done", reclaimedBytes, targets } });
    return { results, reclaimedBytes };
  } finally {
    docker.destroy();
  }
}
