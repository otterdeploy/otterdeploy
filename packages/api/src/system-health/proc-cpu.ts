/**
 * CPU (/proc/stat), load average (/proc/loadavg) and ZFS ARC size
 * (/proc/spl/kstat/zfs/arcstats) parsing.
 *
 * /proc/stat is CUMULATIVE, so a single read says nothing about "right now":
 * every number here comes out of a delta between two reads, the same
 * two-frame trick the container sampler uses for Docker CPU stats. Callers
 * hold the previous snapshot (see host-telemetry.ts); the first read after
 * boot has nothing to subtract and yields null rather than a wrong number.
 */
import { pct, round1 } from "./proc-util";

/** Cumulative jiffies for one `cpu`/`cpuN` line of /proc/stat. */
export interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  /** Sum of the fields above. `guest`/`guest_nice` are deliberately excluded:
   *  the kernel already counts them inside `user`/`nice`. */
  total: number;
}

export interface ProcStatSnapshot {
  total: CpuTimes;
  /** Index = core number, in `cpuN` order. */
  cores: CpuTimes[];
}

export interface HostCpuBreakdown {
  /** user + nice. */
  userPct: number;
  /** system + irq + softirq: everything the kernel did on its own behalf. */
  systemPct: number;
  iowaitPct: number;
  /** Time the hypervisor gave to somebody else. The number that explains a
   *  "slow" cloud VM whose own usage looks fine. */
  stealPct: number;
  idlePct: number;
}

export interface HostCpu {
  /** Busy percent of the whole machine, 0–100. `100 - idle`, so iowait counts
   *  as busy (the CPU is not available to anyone else while it waits). */
  usedPct: number;
  coreCount: number;
  breakdown: HostCpuBreakdown;
  /** Busy percent per core, index = core number. Uneven cores are how a
   *  single-threaded pathology looks. */
  perCorePct: number[];
}

function toCpuTimes(fields: number[]): CpuTimes {
  const at = (i: number): number => fields[i] ?? 0;
  const user = at(0);
  const nice = at(1);
  const system = at(2);
  const idle = at(3);
  const iowait = at(4);
  const irq = at(5);
  const softirq = at(6);
  const steal = at(7);
  return {
    user,
    nice,
    system,
    idle,
    iowait,
    irq,
    softirq,
    steal,
    total: user + nice + system + idle + iowait + irq + softirq + steal,
  };
}

/** Parse /proc/stat's cpu lines. Null when the aggregate `cpu` line is
 *  missing, which is what a non-Linux or truncated file looks like. */
export function parseProcStat(text: string): ProcStatSnapshot | null {
  let total: CpuTimes | null = null;
  const cores: CpuTimes[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("cpu")) continue;
    const parts = line.trim().split(/\s+/);
    const label = parts[0];
    if (label === undefined) continue;
    const fields = parts.slice(1).map(Number);
    // Pre-2.6.11 kernels have no `steal`; anything shorter than user..softirq
    // is not a cpu line we can read.
    if (fields.length < 7 || fields.some((n) => !Number.isFinite(n))) continue;
    const times = toCpuTimes(fields);
    if (label === "cpu") total = times;
    else cores.push(times);
  }
  return total ? { total, cores } : null;
}

/** Difference between two cumulative reads, or null when the counters are not
 *  usable: no tick elapsed, or a field went backwards (a reboot under a
 *  long-lived agent resets /proc/stat to zero). */
function deltaCpuTimes(prev: CpuTimes, cur: CpuTimes): CpuTimes | null {
  const delta: CpuTimes = {
    user: cur.user - prev.user,
    nice: cur.nice - prev.nice,
    system: cur.system - prev.system,
    idle: cur.idle - prev.idle,
    iowait: cur.iowait - prev.iowait,
    irq: cur.irq - prev.irq,
    softirq: cur.softirq - prev.softirq,
    steal: cur.steal - prev.steal,
    total: cur.total - prev.total,
  };
  if (delta.total <= 0) return null;
  if (Object.values(delta).some((value) => value < 0)) return null;
  return delta;
}

/** CPU usage between two /proc/stat reads. Null on a counter reset or on a
 *  core count that changed underneath us (hotplug): honest gap, not a spike. */
export function computeCpuUsage(prev: ProcStatSnapshot, cur: ProcStatSnapshot): HostCpu | null {
  const delta = deltaCpuTimes(prev.total, cur.total);
  if (!delta) return null;

  const perCorePct: number[] = [];
  for (const [index, core] of cur.cores.entries()) {
    const previousCore = prev.cores[index];
    if (!previousCore) return null;
    const coreDelta = deltaCpuTimes(previousCore, core);
    if (!coreDelta) return null;
    perCorePct.push(round1(100 - pct(coreDelta.idle, coreDelta.total)));
  }

  return {
    usedPct: round1(100 - pct(delta.idle, delta.total)),
    coreCount: cur.cores.length,
    breakdown: {
      userPct: round1(pct(delta.user + delta.nice, delta.total)),
      systemPct: round1(pct(delta.system + delta.irq + delta.softirq, delta.total)),
      iowaitPct: round1(pct(delta.iowait, delta.total)),
      stealPct: round1(pct(delta.steal, delta.total)),
      idlePct: round1(pct(delta.idle, delta.total)),
    },
    perCorePct,
  };
}

export interface HostLoad {
  load1: number;
  load5: number;
  load15: number;
  /** Kernel scheduling entities currently runnable (the numerator of
   *  /proc/loadavg's 4th field). */
  runnableEntities: number | null;
  /** Total kernel scheduling entities (threads). With `cpu.coreCount` this is
   *  what a consumer needs to normalise a raw load figure. */
  totalEntities: number | null;
}

export function parseLoadAvg(text: string): HostLoad | null {
  const parts = text.trim().split(/\s+/);
  const load1 = Number(parts[0]);
  const load5 = Number(parts[1]);
  const load15 = Number(parts[2]);
  if (![load1, load5, load15].every((n) => Number.isFinite(n))) return null;
  const entities = parts[3]?.match(/^(\d+)\/(\d+)$/);
  return {
    load1,
    load5,
    load15,
    runnableEntities: entities?.[1] === undefined ? null : Number(entities[1]),
    totalEntities: entities?.[2] === undefined ? null : Number(entities[2]),
  };
}

/** ARC `size` in bytes. The ARC is cache, but it is NOT counted in meminfo's
 *  `Cached`, so a ZFS host looks permanently memory-starved without it. */
export function parseArcSize(text: string): number | null {
  const match = text.match(/^size\s+\d+\s+(\d+)/m);
  return match?.[1] === undefined ? null : Number(match[1]);
}
