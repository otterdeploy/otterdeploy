/**
 * /proc parser + cumulative-delta unit tests (od-je0h.9).
 *
 * Every case runs off a fixture STRING, never the real filesystem: these
 * parsers have to be correct on a Linux host while the suite runs on a macOS
 * laptop with no procfs at all.
 */
import { describe, expect, test } from "vite-plus/test";

import { readProcTelemetry, resetProcTelemetryState } from "../host-telemetry";
import { computeCpuUsage, parseArcSize, parseLoadAvg, parseProcStat } from "../proc-cpu";
import { isRealFilesystem, parseProcMounts } from "../proc-filesystems";
import {
  computeDiskIo,
  computeNetwork,
  isVirtualDiskDevice,
  parseDiskstats,
  parseNetDev,
  reportableDiskDevices,
} from "../proc-io";

// user nice system idle iowait irq softirq steal guest guest_nice
const PROC_STAT_A = `cpu  1000 100 500 8000 200 10 20 30 0 0
cpu0 500 50 250 4000 100 5 10 15 0 0
cpu1 500 50 250 4000 100 5 10 15 0 0
intr 12345 0 0
ctxt 999
btime 1700000000
`;

// +100 idle on cpu0, +400 busy-ish work spread over both cores.
const PROC_STAT_B = `cpu  1200 100 600 8600 250 10 20 30 0 0
cpu0 700 50 300 4200 150 5 10 15 0 0
cpu1 500 50 300 4400 100 5 10 15 0 0
intr 22345 0 0
`;

describe("parseProcStat", () => {
  test("reads the aggregate line and every core line", () => {
    const snapshot = parseProcStat(PROC_STAT_A);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.cores).toHaveLength(2);
    expect(snapshot?.total.user).toBe(1000);
    expect(snapshot?.total.steal).toBe(30);
    // guest/guest_nice are excluded from total: the kernel already counts
    // them inside user/nice, so adding them would double-count.
    expect(snapshot?.total.total).toBe(1000 + 100 + 500 + 8000 + 200 + 10 + 20 + 30);
  });

  test("returns null when there is no aggregate cpu line (non-Linux/truncated)", () => {
    expect(parseProcStat("intr 1 2 3\nctxt 4\n")).toBeNull();
  });

  test("ignores non-cpu lines and unparseable cpu lines", () => {
    const snapshot = parseProcStat(
      "cpu  1 2 3 4 5 6 7 8\ncpu0 broken line here\nprocs_running 2\n",
    );
    expect(snapshot?.cores).toHaveLength(0);
  });
});

describe("computeCpuUsage", () => {
  test("reports the delta between two frames, not the cumulative totals", () => {
    const prev = parseProcStat(PROC_STAT_A);
    const cur = parseProcStat(PROC_STAT_B);
    expect(prev && cur).toBeTruthy();
    if (!prev || !cur) return;

    const cpu = computeCpuUsage(prev, cur);
    // Deltas: user 200, system 100, idle 600, iowait 50 ⇒ total 950.
    expect(cpu?.usedPct).toBe(36.8); // 100 - 600/950
    expect(cpu?.breakdown.idlePct).toBe(63.2);
    expect(cpu?.breakdown.userPct).toBe(21.1);
    expect(cpu?.breakdown.iowaitPct).toBe(5.3);
    expect(cpu?.breakdown.stealPct).toBe(0);
    expect(cpu?.coreCount).toBe(2);
    // cpu0 worked (200 user + 50 sys + 50 iowait vs 200 idle), cpu1 mostly
    // idled (50 sys vs 400 idle): the whole point of per-core reporting.
    expect(cpu?.perCorePct).toHaveLength(2);
    expect(cpu?.perCorePct[0]).toBeGreaterThan(cpu?.perCorePct[1] ?? 0);
  });

  test("a counter reset (reboot under a long-lived agent) yields null, not a spike", () => {
    const prev = parseProcStat(PROC_STAT_B);
    const cur = parseProcStat(PROC_STAT_A); // counters went backwards
    expect(prev && cur).toBeTruthy();
    if (!prev || !cur) return;
    expect(computeCpuUsage(prev, cur)).toBeNull();
  });

  test("two identical frames (no tick elapsed) yield null rather than 0%", () => {
    const frame = parseProcStat(PROC_STAT_A);
    expect(frame).not.toBeNull();
    if (!frame) return;
    expect(computeCpuUsage(frame, frame)).toBeNull();
  });

  test("a core count that changed under us yields null (hotplug, not a reading)", () => {
    const prev = parseProcStat("cpu  1 0 1 10 0 0 0 0\ncpu0 1 0 1 10 0 0 0 0\n");
    const cur = parseProcStat(
      "cpu  2 0 2 20 0 0 0 0\ncpu0 2 0 2 20 0 0 0 0\ncpu1 0 0 0 0 0 0 0 0\n",
    );
    expect(prev && cur).toBeTruthy();
    if (!prev || !cur) return;
    expect(computeCpuUsage(prev, cur)).toBeNull();
  });
});

