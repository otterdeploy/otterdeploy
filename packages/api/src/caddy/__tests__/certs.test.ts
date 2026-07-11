import type { CustomCertificateId, OrganizationId } from "@otterdeploy/shared/id";

/**
 * Custom-cert emission: the pure matching/attachment layer (certs.ts) and the
 * `tls <cert> <key>` directive the builder emits for a matched route. The
 * file-materialization + DB side effects are exercised live via reconcile.
 */
import { describe, expect, test } from "vite-plus/test";

import { buildHttpBlock, type ProxyRouteInput } from "../builder";
import { applyCustomCertsToRoutes, matchCustomCert, type ServableCustomCert } from "../certs";

const cert = (over: Partial<ServableCustomCert> = {}): ServableCustomCert => ({
  id: "cert_a" as CustomCertificateId,
  organizationId: "org_1" as OrganizationId,
  hostname: "app.example.com",
  subjectCN: "app.example.com",
  sans: ["app.example.com"],
  certPath: "/etc/caddy/certs/cert_a/cert.pem",
  keyPath: "/etc/caddy/certs/cert_a/key.pem",
  ...over,
});

const route = (over: Partial<ProxyRouteInput> = {}): ProxyRouteInput => ({
  projectId: "project_1",
  type: "http",
  domain: "app.example.com",
  upstreamHost: "app.internal",
  upstreamPort: 3000,
  protocol: "http",
  layer4Alpn: null,
  usesAcme: true,
  ...over,
});

describe("matchCustomCert", () => {
  test("exact hostname wins over a wildcard cover", () => {
    const wildcard = cert({
      id: "cert_w" as CustomCertificateId,
      hostname: "*.example.com",
      subjectCN: "*.example.com",
      sans: ["*.example.com"],
    });
    const exact = cert();
    expect(matchCustomCert([wildcard, exact], "app.example.com", "org_1")?.id).toBe("cert_a");
    expect(matchCustomCert([wildcard], "app.example.com", "org_1")?.id).toBe("cert_w");
  });

  test("never crosses organizations", () => {
    expect(matchCustomCert([cert()], "app.example.com", "org_2")).toBeNull();
    expect(matchCustomCert([cert()], "app.example.com", undefined)).toBeNull();
  });

  test("returns null when nothing covers the domain", () => {
    expect(matchCustomCert([cert()], "other.example.com", "org_1")).toBeNull();
  });
});

describe("applyCustomCertsToRoutes", () => {
  const projectOrg = new Map([["project_1", "org_1"]]);

  test("attaches container cert paths to covered http routes only", () => {
    const routes = [
      route(),
      route({ domain: "other.example.com" }),
      route({ type: "layer4", protocol: "tcp", domain: "db.example.com" }),
    ];
    const out = applyCustomCertsToRoutes(routes, [cert()], projectOrg);
    expect(out[0]?.customCert).toEqual({
      certPath: "/etc/caddy/certs/cert_a/cert.pem",
      keyPath: "/etc/caddy/certs/cert_a/key.pem",
    });
    expect(out[1]?.customCert).toBeUndefined();
    expect(out[2]?.customCert).toBeUndefined();
  });

  test("routes of a project outside the cert's org are untouched", () => {
    const out = applyCustomCertsToRoutes(
      [route()],
      [cert({ organizationId: "org_2" as OrganizationId })],
      projectOrg,
    );
    expect(out[0]?.customCert).toBeUndefined();
  });
});

describe("buildHttpBlock with a custom cert", () => {
  test("emits tls <cert> <key> and suppresses tls internal", () => {
    const output = buildHttpBlock({
      ...route({ usesAcme: false }),
      customCert: {
        certPath: "/etc/caddy/certs/cert_a/cert.pem",
        keyPath: "/etc/caddy/certs/cert_a/key.pem",
      },
    });
    expect(output).toContain(
      "\ttls /etc/caddy/certs/cert_a/cert.pem /etc/caddy/certs/cert_a/key.pem",
    );
    expect(output).not.toContain("tls internal");
  });

  test("custom cert overrides ACME too (no bare-ACME site for the domain)", () => {
    const output = buildHttpBlock({
      ...route({ usesAcme: true }),
      customCert: {
        certPath: "/etc/caddy/certs/cert_a/cert.pem",
        keyPath: "/etc/caddy/certs/cert_a/key.pem",
      },
    });
    expect(output).toContain("\ttls /etc/caddy/certs/cert_a/cert.pem");
  });
});
