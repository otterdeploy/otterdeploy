/**
 * The rules that turn a probe of the served certificate into a
 * route's cert_state, and the schedule the probe runs on. The pass against a
 * real database is cert-state-probe.postgres.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { type CertProbe } from "../../../lib/cert-probe";
import { certStateFromProbe, startCertStateProbe } from "../cert-state-probe";

const DOMAIN = "whoami.apps.example.com";

function probe(overrides: Partial<CertProbe> = {}): CertProbe {
  return {
    domain: DOMAIN,
    ok: true,
    error: null,
    issuer: "Let's Encrypt",
    subject: DOMAIN,
    sans: [DOMAIN],
    notBefore: "2026-10-09T00:00:00.000Z",
    notAfter: "2027-01-07T00:00:00.000Z",
    daysRemaining: 89,
    serial: "04",
    fingerprint: "AA:BB",
    selfSigned: false,
    status: "valid",
    ...overrides,
  };
}

describe("certStateFromProbe", () => {
  test("a trusted certificate naming the domain makes the route valid", () => {
    expect(certStateFromProbe(DOMAIN, probe(), null)).toEqual({
      certState: "valid",
      certError: null,
    });
    // Still valid inside the renewal window: Caddy renews it, nothing failed.
    expect(
      certStateFromProbe(DOMAIN, probe({ status: "expiring", daysRemaining: 20 }), null),
    ).toEqual({ certState: "valid", certError: null });
  });

  test("a wildcard covers one label, not two", () => {
    const wildcard = probe({ sans: ["*.apps.example.com"] });
    expect(certStateFromProbe(DOMAIN, wildcard, null)?.certState).toBe("valid");
    expect(certStateFromProbe("a.whoami.apps.example.com", wildcard, null)).toBeNull();
  });

  test("an expired certificate makes the route failed, with the date", () => {
    const out = certStateFromProbe(
      DOMAIN,
      probe({ status: "expired", notAfter: "2026-09-01T00:00:00.000Z", daysRemaining: -38 }),
      "CERT_HAS_EXPIRED",
    );
    expect(out?.certState).toBe("failed");
    expect(out?.certError).toContain("2026-09-01");
  });

  test("proves nothing while issuance is in flight or the cert is not one a browser accepts", () => {
    // No handshake / no certificate yet.
    expect(certStateFromProbe(DOMAIN, probe({ ok: false, status: "error" }), null)).toBeNull();
    // Caddy's interim self-signed certificate.
    expect(
      certStateFromProbe(
        DOMAIN,
        probe({ selfSigned: true, status: "internal", issuer: "Caddy Local Authority" }),
        "SELF_SIGNED_CERT_IN_CHAIN",
      ),
    ).toBeNull();
    // Not self-signed, but not trusted either (e.g. a staging CA).
    expect(certStateFromProbe(DOMAIN, probe(), "UNABLE_TO_GET_ISSUER_CERT_LOCALLY")).toBeNull();
    // Trusted, but for another name.
    expect(certStateFromProbe(DOMAIN, probe({ sans: ["other.example.com"] }), null)).toBeNull();
  });
});

describe("startCertStateProbe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("runs a pass 30s after boot, then every two minutes, until stopped", async () => {
    const run = vi.fn(async () => 0);
    const stop = startCertStateProbe(run);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    // 120s since boot: the interval's first tick.
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  test("a pass that throws is logged, and the next one still runs", async () => {
    const run = vi.fn(async () => {
      throw new Error("db down");
    });
    const stop = startCertStateProbe(run);
    await vi.advanceTimersByTimeAsync(150_000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });
});