describe("parseLoadAvg", () => {
  test("reads the three averages plus the scheduling-entity counts", () => {
    const load = parseLoadAvg("0.52 0.71 0.66 3/1284 90210\n");
    expect(load).toEqual({
      load1: 0.52,
      load5: 0.71,
      load15: 0.66,
      runnableEntities: 3,
      totalEntities: 1284,
    });
  });

  test("keeps the averages when the entity field is missing or malformed", () => {
    const load = parseLoadAvg("0.10 0.20 0.30");
    expect(load?.load15).toBe(0.3);
    expect(load?.runnableEntities).toBeNull();
    expect(load?.totalEntities).toBeNull();
  });

  test("returns null on a file that is not a loadavg", () => {
    expect(parseLoadAvg("not a load average\n")).toBeNull();
  });
});

describe("parseArcSize", () => {
  test("pulls the ARC `size` row out of arcstats", () => {
    const text = `13 1 0x01 120 32640 4283 1234
name                            type data
hits                            4    99
size                            4    8589934592
c_max                           4    17179869184
`;
    expect(parseArcSize(text)).toBe(8589934592);
  });

  test("returns null when the ARC has no size row (non-ZFS host)", () => {
    expect(parseArcSize("name type data\nhits 4 99\n")).toBeNull();
  });
});

describe("filesystem filter", () => {
  test("keeps real filesystems and drops the kernel's bookkeeping mounts", () => {
    expect(isRealFilesystem("ext4", "/")).toBe(true);
    expect(isRealFilesystem("xfs", "/var/lib/otterdeploy")).toBe(true);
    expect(isRealFilesystem("zfs", "/tank/data")).toBe(true);
    expect(isRealFilesystem("btrfs", "/mnt/big")).toBe(true);

    expect(isRealFilesystem("proc", "/proc")).toBe(false);
    expect(isRealFilesystem("sysfs", "/sys")).toBe(false);
    expect(isRealFilesystem("tmpfs", "/run/lock")).toBe(false);
    expect(isRealFilesystem("devtmpfs", "/dev")).toBe(false);
    expect(isRealFilesystem("cgroup2", "/sys/fs/cgroup")).toBe(false);
    expect(isRealFilesystem("overlay", "/var/lib/docker/overlay2/abc/merged")).toBe(false);
    expect(isRealFilesystem("squashfs", "/snap/core/1")).toBe(false);
    expect(isRealFilesystem("fuse.portal", "/run/user/1000/doc")).toBe(false);
    // A real filesystem bind-mounted UNDER a pseudo tree is still plumbing.
    expect(isRealFilesystem("ext4", "/run/somebind")).toBe(false);
  });

  test("parseProcMounts drops pseudo mounts, decodes octal escapes and lets later mounts shadow earlier ones", () => {
    const mounts = `proc /proc proc rw,nosuid 0 0
sysfs /sys sysfs rw,nosuid 0 0
/dev/sda2 / ext4 rw,relatime 0 0
tmpfs /run tmpfs rw,nosuid 0 0
cgroup2 /sys/fs/cgroup cgroup2 rw 0 0
/dev/sdb1 /mnt/my\\040disk xfs rw 0 0
overlay /var/lib/docker/overlay2/deadbeef/merged overlay rw 0 0
/dev/sdc1 /mnt/shadowed ext4 rw 0 0
/dev/sdd1 /mnt/shadowed ext4 rw 0 0
`;
    const parsed = parseProcMounts(mounts);
    expect(parsed.map((m) => m.mountPoint)).toEqual(["/", "/mnt/my disk", "/mnt/shadowed"]);
    expect(parsed[1]?.fsType).toBe("xfs");
    expect(parsed[2]?.device).toBe("/dev/sdd1");
  });
});

describe("block device selection", () => {
  test("drops loop/ram/zram devices but keeps device-mapper and md", () => {
    expect(isVirtualDiskDevice("loop0")).toBe(true);
    expect(isVirtualDiskDevice("ram3")).toBe(true);
    expect(isVirtualDiskDevice("zram0")).toBe(true);
    expect(isVirtualDiskDevice("sr0")).toBe(true);
    expect(isVirtualDiskDevice("sda")).toBe(false);
    expect(isVirtualDiskDevice("dm-0")).toBe(false);
    expect(isVirtualDiskDevice("md0")).toBe(false);
  });

  test("drops partitions of a device present in the same read (they double-count the parent)", () => {
    const devices = [
      "loop0",
      "sda",
      "sda1",
      "sda2",
      "nvme0n1",
      "nvme0n1p1",
      "mmcblk0",
      "mmcblk0p1",
      "dm-0",
    ];
    expect(reportableDiskDevices(devices)).toEqual(["sda", "nvme0n1", "mmcblk0", "dm-0"]);
  });

  test("keeps a partition whose parent is absent (that partition IS the device we can see)", () => {
    expect(reportableDiskDevices(["vdb1"])).toEqual(["vdb1"]);
  });
});

