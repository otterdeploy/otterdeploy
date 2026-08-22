/**
 * The one stateful piece of the procfs collectors: the previous cumulative
 * read.
 *
 * /proc/stat, /proc/diskstats and /proc/net/dev are counters since boot, so a
 * single read says nothing about "right now". This module holds the last
 * frame in module state — exactly like the container sampler's two-frame
 * Docker CPU delta — and hands the parsers a before/after pair. The first
 * call after boot has nothing to subtract and reports null rather than a
 * wrong number.
 *
 * Linux-only in practice: on a platform with no procfs every section is null
 * and nothing logs an error.
 */
import {
  computeCpuUsage,
  parseLoadAvg,
  parseProcStat,
  type HostCpu,
  type HostLoad,
  type ProcStatSnapshot,
} from "./proc-cpu";
import {
  computeDiskIo,
  computeNetwork,
  parseDiskstats,
  parseNetDev,
  type DiskCounters,
  type HostDiskIo,
  type HostNetworkInterface,
  type NetCounters,
} from "./proc-io";
import { procRoot, readFirstProcFile, readProcFile } from "./proc-util";

interface TelemetryFrame {
  at: number;
  stat: ProcStatSnapshot | null;
  disks: Map<string, DiskCounters> | null;
  net: Map<string, NetCounters> | null;
}

/** The previous cumulative read. Module state on purpose: the collector is a
 *  process-wide singleton sampled on a fixed tick. */
let previousFrame: TelemetryFrame | null = null;

export interface ProcTelemetry {
  cpu: HostCpu | null;
  load: HostLoad | null;
  diskIo: HostDiskIo[] | null;
  network: HostNetworkInterface[] | null;
}

/** Exported for tests: drops the delta baseline so a test can assert the
 *  first-read-returns-null contract. */
export function resetProcTelemetryState(): void {
  previousFrame = null;
}

export async function readProcTelemetry(): Promise<ProcTelemetry> {
  const root = procRoot();
  const [statText, loadText, diskstatsText, netDevText] = await Promise.all([
    readProcFile(`${root}/stat`),
    readProcFile(`${root}/loadavg`),
    readProcFile(`${root}/diskstats`),
    // `<proc>/net` follows the READER's network namespace; pid 1 is the host's.
    readFirstProcFile([`${root}/1/net/dev`, `${root}/net/dev`]),
  ]);

  const frame: TelemetryFrame = {
    at: Date.now(),
    stat: statText === null ? null : parseProcStat(statText),
    disks: diskstatsText === null ? null : parseDiskstats(diskstatsText),
    net: netDevText === null ? null : parseNetDev(netDevText),
  };
  const prev = previousFrame;
  previousFrame = frame;

  const elapsedMs = prev ? frame.at - prev.at : 0;
  return {
    cpu: prev?.stat && frame.stat ? computeCpuUsage(prev.stat, frame.stat) : null,
    load: loadText === null ? null : parseLoadAvg(loadText),
    diskIo: prev?.disks && frame.disks ? computeDiskIo(prev.disks, frame.disks, elapsedMs) : null,
    network: prev?.net && frame.net ? computeNetwork(prev.net, frame.net, elapsedMs) : null,
  };
}
