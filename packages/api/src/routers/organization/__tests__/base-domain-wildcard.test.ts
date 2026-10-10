/**
 * od-88n8: the workspace base domain needs `*.<base>`, and nothing wrote it.
 *
 * Cloudflare one-click wrote the verify TXT and the apex A only, so a workspace
 * came out "verified" with every `<service>-<project>.<base>` hostname still
 * failing to resolve. These drive the real handlers against an in-memory
 * Cloudflare and assert on the zone itself.
 */

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { fakeCloudflare } from "../../../lib/__tests__/fake-cloudflare";

// oxlint-disable-next-line node/no-process-env -- test env setup boundary: satisfy required vars so the module graph (db/auth/env) loads.
process.env.DATABASE_URL ??= "postgres://test/test";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.REDIS_URL ??= "redis://localhost:6379";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.CORS_ORIGIN ??= "http://localhost:3000";
// oxlint-disable-next-line node/no-process-env -- test env setup boundary (see above).
process.env.RESEND_API_KEY ??= "test-resend-key";

const SERVER_IP = "203.0.113.24";
const ELSEWHERE = "198.51.100.7";
const orgId = idSchema.organization.parse("org_a");

interface OrgRow {
  id: typeof orgId;
  name: string;
  slug: string;
  baseDomain: string | null;
  baseDomainVerifiedAt: Date | null;
  baseDomainVerifyToken: string | null;
  cloudflareApiToken: string | null;
  cloudflareZoneId: string | null;
}

interface FixtureState {
  row: OrgRow | null;
  serverIp: string | null;
  addresses: Map<string, string[]>;
  txt: Map<string, string[]>;
}

const state = vi.hoisted(() => {
  const initial: FixtureState = {
    row: null,
    serverIp: null,
    addresses: new Map(),
    txt: new Map(),
  };
  return initial;
});

function connectedRow(overrides: Partial<OrgRow> = {}): OrgRow {
  return {
    id: orgId,
    name: "Acme",
    slug: "acme",
    baseDomain: "acme.com",
    baseDomainVerifiedAt: null,
    baseDomainVerifyToken: "tok",
    cloudflareApiToken: "cf-token",
    cloudflareZoneId: "zone_1",
    ...overrides,
  };
}

vi.mock("../queries", () => ({
  getOrganizationById: vi.fn(async () => state.row),
  setOrganizationBaseDomain: vi.fn(async () => state.row),
  markOrganizationBaseDomainVerified: vi.fn(async () => state.row),
  setOrganizationCloudflareConfig: vi.fn(async () => state.row),
  readPlatformServerIp: vi.fn(async () => state.serverIp),
  readLocalBaseDomain: vi.fn(() => null),
  listGeneratedHostnamesUnder: vi.fn(async () => ({ hostnames: [], total: 0 })),
}));

vi.mock("../../../lib/dns-resolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/dns-resolver")>();
  const miss = (name: string) =>
    Result.err(new actual.DnsRecordMissing({ name, code: "ENOTFOUND", cause: null }));
  return {
    ...actual,
    resolveAddressesRobust: vi.fn(async (name: string) => {
      const found = state.addresses.get(name);
      return found ? Result.ok(found) : miss(name);
    }),
    resolveTxtRobust: vi.fn(async (name: string) => {
      const found = state.txt.get(name);
      return found ? Result.ok(found) : miss(name);
    }),
    resolveNsRobust: vi.fn(async (name: string) =>
      name === "acme.com" ? Result.ok(["kate.ns.cloudflare.com"]) : miss(name),
    ),
  };
});

const {
  autoConfigureBaseDomainViaCloudflare,
  updateOrganizationBaseDomain,
  verifyOrganizationBaseDomain,
} = await import("../handlers");
const { checkOrganizationBaseDomainDns, getOrganizationCloudflareZone } =
  await import("../base-domain");

beforeEach(() => {
  state.row = connectedRow();
  state.serverIp = SERVER_IP;
  state.addresses.clear();
  state.txt.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wildcardsIn(cf: ReturnType<typeof fakeCloudflare>) {
  return cf.records.filter((r) => r.name === "*.acme.com");
}

describe("Cloudflare one-click for the base domain", () => {
  test("writes the *.<base> wildcard, DNS-only, so service hostnames resolve", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    const result = (await autoConfigureBaseDomainViaCloudflare(orgId)).unwrap();

    expect(wildcardsIn(cf)).toEqual([
      {
        id: result.wildcardRecordId,
        type: "A",
        name: "*.acme.com",
        content: SERVER_IP,
        proxied: false,
      },
    ]);
  });

  test("running it twice leaves one of each record", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    (await autoConfigureBaseDomainViaCloudflare(orgId)).unwrap();
    (await autoConfigureBaseDomainViaCloudflare(orgId)).unwrap();

    expect(cf.records.map((r) => `${r.type} ${r.name}`).toSorted()).toEqual([
      "A *.acme.com",
      "A acme.com",
      "TXT _otterdeploy-verify.acme.com",
    ]);
  });
});

