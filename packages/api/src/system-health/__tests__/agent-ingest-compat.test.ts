/**
 * Version-skew contract for the health-report ingest (od-je0h.9/od-je0h.10).
 *
 * Agents run the platform image that was current when their node was
 * provisioned, so during any rolling update the control plane receives BOTH
 * the old payload (memory/disk/docker only) and the new one (plus cpu, load,
 * filesystems, diskIo, network). Both must ingest, and both must yield a
 * usable `server_metric` row — the new one with more columns filled, the old
 * one with nulls where it had nothing to say, never with fabricated zeros.
 */
import { describe, expect, test } from "vite-plus/test";

import { reportSchema } from "../agent-ingest";
import { deriveServerMetricValues } from "../metric-row";

/** Exactly what an agent built before this change posts. */
const OLD_PAYLOAD = {
  hostname: "node-1",
  health: {
    memory: {
      totalBytes: 16_000_000_000,
      availableBytes: 8_000_000_000,
      usedPct: 50,
      swapTotalBytes: 2_000_000_000,
      swapFreeBytes: 1_500_000_000,
    },
    disk: { path: "/", totalBytes: 500_000_000_000, freeBytes: 100_000_000_000, usedPct: 80 },
    docker: null,
    branchPool: null,
    recommendations: [],
    sampledAt: "2026-08-20T10:00:00.000Z",
  },
  capacity: { cpuTotal: 4, memTotalGb: 16 },
};

/** The extended payload, with every telemetry section present. */
const NEW_PAYLOAD = {
  ...OLD_PAYLOAD,
  health: {
    ...OLD_PAYLOAD.health,
    memory: {
      ...OLD_PAYLOAD.health.memory,
      buffersBytes: 200_000_000,
      cachedBytes: 4_000_000_000,
      zfsArcBytes: 1_000_000_000,
    },
    filesystems: [
      {
        device: "/dev/sda2",
        mountPoint: "/",
        fsType: "ext4",
        totalBytes: 500_000_000_000,
        freeBytes: 100_000_000_000,
        usedPct: 80,
      },
    ],
    cpu: {
      usedPct: 37.5,
      coreCount: 4,
      breakdown: { userPct: 20, systemPct: 10, iowaitPct: 5, stealPct: 2.5, idlePct: 62.5 },
      perCorePct: [40, 35, 38, 37],
    },
    load: { load1: 1.5, load5: 1.2, load15: 0.9, runnableEntities: 2, totalEntities: 900 },
    diskIo: [
      {
        device: "sda",
        readBytesPerSec: 1000,
        writeBytesPerSec: 2000,
        readAwaitMs: 1.2,
        writeAwaitMs: 3.4,
        utilPct: 12,
      },
      {
        device: "nvme0n1",
        readBytesPerSec: 500,
        writeBytesPerSec: 250,
        readAwaitMs: 0.2,
        writeAwaitMs: 0.4,
        utilPct: 3,
      },
    ],
    network: [
      {
        name: "eth0",
        rxBytesPerSec: 1_000,
        txBytesPerSec: 2_000,
        rxBytesTotal: 10_000,
        txBytesTotal: 20_000,
      },
      {
        name: "eth1",
        rxBytesPerSec: 500,
        txBytesPerSec: 100,
        rxBytesTotal: 5_000,
        txBytesTotal: 1_000,
      },
    ],
  },
};

