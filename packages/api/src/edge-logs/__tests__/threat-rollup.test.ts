import { describe, expect, test } from "vite-plus/test";

import type { EdgeLogLine } from "../types";

import { MAX_SAMPLE_PATHS, mergeProbe, type PendingProbe } from "../threat-rollup";

function line(over: Partial<EdgeLogLine> = {}): EdgeLogLine {
  return {
    id: "line-1",
    ts: "2026-08-10T12:00:00.000Z",
    method: "GET",
    host: "app.example.com",
    path: "/.env",
    status: 404,
    latencyMs: 1,
    clientIp: "203.0.113.7",
    country: "DE",
    userAgent: "curl/8",
    referer: "",
    tlsVersion: null,
    tlsCipher: null,
    upstream: null,
    cache: null,
    reqBytes: 0,
    resBytes: 0,
    requestId: null,
    headers: {},
    ...over,
  };
}

function fold(lines: EdgeLogLine[]): Map<string, PendingProbe> {
  const pending = new Map<string, PendingProbe>();
  for (const l of lines) mergeProbe(pending, l);
  return pending;
}

describe("mergeProbe", () => {
  test("collapses a burst from one IP into a single counter row", () => {
    const pending = fold([line(), line({ ts: "2026-08-10T12:00:01.000Z" }), line()]);
    expect(pending.size).toBe(1);
    const [group] = [...pending.values()];
    expect(group?.probes).toBe(3);
    expect(group?.ip).toBe("203.0.113.7");
  });

  test("keeps the earliest first_seen and the latest last_seen, out of order", () => {
    const pending = fold([
      line({ ts: "2026-08-10T12:00:05.000Z" }),
      line({ ts: "2026-08-10T11:59:00.000Z" }),
      line({ ts: "2026-08-10T12:00:09.000Z" }),
    ]);
    const [group] = [...pending.values()];
    expect(group?.firstSeen).toBe("2026-08-10T11:59:00.000Z");
    expect(group?.lastSeen).toBe("2026-08-10T12:00:09.000Z");
  });

  test("separates the same IP probing different hosts", () => {
    const pending = fold([line(), line({ host: "api.example.com" })]);
    expect(pending.size).toBe(2);
  });

  test("lowercases the host so Host-header casing doesn't split a row", () => {
    const pending = fold([line({ host: "App.Example.com" }), line()]);
    expect(pending.size).toBe(1);
    expect([...pending.keys()][0]).toBe("app.example.com 203.0.113.7");
  });

  test("collects distinct sample paths, capped", () => {
    const pending = fold([
      line({ path: "/.env" }),
      line({ path: "/.env" }),
      line({ path: "/.git/config" }),
      line({ path: "/wp-login.php" }),
      line({ path: "/actuator/env" }),
      line({ path: "/info.php" }),
      line({ path: "/telescope/requests" }),
    ]);
    const [group] = [...pending.values()];
    expect(group?.probes).toBe(7);
    expect(group?.paths.length).toBe(MAX_SAMPLE_PATHS);
    expect(new Set(group?.paths).size).toBe(MAX_SAMPLE_PATHS);
  });

  test("backfills a country once one lookup resolves", () => {
    const pending = fold([line({ country: null }), line({ country: "CN" })]);
    const [group] = [...pending.values()];
    expect(group?.country).toBe("CN");
  });
});
