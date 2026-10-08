/**
 * The project Networking table's TLS cell, and the one colour self-signed
 * wears.
 *
 * - A route served with an UPLOADED certificate keeps usesAcme=false, so the
 *   cell read "self-signed" for the operator's own trusted chain. The row now
 *   says "custom" when the project's custom-certificate hosts include it.
 * - Self-signed was warning-amber on the Public networking chip and sky-blue
 *   here and on Edge → Certificates: one fact, two signals. Every surface now
 *   takes the same tone from self-signed-tone.ts.
 */

import { renderToStaticMarkup } from "react-dom/server";

import { idSchema } from "@otterdeploy/shared/id";
import { DEFAULT_ROUTE_POLICY } from "@otterdeploy/shared/route-policy";
import { describe, expect, it } from "vite-plus/test";

import { PROBE_STATUS } from "@/features/certificates/data/certificates";
import { CERT_STATUS } from "@/features/projects/components/networking/certificate-status";
import { SELF_SIGNED_TONE } from "@/shared/components/domains/self-signed-tone";
import { SelfSignedBadge } from "@/shared/components/domains/self-signed-badge";

import { mapRoute, type ProxyRouteItem } from "./networking-routes-model";

function route(overrides: Partial<ProxyRouteItem>): ProxyRouteItem {
  // drizzle's timestamp columns come over the wire as `Date` (oRPC z.date()):
  // the library seam the row type demands, and nothing here reads them.
  const at = new Date("2026-10-08T00:00:00Z");
  return {
    id: idSchema.proxyRoute.parse("rt_1"),
    projectId: idSchema.project.parse("prj_1"),
    resourceId: null,
    previewId: null,
    type: "http",
    domain: "app.example.com",
    upstreamHost: "web.shop.otterdeploy.internal",
    upstreamPort: 3000,
    protocol: "http",
    layer4Alpn: null,
    enabled: true,
    disabledByUser: false,
    exposureScope: "public",
    source: "custom",
    isPrimary: true,
    dnsState: "pointed",
    dnsCheckedAt: null,
    certState: "unknown",
    certError: null,
    certCheckedAt: null,
    usesAcme: false,
    protected: false,
    routePolicy: DEFAULT_ROUTE_POLICY,
    customDirectives: null,
    domainVerifiedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const NONE: ReadonlySet<string> = new Set();

describe("mapRoute TLS mode", () => {
  it("is custom for a host an uploaded certificate covers, though the route is not ACME", () => {
    const row = mapRoute(route({}), new Map(), new Set(["app.example.com"]));
    expect(row.tls).toBe("custom");
  });

  it("is internal (self-signed) or letsencrypt from the route otherwise", () => {
    expect(mapRoute(route({}), new Map(), NONE).tls).toBe("internal");
    expect(mapRoute(route({ usesAcme: true }), new Map(), NONE).tls).toBe("letsencrypt");
  });
});

describe("self-signed tone", () => {
  it("is the info tint on the chip, the Networking table and Edge → Certificates", () => {
    expect(SELF_SIGNED_TONE.dot).toBe("bg-info");
    expect(CERT_STATUS.internal).toMatchObject({
      dot: SELF_SIGNED_TONE.dot,
      text: SELF_SIGNED_TONE.text,
    });
    expect(PROBE_STATUS.internal).toMatchObject({
      dot: SELF_SIGNED_TONE.dot,
      text: SELF_SIGNED_TONE.text,
    });
    expect(renderToStaticMarkup(<SelfSignedBadge hint="x" />)).toContain(SELF_SIGNED_TONE.chip);
  });
});
