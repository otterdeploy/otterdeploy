import { beforeEach, describe, expect, test } from "vite-plus/test";

import type { EdgeEventLine, EdgeLogLine } from "../types";

import { parseCaddyEvent } from "../event-parse";
import {
  __resetEdgeEvents,
  pushEdgeEvent,
  queryEdgeEvents,
  subscribeEdgeEvents,
} from "../event-ring";
import { parseCaddyAccessLog } from "../parse";
import { __resetEdgeLogs, bucketOf, pushEdgeLog, queryEdgeLogs, subscribeEdgeLogs } from "../ring";

/** Narrow `arr[0]` to its element type with a throwing guard. Keeps the tests
 *  free of `!` non-null assertions while preserving `arr[0]!`'s runtime intent. */
function first<T>(arr: readonly T[]): T {
  const row = arr[0];
  if (row === undefined) throw new Error("expected at least one element");
  return row;
}

const caddyEntry = {
  ts: 1_700_000_000.5,
  request: {
    remote_ip: "1.2.3.4",
    method: "GET",
    host: "plane.com",
    uri: "/app",
    headers: {
      "User-Agent": ["Mozilla/5.0"],
      Referer: ["https://plane.com/"],
    },
    tls: { version: 772, cipher_suite: 4865 },
  },
  duration: 0.012,
  size: 1234,
  bytes_read: 56,
  status: 200,
  request_id: "req_abc",
};

describe("parseCaddyAccessLog", () => {
  test("maps a Caddy access entry to an EdgeLogLine", () => {
    const out = parseCaddyAccessLog(caddyEntry);
    if (!out) throw new Error("expected a parsed access line");
    expect(out.method).toBe("GET");
    expect(out.host).toBe("plane.com");
    expect(out.path).toBe("/app");
    expect(out.status).toBe(200);
    expect(out.latencyMs).toBe(12);
    expect(out.clientIp).toBe("1.2.3.4");
    expect(out.userAgent).toBe("Mozilla/5.0");
    expect(out.referer).toBe("https://plane.com/");
    expect(out.tlsVersion).toBe("TLSv1.3");
    expect(out.tlsCipher).toBe("TLS_AES_128_GCM_SHA256");
    expect(out.reqBytes).toBe(56);
    expect(out.resBytes).toBe(1234);
    expect(out.requestId).toBe("req_abc");
    expect(out.ts).toBe(new Date(1_700_000_000_500).toISOString());
    // headers captured (sensitive ones stripped)
    expect(out.headers["User-Agent"]).toBe("Mozilla/5.0");
    expect(out.headers["Referer"]).toBe("https://plane.com/");
  });

  test("strips sensitive headers from the preview", () => {
    const out = parseCaddyAccessLog({
      ...caddyEntry,
      request: {
        ...caddyEntry.request,
        headers: {
          "User-Agent": ["x"],
          Cookie: ["session=secret"],
          Authorization: ["Bearer tok"],
        },
      },
    });
    if (!out) throw new Error("expected a parsed access line");
    expect(out.headers["Cookie"]).toBeUndefined();
    expect(out.headers["Authorization"]).toBeUndefined();
    expect(out.headers["User-Agent"]).toBe("x");
  });

  test("strips port from remote_addr fallback", () => {
    const out = parseCaddyAccessLog({
      ...caddyEntry,
      request: { ...caddyEntry.request, remote_ip: undefined, remote_addr: "9.9.9.9:5555" },
    });
    if (!out) throw new Error("expected a parsed access line");
    expect(out.clientIp).toBe("9.9.9.9");
  });

  test("returns null for non-access (runtime) log lines", () => {
    expect(parseCaddyAccessLog({ level: "info", msg: "serving" })).toBeNull();
    expect(parseCaddyAccessLog("garbage")).toBeNull();
    expect(parseCaddyAccessLog(null)).toBeNull();
  });
});

