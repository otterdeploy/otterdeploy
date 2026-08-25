/**
 * A re-evaluation of an existing route must never revoke working TLS.
 *
 * The incident these pin: a generated route is born `dnsState: "pointed"`
 * (expose.ts), earns a real Let's Encrypt certificate, and serves happily.
 * The operator then puts Cloudflare's proxy in front of it. Supported, and
 * usually what you want. The next `service.domains.recheck` resolves the
 * Cloudflare anycast addresses, classifies the host as `proxied`, and the old
 * `acmeFor` returned false. `usesAcme` flipped true → false, the Caddyfile was
 * re-rendered with `tls internal`, and Caddy replaced the trusted certificate
 * with a self-signed one in the same second. On Cloudflare's Full (strict)
 * mode that is an outage, caused by a read-only health check.
 */

import { describe, expect, it } from "vite-plus/test";

import { acmeFor, acmeForExistingRoute, acmeForPlatformHost } from "../domain-rules";

describe("acmeFor (new route)", () => {
  it("only issues for a host that points at us", () => {
    expect(acmeFor("app.example.com", "pointed")).toBe(true);
    expect(acmeFor("app.example.com", "proxied")).toBe(false);
    expect(acmeFor("app.example.com", "unpointed")).toBe(false);
    expect(acmeFor("app.example.com", "unknown")).toBe(false);
  });

  it("never issues for hosts that provably cannot get a public cert", () => {
    expect(acmeFor("app.localhost", "pointed")).toBe(false);
    expect(acmeFor("app.127.0.0.1.sslip.io", "pointed")).toBe(false);
  });
});

describe("acmeForExistingRoute", () => {
  const base = {
    domain: "app.example.com",
    currentUsesAcme: true,
    certState: "valid",
  } as const;

  it("keeps ACME when a working cert exists and DNS starts reading proxied", () => {
    // The regression, stated directly.
    expect(acmeForExistingRoute({ ...base, dnsState: "proxied" })).toBe(true);
  });

  it("keeps ACME when the probe degrades to unpointed or unknown", () => {
    // A probe that can't see the host is not proof the cert stopped working;
    // a transient resolver failure must not cost the operator their TLS.
    expect(acmeForExistingRoute({ ...base, dnsState: "unpointed" })).toBe(true);
    expect(acmeForExistingRoute({ ...base, dnsState: "unknown" })).toBe(true);
  });

  it("does NOT prop up a route whose cert never worked", () => {
    // No certificate to protect: the normal rule applies, so the route stays
    // on `tls internal` rather than retrying ACME behind a proxy forever.
    for (const certState of ["unknown", "obtaining", "failed"] as const) {
      expect(acmeForExistingRoute({ ...base, certState, dnsState: "proxied" })).toBe(false);
    }
  });

  it("does NOT grant ACME to a route that never had it", () => {
    expect(acmeForExistingRoute({ ...base, currentUsesAcme: false, dnsState: "proxied" })).toBe(
      false,
    );
  });

  it("still upgrades: proxied → pointed turns ACME on", () => {
    expect(
      acmeForExistingRoute({
        domain: "app.example.com",
        dnsState: "pointed",
        currentUsesAcme: false,
        certState: "unknown",
      }),
    ).toBe(true);
  });

  it("holds the line for hosts that can never get a public cert", () => {
    // `.localhost` can't have earned a real cert, so there is nothing to
    // protect and the guard must not resurrect ACME for it.
    expect(
      acmeForExistingRoute({
        domain: "app.localhost",
        dnsState: "pointed",
        currentUsesAcme: true,
        certState: "valid",
      }),
    ).toBe(false);
  });
});

/**
 * The mint path and the rename path must answer identically for the same host.
 * They did not: a generated host under an unverified apex whose DNS already
 * pointed here got `tls internal` on first expose and a real certificate only
 * if something later renamed it. Observed as livekit.dr34mw0rk5.com serving
 * "Caddy Local Authority - ECC Intermediate" with a 12-hour validity.
 */
describe("acmeForPlatformHost", () => {
  const base = {
    domain: "livekit.example.com",
    isLocalBase: false,
    apexVerified: false,
    dnsState: "pointed",
  } as const;

  it("issues when DNS already lands here, even under an unverified apex", () => {
    // The bug, stated directly.
    expect(acmeForPlatformHost(base)).toBe(true);
  });

  it("issues on a verified apex whatever DNS currently reads", () => {
    // A verified apex behind Cloudflare reads `proxied`. Requiring `pointed`
    // alone would put a working site back on a self-signed cert.
    for (const dnsState of ["pointed", "proxied", "unpointed", "unknown"] as const) {
      expect(acmeForPlatformHost({ ...base, apexVerified: true, dnsState })).toBe(true);
    }
  });

  it("withholds when the apex is unverified and DNS does not point here", () => {
    for (const dnsState of ["proxied", "unpointed", "unknown"] as const) {
      expect(acmeForPlatformHost({ ...base, dnsState })).toBe(false);
    }
  });

  it("never issues for the dev wildcard, whatever it is named", () => {
    // LOCAL_BASE_DOMAIN is env-configurable, so the guard is the SOURCE, not
    // the name: a dev apex called `dev.example.com` still gets no public cert.
    expect(acmeForPlatformHost({ ...base, isLocalBase: true })).toBe(false);
    expect(acmeForPlatformHost({ ...base, isLocalBase: true, apexVerified: true })).toBe(false);
  });

  it("never issues for names no CA can sign, which a mint calls pointed by construction", () => {
    expect(acmeForPlatformHost({ ...base, domain: "app.127.0.0.1.sslip.io" })).toBe(false);
    expect(acmeForPlatformHost({ ...base, domain: "app.localhost" })).toBe(false);
    // Even a verified apex cannot rescue those.
    expect(acmeForPlatformHost({ ...base, domain: "app.localhost", apexVerified: true })).toBe(
      false,
    );
  });
});
