import { describe, expect, it } from "vite-plus/test";

import {
  previewSuffix,
  publishNote,
  txtStatus,
  wildcardStatus,
  wildcardWarning,
  type Publishing,
} from "./base-domain-copy";

const orgBase = (certificate: Publishing["certificate"]): Publishing => ({
  source: "org-base",
  suffix: "acme.com",
  certificate,
});

describe("wildcardStatus", () => {
  it("names each measured state, with the address when it points elsewhere", () => {
    const at = (state: Parameters<typeof wildcardStatus>[0]["state"], addresses: string[] = []) =>
      wildcardStatus({ state, addresses, proxied: false });
    expect(at("pointing-here", ["203.0.113.24"])).toEqual({ tone: "ok", label: "Points here" });
    expect(at("pointing-elsewhere", ["198.51.100.7"])).toEqual({
      tone: "bad",
      label: "Points to 198.51.100.7",
    });
    expect(at("not-resolving")).toEqual({ tone: "warn", label: "Not found" });
    expect(at("unknown")).toEqual({ tone: "muted", label: "Couldn't check" });
  });

  it("calls a Cloudflare-proxied wildcard proxied, not a wrong address", () => {
    expect(
      wildcardStatus({ state: "pointing-elsewhere", addresses: ["104.16.1.1"], proxied: true }),
    ).toEqual({ tone: "warn", label: "Proxied" });
  });
});

describe("txtStatus", () => {
  it("maps each TXT state", () => {
    expect(txtStatus({ state: "found" }).tone).toBe("ok");
    expect(txtStatus({ state: "wrong-value" })).toEqual({ tone: "bad", label: "Wrong value" });
    expect(txtStatus({ state: "not-found" })).toEqual({ tone: "warn", label: "Not found" });
    expect(txtStatus({ state: "unknown" }).tone).toBe("muted");
  });
});

describe("publishNote", () => {
  it("is honest about the sslip.io fallback: temporary, self-signed, asks first", () => {
    const note = publishNote({
      publishing: {
        source: "sslip-fallback",
        suffix: "203.0.113.24.sslip.io",
        certificate: "self-signed",
      },
      wildcard: null,
      preview: false,
    });
    expect(note).toContain("Temporary address");
    expect(note).toContain("Self-signed");
    expect(note).toContain("asked before");
    // The old copy promised a platform default that the resolver doesn't have.
    expect(note).not.toMatch(/platform default|sslip\.io fallback/i);
  });

  it("only says reachable when the wildcard was measured pointing here", () => {
    expect(
      publishNote({
        publishing: orgBase("lets-encrypt"),
        wildcard: "pointing-here",
        preview: false,
      }),
    ).toBe("Reachable, with a Let's Encrypt certificate.");
    expect(
      publishNote({
        publishing: orgBase("self-signed"),
        wildcard: "not-resolving",
        preview: false,
      }),
    ).toMatch(/^Not reachable until the DNS records below are in place/);
    expect(
      publishNote({
        publishing: orgBase("lets-encrypt"),
        wildcard: "pointing-elsewhere",
        preview: false,
      }),
    ).toMatch(/^Not reachable until the wildcard record/);
  });

  it("says when it could not check, rather than guessing", () => {
    expect(
      publishNote({ publishing: orgBase("self-signed"), wildcard: "unknown", preview: false }),
    ).toMatch(/couldn't check/);
  });

  it("does not call a proxied wildcard unreachable", () => {
    expect(
      publishNote({
        publishing: orgBase("lets-encrypt"),
        wildcard: "pointing-elsewhere",
        proxied: true,
        preview: false,
      }),
    ).toMatch(/^Reachable through Cloudflare's proxy/);
  });

  it("marks an unsaved domain as a preview", () => {
    expect(
      publishNote({
        publishing: orgBase("lets-encrypt"),
        wildcard: "pointing-here",
        preview: true,
      }),
    ).toMatch(/^Preview/);
  });
});

describe("previewSuffix", () => {
  it("uses the typed domain, normalised", () => {
    expect(previewSuffix({ typed: "  Acme.DEV ", serverIp: "203.0.113.24" })).toBe("acme.dev");
  });

  it("falls back to sslip.io on this server's IP when the field is emptied", () => {
    expect(previewSuffix({ typed: "", serverIp: "203.0.113.24" })).toBe("203.0.113.24.sslip.io");
    expect(previewSuffix({ typed: "", serverIp: null })).toBe("127.0.0.1.sslip.io");
  });
});

describe("wildcardWarning", () => {
  it("names the wrong address and this server's", () => {
    expect(
      wildcardWarning({
        baseDomain: "acme.com",
        serverIp: "203.0.113.24",
        check: { state: "pointing-elsewhere", addresses: ["198.51.100.7"], proxied: false },
      }),
    ).toBe(
      "*.acme.com resolves to 198.51.100.7, not this server (203.0.113.24). Update the A record, or remove the old one.",
    );
  });

  it("tells a proxied wildcard to turn the proxy off", () => {
    expect(
      wildcardWarning({
        baseDomain: "acme.com",
        serverIp: "203.0.113.24",
        check: { state: "pointing-elsewhere", addresses: ["104.16.1.1"], proxied: true },
      }),
    ).toMatch(/proxied by Cloudflare/);
  });

  it("stays quiet when the pill already says it all", () => {
    for (const state of ["pointing-here", "not-resolving", "unknown"] as const) {
      expect(
        wildcardWarning({
          baseDomain: "acme.com",
          serverIp: "203.0.113.24",
          check: { state, addresses: [], proxied: false },
        }),
      ).toBeNull();
    }
  });
});
