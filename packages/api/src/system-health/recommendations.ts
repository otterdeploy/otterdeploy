/**
 * Turn a host-health snapshot into the actionable recommendation list —
 * shared by the UI card and the monitor's notification thresholds so both
 * always agree. Split out of host-health.ts (which keeps the reading side)
 * when the branching-pool block joined memory/disk/docker.
 */
import type { BranchPoolHealth } from "./branch-pool";
import type { DockerUsage, HealthRecommendation, HostDisk, HostMemory } from "./host-health";

const GB = 1024 * 1024 * 1024;

function gb(bytes: number): string {
  return `${(bytes / GB).toFixed(1)} GB`;
}

function dockerRecommendations(docker: DockerUsage): HealthRecommendation[] {
  const recs: HealthRecommendation[] = [];
  if (docker.images.reclaimableBytes >= 2 * GB) {
    recs.push({
      id: "images-reclaimable",
      severity: "warning",
      title: `${gb(docker.images.reclaimableBytes)} in unused images`,
      detail: `${docker.images.count - docker.images.activeCount} images aren't used by any container (old deploy images accumulate here). Safe to remove — anything needed again is re-pulled.`,
      action: "images",
    });
  }
  if (docker.buildCache.reclaimableBytes >= 5 * GB) {
    recs.push({
      id: "build-cache-reclaimable",
      severity: "info",
      title: `${gb(docker.buildCache.reclaimableBytes)} of idle build cache`,
      detail:
        "BuildKit keeps layer caches to speed up rebuilds. Clearing it slows the next build of each service but frees the space immediately.",
      action: "build-cache",
    });
  }
  return recs;
}

function branchPoolRecommendations(branchPool: BranchPoolHealth): HealthRecommendation[] {
  const recs: HealthRecommendation[] = [];
  if (branchPool.health && branchPool.health !== "ONLINE") {
    recs.push({
      id: "branch-pool-unhealthy",
      severity: "critical",
      title: `Branching pool is ${branchPool.health}`,
      detail: `ZFS pool '${branchPool.pool}' is not healthy — branch databases on it may hang or lose writes. A SUSPENDED file-backed pool usually means the host disk ran out under it; free space, then \`zpool clear ${branchPool.pool}\`.`,
      action: null,
    });
  }
  if (branchPool.reclaimableBytes >= 1 * GB) {
    recs.push({
      id: "branch-pool-reclaimable",
      severity: branchPool.reclaimableBytes >= 5 * GB ? "warning" : "info",
      title: `${gb(branchPool.reclaimableBytes)} of freed branch data still held on disk`,
      detail: `Deleted branch databases freed space inside pool '${branchPool.pool}', but the sparse image file keeps those blocks materialized until trimmed. Trimming returns them to the host${branchPool.autotrim === false ? " and enables autotrim so this stops accumulating" : ""}.`,
      action: "branch-pool",
    });
  }
  if (branchPool.suggestGrowBytes != null) {
    recs.push({
      id: "branch-pool-capacity",
      severity: "warning",
      title: "Branching pool is filling up",
      detail: `Pool '${branchPool.pool}' is over 70% full. The host disk has headroom — grow the pool by ${gb(branchPool.suggestGrowBytes)} from the card below before branch databases run out of space.`,
      action: null,
    });
  }
  return recs;
}

export function deriveRecommendations(
  memory: HostMemory,
  disk: HostDisk | null,
  docker: DockerUsage | null,
  branchPool: BranchPoolHealth | null = null,
): HealthRecommendation[] {
  const recs: HealthRecommendation[] = [];
  const pruneHint = docker && docker.images.reclaimableBytes >= 1 * GB;

  if (memory.usedPct >= 90) {
    recs.push({
      id: "memory-critical",
      severity: "critical",
      title: "Server memory is nearly exhausted",
      detail: `${gb(memory.availableBytes)} of ${gb(memory.totalBytes)} available (${memory.usedPct}% used). Builds and deploys can be OOM-killed at this level.${pruneHint ? ` ${gb(docker.images.reclaimableBytes)} of unused images can be reclaimed.` : ""}`,
      action: pruneHint ? "images" : null,
    });
  }
  if (memory.swapTotalBytes === 0) {
    recs.push({
      id: "no-swap",
      severity: memory.totalBytes < 4 * GB ? "warning" : "info",
      title: "No swap configured",
      detail:
        "Without swap, a memory spike during a build kills the process instead of slowing down. Adding 2–4 GB of swap makes builds on small servers far more reliable.",
      action: null,
    });
  }
  if (disk && disk.usedPct >= 85) {
    recs.push({
      id: "disk-pressure",
      severity: disk.usedPct >= 95 ? "critical" : "warning",
      title: `Disk ${disk.usedPct}% full`,
      detail: `${gb(disk.freeBytes)} free on ${disk.path}. Deploys fail once image pulls can't be written.`,
      action: docker && docker.images.reclaimableBytes > 0 ? "images" : null,
    });
  }
  if (docker) recs.push(...dockerRecommendations(docker));
  if (branchPool) recs.push(...branchPoolRecommendations(branchPool));
  return recs;
}