describe("ring buffer", () => {
  beforeEach(() => __resetEdgeLogs());

  function line(partial: Partial<EdgeLogLine>): EdgeLogLine {
    return {
      id: Math.random().toString(36),
      ts: new Date().toISOString(),
      method: "GET",
      host: "plane.com",
      path: "/",
      status: 200,
      latencyMs: 10,
      clientIp: "1.1.1.1",
      country: null,
      userAgent: "ua",
      referer: "-",
      tlsVersion: null,
      tlsCipher: null,
      upstream: null,
      cache: null,
      reqBytes: 0,
      resBytes: 0,
      requestId: null,
      headers: {},
      ...partial,
    };
  }

  test("bucketOf classifies status codes", () => {
    expect(bucketOf(204)).toBe("2xx");
    expect(bucketOf(301)).toBe("3xx");
    expect(bucketOf(404)).toBe("4xx");
    expect(bucketOf(503)).toBe("5xx");
  });

  test("query is scoped to the caller's hosts", () => {
    pushEdgeLog(line({ host: "plane.com" }));
    pushEdgeLog(line({ host: "evil.com" }));
    const res = queryEdgeLogs({ hosts: ["plane.com"], range: "1h" }, Date.now());
    expect(res.total).toBe(1);
    expect(first(res.rows).host).toBe("plane.com");
  });

  test("query computes per-host error rate + percentiles", () => {
    for (let i = 0; i < 9; i++) pushEdgeLog(line({ status: 200, latencyMs: 10 }));
    pushEdgeLog(line({ status: 500, latencyMs: 100 }));
    const res = queryEdgeLogs({ hosts: ["plane.com"], range: "1h" }, Date.now());
    const stat = res.hostStats.find((s) => s.host === "plane.com");
    if (!stat) throw new Error("expected a host stat");
    expect(stat.errorRate).toBeCloseTo(0.1, 5);
    expect(stat.p50).toBe(10);
    expect(res.total).toBe(10);
  });

  test("suspicious totals count the window, not the returned page", () => {
    // 30 probes, then 10 ordinary requests, with a page cap of 5. The cap
    // leaves the newest 5 (all ordinary) in `rows`, so a count derived from
    // `rows` would say zero. The window still holds 30.
    for (let i = 0; i < 30; i++) pushEdgeLog(line({ path: "/.env", clientIp: "9.9.9.9" }));
    for (let i = 0; i < 10; i++) pushEdgeLog(line({ path: "/" }));
    const res = queryEdgeLogs({ hosts: ["plane.com"], range: "1h", limit: 5 }, Date.now());
    expect(res.rows).toHaveLength(5);
    expect(res.rows.every((r) => r.path === "/")).toBe(true);
    expect(res.suspiciousTotal).toBe(30);
    expect(res.suspiciousIps).toEqual(["9.9.9.9"]);
  });

  test("a wider window never reports fewer probes than a narrower one", () => {
    // The bug this pins: 1h → 7d made the toolbar count FALL, because it was
    // read off the capped page instead of the window. 7d contains 1h, so its
    // count must be >= the 1h count for any data.
    const now = Date.now();
    for (let i = 0; i < 40; i++) {
      pushEdgeLog(line({ path: "/.git/config", ts: new Date(now - 30 * 60_000).toISOString() }));
    }
    for (let i = 0; i < 300; i++) {
      pushEdgeLog(line({ path: "/", ts: new Date(now - 60_000).toISOString() }));
    }
    const oneHour = queryEdgeLogs({ hosts: ["plane.com"], range: "1h" }, now);
    const sevenDays = queryEdgeLogs({ hosts: ["plane.com"], range: "7d" }, now);
    expect(oneHour.suspiciousTotal).toBe(40);
    expect(sevenDays.suspiciousTotal).toBeGreaterThanOrEqual(oneHour.suspiciousTotal);
    // And the older probes are outside the default page either way.
    expect(sevenDays.rows.some((r) => r.path === "/.git/config")).toBe(false);
  });

  test("the suspicious filter narrows rows server-side", () => {
    pushEdgeLog(line({ path: "/" }));
    pushEdgeLog(line({ path: "/actuator/env", clientIp: "5.5.5.5" }));
    pushEdgeLog(line({ path: "/.well-known/security.txt" }));
    const res = queryEdgeLogs({ hosts: ["plane.com"], range: "1h", suspicious: true }, Date.now());
    expect(res.total).toBe(1);
    expect(first(res.rows).path).toBe("/actuator/env");
    expect(res.suspiciousIps).toEqual(["5.5.5.5"]);
  });

  test("status filter narrows the result (multi-select)", () => {
    pushEdgeLog(line({ status: 200 }));
    pushEdgeLog(line({ status: 404 }));
    pushEdgeLog(line({ status: 500 }));
    const res = queryEdgeLogs(
      { hosts: ["plane.com"], range: "1h", statuses: ["4xx", "5xx"] },
      Date.now(),
    );
    expect(res.total).toBe(2);
    expect(res.rows.map((r) => r.status).sort((a, b) => a - b)).toEqual([404, 500]);
  });

  test("custom from/to window overrides the rolling range", () => {
    const now = Date.now();
    const hourAgo = now - 60 * 60_000;
    pushEdgeLog(line({ path: "/old", ts: new Date(hourAgo - 10 * 60_000).toISOString() }));
    pushEdgeLog(line({ path: "/inside", ts: new Date(hourAgo + 5 * 60_000).toISOString() }));
    pushEdgeLog(line({ path: "/after", ts: new Date(now - 60_000).toISOString() }));
    const res = queryEdgeLogs(
      { hosts: ["plane.com"], range: "5m", from: hourAgo, to: hourAgo + 10 * 60_000 },
      now,
    );
    expect(res.total).toBe(1);
    expect(first(res.rows).path).toBe("/inside");
    // Histogram buckets span the custom window, not the preset.
    expect(Date.parse(first(res.histogram).t)).toBeGreaterThanOrEqual(hourAgo);
  });

  test("subscribe delivers live lines and unsubscribes", () => {
    const seen: EdgeLogLine[] = [];
    const unsub = subscribeEdgeLogs((l) => seen.push(l));
    pushEdgeLog(line({ path: "/a" }));
    unsub();
    pushEdgeLog(line({ path: "/b" }));
    expect(seen).toHaveLength(1);
    expect(first(seen).path).toBe("/a");
  });
});

