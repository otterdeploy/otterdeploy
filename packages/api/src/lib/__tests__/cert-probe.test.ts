import { describe, expect, test } from "vitest";

import { type RawCert, shapeCertProbe } from "../cert-probe";

const NOW = Date.parse("2026-06-16T00:00:00Z");
const days = (n: number) => new Date(NOW + n * 86_400_000).toUTCString();

function cert(overrides: Partial<RawCert> = {}): RawCert {
  return {
    issuer: { O: "Let's Encrypt", CN: "R3" },
    subject: { CN: "app.example.com" },
    subjectaltname: "DNS:app.example.com, DNS:www.example.com",
    valid_from: days(-30),
    valid_to: days(60),
    serialNumber: "03ABCD",
    fingerprint256: "AA:BB:CC",
    ...overrides,
  };
}

describe("shapeCertProbe", () => {
  test("shapes a healthy Let's Encrypt cert as valid", () => {
    const out = shapeCertProbe("app.example.com", cert(), null, NOW);
    expect(out.ok).toBe(true);
    expect(out.status).toBe("valid");
    expect(out.issuer).toBe("Let's Encrypt");
    expect(out.subject).toBe("app.example.com");
    expect(out.sans).toEqual(["app.example.com", "www.example.com"]);
    expect(out.daysRemaining).toBe(60);
    expect(out.selfSigned).toBe(false);
    expect(out.serial).toBe("03ABCD");
  });

  test("flags a cert within 30 days as expiring", () => {
    const out = shapeCertProbe("app.example.com", cert({ valid_to: days(10) }), null, NOW);
    expect(out.status).toBe("expiring");
    expect(out.daysRemaining).toBe(10);
  });

  test("flags a past-expiry cert as expired (even if self-signed)", () => {
    const out = shapeCertProbe(
      "app.example.com",
      cert({ valid_to: days(-1), issuer: { O: "Caddy Local Authority" } }),
      null,
      NOW,
    );
    expect(out.status).toBe("expired");
    expect(out.daysRemaining).toBeLessThan(0);
  });

  test("detects Caddy internal CA as self-signed/internal", () => {
    const out = shapeCertProbe(
      "svc.localhost",
      cert({ issuer: { O: "Caddy Local Authority - 2024 ECC Root" } }),
      null,
      NOW,
    );
    expect(out.selfSigned).toBe(true);
    expect(out.status).toBe("internal");
  });

  test("treats issuer === subject as self-signed", () => {
    const out = shapeCertProbe(
      "self.example.com",
      cert({ issuer: { CN: "self.example.com" }, subject: { CN: "self.example.com" } }),
      null,
      NOW,
    );
    expect(out.selfSigned).toBe(true);
    expect(out.status).toBe("internal");
  });

  test("shapes a probe error into an error row", () => {
    const out = shapeCertProbe("down.example.com", null, "connection timed out", NOW);
    expect(out.ok).toBe(false);
    expect(out.status).toBe("error");
    expect(out.error).toBe("connection timed out");
    expect(out.notAfter).toBeNull();
  });

  test("tolerates missing SANs and dates", () => {
    const out = shapeCertProbe(
      "bare.example.com",
      { issuer: { O: "X" }, subject: { CN: "bare.example.com" } },
      null,
      NOW,
    );
    expect(out.sans).toEqual([]);
    expect(out.notAfter).toBeNull();
    expect(out.daysRemaining).toBeNull();
    // No expiry info and not self-signed ⇒ can't be "expiring"/"expired".
    expect(out.status).toBe("valid");
  });
});