describe("already-connected workspaces get the missing wildcard", () => {
  test("on the next verify", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    const result = (await verifyOrganizationBaseDomain(orgId)).unwrap();

    expect(result.wildcard).toBe("created");
    expect(wildcardsIn(cf)).toMatchObject([{ type: "A", content: SERVER_IP, proxied: false }]);
  });

  test("on the next save", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);

    (
      await updateOrganizationBaseDomain({ organizationId: orgId, baseDomain: "acme.com" })
    ).unwrap();

    expect(wildcardsIn(cf)).toMatchObject([{ type: "A", content: SERVER_IP, proxied: false }]);
  });

  test("never overwrites a wildcard the operator already has", async () => {
    const theirs = {
      id: "theirs",
      type: "A",
      name: "*.acme.com",
      content: ELSEWHERE,
      proxied: true,
    };
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", records: [theirs] });
    vi.stubGlobal("fetch", cf.fetch);

    const result = (await verifyOrganizationBaseDomain(orgId)).unwrap();

    expect(result.wildcard).toBe("present");
    expect(cf.records).toEqual([theirs]);
  });

  test("a Cloudflare failure does not fail the verify it rides on", async () => {
    vi.stubGlobal(
      "fetch",
      fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", rejectToken: true }).fetch,
    );
    state.txt.set("_otterdeploy-verify.acme.com", ["tok"]);

    const result = (await verifyOrganizationBaseDomain(orgId)).unwrap();

    expect(result).toMatchObject({ ok: true, wildcard: "failed" });
  });

  test("does nothing without Cloudflare", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);
    state.row = connectedRow({ cloudflareApiToken: null, cloudflareZoneId: null });

    const result = (await verifyOrganizationBaseDomain(orgId)).unwrap();

    expect(result.wildcard).toBe("skipped");
    expect(cf.calls).toEqual([]);
  });
});

describe("checkOrganizationBaseDomainDns", () => {
  test("reports both records, each with what DNS says now", async () => {
    state.addresses.set("otterdeploy-dns-check.acme.com", [SERVER_IP]);
    state.txt.set("_otterdeploy-verify.acme.com", ["tok"]);

    const view = (await checkOrganizationBaseDomainDns(orgId)).unwrap();

    expect(view.records.map((r) => [r.purpose, r.type, r.relativeName, r.value])).toEqual([
      ["wildcard", "A", "*", SERVER_IP],
      ["verify", "TXT", "_otterdeploy-verify", "tok"],
    ]);
    expect(view.wildcard).toMatchObject({ state: "pointing-here" });
    expect(view.txt).toMatchObject({ state: "found" });
    expect(view.provider).toBe("cloudflare");
  });

  test("a wildcard pointing at another host is pointing-elsewhere, with its address", async () => {
    state.addresses.set("otterdeploy-dns-check.acme.com", [ELSEWHERE]);

    const view = (await checkOrganizationBaseDomainDns(orgId)).unwrap();

    expect(view.wildcard).toMatchObject({ state: "pointing-elsewhere", addresses: [ELSEWHERE] });
    expect(view.txt).toMatchObject({ state: "not-found" });
  });

  test("a missing wildcard is not-resolving, and new services get a self-signed cert", async () => {
    const view = (await checkOrganizationBaseDomainDns(orgId)).unwrap();

    expect(view.wildcard).toMatchObject({ state: "not-resolving", addresses: [] });
    expect(view.publishing).toEqual({
      source: "org-base",
      suffix: "acme.com",
      certificate: "self-signed",
    });
  });

  test("a verified domain publishes with Let's Encrypt", async () => {
    state.row = connectedRow({ baseDomainVerifiedAt: new Date(0) });
    state.addresses.set("otterdeploy-dns-check.acme.com", [SERVER_IP]);

    const view = (await checkOrganizationBaseDomainDns(orgId)).unwrap();

    expect(view.publishing.certificate).toBe("lets-encrypt");
  });

  test("with no base domain, services publish on sslip.io with a self-signed cert", async () => {
    state.row = connectedRow({ baseDomain: null, baseDomainVerifyToken: null });

    const view = (await checkOrganizationBaseDomainDns(orgId)).unwrap();

    expect(view.publishing).toEqual({
      source: "sslip-fallback",
      suffix: `${SERVER_IP}.sslip.io`,
      certificate: "self-signed",
    });
    expect(view.records).toEqual([]);
    expect(view.wildcard).toBeNull();
    expect(view.txt).toBeNull();
  });
});

describe("getOrganizationCloudflareZone", () => {
  test("names the connected zone instead of its id", async () => {
    vi.stubGlobal("fetch", fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" }).fetch);

    const view = (await getOrganizationCloudflareZone(orgId)).unwrap();

    expect(view).toEqual({ zoneId: "zone_1", name: "acme.com", token: "ok", message: null });
  });

  test("says the token was rejected when Cloudflare refuses it now", async () => {
    vi.stubGlobal(
      "fetch",
      fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com", rejectToken: true }).fetch,
    );

    const view = (await getOrganizationCloudflareZone(orgId)).unwrap();

    expect(view).toMatchObject({ zoneId: "zone_1", name: null, token: "rejected" });
    expect(view.message).toContain("Invalid API Token");
  });

  test("is not-connected without a token, and never calls Cloudflare", async () => {
    const cf = fakeCloudflare({ zoneId: "zone_1", zoneName: "acme.com" });
    vi.stubGlobal("fetch", cf.fetch);
    state.row = connectedRow({ cloudflareApiToken: null, cloudflareZoneId: null });

    const view = (await getOrganizationCloudflareZone(orgId)).unwrap();

    expect(view.token).toBe("not-connected");
    expect(cf.calls).toEqual([]);
  });
});