describe("agent report ingest schema", () => {
  test("an OLDER agent's payload still parses (version skew is by design)", () => {
    const parsed = reportSchema.safeParse(OLD_PAYLOAD);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.hostname).toBe("node-1");
    expect(parsed.data?.health.sampledAt).toBe("2026-08-20T10:00:00.000Z");
  });

  test("the extended payload parses and keeps its new sections", () => {
    const parsed = reportSchema.safeParse(NEW_PAYLOAD);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.health.cpu).toBeTruthy();
    expect(parsed.data?.health.network).toHaveLength(2);
  });

  test("a payload from a FUTURE agent (sections we don't know yet) still parses", () => {
    const parsed = reportSchema.safeParse({
      ...OLD_PAYLOAD,
      health: { ...OLD_PAYLOAD.health, gpus: [{ name: "some-future-thing", usedPct: 3 }] },
    });
    expect(parsed.success).toBe(true);
  });

  test("explicit nulls for the telemetry sections parse (a Linux-less node)", () => {
    const parsed = reportSchema.safeParse({
      ...OLD_PAYLOAD,
      health: {
        ...OLD_PAYLOAD.health,
        cpu: null,
        load: null,
        filesystems: null,
        diskIo: null,
        network: null,
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("a body with no hostname or no memory block is still rejected", () => {
    expect(reportSchema.safeParse({ health: OLD_PAYLOAD.health }).success).toBe(false);
    expect(
      reportSchema.safeParse({ hostname: "n", health: { sampledAt: "2026-01-01" } }).success,
    ).toBe(false);
  });
});

describe("deriveServerMetricValues", () => {
  test("an OLD payload yields a row with nulls, not zeros, for what it never reported", () => {
    const values = deriveServerMetricValues(OLD_PAYLOAD.health);
    expect(values).not.toBeNull();
    expect(values?.memUsedPct).toBe(50);
    expect(values?.memAvailableBytes).toBe(8_000_000_000);
    expect(values?.memTotalBytes).toBe(16_000_000_000);
    expect(values?.diskUsedPct).toBe(80);
    // Swap: 2GB total, 1.5GB free ⇒ 25% used.
    expect(values?.swapUsedPct).toBe(25);
    // Sections an old agent never collected.
    expect(values?.cpuPct).toBeNull();
    expect(values?.loadAvg1).toBeNull();
    expect(values?.memCachedBytes).toBeNull();
    expect(values?.zfsArcBytes).toBeNull();
    expect(values?.diskReadBytesPerSec).toBeNull();
    expect(values?.netRxBytesPerSec).toBeNull();
  });

  test("the extended payload fills the whole series, summing per-device rates", () => {
    const values = deriveServerMetricValues(NEW_PAYLOAD.health);
    expect(values?.cpuPct).toBe(37.5);
    expect(values?.cpuUserPct).toBe(20);
    expect(values?.cpuSystemPct).toBe(10);
    expect(values?.cpuIowaitPct).toBe(5);
    expect(values?.cpuStealPct).toBe(2.5);
    expect(values?.loadAvg1).toBe(1.5);
    expect(values?.loadAvg15).toBe(0.9);
    expect(values?.memCachedBytes).toBe(4_000_000_000);
    expect(values?.memBuffersBytes).toBe(200_000_000);
    expect(values?.zfsArcBytes).toBe(1_000_000_000);
    expect(values?.diskReadBytesPerSec).toBe(1500);
    expect(values?.diskWriteBytesPerSec).toBe(2250);
    expect(values?.netRxBytesPerSec).toBe(1500);
    expect(values?.netTxBytesPerSec).toBe(2100);
  });

  test("an empty section sums to 0 (the reporter looked) while a missing one stays null", () => {
    const values = deriveServerMetricValues({
      ...OLD_PAYLOAD.health,
      diskIo: [],
    });
    expect(values?.diskReadBytesPerSec).toBe(0);
    expect(values?.netRxBytesPerSec).toBeNull();
  });

  test("a host with no swap reports null, not 0% or NaN", () => {
    const values = deriveServerMetricValues({
      ...OLD_PAYLOAD.health,
      memory: { ...OLD_PAYLOAD.health.memory, swapTotalBytes: 0, swapFreeBytes: 0 },
    });
    expect(values?.swapUsedPct).toBeNull();
  });

  test("a payload with no readable memory block yields no row at all", () => {
    expect(deriveServerMetricValues({ sampledAt: "2026-08-20T10:00:00.000Z" })).toBeNull();
    expect(deriveServerMetricValues(null)).toBeNull();
    expect(deriveServerMetricValues("not a report")).toBeNull();
  });
});
