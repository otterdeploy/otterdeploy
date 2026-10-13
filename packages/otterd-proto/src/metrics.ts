/**
 * Metric samples, series markers, node signals and telemetry batches
 *; mirror of `metrics.rs`. Telemetry is lenient:
 * a newer node may add fields that this side strips.
 */
import * as z from "zod";

import { probeResult } from "./health";
import { u16, u53, wireId } from "./primitives";

export const MAX_NODE_DIMENSIONS = 16;
export const MAX_BATCH_ITEMS = 2_000;

export const METRIC_NAMES = [
  "host.cpu.used_pct",
  "host.cpu.user_pct",
  "host.cpu.system_pct",
  "host.cpu.iowait_pct",
  "host.cpu.steal_pct",
  "host.load.1",
  "host.load.5",
  "host.load.15",
  "host.mem.used_bytes",
  "host.mem.total_bytes",
  "host.mem.cached_bytes",
  "host.mem.arc_bytes",
  "host.swap.used_bytes",
  "host.swap.total_bytes",
  "fs.used_bytes",
  "fs.total_bytes",
  "disk.read_bytes_per_sec",
  "disk.write_bytes_per_sec",
  "disk.util_pct",
  "net.rx_bytes_per_sec",
  "net.tx_bytes_per_sec",
  "container.cpu_pct",
  "container.mem_bytes",
  "container.mem_limit_bytes",
  "container.net.rx_bytes_per_sec",
  "container.net.tx_bytes_per_sec",
  "container.healthy",
  "systemd.unit_active",
  "zfs.pool_online",
  "zfs.pool_used_bytes",
] as const;
export const metricName = z.enum(METRIC_NAMES);

export const metricIdentity = z.object({
  installId: wireId,
  orgId: wireId.optional(),
  subjectId: wireId,
  generation: u53.optional(),
  attemptId: wireId.optional(),
  nodeId: wireId,
  nodeEpoch: u53,
  bootId: wireId,
  sampleSeq: u53,
  dimensionSet: z.string(),
  schemaVersion: u16,
});

export const metricSample = z.object({
  identity: metricIdentity,
  observedAtUnixMs: u53,
  clockUncertaintyMs: u53,
  intervalMs: u53,
  ttlMs: u53,
  /** `null` = not measured this round; never coerce to zero. */
  values: z.array(z.object({ name: metricName, value: z.number().nullable() })),
});

export const seriesMarker = z.object({
  kind: z.enum([
    "boot",
    "gap-start",
    "gap-end",
    "tombstone",
    "maintenance-start",
    "maintenance-end",
  ]),
  atUnixMs: u53,
  seq: u53,
  subjectId: wireId.optional(),
  dimensionSet: z.string().optional(),
});

export const SIGNAL_KINDS = [
  "firewall-drift",
  "docker-rules-missing",
  "mesh-peer-blocked",
  "vip-receiver-stalled",
  "dns-responder-down",
  "engine-unreachable",
  "watchdog-restart",
  "boot-quarantine",
  "probe-capacity",
] as const;

export const nodeSignal = z.object({
  kind: z.enum(SIGNAL_KINDS),
  active: z.boolean(),
  sinceUnixMs: u53,
  detail: z.string().optional(),
});

export const sampleBatch = z.object({
  batchId: wireId,
  nodeId: wireId,
  nodeEpoch: u53,
  bootId: wireId,
  /** Live observation versus replay: replay corrects history, never raises a current alert. */
  live: z.boolean(),
  probes: z.array(probeResult).optional(),
  metrics: z.array(metricSample).optional(),
  markers: z.array(seriesMarker).optional(),
  signals: z.array(nodeSignal).optional(),
});
export type SampleBatch = z.infer<typeof sampleBatch>;

export const batchDisposition = z.enum(["accepted", "deferred", "refused"]);
