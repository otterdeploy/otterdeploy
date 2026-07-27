/**
 * od-5j8.11 — every IP the firewall/CrowdSec layer acts on or attributes a
 * decision to must come from a source a caller can't spoof, never a
 * client-controlled header read directly.
 *
 * Two attribution paths feed CrowdSec/firewall enforcement:
 *   1. Edge-log ingestion (edge-logs/parse.ts) — the client IP CrowdSec's
 *      Caddy-log acquisition scenarios key on, and what the Firewall
 *      "Flagged IPs" review surfaces to the operator before a manual block.
 *      Caddy IS the network edge here (TLS-only ingress, od-5j8.10) — its
 *      own structured access-log fields (remote_ip/remote_addr) are the
 *      actual TCP peer, not a forwarded header, so this path is safe BY
 *      CONSTRUCTION as long as it keeps reading those fields instead of an
 *      X-Forwarded-For-style header off the request.
 *   2. The control-plane's own request handling (apps/server) — od-5j8.10's
 *      trusted-proxy resolver (packages/api/src/security/trusted-proxy.ts)
 *      is the ONLY place allowed to turn X-Forwarded-For into a trusted
 *      client IP, and `sanitizeForwardingHeaders` must run before anything
 *      else (in particular evlog's audit enricher, which has no injectable
 *      IP resolver) reads those headers — otherwise a direct caller could
 *      spoof the IP that ends up attributed to a firewall-adjacent audit
 *      entry (e.g. a manual block/unblock, or console.enroll).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("[od-5j8.11] edge-log ingestion sources the client IP from Caddy's own connection fields", () => {
  test("ipOf() reads remote_ip/remote_addr — Caddy's own view of the TCP peer — never a forwarded header", () => {
    const parse = source("packages/api/src/edge-logs/parse.ts");
    const fn = parse.slice(
      parse.indexOf("function ipOf("),
      parse.indexOf("\n}\n", parse.indexOf("function ipOf(")) + 2,
    );
    expect(fn).toContain("req.remote_ip");
    expect(fn).toContain("req.remote_addr");
    expect(fn).not.toMatch(/forwarded-for/i);
    expect(fn).not.toMatch(/headers\./);
  });

  test("the Flagged-IPs review path (what an operator blocks off of) reads edgeLog.clientIp — populated from ipOf(), not a header", () => {
    const threatScan = source("packages/api/src/edge-logs/threat-scan.ts");
    expect(threatScan).toContain("edgeLog.clientIp");
    const parse = source("packages/api/src/edge-logs/parse.ts");
    expect(parse).toContain("clientIp: ipOf(req)");
  });
});

describe("[od-5j8.11] the control plane's own request path resolves the caller IP through the trusted-proxy gate, not raw headers", () => {
  test("sanitizeForwardingHeaders runs before evlog's audit middleware in apps/server — the ordering a spoofed forwarded header depends on NOT existing", () => {
    const entry = source("apps/server/src/index.ts");
    const sanitizeAt = entry.indexOf("sanitizeForwardingHeaders(c)");
    const evlogAt = entry.indexOf("evlog({");
    expect(sanitizeAt).toBeGreaterThan(-1);
    expect(evlogAt).toBeGreaterThan(-1);
    expect(sanitizeAt).toBeLessThan(evlogAt);
  });

  test("resolveClientAddress only trusts X-Forwarded-For from a peer matching TRUSTED_PROXIES — never unconditionally", () => {
    const trustedProxy = source("packages/api/src/security/trusted-proxy.ts");
    expect(trustedProxy).toContain(
      "isTrustedProxyPeer(input.peerAddress, input.trustedProxiesRaw)",
    );
    // The untrusted branch must return BEFORE the header is even read.
    const fn = trustedProxy.slice(
      trustedProxy.indexOf("export function resolveClientAddress"),
      trustedProxy.indexOf("\n}\n", trustedProxy.indexOf("export function resolveClientAddress")),
    );
    const trustedPeerLine = fn.indexOf("if (!trustedPeer)");
    const headerReadLine = fn.indexOf('headers.get("x-forwarded-for")');
    expect(trustedPeerLine).toBeGreaterThan(-1);
    expect(headerReadLine).toBeGreaterThan(-1);
    expect(trustedPeerLine).toBeLessThan(headerReadLine);
  });

  test("no firewall router handler reads x-forwarded-for / x-real-ip directly — every IP it acts on is either operator-typed input or comes through the trusted resolver", () => {
    const router = source("packages/api/src/routers/firewall/index.ts");
    expect(router).not.toMatch(/x-forwarded-for/i);
    expect(router).not.toMatch(/x-real-ip/i);
  });

  test("the terminal feature's own raw header IP reader (a DIFFERENT, ticket-scoped concern) is never imported by the firewall subsystem", () => {
    const router = source("packages/api/src/routers/firewall/index.ts");
    const decisionsRead = source("packages/api/src/routers/firewall/decisions-read.ts");
    expect(router).not.toContain("clientIpFromHeaders");
    expect(decisionsRead).not.toContain("clientIpFromHeaders");
  });
});
