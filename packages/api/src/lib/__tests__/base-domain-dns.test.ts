/**
 * The workspace base domain's DNS: which records it needs, what the live DNS
 * says about them, and what the Cloudflare one-click path writes.
 *
 * Every generated host is `<service>-<project>.<base>`, so the record that
 * makes services reachable is the wildcard `*.<base>`. One-click used to write
 * only the verify TXT and the apex A, which verified the domain while every
 * service hostname still failed to resolve.
 */

import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DnsLookupFailed, DnsRecordMissing } from "../dns-resolver";
import { fakeCloudflare } from "./fake-cloudflare";

const { resolveAddressesRobust, resolveTxtRobust } = vi.hoisted(() => ({
  resolveAddressesRobust: vi.fn(),
  resolveTxtRobust: vi.fn(),
}));

vi.mock("../dns-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dns-resolver")>();
  return { ...actual, resolveAddressesRobust, resolveTxtRobust };
});

const { baseDomainDnsRecords } = await import("../dns-records");
const {
  checkBaseDomainTxt,
  checkBaseDomainWildcard,
  ensureBaseDomainWildcard,
  wildcardProbeName,
  writeBaseDomainRecords,
} = await import("../base-domain-dns");

const SERVER_IP = "203.0.113.24";
const ELSEWHERE = "198.51.100.7";
// Inside Cloudflare's published 104.16.0.0/13 edge range.
const CLOUDFLARE_EDGE = "104.16.1.1";

beforeEach(() => {
  resolveAddressesRobust.mockReset();
  resolveTxtRobust.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("baseDomainDnsRecords", () => {
  it("asks for the wildcard A record and the ownership TXT, not the apex", () => {
    expect(
      baseDomainDnsRecords({
        baseDomain: "acme.com",
        serverIp: SERVER_IP,
        verifyToken: "tok",
        zone: "acme.com",
      }),
    ).toEqual([
      { type: "A", name: "*.acme.com", value: SERVER_IP, relativeName: "*" },
      {
        type: "TXT",
        name: "_otterdeploy-verify.acme.com",
        value: "tok",
        relativeName: "_otterdeploy-verify",
      },
    ]);
  });

  it("names records relative to the zone when the base domain sits below it", () => {
    const records = baseDomainDnsRecords({
      baseDomain: "apps.acme.com",
      serverIp: SERVER_IP,
      verifyToken: "tok",
      zone: "acme.com",
    });
    expect(records.map((r) => r.relativeName)).toEqual(["*.apps", "_otterdeploy-verify.apps"]);
  });

  it("gives no relative name when the zone is unknown, rather than guess one", () => {
    // Guessing the base domain is the zone would turn apps.acme.com's wildcard
    // into a bare "*", which a provider UI creates as *.acme.com.
    const records = baseDomainDnsRecords({
      baseDomain: "apps.acme.com",
      serverIp: SERVER_IP,
      verifyToken: "tok",
    });
    expect(records.map((r) => r.relativeName)).toEqual([null, null]);
  });

  it("omits the A record when the install has no public IP to point at", () => {
    const records = baseDomainDnsRecords({
      baseDomain: "acme.com",
      serverIp: null,
      verifyToken: "tok",
    });
    expect(records.map((r) => r.type)).toEqual(["TXT"]);
  });
});

describe("checkBaseDomainWildcard", () => {
  it("probes a name under the wildcard, never the apex", async () => {
    resolveAddressesRobust.mockResolvedValue(Result.ok([SERVER_IP]));
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: SERVER_IP });
    expect(resolveAddressesRobust).toHaveBeenCalledWith(wildcardProbeName("acme.com"));
    expect(check.probe).toBe(wildcardProbeName("acme.com"));
    expect(check.probe.endsWith(".acme.com")).toBe(true);
  });

  it("reports pointing-here when the probe resolves to this server", async () => {
    resolveAddressesRobust.mockResolvedValue(Result.ok([SERVER_IP]));
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: SERVER_IP });
    expect(check).toMatchObject({ state: "pointing-here", addresses: [SERVER_IP], proxied: false });
  });

  it("reports pointing-elsewhere, with the address, when it resolves to another host", async () => {
    resolveAddressesRobust.mockResolvedValue(Result.ok([ELSEWHERE]));
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: SERVER_IP });
    expect(check).toMatchObject({
      state: "pointing-elsewhere",
      addresses: [ELSEWHERE],
      proxied: false,
    });
  });

  it("calls a Cloudflare-proxied wildcard elsewhere, and says it is proxied", async () => {
    // The proxy answers ACME itself, so this host can't get a certificate.
    resolveAddressesRobust.mockResolvedValue(Result.ok([CLOUDFLARE_EDGE]));
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: SERVER_IP });
    expect(check).toMatchObject({ state: "pointing-elsewhere", proxied: true });
  });

  it("reports not-resolving on an authoritative miss", async () => {
    resolveAddressesRobust.mockResolvedValue(
      Result.err(new DnsRecordMissing({ name: "x", code: "ENOTFOUND", cause: null })),
    );
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: SERVER_IP });
    expect(check).toMatchObject({ state: "not-resolving", addresses: [] });
  });

  it("reports unknown when no resolver answered", async () => {
    resolveAddressesRobust.mockResolvedValue(
      Result.err(new DnsLookupFailed({ name: "x", cause: new Error("timeout") })),
    );
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: SERVER_IP });
    expect(check.state).toBe("unknown");
  });

  it("reports unknown when this install's own IP is not known", async () => {
    // It resolves, but with nothing to compare against "elsewhere" would be a guess.
    resolveAddressesRobust.mockResolvedValue(Result.ok([ELSEWHERE]));
    const check = await checkBaseDomainWildcard({ baseDomain: "acme.com", serverIp: null });
    expect(check).toMatchObject({ state: "unknown", addresses: [ELSEWHERE] });
  });
});

