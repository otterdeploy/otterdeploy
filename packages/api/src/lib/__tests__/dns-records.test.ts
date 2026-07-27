import { describe, expect, it } from "vitest";

import { requiredDnsRecords, toRelativeName } from "../dns-records";

describe("toRelativeName", () => {
  it("strips the zone so the value can be pasted into a DNS provider's UI", () => {
    // Pasting the FQDN into Cloudflare silently creates waves.acme.com.acme.com.
    expect(toRelativeName("waves.acme.com", "acme.com")).toBe("waves");
    expect(toRelativeName("_otterdeploy-verify.waves.acme.com", "acme.com")).toBe(
      "_otterdeploy-verify.waves",
    );
  });

  it("uses @ at the apex", () => {
    expect(toRelativeName("acme.com", "acme.com")).toBe("@");
  });

  it("returns null when the zone is unknown or doesn't contain the name", () => {
    // Null so the UI falls back to the FQDN rather than inventing a name.
    expect(toRelativeName("waves.acme.com", null)).toBeNull();
    expect(toRelativeName("waves.other.com", "acme.com")).toBeNull();
  });

  it("does not treat a lookalike suffix as the zone", () => {
    // "notacme.com" ends with "acme.com" as a SUBSTRING but is a different
    // zone — stripping it would produce a wrong record name.
    expect(toRelativeName("waves.notacme.com", "acme.com")).toBeNull();
  });

  it("is case- and trailing-dot-insensitive", () => {
    expect(toRelativeName("Waves.ACME.com.", "acme.com.")).toBe("waves");
  });
});

describe("requiredDnsRecords", () => {
  it("derives the address record and the ownership TXT", () => {
    expect(
      requiredDnsRecords({
        domain: "waves.acme.com",
        serverIp: "46.224.8.75",
        verifyToken: "tok123",
        zone: "acme.com",
      }),
    ).toEqual([
      { type: "A", name: "waves.acme.com", value: "46.224.8.75", relativeName: "waves" },
      {
        type: "TXT",
        name: "_otterdeploy-verify.waves.acme.com",
        value: "tok123",
        relativeName: "_otterdeploy-verify.waves",
      },
    ]);
  });

  it("omits what it cannot derive rather than emitting a placeholder", () => {
    // A record showing "null" or "<your-ip>" is worse than no record: it looks
    // copyable and isn't.
    expect(
      requiredDnsRecords({ domain: "a.acme.com", serverIp: null, verifyToken: "t" }),
    ).toHaveLength(1);
    expect(
      requiredDnsRecords({ domain: "a.acme.com", serverIp: "1.2.3.4", verifyToken: null }),
    ).toHaveLength(1);
    expect(requiredDnsRecords({ domain: "a.acme.com", serverIp: null, verifyToken: null })).toEqual(
      [],
    );
  });

  it("falls back to FQDN names when the zone is unknown", () => {
    const [a] = requiredDnsRecords({
      domain: "waves.acme.com",
      serverIp: "1.2.3.4",
      verifyToken: null,
    });
    expect(a?.relativeName).toBeNull();
    expect(a?.name).toBe("waves.acme.com");
  });
});
