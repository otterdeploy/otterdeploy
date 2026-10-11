import { describe, expect, test } from "vite-plus/test";

import { type DomainStatusInput, domainStatus } from "./domain-status";

/** A healthy custom host: verified, pointed here, ACME certificate issued,
 *  proxy in sync. Each case changes only what it is about. */
const live: DomainStatusInput = {
  domain: "shop.example.com",
  source: "custom",
  status: "live",
  dnsState: "pointed",
  dnsCheckedAt: "2026-10-11T08:00:00Z",
  usesAcme: true,
  certState: "valid",
  ownershipVerified: true,
  edgeState: "synced",
};

const kind = (patch: Partial<DomainStatusInput>, base?: "unset" | "pending" | "verified") =>
  domainStatus({ ...live, ...patch }, base).kind;

describe("domainStatus: one state per host", () => {
  test("a verified, pointed host with a valid certificate is live", () => {
    expect(domainStatus(live)).toEqual({
      kind: "live",
      tone: "ok",
      action: null,
      showRecords: false,
    });
  });

  test("each single fact maps to its own state", () => {
    expect(kind({ status: "paused" })).toBe("paused");
    expect(kind({ status: "disabled", ownershipVerified: false })).toBe("ownershipPending");
    expect(kind({ status: "disabled" })).toBe("disabled");
    expect(kind({ edgeState: "failed" })).toBe("edgeFailed");
    expect(kind({ certState: "failed" })).toBe("certFailed");
    expect(kind({ dnsState: "unpointed" })).toBe("notPointed");
    expect(kind({ edgeState: "pending" })).toBe("edgeApplying");
    expect(kind({ certState: "obtaining" })).toBe("certIssuing");
    expect(kind({ dnsState: "proxied", usesAcme: false })).toBe("proxied");
    expect(kind({ dnsState: "unknown" })).toBe("dnsUnchecked");
    expect(kind({ usesAcme: false, certState: "unknown" })).toBe("selfSigned");
  });
});

describe("domainStatus: precedence, worst first", () => {
  test("paused outranks every other fact", () => {
    expect(
      kind({ status: "paused", edgeState: "failed", certState: "failed", dnsState: "unpointed" }),
    ).toBe("paused");
  });

  test("an unverified host shows ownership, not a reload it isn't part of", () => {
    // The owner's screenshot: "Ownership pending" and "Not applied" at once.
    expect(kind({ status: "disabled", ownershipVerified: false, edgeState: "failed" })).toBe(
      "ownershipPending",
    );
  });

  test("a refused reload outranks a certificate failure", () => {
    expect(kind({ edgeState: "failed", certState: "failed" })).toBe("edgeFailed");
  });

  test("a certificate failure outranks DNS pointing elsewhere", () => {
    expect(kind({ certState: "failed", dnsState: "unpointed" })).toBe("certFailed");
  });

  test("DNS pointing elsewhere outranks work in flight", () => {
    expect(kind({ dnsState: "unpointed", edgeState: "pending" })).toBe("notPointed");
    expect(kind({ dnsState: "unpointed", certState: "obtaining" })).toBe("notPointed");
  });

  test("applying a change outranks issuing a certificate", () => {
    expect(kind({ edgeState: "pending", certState: "obtaining" })).toBe("edgeApplying");
  });

  test("certificate state is ignored for hosts that don't use ACME", () => {
    expect(kind({ usesAcme: false, dnsState: "proxied", certState: "failed" })).toBe("proxied");
  });
});

describe("domainStatus: generated hosts", () => {
  const generated = { source: "generated" as const, dnsCheckedAt: null, usesAcme: false };

  test("an sslip host is temporary, never 'not pointed'", () => {
    expect(
      kind({ ...generated, domain: "web-1a2b.203-0-113-41.sslip.io", dnsState: "unpointed" }),
    ).toBe("temporary");
  });

  test("an unmeasured host under an unverified base domain waits on it", () => {
    expect(kind({ ...generated, domain: "web.apps.example.com" }, "pending")).toBe(
      "baseDomainPending",
    );
  });

  test("a measured miss is reported even when the base domain is pending", () => {
    expect(
      kind(
        {
          ...generated,
          domain: "web.apps.example.com",
          dnsCheckedAt: "2026-10-11T08:00:00Z",
          dnsState: "unpointed",
        },
        "pending",
      ),
    ).toBe("notPointed");
  });

  test("a generated host under a verified base domain is live", () => {
    expect(kind({ ...generated, domain: "web.apps.example.com" }, "verified")).toBe("live");
  });
});

describe("domainStatus: the card's action and records", () => {
  test("states that need DNS offer Recheck and list the records", () => {
    const pending = domainStatus({ ...live, status: "disabled", ownershipVerified: false });
    expect(pending.action).toBe("recheck");
    expect(pending.showRecords).toBe(true);
    expect(domainStatus({ ...live, dnsState: "unpointed" }).showRecords).toBe(true);
  });

  test("in-flight states offer no action: they resolve on their own", () => {
    expect(domainStatus({ ...live, edgeState: "pending" }).action).toBeNull();
    expect(domainStatus({ ...live, certState: "obtaining" }).action).toBeNull();
  });

  test("paused offers Resume; a refused reload points at the edge logs", () => {
    expect(domainStatus({ ...live, status: "paused" }).action).toBe("resume");
    expect(domainStatus({ ...live, edgeState: "failed" }).action).toBe("edgeLogs");
  });
});
