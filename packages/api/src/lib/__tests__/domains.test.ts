/**
 * Resolution-chain tests for resolvePublicDomain. One case per branch
 * of the chain so a refactor that breaks the precedence order surfaces
 * immediately.
 */

import { describe, expect, it } from "vitest";

import { resolvePublicDomain } from "../domains";

const ctx = (kind: "service" | "database" = "service") => ({
  resourceSlug: "web",
  projectSlug: "myproj",
  kind,
});

const empty = {
  resourceOverride: null,
  projectCustomDomain: null,
  projectCustomDomainVerifiedAt: null,
  orgBaseDomain: null,
  orgBaseDomainVerifiedAt: null,
  localBaseDomain: null,
  serverIp: null,
};

describe("resolvePublicDomain", () => {
  it("uses resource override as the literal FQDN", () => {
    const r = resolvePublicDomain(ctx(), {
      ...empty,
      resourceOverride: "checkout.acme.com",
      orgBaseDomain: "acme.com",
    });
    expect(r.fqdn).toBe("checkout.acme.com");
    expect(r.source).toBe("resource-override");
    expect(r.verified).toBe(true);
  });

  it("drops project slug under a project custom domain", () => {
    const r = resolvePublicDomain(ctx(), {
      ...empty,
      projectCustomDomain: "myproj.acme.com",
      projectCustomDomainVerifiedAt: new Date(),
    });
    expect(r.fqdn).toBe("web.myproj.acme.com");
    expect(r.source).toBe("project-custom");
    expect(r.verified).toBe(true);
  });

  it("marks project custom domain unverified when no timestamp", () => {
    const r = resolvePublicDomain(ctx(), {
      ...empty,
      projectCustomDomain: "myproj.acme.com",
    });
    expect(r.verified).toBe(false);
  });

  it("uses org base with apps/db subdomain split", () => {
    const svc = resolvePublicDomain(ctx("service"), {
      ...empty,
      orgBaseDomain: "acme.com",
      orgBaseDomainVerifiedAt: new Date(),
    });
    expect(svc.fqdn).toBe("web-myproj.apps.acme.com");
    expect(svc.source).toBe("org-base");

    const db = resolvePublicDomain(ctx("database"), {
      ...empty,
      orgBaseDomain: "acme.com",
      orgBaseDomainVerifiedAt: new Date(),
    });
    expect(db.fqdn).toBe("web-myproj.db.acme.com");
    expect(db.source).toBe("org-base");
  });

  it("prefers the local base domain over sslip (dev), unverified", () => {
    const r = resolvePublicDomain(ctx(), {
      ...empty,
      localBaseDomain: "otterdeploy.localhost",
      serverIp: "203.0.113.7",
    });
    expect(r.fqdn).toBe("web-myproj.otterdeploy.localhost");
    expect(r.source).toBe("local-base");
    expect(r.verified).toBe(false);
  });

  it("org base domain wins over the local base domain", () => {
    const r = resolvePublicDomain(ctx(), {
      ...empty,
      orgBaseDomain: "acme.com",
      orgBaseDomainVerifiedAt: new Date(),
      localBaseDomain: "otterdeploy.localhost",
    });
    expect(r.fqdn).toBe("web-myproj.apps.acme.com");
    expect(r.source).toBe("org-base");
  });

  it("falls back to sslip.io with the server IP", () => {
    const r = resolvePublicDomain(ctx(), { ...empty, serverIp: "203.0.113.7" });
    expect(r.fqdn).toBe("web-myproj.203.0.113.7.sslip.io");
    expect(r.source).toBe("sslip-fallback");
    expect(r.verified).toBe(false);
  });

  it("falls back to 127.0.0.1 sslip when no server IP is set", () => {
    const r = resolvePublicDomain(ctx(), empty);
    expect(r.fqdn).toBe("web-myproj.127.0.0.1.sslip.io");
    expect(r.source).toBe("sslip-fallback");
  });

  it("resource override wins over everything below it", () => {
    const r = resolvePublicDomain(ctx(), {
      resourceOverride: "literal.example",
      projectCustomDomain: "proj.example",
      projectCustomDomainVerifiedAt: new Date(),
      orgBaseDomain: "org.example",
      orgBaseDomainVerifiedAt: new Date(),
      localBaseDomain: "otterdeploy.localhost",
      serverIp: "1.2.3.4",
    });
    expect(r.fqdn).toBe("literal.example");
  });

  it("lowercases and trims user input", () => {
    const r = resolvePublicDomain(ctx(), {
      ...empty,
      orgBaseDomain: "  ACME.com  ",
      orgBaseDomainVerifiedAt: new Date(),
    });
    expect(r.fqdn).toBe("web-myproj.apps.acme.com");
  });
});
