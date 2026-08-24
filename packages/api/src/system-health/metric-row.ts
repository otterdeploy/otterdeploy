/**
 * Health report → `server_metric` row.
 *
 * The ingest payload is deliberately loose (agents and the control plane skew
 * by design), so the numeric series is PARSED out of it here rather than read
 * off a trusted shape: every field is optional, an old agent's payload yields
 * a row with the columns it can fill and nulls elsewhere, and a payload with
 * no readable memory block yields no row at all rather than a row of zeros.
 */
import * as z from "zod";

const numeric = z.number();

/** Bytes go into bigint columns, which want integers. */
function bytes(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(value);
}

function nullable(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : value;
}

/** Sum a per-device/per-interface rate across the whole host. A missing list
 *  stays null (nothing was reported), an empty list sums to 0 (the reporter
 *  looked and there was no traffic). */
function sumRates<T>(
  items: T[] | null | undefined,
  pick: (item: T) => number | undefined,
): number | null {
  if (!items) return null;
  return Math.round(items.reduce((total, item) => total + (pick(item) ?? 0), 0));
}

const healthSchema = z.looseObject({
  memory: z
    .looseObject({
      totalBytes: numeric.optional(),
      availableBytes: numeric.optional(),
      usedPct: numeric.optional(),
      swapTotalBytes: numeric.nullish(),
      swapFreeBytes: numeric.nullish(),
      buffersBytes: numeric.nullish(),
      cachedBytes: numeric.nullish(),
      zfsArcBytes: numeric.nullish(),
    })
    .optional(),
  disk: z.looseObject({ usedPct: numeric.optional(), freeBytes: numeric.optional() }).nullish(),
  cpu: z
    .looseObject({
      usedPct: numeric.optional(),
      breakdown: z
        .looseObject({
          userPct: numeric.optional(),
          systemPct: numeric.optional(),
          iowaitPct: numeric.optional(),
          stealPct: numeric.optional(),
        })
        .optional(),
    })
    .nullish(),
  load: z
    .looseObject({
      load1: numeric.optional(),
      load5: numeric.optional(),
      load15: numeric.optional(),
    })
    .nullish(),
  diskIo: z
    .array(
      z.looseObject({
        readBytesPerSec: numeric.optional(),
        writeBytesPerSec: numeric.optional(),
      }),
    )
    .nullish(),
  network: z
    .array(
      z.looseObject({
        rxBytesPerSec: numeric.optional(),
        txBytesPerSec: numeric.optional(),
      }),
    )
    .nullish(),
});

/** The series columns of `server_metric`, minus the row identity the caller
 *  supplies (seq/serverId/organizationId/ts). */
export interface ServerMetricValues {
  cpuPct: number | null;
  cpuUserPct: number | null;
  cpuSystemPct: number | null;
  cpuIowaitPct: number | null;
  cpuStealPct: number | null;
  memUsedPct: number;
  memAvailableBytes: number;
  memTotalBytes: number;
  memCachedBytes: number | null;
  memBuffersBytes: number | null;
  zfsArcBytes: number | null;
  swapUsedPct: number | null;
  diskUsedPct: number | null;
  diskFreeBytes: number | null;
  diskReadBytesPerSec: number | null;
  diskWriteBytesPerSec: number | null;
  loadAvg1: number | null;
  loadAvg5: number | null;
  loadAvg15: number | null;
  netRxBytesPerSec: number | null;
  netTxBytesPerSec: number | null;
}

type ParsedHealth = z.infer<typeof healthSchema>;
type ParsedMemory = NonNullable<ParsedHealth["memory"]>;

/** The memory block, minus the three fields the caller has already proved
 *  present. A host with no swap configured reports null, not 0% or NaN. */
function memoryValues(
  memory: ParsedMemory,
): Pick<ServerMetricValues, "memCachedBytes" | "memBuffersBytes" | "zfsArcBytes" | "swapUsedPct"> {
  const swapTotal = memory.swapTotalBytes;
  const swapFree = memory.swapFreeBytes ?? 0;
  return {
    memCachedBytes: bytes(memory.cachedBytes),
    memBuffersBytes: bytes(memory.buffersBytes),
    zfsArcBytes: bytes(memory.zfsArcBytes),
    swapUsedPct:
      swapTotal !== null && swapTotal !== undefined && swapTotal > 0
        ? ((swapTotal - swapFree) / swapTotal) * 100
        : null,
  };
}

function cpuValues(
  cpu: ParsedHealth["cpu"],
): Pick<
  ServerMetricValues,
  "cpuPct" | "cpuUserPct" | "cpuSystemPct" | "cpuIowaitPct" | "cpuStealPct"
> {
  return {
    cpuPct: nullable(cpu?.usedPct),
    cpuUserPct: nullable(cpu?.breakdown?.userPct),
    cpuSystemPct: nullable(cpu?.breakdown?.systemPct),
    cpuIowaitPct: nullable(cpu?.breakdown?.iowaitPct),
    cpuStealPct: nullable(cpu?.breakdown?.stealPct),
  };
}

/** Per-device and per-interface rates, summed to one host-wide figure each.
 *  The per-device detail stays in the snapshot payload; the series charts the
 *  machine. */
function rateValues(
  diskIo: ParsedHealth["diskIo"],
  network: ParsedHealth["network"],
): Pick<
  ServerMetricValues,
  "diskReadBytesPerSec" | "diskWriteBytesPerSec" | "netRxBytesPerSec" | "netTxBytesPerSec"
> {
  return {
    diskReadBytesPerSec: sumRates(diskIo, (d) => d.readBytesPerSec),
    diskWriteBytesPerSec: sumRates(diskIo, (d) => d.writeBytesPerSec),
    netRxBytesPerSec: sumRates(network, (n) => n.rxBytesPerSec),
    netTxBytesPerSec: sumRates(network, (n) => n.txBytesPerSec),
  };
}

/**
 * Derive the time-series row from a reported health payload. Null when the
 * payload carries no usable memory block: memory is the one section every
 * platform can answer, so its absence means the report is not a host-health
 * report and there is nothing honest to chart.
 */
export function deriveServerMetricValues(health: unknown): ServerMetricValues | null {
  const parsed = healthSchema.safeParse(health);
  if (!parsed.success) return null;
  const { memory, disk, cpu, load, diskIo, network } = parsed.data;
  if (
    memory?.totalBytes === undefined ||
    memory.availableBytes === undefined ||
    memory.usedPct === undefined
  ) {
    return null;
  }

  return {
    ...cpuValues(cpu),
    ...memoryValues(memory),
    ...rateValues(diskIo, network),
    memUsedPct: memory.usedPct,
    memAvailableBytes: Math.round(memory.availableBytes),
    memTotalBytes: Math.round(memory.totalBytes),
    diskUsedPct: nullable(disk?.usedPct),
    diskFreeBytes: bytes(disk?.freeBytes),
    loadAvg1: nullable(load?.load1),
    loadAvg5: nullable(load?.load5),
    loadAvg15: nullable(load?.load15),
  };
}
