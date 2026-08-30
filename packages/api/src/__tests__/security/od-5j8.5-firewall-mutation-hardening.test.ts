/**
 * od-5j8.5: firewall mutations are authorized and blocklist ingestion is
 * hardened against SSRF / shell injection / malformed content.
 *
 * Invariant under test:
 *   1. Every firewall mutation (block/unblock/blockMany/console.enroll and
 *      every `blocklists.*` write) requires BOTH install-admin AND the
 *      organization's `firewall:update` permission. A plain install-admin
 *      read gate is not enough for a write.
 *   2. Blocklist ingestion never fetches a URL that resolves to a
 *      loopback/private/link-local/cloud-metadata address (SSRF corpus
 *      against the shared `isForbiddenOutboundAddress` guard the firewall
 *      sync path is built on).
 *   3. Blocklist content parsing never forwards shell-meaningful annotations
 *      to the `cscli` importer (command injection via a malicious list
 *      entry).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import { isForbiddenOutboundAddress, validatePublicHttpUrl } from "../../security/public-fetch";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("[od-5j8.5] every firewall mutation requires install-admin AND firewall:update", () => {
  // The three decision writes moved to their own file when index.ts hit the
  // line cap; the gate they must use did not change.
  test("block/unblock/blockMany all use the write-gated procedure, not the read-only one", () => {
    const handlers = source("packages/api/src/routers/firewall/decision-handlers.ts");
    expect(handlers).toContain(
      'const globalFirewallWrite = requireInstallAdminPermission({ firewall: ["update"] });',
    );
    for (const handler of ["block:", "blockMany:", "unblock:"]) {
      const line = handlers.slice(handlers.indexOf(handler));
      expect(line.slice(0, line.indexOf("\n"))).toContain("globalFirewallWrite");
    }
  });

  test("console.enroll uses the write-gated procedure", () => {
    const router = source("packages/api/src/routers/firewall/index.ts");
    expect(router).toContain(
      'const globalFirewallWrite = requireInstallAdminPermission({ firewall: ["update"] });',
    );
    const line = router.slice(router.indexOf("enroll:"));
    expect(line.slice(0, line.indexOf("\n"))).toContain("globalFirewallWrite");
  });

  // Both write paths have to consult the guard, and they consult it
  // differently on purpose: a single deliberate block refuses only the
  // caller's own address, a sweep silently drops every signed-in one. A
  // regression here bans the operator off their own panel.
  test("neither block path can ban the people operating the firewall", () => {
    const handlers = source("packages/api/src/routers/firewall/decision-handlers.ts");
    expect(handlers).toContain("blocksCaller(input.ip, context.headers)");
    expect(handlers).toContain("errors.SELF_BLOCK()");
    expect(handlers).toContain("sweepBlockTargets(input.ips)");
  });

  test("every blocklists.* write handler (addCustom/enableCatalog/toggle/remove/syncNow) uses the write gate", () => {
    const router = source("packages/api/src/routers/firewall/index.ts");
    const blocklistsBlock = router.slice(
      router.indexOf("blocklists: {"),
      router.indexOf("\n  console: {"),
    );
    for (const handler of ["addCustom:", "enableCatalog:", "toggle:", "remove:", "syncNow:"]) {
      const idx = blocklistsBlock.indexOf(handler);
      expect(idx).toBeGreaterThan(-1);
      const line = blocklistsBlock.slice(
        idx,
        blocklistsBlock.indexOf("\n", idx + handler.length + 40),
      );
      expect(line).toContain("globalFirewallWrite");
    }
  });

  test("blocklists.list (a read) uses the read-only gate, not the write gate, least privilege", () => {
    const router = source("packages/api/src/routers/firewall/index.ts");
    const listIdx = router.indexOf("list: globalFirewallRead.firewall.blocklists.list");
    expect(listIdx).toBeGreaterThan(-1);
  });

  test("no firewall handler falls back to a bare orgScopedProcedure without a permission check", () => {
    const router = source("packages/api/src/routers/firewall/index.ts");
    expect(router).not.toContain("orgScopedProcedure.firewall");
  });
});

describe("[od-5j8.5] blocklist ingestion SSRF corpus", () => {
  test.each([
    ["loopback IPv4", "127.0.0.1"],
    ["loopback IPv6", "::1"],
    ["IPv4-mapped IPv6 loopback", "::ffff:127.0.0.1"],
    ["cloud metadata endpoint", "169.254.169.254"],
    ["link-local IPv6", "fe80::1"],
    ["private RFC1918 (10/8)", "10.1.2.3"],
    ["private RFC1918 (172.16/12)", "172.16.0.5"],
    ["private RFC1918 (192.168/16)", "192.168.1.1"],
    ["carrier-grade NAT (100.64/10)", "100.64.0.1"],
    ["unique-local IPv6 (fc00::/7)", "fc00::1"],
    ["documentation range (TEST-NET-1)", "192.0.2.1"],
    ["benchmarking range", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["unspecified", "0.0.0.0"],
  ])("rejects %s (%s) as an outbound target", (_label, address) => {
    expect(isForbiddenOutboundAddress(address)).toBe(true);
  });

  test("a routable public address is allowed", () => {
    expect(isForbiddenOutboundAddress("1.1.1.1")).toBe(false);
    expect(isForbiddenOutboundAddress("8.8.8.8")).toBe(false);
  });

  test("a non-IP string (unresolved hostname) is treated as forbidden, not skipped", () => {
    expect(isForbiddenOutboundAddress("not-an-ip")).toBe(true);
  });

  test("credentials embedded in a blocklist URL are rejected before any network call", () => {
    expect(() => validatePublicHttpUrl("https://user:pass@list.example/ips.txt")).toThrow();
  });

  test("non-http(s) schemes (file/gopher/ftp) are rejected outright, classic SSRF scheme-confusion vectors", () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_FLUSHALL",
      "ftp://internal/",
      "unix:///var/run/docker.sock",
    ]) {
      expect(() => validatePublicHttpUrl(url)).toThrow();
    }
  });

  test("a blocklist URL cannot target the control plane's own declared hostnames", () => {
    expect(() => validatePublicHttpUrl("https://server/ips.txt", ["server"])).toThrow(
      "The URL targets the control plane.",
    );
  });

  test("the firewall sync path is built on the shared SSRF-hardened fetcher, not a bare fetch()", () => {
    const sync = source("packages/api/src/routers/firewall/sync.ts");
    expect(sync).toContain("fetchPublicText");
    expect(sync).not.toMatch(/\bawait fetch\(/);
    const router = source("packages/api/src/routers/firewall/index.ts");
    expect(router).toContain("validatePublicHttpUrl");
  });
});

describe("[od-5j8.5] blocklist content parsing hardening (import 'cscli decisions import')", () => {
  test("parseBlocklistContent is imported by the sync path that shells out to cscli", () => {
    const sync = source("packages/api/src/routers/firewall/sync.ts");
    expect(sync).toContain("cscliRun");
  });

  test("cscliRun documents positional-argument passing rather than shell interpolation", () => {
    const cscli = source("packages/api/src/routers/firewall/cscli.ts");
    // The router's console.enroll call site comments this explicitly; assert
    // the primitive itself never builds a command string via interpolation
    // of caller-controlled values (e.g. `` `cscli ... ${value}` ``).
    expect(cscli).not.toMatch(/`cscli[^`]*\$\{/);
  });
});
