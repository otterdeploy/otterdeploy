import type { ResourceId } from "@otterdeploy/shared/id";

import { describe, expect, test } from "vite-plus/test";

import {
  EMPTY_STATS,
  backupFreshnessPerResource,
  batchDataCells,
  firstPerResource,
  parseMariadbStats,
  parseMongoStats,
  parsePostgresStatsRow,
  parseRedisInfoStats,
  toFiniteNumber,
  versionFromImage,
  withTimeout,
} from "../catalog-shared";

const rid = (n: string) => n as ResourceId;

describe("versionFromImage", () => {
  test("plain tag", () => {
    expect(versionFromImage("postgres:17-alpine")).toBe("17-alpine");
  });

  test("registry with port is not a tag", () => {
    expect(versionFromImage("registry.local:5000/postgres")).toBeNull();
    expect(versionFromImage("registry.local:5000/postgres:16")).toBe("16");
  });

  test("digest-pinned ref has no tag", () => {
    expect(versionFromImage("postgres@sha256:abc123")).toBeNull();
  });

  test("untagged ref", () => {
    expect(versionFromImage("redis")).toBeNull();
  });
});

describe("firstPerResource", () => {
  test("keeps the first (newest) row per resource", () => {
    const rows = [
      { resourceId: rid("resource_a"), image: "postgres:17" },
      { resourceId: rid("resource_a"), image: "postgres:16" },
      { resourceId: rid("resource_b"), image: "redis:7" },
    ];
    const map = firstPerResource(rows);
    expect(map.get(rid("resource_a"))?.image).toBe("postgres:17");
    expect(map.get(rid("resource_b"))?.image).toBe("redis:7");
    expect(map.size).toBe(2);
  });
});

describe("backupFreshnessPerResource", () => {
  const t1 = new Date("2026-07-01T00:00:00Z");
  const t2 = new Date("2026-07-02T00:00:00Z");

  test("newest attempt sets status; newest success sets freshness", () => {
    // Rows arrive newest-first (failed attempt after the last success).
    const map = backupFreshnessPerResource([
      { resourceId: rid("resource_a"), status: "failed", completedAt: t2, createdAt: t2 },
      { resourceId: rid("resource_a"), status: "succeeded", completedAt: t1, createdAt: t1 },
    ]);
    const entry = map.get(rid("resource_a"));
    expect(entry?.lastBackupStatus).toBe("failed");
    expect(entry?.lastBackupAt).toBe(t1.toISOString());
  });

  test("no succeeded run → null freshness, honest status", () => {
    const map = backupFreshnessPerResource([
      { resourceId: rid("resource_a"), status: "failed", completedAt: null, createdAt: t1 },
    ]);
    expect(map.get(rid("resource_a"))).toEqual({
      lastBackupAt: null,
      lastBackupStatus: "failed",
    });
  });

  test("succeeded run without completedAt falls back to createdAt", () => {
    const map = backupFreshnessPerResource([
      { resourceId: rid("resource_a"), status: "succeeded", completedAt: null, createdAt: t1 },
    ]);
    expect(map.get(rid("resource_a"))?.lastBackupAt).toBe(t1.toISOString());
  });
});

describe("toFiniteNumber", () => {
  test("parses numeric strings, rejects junk", () => {
    expect(toFiniteNumber("42")).toBe(42);
    expect(toFiniteNumber(" 42 ")).toBe(42);
    expect(toFiniteNumber(7)).toBe(7);
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("abc")).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
  });
});

describe("parsePostgresStatsRow", () => {
  test("maps the stats row and trims the distro suffix off server_version", () => {
    expect(
      parsePostgresStatsRow(["123456", "14", "100", "16.4 (Debian 16.4-1.pgdg120+1)"]),
    ).toEqual({
      sizeBytes: 123456,
      connections: 14,
      maxConnections: 100,
      serverVersion: "16.4",
    });
  });

  test("missing row → all null", () => {
    expect(parsePostgresStatsRow(undefined)).toEqual(EMPTY_STATS);
  });

  test("each field degrades independently", () => {
    expect(parsePostgresStatsRow([null, "3", null, null])).toEqual({
      sizeBytes: null,
      connections: 3,
      maxConnections: null,
      serverVersion: null,
    });
  });
});

describe("parseRedisInfoStats", () => {
  const info = [
    "# Server",
    "redis_version:7.2.5",
    "# Clients",
    "connected_clients:4",
    "maxclients:10000",
    "# Memory",
    "used_memory:1048576",
    "used_memory_human:1.00M",
  ].join("\r\n");

  test("parses memory/clients/version out of INFO", () => {
    expect(parseRedisInfoStats(info)).toEqual({
      sizeBytes: 1048576,
      connections: 4,
      maxConnections: 10000,
      serverVersion: "7.2.5",
    });
  });

  test("does not confuse used_memory_human with used_memory", () => {
    const only = "used_memory_human:1.00M\r\nused_memory:2048\r\n";
    expect(parseRedisInfoStats(only).sizeBytes).toBe(2048);
  });

  test("missing sections → nulls", () => {
    expect(parseRedisInfoStats("# Server\r\n")).toEqual(EMPTY_STATS);
  });
});

describe("parseMariadbStats", () => {
  test("parses batch output (header + data line)", () => {
    const sizeOut = "size\tmax\tversion\n524288\t151\t11.4.2-MariaDB\n";
    const threadsOut = "Variable_name\tValue\nThreads_connected\t6\n";
    expect(parseMariadbStats(sizeOut, threadsOut)).toEqual({
      sizeBytes: 524288,
      connections: 6,
      maxConnections: 151,
      serverVersion: "11.4.2-MariaDB",
    });
  });

  test("empty output → nulls", () => {
    expect(parseMariadbStats("", "")).toEqual(EMPTY_STATS);
  });

  test("batchDataCells returns null when there is no data line", () => {
    expect(batchDataCells("header_only\n")).toBeNull();
  });
});

describe("parseMongoStats", () => {
  test("maps dbStats + serverStatus connections", () => {
    expect(
      parseMongoStats({ dataSize: 2048, current: 5, available: 995, version: "7.0.12" }),
    ).toEqual({
      sizeBytes: 2048,
      connections: 5,
      maxConnections: 1000,
      serverVersion: "7.0.12",
    });
  });

  test("serverStatus denied → connections degrade to null, size survives", () => {
    expect(
      parseMongoStats({ dataSize: 2048, current: null, available: null, version: "7.0.12" }),
    ).toEqual({
      sizeBytes: 2048,
      connections: null,
      maxConnections: null,
      serverVersion: "7.0.12",
    });
  });
});

describe("withTimeout", () => {
  test("resolves a fast promise", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  test("rejects a slow promise", async () => {
    const never = new Promise(() => {});
    await expect(withTimeout(never, 10)).rejects.toThrow(/timed out/);
  });
});
