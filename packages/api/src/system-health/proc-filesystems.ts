/**
 * Every real mounted filesystem, from /proc/mounts + statfs.
 *
 * host-health's `disk` field is the ONE filesystem the data root lives on and
 * stays exactly that (the servers list and the reclaim recommendations read
 * it). This is the full picture beside it: a node whose data root is fine
 * while /var is at 99% is a node with a problem, and a single-disk read
 * cannot see it.
 */
import { Result } from "better-result";
import { statfs } from "node:fs/promises";

import { procRoot, readProcFile } from "./proc-util";

export interface HostFilesystem {
  device: string;
  mountPoint: string;
  fsType: string;
  totalBytes: number;
  freeBytes: number;
  usedPct: number;
}

/**
 * Filesystem types that are kernel bookkeeping, not storage. Reporting these
 * as "disks" is how a host health page ends up with thirty rows of 0-byte
 * cgroup mounts. Docker's `overlay` roots are excluded too: their usage is
 * the backing filesystem's, already reported once under its own mount.
 */
const PSEUDO_FS_TYPES = new Set([
  "autofs",
  "binfmt_misc",
  "bpf",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "efivarfs",
  "fusectl",
  "hugetlbfs",
  "mqueue",
  "nsfs",
  "overlay",
  "overlay2",
  "proc",
  "pstore",
  "ramfs",
  "rpc_pipefs",
  "securityfs",
  "selinuxfs",
  "squashfs",
  "sysfs",
  "tmpfs",
  "tracefs",
]);

/** Mount points under these are kernel/runtime surfaces even when the type
 *  looks real (bind mounts under /run, per-container /dev nodes). */
const PSEUDO_MOUNT_PREFIXES = ["/proc/", "/sys/", "/dev/", "/run/"];

export function isRealFilesystem(fsType: string, mountPoint: string): boolean {
  if (PSEUDO_FS_TYPES.has(fsType)) return false;
  // fuse.gvfsd, fuse.portal, … are desktop plumbing; fuseblk (ntfs-3g) is real.
  if (fsType.startsWith("fuse.")) return false;
  if (fsType.startsWith("cgroup")) return false;
  if (mountPoint === "/proc" || mountPoint === "/sys" || mountPoint === "/dev") return false;
  return !PSEUDO_MOUNT_PREFIXES.some((prefix) => mountPoint.startsWith(prefix));
}

/** /proc/mounts escapes space, tab, newline and backslash as octal. */
function decodeMountField(value: string): string {
  return value.replace(/\\(\d{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

export interface MountEntry {
  device: string;
  mountPoint: string;
  fsType: string;
}

/** Parse /proc/mounts and keep only real filesystems. Later mounts shadow
 *  earlier ones at the same mount point, so the last entry wins. */
export function parseProcMounts(text: string): MountEntry[] {
  const byMountPoint = new Map<string, MountEntry>();
  for (const line of text.split("\n")) {
    const [device, mountPoint, fsType] = line.trim().split(/\s+/);
    if (!device || !mountPoint || !fsType) continue;
    const entry: MountEntry = {
      device: decodeMountField(device),
      mountPoint: decodeMountField(mountPoint),
      fsType,
    };
    if (!isRealFilesystem(entry.fsType, entry.mountPoint)) continue;
    byMountPoint.set(entry.mountPoint, entry);
  }
  return [...byMountPoint.values()];
}

/** Upper bound on filesystems we statfs per sample. A host with more real
 *  mounts than this is doing something unusual; the cost of one statfs each
 *  is what we are bounding, not the truth. */
const MAX_FILESYSTEMS = 64;

async function measure(entry: MountEntry): Promise<HostFilesystem | null> {
  const stat = await Result.tryPromise({
    try: () => statfs(entry.mountPoint),
    catch: () => null,
  });
  if (stat.isErr()) return null;
  const totalBytes = stat.value.blocks * stat.value.bsize;
  const freeBytes = stat.value.bavail * stat.value.bsize;
  // A zero-block filesystem is a pseudo mount that slipped the type filter;
  // there is no honest percentage to report for it.
  if (totalBytes <= 0) return null;
  return {
    device: entry.device,
    mountPoint: entry.mountPoint,
    fsType: entry.fsType,
    totalBytes,
    freeBytes,
    usedPct: Math.round(((totalBytes - freeBytes) / totalBytes) * 100),
  };
}

/** Null (not an empty list) when there is no /proc/mounts to read: "we could
 *  not look" and "we looked and found nothing" are different answers. */
export async function readFilesystems(): Promise<HostFilesystem[] | null> {
  const text = await readProcFile(`${procRoot()}/mounts`);
  if (text === null) return null;
  const entries = parseProcMounts(text).slice(0, MAX_FILESYSTEMS);
  const results = await Promise.all(entries.map(measure));
  return results.filter((fs): fs is HostFilesystem => fs !== null);
}