// major minor name rd_ios rd_merges rd_sectors rd_ticks wr_ios wr_merges
// wr_sectors wr_ticks in_flight io_ticks time_in_queue
const DISKSTATS_A = `   8       0 sda 100 0 2000 500 50 0 1000 250 0 800 750
   8       1 sda1 90 0 1800 450 40 0 900 200 0 700 650
   7       0 loop0 5 0 40 10 0 0 0 0 0 10 10
`;
const DISKSTATS_B = `   8       0 sda 200 0 6000 700 150 0 5000 650 0 1800 2450
   8       1 sda1 180 0 5000 600 120 0 4000 500 0 1500 2000
   7       0 loop0 5 0 40 10 0 0 0 0 0 10 10
`;

describe("parseDiskstats / computeDiskIo", () => {
  test("parses the stable first eleven counters per device", () => {
    const stats = parseDiskstats(DISKSTATS_A);
    expect(stats.get("sda")).toEqual({
      readIos: 100,
      readSectors: 2000,
      readTicksMs: 500,
      writeIos: 50,
      writeSectors: 1000,
      writeTicksMs: 250,
      ioTicksMs: 800,
    });
    expect(stats.has("loop0")).toBe(true);
  });

  test("computes byte rates, awaits and utilisation over the interval", () => {
    const io = computeDiskIo(parseDiskstats(DISKSTATS_A), parseDiskstats(DISKSTATS_B), 1000);
    expect(io).toHaveLength(1); // sda1 (partition) and loop0 (virtual) dropped
    const sda = io?.[0];
    expect(sda?.device).toBe("sda");
    // 4000 sectors read × 512B over one second.
    expect(sda?.readBytesPerSec).toBe(4000 * 512);
    expect(sda?.writeBytesPerSec).toBe(4000 * 512);
    // 200ms of read ticks over 100 reads.
    expect(sda?.readAwaitMs).toBe(2);
    // 400ms of write ticks over 100 writes.
    expect(sda?.writeAwaitMs).toBe(4);
    // 1000ms busy out of a 1000ms interval, clamped at 100.
    expect(sda?.utilPct).toBe(100);
  });

  test("halving the interval doubles the rate", () => {
    const io = computeDiskIo(parseDiskstats(DISKSTATS_A), parseDiskstats(DISKSTATS_B), 500);
    expect(io?.[0]?.readBytesPerSec).toBe(4000 * 512 * 2);
  });

  test("a device whose counters went backwards is dropped for this sample", () => {
    const io = computeDiskIo(parseDiskstats(DISKSTATS_B), parseDiskstats(DISKSTATS_A), 1000);
    expect(io).toEqual([]);
  });

  test("a zero/negative interval yields null rather than a division blow-up", () => {
    expect(computeDiskIo(parseDiskstats(DISKSTATS_A), parseDiskstats(DISKSTATS_B), 0)).toBeNull();
  });
});

const NET_DEV_A = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0: 5000      50    0    0    0     0          0         0     2000      20    0    0    0     0       0          0
`;
const NET_DEV_B = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9000      90    0    0    0     0          0         0     9000      90    0    0    0     0       0          0
  eth0: 15000     150   0    0    0     0          0         0     7000      70    0    0    0     0       0          0
`;

describe("parseNetDev / computeNetwork", () => {
  test("skips loopback and reads rx/tx bytes from the right columns", () => {
    const interfaces = parseNetDev(NET_DEV_A);
    expect(interfaces.has("lo")).toBe(false);
    expect(interfaces.get("eth0")).toEqual({ rxBytes: 5000, txBytes: 2000 });
  });

  test("reports per-second rates alongside the cumulative totals", () => {
    const net = computeNetwork(parseNetDev(NET_DEV_A), parseNetDev(NET_DEV_B), 2000);
    expect(net).toEqual([
      {
        name: "eth0",
        rxBytesPerSec: 5000, // 10000 bytes over 2s
        txBytesPerSec: 2500,
        rxBytesTotal: 15000,
        txBytesTotal: 7000,
      },
    ]);
  });

  test("an interface recreated between samples (counters reset) is dropped", () => {
    const net = computeNetwork(parseNetDev(NET_DEV_B), parseNetDev(NET_DEV_A), 2000);
    expect(net).toEqual([]);
  });

  test("an interface that only appears in the current read has no delta yet", () => {
    const net = computeNetwork(new Map(), parseNetDev(NET_DEV_B), 1000);
    expect(net).toEqual([]);
  });
});

describe("readProcTelemetry (module delta state)", () => {
  test("the first read after boot reports null rather than a wrong number", async () => {
    resetProcTelemetryState();
    const first = await readProcTelemetry();
    // Nothing to subtract yet. On a host WITH procfs this is the honest
    // answer for one interval; on a host without one it is the answer
    // forever, and neither case logs an error or fabricates a zero.
    expect(first.cpu).toBeNull();
    expect(first.diskIo).toBeNull();
    expect(first.network).toBeNull();
  });

  test("a second read never throws, whatever the platform exposes", async () => {
    resetProcTelemetryState();
    await readProcTelemetry();
    const second = await readProcTelemetry();
    // Values are platform-dependent (null off Linux, real numbers on it), so
    // this asserts the contract that holds everywhere: the shape.
    expect(Object.keys(second).sort()).toEqual(["cpu", "diskIo", "load", "network"]);
  });
});
