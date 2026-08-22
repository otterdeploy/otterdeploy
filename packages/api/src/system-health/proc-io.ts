/**
 * Block-device I/O (/proc/diskstats) and network throughput (/proc/net/dev).
 *
 * Both files are CUMULATIVE counters, so everything here is a delta between
 * two reads, with the same discipline as proc-cpu: a counter that went
 * BACKWARDS (device re-plugged, interface recreated, host rebooted under a
 * long-lived agent) drops that device for one sample instead of reporting a
 * nonsense spike.
 */
import { pct, perSecond, round1 } from "./proc-util";

// ─── block device I/O ───────────────────────────────────────────────────────

/** Cumulative counters for one device line of /proc/diskstats. */
export interface DiskCounters {
  readIos: number;
  readSectors: number;
  readTicksMs: number;
  writeIos: number;
  writeSectors: number;
  writeTicksMs: number;
  /** Wall-clock ms the device spent with at least one request in flight. */
  ioTicksMs: number;
}

export interface HostDiskIo {
  device: string;
  readBytesPerSec: number;
  writeBytesPerSec: number;
  /** Mean ms a read waited (queue + service). `iostat`'s r_await. */
  readAwaitMs: number;
  writeAwaitMs: number;
  /** Share of the interval the device was busy, 0–100. */
  utilPct: number;
}

/** The kernel reports diskstats sectors in fixed 512-byte units regardless of
 *  the device's physical sector size. */
const SECTOR_BYTES = 512;

/** Virtual/removable devices nobody charts. Device-mapper (`dm-N`) and md
 *  RAID (`mdN`) are deliberately KEPT: on an LVM or RAID host they are where
 *  the real I/O shows up. Partitions are dropped separately (they
 *  double-count their parent). */
export function isVirtualDiskDevice(name: string): boolean {
  return /^(loop|ram|zram|fd|sr)\d+$/.test(name);
}

/** True for a partition of another device present in the same read: `sda1`
 *  under `sda`, `nvme0n1p2` under `nvme0n1`, `mmcblk0p1` under `mmcblk0`.
 *  Keeping both would double every byte the parent moved. */
export function isPartitionName(name: string, devices: Iterable<string>): boolean {
  const all = new Set(devices);
  const nvmeOrMmc = name.match(/^(.*?)p\d+$/);
  if (nvmeOrMmc?.[1] !== undefined && all.has(nvmeOrMmc[1])) return true;
  const trailingDigits = name.match(/^(.*?[a-z])\d+$/);
  if (trailingDigits?.[1] !== undefined && all.has(trailingDigits[1])) return true;
  return false;
}

/** Whole block devices worth reporting: not virtual, not a partition. */
export function reportableDiskDevices(devices: Iterable<string>): string[] {
  const all = [...devices];
  return all.filter((name) => !isVirtualDiskDevice(name) && !isPartitionName(name, all));
}

/** Parse /proc/diskstats. Fields after `major minor name` are the kernel's
 *  stat block; the first 11 (reads..time_in_queue) have been stable since
 *  2.6, later discard/flush fields are ignored. */
export function parseDiskstats(text: string): Map<string, DiskCounters> {
  const devices = new Map<string, DiskCounters>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;
    const name = parts[2];
    if (name === undefined) continue;
    const nums = parts.slice(3).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const at = (i: number): number => nums[i] ?? 0;
    devices.set(name, {
      readIos: at(0),
      readSectors: at(2),
      readTicksMs: at(3),
      writeIos: at(4),
      writeSectors: at(6),
      writeTicksMs: at(7),
      ioTicksMs: at(9),
    });
  }
  return devices;
}

function diskRates(
  device: string,
  before: DiskCounters,
  after: DiskCounters,
  elapsedMs: number,
): HostDiskIo | null {
  const readIos = after.readIos - before.readIos;
  const writeIos = after.writeIos - before.writeIos;
  const readSectors = after.readSectors - before.readSectors;
  const writeSectors = after.writeSectors - before.writeSectors;
  const readTicks = after.readTicksMs - before.readTicksMs;
  const writeTicks = after.writeTicksMs - before.writeTicksMs;
  const ioTicks = after.ioTicksMs - before.ioTicksMs;
  const deltas = [readIos, writeIos, readSectors, writeSectors, readTicks, writeTicks, ioTicks];
  if (deltas.some((value) => value < 0)) return null;
  return {
    device,
    readBytesPerSec: perSecond(readSectors * SECTOR_BYTES, elapsedMs),
    writeBytesPerSec: perSecond(writeSectors * SECTOR_BYTES, elapsedMs),
    readAwaitMs: readIos > 0 ? round1(readTicks / readIos) : 0,
    writeAwaitMs: writeIos > 0 ? round1(writeTicks / writeIos) : 0,
    utilPct: round1(Math.min(100, pct(ioTicks, elapsedMs))),
  };
}

/** Per-device rates between two /proc/diskstats reads. Null when no usable
 *  interval elapsed; devices with reset counters are simply omitted. */
export function computeDiskIo(
  prev: Map<string, DiskCounters>,
  cur: Map<string, DiskCounters>,
  elapsedMs: number,
): HostDiskIo[] | null {
  if (elapsedMs <= 0) return null;
  const out: HostDiskIo[] = [];
  for (const device of reportableDiskDevices(cur.keys())) {
    const before = prev.get(device);
    const after = cur.get(device);
    if (!before || !after) continue;
    const rates = diskRates(device, before, after, elapsedMs);
    if (rates) out.push(rates);
  }
  return out;
}

// ─── network ────────────────────────────────────────────────────────────────

export interface NetCounters {
  rxBytes: number;
  txBytes: number;
}

export interface HostNetworkInterface {
  name: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  /** Cumulative since the interface came up: what a "total transferred" read
   *  wants, and what makes a rate verifiable. */
  rxBytesTotal: number;
  txBytesTotal: number;
}

/** Parse /proc/net/dev. Loopback is skipped: it is process-to-process traffic
 *  on the same box, and including it makes every host look busy. */
export function parseNetDev(text: string): Map<string, NetCounters> {
  const interfaces = new Map<string, NetCounters>();
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (!name || name === "lo") continue;
    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    // rx: bytes packets errs drop fifo frame compressed multicast | tx: bytes …
    if (fields.length < 9 || fields.some((n) => !Number.isFinite(n))) continue;
    interfaces.set(name, { rxBytes: fields[0] ?? 0, txBytes: fields[8] ?? 0 });
  }
  return interfaces;
}

/** Per-interface rates between two /proc/net/dev reads. Same counter-reset
 *  discipline as disks: a recreated interface is dropped for one sample. */
export function computeNetwork(
  prev: Map<string, NetCounters>,
  cur: Map<string, NetCounters>,
  elapsedMs: number,
): HostNetworkInterface[] | null {
  if (elapsedMs <= 0) return null;
  const out: HostNetworkInterface[] = [];
  for (const [name, after] of cur) {
    const before = prev.get(name);
    if (!before) continue;
    const rxDelta = after.rxBytes - before.rxBytes;
    const txDelta = after.txBytes - before.txBytes;
    if (rxDelta < 0 || txDelta < 0) continue;
    out.push({
      name,
      rxBytesPerSec: perSecond(rxDelta, elapsedMs),
      txBytesPerSec: perSecond(txDelta, elapsedMs),
      rxBytesTotal: after.rxBytes,
      txBytesTotal: after.txBytes,
    });
  }
  return out;
}
