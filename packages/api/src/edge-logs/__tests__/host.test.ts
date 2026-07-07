import { beforeEach, describe, expect, test } from "vite-plus/test";

import { normalizeHost } from "../host";
import { parseCaddyAccessLog } from "../parse";
import { __resetEdgeLogs, pushEdgeLog, queryEdgeLogs } from "../ring";

describe("normalizeHost", () => {
  test("lowercases", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });

  test("strips a trailing port", () => {
    expect(normalizeHost("example.com:8443")).toBe("example.com");
    expect(normalizeHost("EXAMPLE.com:443")).toBe("example.com");
  });

  test("leaves a bare host untouched", () => {
    expect(normalizeHost("example.com")).toBe("example.com");
  });

  test("keeps an IPv6 literal intact while stripping its port", () => {
    expect(normalizeHost("[::1]:443")).toBe("[::1]");
    expect(normalizeHost("[::1]")).toBe("[::1]");
  });

  test("is idempotent", () => {
    expect(normalizeHost(normalizeHost("Example.com:443"))).toBe("example.com");
  });
});

describe("ingest canonicalizes the stored host", () => {
  beforeEach(() => __resetEdgeLogs());

  // ts within the query window so the host filter — not the time filter —
  // decides the match.
  const tsSec = 1_700_000_000;
  const now = tsSec * 1000 + 1_000;
  const entry = (host: string) => ({
    ts: tsSec,
    request: { method: "GET", host, uri: "/" },
    status: 200,
  });

  test("a case/port-variant Host is stored canonical", () => {
    const out = parseCaddyAccessLog(entry("Plane.COM:443"));
    if (!out) throw new Error("expected a parsed line");
    expect(out.host).toBe("plane.com");
  });

  test("a canonical scope matches a case/port-variant request (pre-fix: dropped)", () => {
    const out = parseCaddyAccessLog(entry("Plane.COM:443"));
    if (!out) throw new Error("expected a parsed line");
    pushEdgeLog(out);

    const res = queryEdgeLogs({ hosts: ["plane.com"], range: "1h" }, now);
    expect(res.total).toBe(1);
    expect(res.rows[0]?.host).toBe("plane.com");
  });
});