describe("checkBaseDomainTxt", () => {
  it("maps the TXT lookup to found / wrong-value / not-found / unknown", async () => {
    const run = () => checkBaseDomainTxt({ baseDomain: "acme.com", verifyToken: "tok" });

    resolveTxtRobust.mockResolvedValueOnce(Result.ok(["tok"]));
    expect(await run()).toEqual({
      name: "_otterdeploy-verify.acme.com",
      state: "found",
      found: ["tok"],
    });

    resolveTxtRobust.mockResolvedValueOnce(Result.ok(["stale"]));
    expect((await run()).state).toBe("wrong-value");

    resolveTxtRobust.mockResolvedValueOnce(
      Result.err(new DnsRecordMissing({ name: "x", code: "ENODATA", cause: null })),
    );
    expect((await run()).state).toBe("not-found");

    resolveTxtRobust.mockResolvedValueOnce(
      Result.err(new DnsLookupFailed({ name: "x", cause: new Error("timeout") })),
    );
    expect((await run()).state).toBe("unknown");
  });
});

describe("writeBaseDomainRecords (Cloudflare one-click)", () => {
  const input = {
    token: "cf-token",
    zoneId: "zone_1",
    baseDomain: "acme.com",
    serverIp: SERVER_IP,
    verifyToken: "tok",
  };

  it("writes the wildcard A record, DNS-only, alongside the TXT and apex A", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    const written = await writeBaseDomainRecords(input);

    expect(written.isOk()).toBe(true);
    const wildcard = cf.records.find((r) => r.name === "*.acme.com");
    // Proxied would terminate TLS at Cloudflare and break the ACME challenge.
    expect(wildcard).toMatchObject({ type: "A", content: SERVER_IP, proxied: false });
    expect(cf.records.map((r) => `${r.type} ${r.name}`).toSorted()).toEqual([
      "A *.acme.com",
      "A acme.com",
      "TXT _otterdeploy-verify.acme.com",
    ]);
    expect(written.unwrap().wildcard).toEqual({ state: "created", recordId: wildcard?.id });
  });

  it("is idempotent: a second run leaves the zone exactly as the first did", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    (await writeBaseDomainRecords(input)).unwrap();
    const snapshot = cf.records.map((r) => ({ ...r }));
    const second = (await writeBaseDomainRecords(input)).unwrap();

    expect(cf.records).toEqual(snapshot);
    expect(second.apex.state).toBe("present");
    expect(second.wildcard.state).toBe("present");
  });

  // od-pq4i: the apex is usually a live website. One-click must never repoint it.
  for (const existing of [
    { type: "A", content: ELSEWHERE },
    { type: "AAAA", content: "2001:db8::7" },
    { type: "CNAME", content: "acme.netlify.app" },
  ]) {
    it(`leaves an existing apex ${existing.type} pointing elsewhere untouched`, async () => {
      const theirs = { id: "site", name: "acme.com", proxied: true, ...existing };
      const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", records: [theirs] });
      vi.stubGlobal("fetch", cf.fetch);

      const written = (await writeBaseDomainRecords(input)).unwrap();

      expect(cf.records.filter((r) => r.name === "acme.com")).toEqual([theirs]);
      expect(cf.calls.some((c) => c.method === "PATCH")).toBe(false);
      expect(written.apex).toEqual({ state: "elsewhere", existing });
      // The wildcard is what services need, and it was free: still written.
      expect(written.wildcard.state).toBe("created");
    });
  }

  it("leaves an existing wildcard pointing elsewhere untouched, and says so", async () => {
    const theirs = { id: "old", type: "A", name: "*.acme.com", content: ELSEWHERE, proxied: true };
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", records: [theirs] });
    vi.stubGlobal("fetch", cf.fetch);

    const written = (await writeBaseDomainRecords(input)).unwrap();

    expect(cf.records.filter((r) => r.name === "*.acme.com")).toEqual([theirs]);
    expect(written.wildcard).toEqual({
      state: "elsewhere",
      existing: { type: "A", content: ELSEWHERE },
    });
  });

  it("counts an AAAA already pointing at this install's IPv6 as present", async () => {
    const ours = {
      id: "v6",
      type: "AAAA",
      name: "acme.com",
      content: "2001:db8::1",
      proxied: false,
    };
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", records: [ours] });
    vi.stubGlobal("fetch", cf.fetch);

    const written = (
      await writeBaseDomainRecords({ ...input, serverIpv6: "2001:db8::1" })
    ).unwrap();

    expect(written.apex).toEqual({ state: "present", recordId: "v6" });
    expect(cf.records.filter((r) => r.name === "acme.com")).toEqual([ours]);
  });

  it("returns Cloudflare's error rather than throwing", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", rejectToken: true });
    vi.stubGlobal("fetch", cf.fetch);

    const written = await writeBaseDomainRecords(input);
    expect(written.isErr()).toBe(true);
  });
});

