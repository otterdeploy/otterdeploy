import { beforeEach, describe, expect, test } from "bun:test";

import { parseCaddyEvent } from "../event-parse";
import {
  __resetEdgeEvents,
  pushEdgeEvent,
  queryEdgeEvents,
  subscribeEdgeEvents,
} from "../event-ring";
import { parseCaddyAccessLog } from "../parse";
import {
  __resetEdgeLogs,
  bucketOf,
  pushEdgeLog,
  queryEdgeLogs,
  subscribeEdgeLogs,
} from "../ring";
import type { EdgeEventLine, EdgeLogLine } from "../types";

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
    const out = parseCaddyAccessLog(caddyEntry)!;
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
    })!;
    expect(out.headers["Cookie"]).toBeUndefined();
    expect(out.headers["Authorization"]).toBeUndefined();
    expect(out.headers["User-Agent"]).toBe("x");
  });

  test("strips port from remote_addr fallback", () => {
    const out = parseCaddyAccessLog({
      ...caddyEntry,
      request: { ...caddyEntry.request, remote_ip: undefined, remote_addr: "9.9.9.9:5555" },
    })!;
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
    expect(res.rows[0]!.host).toBe("plane.com");
  });

  test("query computes per-host error rate + percentiles", () => {
    for (let i = 0; i < 9; i++) pushEdgeLog(line({ status: 200, latencyMs: 10 }));
    pushEdgeLog(line({ status: 500, latencyMs: 100 }));
    const res = queryEdgeLogs({ hosts: ["plane.com"], range: "1h" }, Date.now());
    const stat = res.hostStats.find((s) => s.host === "plane.com")!;
    expect(stat.errorRate).toBeCloseTo(0.1, 5);
    expect(stat.p50).toBe(10);
    expect(res.total).toBe(10);
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
    expect(res.rows.map((r) => r.status).sort()).toEqual([404, 500]);
  });

  test("subscribe delivers live lines and unsubscribes", () => {
    const seen: EdgeLogLine[] = [];
    const unsub = subscribeEdgeLogs((l) => seen.push(l));
    pushEdgeLog(line({ path: "/a" }));
    unsub();
    pushEdgeLog(line({ path: "/b" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe("/a");
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
    })!;
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
    })!;
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
    })!;
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
    expect(res.rows[0]!.host).toBe("plane.com");
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
    expect(res.rows[0]!.domains).toEqual(["plane.com"]);
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
    expect(byCat.rows[0]!.category).toBe("cert");
    const byLevel = queryEdgeEvents(
      { hosts: ["plane.com"], range: "1h", levels: ["error"] },
      Date.now(),
    );
    expect(byLevel.total).toBe(1);
    expect(byLevel.rows[0]!.level).toBe("error");
  });

  test("subscribe delivers live events and unsubscribes", () => {
    const seen: EdgeEventLine[] = [];
    const unsub = subscribeEdgeEvents((e) => seen.push(e));
    pushEdgeEvent(ev({ msg: "first" }));
    unsub();
    pushEdgeEvent(ev({ msg: "second" }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.msg).toBe("first");
  });
});