describe("parseCaddyEvent", () => {
  test("classifies an ACME challenge error (cert, host)", () => {
    const out = parseCaddyEvent({
      level: "error",
      ts: 1_700_000_000,
      logger: "http",
      msg: "looking up info for HTTP challenge",
      host: "www.somnara.de",
      error: "no information found to solve challenge for identifier: www.somnara.de",
    });
    if (!out) throw new Error("expected a parsed event");
    expect(out.category).toBe("cert");
    expect(out.level).toBe("error");
    expect(out.host).toBe("www.somnara.de");
    expect(out.error).toContain("no information found");
  });

  test("keeps cert-management batch (info level) with domains, no host", () => {
    const out = parseCaddyEvent({
      level: "info",
      logger: "http",
      msg: "enabling automatic TLS certificate management",
      domains: ["a.example.com", "b.example.com"],
    });
    if (!out) throw new Error("expected a parsed event");
    expect(out.category).toBe("cert");
    expect(out.host).toBeNull();
    expect(out.domains).toEqual(["a.example.com", "b.example.com"]);
  });

  test("classifies a reverse_proxy error and strips sensitive headers from raw", () => {
    const out = parseCaddyEvent({
      level: "error",
      logger: "http.handlers.reverse_proxy",
      msg: "aborting with incomplete response",
      upstream: "10.0.6.7:3000",
      error: "reading: context canceled",
      request: {
        host: "trigger.example.com",
        headers: { Authorization: ["secret"], Cookie: ["s=1"], "User-Agent": ["node"] },
      },
    });
    if (!out) throw new Error("expected a parsed event");
    expect(out.category).toBe("upstream");
    expect(out.host).toBe("trigger.example.com");
    expect(out.upstream).toBe("10.0.6.7:3000");
    expect(out.raw).not.toContain("secret");
    expect(out.raw).not.toContain("Cookie");
    expect(out.raw).toContain("User-Agent");
  });

  test("drops info-level noise that isn't cert (reloads, lifecycle)", () => {
    expect(
      parseCaddyEvent({ level: "info", logger: "docker-proxy", msg: "New Config JSON" }),
    ).toBeNull();
    expect(
      parseCaddyEvent({ level: "info", logger: "http.log", msg: "server running" }),
    ).toBeNull();
    expect(parseCaddyEvent("garbage")).toBeNull();
    expect(parseCaddyEvent({})).toBeNull();
  });
});

