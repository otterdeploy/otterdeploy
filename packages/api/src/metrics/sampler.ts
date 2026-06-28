import type { ResourceId } from "@otterdeploy/shared/id";
/**
 * Metrics sampler. On a fixed tick, lists otterdeploy-managed running
 * containers and records one CPU/memory/network sample each into
 * `resource_metric`, keyed by the `otterdeploy.resource.id` label.
 *
 * CPU% needs two stats frames (a delta), so we stream the Docker stats API and
 * read the second frame — its `precpu_stats` is populated from the first, which
 * a one-shot read can't give us. Each sample closes its stream immediately.
 */
import type { Readable } from "node:stream";

import { db } from "@otterdeploy/db";
import { resourceMetric } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { log } from "evlog";

import { healthFromStatus, recordHealthObservations } from "./health-detector";
import { samplePlatformMetrics } from "./platform";

const RESOURCE_ID_LABEL = "otterdeploy.resource.id";

interface DockerStatsFrame {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] | null };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: { usage?: number; limit?: number };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}

function computeCpuPct(f: DockerStatsFrame): number {
  const cur = f.cpu_stats ?? {};
  const prev = f.precpu_stats ?? {};
  const curUsage = cur.cpu_usage ?? {};
  const cpuDelta = (curUsage.total_usage ?? 0) - (prev.cpu_usage?.total_usage ?? 0);
  const systemDelta = (cur.system_cpu_usage ?? 0) - (prev.system_cpu_usage ?? 0);
  const onlineCpus = cur.online_cpus || (curUsage.percpu_usage?.length ?? 1);
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

function sumNetwork(f: DockerStatsFrame): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const net of Object.values(f.networks ?? {})) {
    rx += net.rx_bytes ?? 0;
    tx += net.tx_bytes ?? 0;
  }
  return { rx, tx };
}

/** Read the Docker stats stream and resolve the second JSON frame (with a
 *  populated precpu delta). Resolves null on timeout / parse failure. */
function readSecondFrame(stream: Readable, timeoutMs = 3000): Promise<DockerStatsFrame | null> {
  return new Promise((resolve) => {
    let buf = "";
    let frames = 0;
    const done = (value: DockerStatsFrame | null) => {
      stream.destroy();
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          frames++;
          if (frames >= 2) {
            try {
              done(JSON.parse(line) as DockerStatsFrame);
            } catch {
              done(null);
            }
            return;
          }
        }
        nl = buf.indexOf("\n");
      }
    });
    stream.on("error", () => done(null));
    stream.on("end", () => done(null));
  });
}

/** Read one container's stats frame into a metric row. Resolves null when the
 *  stats read fails or the second frame never arrives. */
async function readContainerMetric(
  docker: Docker,
  containerId: string,
  resourceId: ResourceId,
): Promise<typeof resourceMetric.$inferInsert | null> {
  const statsResult = await docker.containers.getContainer(containerId).stats({ stream: true });
  if (statsResult.isErr()) return null;

  const frame = await readSecondFrame(statsResult.value as Readable);
  if (!frame) return null;

  const net = sumNetwork(frame);
  return {
    resourceId,
    containerId,
    cpuPct: computeCpuPct(frame),
    memBytes: frame.memory_stats?.usage ?? 0,
    memLimitBytes: frame.memory_stats?.limit ?? 0,
    netRxBytes: net.rx,
    netTxBytes: net.tx,
  };
}

/** One sampling pass. Safe to call repeatedly; self-guards against overlap. */
let running = false;
export async function sampleAllContainers(): Promise<void> {
  if (running) return;
  running = true;
  const docker = Docker.fromEnv();
  try {
    const list = await docker.containers.list({
      all: false,
      filters: { label: ["otterdeploy.managed=true"] },
    });
    if (list.isErr()) return;

    const rows: Array<typeof resourceMetric.$inferInsert> = [];
    const healthObserved: Array<{ resourceId: ResourceId; health: "healthy" | "unhealthy" }> = [];
    for (const container of list.value) {
      const resourceId = container.Labels?.[RESOURCE_ID_LABEL];
      if (!resourceId) continue; // only chart label-tagged resources

      // Observe health BEFORE the (fallible) stats read so a stats hiccup never
      // hides a health transition. Only healthcheck-bearing containers signal.
      const health = healthFromStatus(container.Status);
      if (health) healthObserved.push({ resourceId: resourceId as ResourceId, health });

      const row = await readContainerMetric(docker, container.Id, resourceId as ResourceId);
      if (row) rows.push(row);
    }

    if (rows.length > 0) {
      await db.insert(resourceMetric).values(rows);
    }

    // Emit health.degraded / health.recovered on any flip vs the last tick.
    // Best-effort — guarded so it can never break sampling.
    await recordHealthObservations(healthObserved).catch(() => undefined);
  } catch (cause) {
    log.error({
      metrics: { step: "sample", status: "error" },
      error: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    running = false;
    docker.destroy();
  }
}

/** Start the periodic sampler. Returns a stop handle. Each tick samples both
 *  per-container stats and install-wide platform metrics (queue backlog). */
export function startMetricsSampler(intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    void sampleAllContainers();
    void samplePlatformMetrics();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
