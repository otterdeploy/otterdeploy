/**
 * A generated sslip.io (or `.localhost`) host is served with a
 * self-signed certificate for good, so the dashboard has to be able to say so
 * from data. The wizard used to promise "Let's Encrypt · issued and renewed
 * automatically" for exactly that address, and the domain row called it Live
 * with nothing about the browser warning a visitor gets.
 *
 * Two projections carry the fact: the domain view (`publicCertEligible`, read
 * by the Public networking row) and the wizard's host preview (the same field
 * on `publicHostPreview`). Both must say "no" for the names no CA signs and
 * "yes" for a real apex, or the UI either cries wolf on a working custom
 * domain or keeps the old promise.
 */

import { idSchema } from "@otterdeploy/shared/id";
import { DEFAULT_ROUTE_POLICY } from "@otterdeploy/shared/route-policy";
import { describe, expect, it } from "vite-plus/test";

import type { ProxyRouteRecord } from "../../../caddy/queries";

import { routeCertSource } from "../../../caddy/certs";
import { resolvedHostCanHoldPublicCert, toDomainView } from "../domain-rules";

const NO_CUSTOM_CERTS: ReadonlySet<string> = new Set();

function route(overrides: Partial<ProxyRouteRecord>): ProxyRouteRecord {
  // drizzle's timestamp columns are `Date`: the library seam the row type
  // demands, and nothing here reads them.
  const at = new Date("2026-10-08T00:00:00Z");
  return {
    id: idSchema.proxyRoute.parse("rt_1"),
    projectId: idSchema.project.parse("prj_1"),
    resourceId: idSchema.resource.parse("res_1"),
    previewId: null,
    type: "http",
    domain: "web-shop.116.203.148.168.sslip.io",
    upstreamHost: "web",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    disabledByUser: false,
    exposureScope: "public",
    source: "generated",
    isPrimary: true,
    dnsState: "pointed",
    dnsCheckedAt: null,
    certState: "unknown",
    certError: null,
    certCheckedAt: null,
    edgeState: "synced",
    edgeError: null,
    edgeRevision: 0,
    usesAcme: false,
    protected: false,
    routePolicy: DEFAULT_ROUTE_POLICY,
    customDirectives: null,
    accessPinHash: null,
    domainVerifyToken: null,
    domainVerifiedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

describe("toDomainView publicCertEligible", () => {
  it("is false for a generated sslip.io host on tls internal", () => {
    const view = toDomainView(route({}), "116.203.148.168", NO_CUSTOM_CERTS);
    expect(view.usesAcme).toBe(false);
    expect(view.publicCertEligible).toBe(false);
  });

  it("is false for a .localhost dev host", () => {
    expect(
      toDomainView(route({ domain: "web.shop.localhost" }), null, NO_CUSTOM_CERTS)
        .publicCertEligible,
    ).toBe(false);
  });

  it("is true for an ACME route on a real name", () => {
    const view = toDomainView(
      route({ domain: "app.example.com", source: "custom", usesAcme: true, certState: "valid" }),
      "116.203.148.168",
      NO_CUSTOM_CERTS,
    );
    expect(view.publicCertEligible).toBe(true);
  });

  it("is true for a real name still on tls internal (fixable, not permanent)", () => {
    const view = toDomainView(
      route({ domain: "app.example.com", source: "custom", dnsState: "unpointed" }),
      "116.203.148.168",
      NO_CUSTOM_CERTS,
    );
    expect(view.usesAcme).toBe(false);
    expect(view.publicCertEligible).toBe(true);
  });
});

describe("toDomainView certSource", () => {
  it("is custom when an uploaded certificate covers the host, whatever usesAcme says", () => {
    // The reconciler emits `tls <cert> <key>` for such a host and leaves
    // uses_acme false: read on its own, that flag called it self-signed.
    const covered = new Set(["app.example.com"]);
    const view = toDomainView(
      route({ domain: "App.Example.com", source: "custom", usesAcme: false }),
      "116.203.148.168",
      covered,
    );
    expect(view.certSource).toBe("custom");
    expect(routeCertSource({ domain: "app.example.com", usesAcme: true }, covered)).toBe("custom");
  });

  it("is acme or internal from the route when no uploaded certificate covers it", () => {
    expect(routeCertSource({ domain: "app.example.com", usesAcme: true }, NO_CUSTOM_CERTS)).toBe(
      "acme",
    );
    expect(toDomainView(route({}), null, NO_CUSTOM_CERTS).certSource).toBe("internal");
  });
});

describe("resolvedHostCanHoldPublicCert (wizard host preview)", () => {
  it("says no for the sslip fallback", () => {
    expect(
      resolvedHostCanHoldPublicCert({
        fqdn: "web-shop.116.203.148.168.sslip.io",
        source: "sslip-fallback",
      }),
    ).toBe(false);
  });

  it("says no for the local dev base, whatever it is named", () => {
    expect(
      resolvedHostCanHoldPublicCert({ fqdn: "web-shop.dev.example.test", source: "local-base" }),
    ).toBe(false);
  });

  it("says yes for a host under the org base domain", () => {
    expect(
      resolvedHostCanHoldPublicCert({ fqdn: "web-shop.apps.example.com", source: "org-base" }),
    ).toBe(true);
  });
});