describe("event ring", () => {
  beforeEach(() => __resetEdgeEvents());

  function ev(partial: Partial<EdgeEventLine>): EdgeEventLine {
    return {
      id: Math.random().toString(36),
      ts: new Date().toISOString(),
      level: "error",
      category: "upstream",
      logger: "http.handlers.reverse_proxy",
      msg: "aborting with incomplete response",
      host: "plane.com",
      domains: [],
      upstream: "10.0.0.1:3000",
      error: "context canceled",
      raw: "{}",
      ...partial,
    };
  }

  test("query is scoped to the caller's hosts", () => {
    pushEdgeEvent(ev({ host: "plane.com" }));
    pushEdgeEvent(ev({ host: "evil.com" }));
    const res = queryEdgeEvents({ hosts: ["plane.com"], range: "1h" }, Date.now());
    expect(res.total).toBe(1);
    expect(first(res.rows).host).toBe("plane.com");
  });

  test("batch event is visible via an owned domain and redacted to it", () => {
    pushEdgeEvent(
      ev({
        category: "cert",
        host: null,
        msg: "enabling automatic TLS certificate management",
        domains: ["plane.com", "evil.com"],
      }),
    );
    const res = queryEdgeEvents({ hosts: ["plane.com"], range: "1h" }, Date.now());
    expect(res.total).toBe(1);
    expect(first(res.rows).domains).toEqual(["plane.com"]);
  });

  test("host-less, domain-less events are not surfaced per tenant", () => {
    pushEdgeEvent(ev({ host: null, domains: [], category: "config" }));
    const res = queryEdgeEvents({ hosts: ["plane.com"], range: "1h" }, Date.now());
    expect(res.total).toBe(0);
  });

  test("category + level filters narrow the result", () => {
    pushEdgeEvent(ev({ category: "cert", level: "info" }));
    pushEdgeEvent(ev({ category: "upstream", level: "error" }));
    const byCat = queryEdgeEvents(
      { hosts: ["plane.com"], range: "1h", categories: ["cert"] },
      Date.now(),
    );
    expect(byCat.total).toBe(1);
    expect(first(byCat.rows).category).toBe("cert");
    const byLevel = queryEdgeEvents(
      { hosts: ["plane.com"], range: "1h", levels: ["error"] },
      Date.now(),
    );
    expect(byLevel.total).toBe(1);
    expect(first(byLevel.rows).level).toBe("error");
  });

  test("subscribe delivers live events and unsubscribes", () => {
    const seen: EdgeEventLine[] = [];
    const unsub = subscribeEdgeEvents((e) => seen.push(e));
    pushEdgeEvent(ev({ msg: "first" }));
    unsub();
    pushEdgeEvent(ev({ msg: "second" }));
    expect(seen).toHaveLength(1);
    expect(first(seen).msg).toBe("first");
  });
});