describe("ensureBaseDomainWildcard (already-connected workspaces)", () => {
  const input = {
    token: "cf-token",
    zoneId: "zone_1",
    baseDomain: "acme.com",
    serverIp: SERVER_IP,
  };

  it("adds the wildcard when the zone has none", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    const ensured = (await ensureBaseDomainWildcard(input)).unwrap();

    expect(ensured.state).toBe("created");
    expect(cf.records).toMatchObject([
      { type: "A", name: "*.acme.com", content: SERVER_IP, proxied: false },
    ]);
  });

  it("leaves an existing wildcard alone, even one the operator pointed elsewhere", async () => {
    // A background repair must not overwrite a record the operator chose.
    const existing = {
      id: "theirs",
      type: "CNAME",
      name: "*.acme.com",
      content: "edge.example.net",
      proxied: true,
    };
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", records: [existing] });
    vi.stubGlobal("fetch", cf.fetch);

    const ensured = (await ensureBaseDomainWildcard(input)).unwrap();

    expect(ensured.state).toBe("elsewhere");
    expect(cf.records).toEqual([existing]);
    expect(cf.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("is idempotent across repeated calls", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    (await ensureBaseDomainWildcard(input)).unwrap();
    const second = (await ensureBaseDomainWildcard(input)).unwrap();

    expect(second.state).toBe("present");
    expect(cf.records).toHaveLength(1);
  });
});
