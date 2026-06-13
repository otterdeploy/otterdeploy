import { beforeEach, describe, expect, test } from "bun:test";

import { parseCaddyAccessLog } from "../parse";
import {
  __resetEdgeLogs,
  bucketOf,
  pushEdgeLog,
  queryEdgeLogs,
  subscribeEdgeLogs,
} from "../ring";
import type { EdgeLogLine } from "../types";

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
