import { describe, expect, it } from "vite-plus/test";

import type { EdgeHostStat } from "../../edge-logs/types";
import type { ProjectRouteRef } from "./route-stats";

import { mergeRouteStats } from "./route-stats";

const route = (host: string, over?: Partial<ProjectRouteRef>): ProjectRouteRef => ({
  host,
  resourceId: `resource_${host.split(".")[0]}`,
  isPrimary: true,
  ...over,
});

const stat = (host: string, over?: Partial<EdgeHostStat>): EdgeHostStat => ({
  host,
  rps: 1,
  errorRate: 0,
  p50: 10,
  p95: 40,
  p99: 90,
  ...over,
});

describe("mergeRouteStats", () => {
  it("returns one row per route, carrying the host's stats", () => {
    const out = mergeRouteStats(
      [route("web.example.com")],
      [stat("web.example.com", { rps: 3.2, errorRate: 0.01, p50: 12, p95: 88 })],
    );
    expect(out).toEqual([
      {
        host: "web.example.com",
        resourceId: "resource_web",
        isPrimary: true,
        rps: 3.2,
        errorRate: 0.01,
        p50: 12,
        p95: 88,
      },
    ]);
  });

  it("zero-fills routes with no traffic instead of dropping them", () => {
    const out = mergeRouteStats([route("quiet.example.com")], []);
    expect(out).toEqual([
      {
        host: "quiet.example.com",
        resourceId: "resource_quiet",
        isPrimary: true,
        rps: 0,
        errorRate: 0,
        p50: 0,
        p95: 0,
      },
    ]);
  });

  it("never invents a route from a stat outside the route list", () => {
    const out = mergeRouteStats([route("a.example.com")], [stat("stray.example.com")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.host).toBe("a.example.com");
  });

  it("orders busiest hosts first, then alphabetically for the quiet tail", () => {
    const out = mergeRouteStats(
      [route("zz.example.com"), route("aa.example.com"), route("busy.example.com")],
      [stat("busy.example.com", { rps: 12 })],
    );
    expect(out.map((r) => r.host)).toEqual([
      "busy.example.com",
      "aa.example.com",
      "zz.example.com",
    ]);
  });
});
