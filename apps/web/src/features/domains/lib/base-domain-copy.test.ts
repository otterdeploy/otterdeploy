import { describe, expect, it } from "vite-plus/test";

import {
  apexNote,
  previewSuffix,
  writeResultMessage,
  publishNote,
  txtStatus,
  wildcardStatus,
  wildcardWarning,
  type Publishing,
} from "./base-domain-copy";

const orgBase = (certificate: Publishing["certificate"]): Publishing => ({
  source: "org-base",
  suffix: "acme.com",
  onServerIp: false,
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
        suffix: "sslip.io",
        onServerIp: true,
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
    expect(previewSuffix({ typed: "  Acme.DEV ", hasServerIp: true })).toEqual({
      suffix: "acme.dev",
      onServerIp: false,
    });
  });

  it("falls back to sslip.io on this server's IP, without ever spelling the IP", () => {
    expect(previewSuffix({ typed: "", hasServerIp: true })).toEqual({
      suffix: "sslip.io",
      onServerIp: true,
    });
    expect(previewSuffix({ typed: "", hasServerIp: false })).toEqual({
      suffix: "127.0.0.1.sslip.io",
      onServerIp: false,
    });
  });
});

const SERVER_IP = "203.0.113.24";

describe("wildcardWarning", () => {
  it("names the wrong address, never this server's, and says nothing is overwritten", () => {
    const text = wildcardWarning({
      baseDomain: "acme.com",
      check: { state: "pointing-elsewhere", addresses: ["198.51.100.7"], proxied: false },
    });
    expect(text).toMatch(/^\*\.acme\.com resolves to 198\.51\.100\.7, not this server\./);
    expect(text).toContain("never overwrites an existing record");
    expect(text).not.toContain(SERVER_IP);
  });

  it("tells a proxied wildcard to turn the proxy off", () => {
    expect(
      wildcardWarning({
        baseDomain: "acme.com",
        check: { state: "pointing-elsewhere", addresses: ["104.16.1.1"], proxied: true },
      }),
    ).toMatch(/proxied by Cloudflare/);
  });

  it("stays quiet when the pill already says it all", () => {
    for (const state of ["pointing-here", "not-resolving", "unknown"] as const) {
      expect(
        wildcardWarning({
          baseDomain: "acme.com",
          check: { state, addresses: [], proxied: false },
        }),
      ).toBeNull();
    }
  });
});

describe("apexNote", () => {
  it("explains an apex serving another site is fine and left alone", () => {
    expect(
      apexNote({
        baseDomain: "acme.com",
        apex: { state: "pointing-elsewhere", addresses: ["198.51.100.7"], proxied: false },
      }),
    ).toBe(
      "acme.com itself points to 198.51.100.7. That's fine: services use the wildcard, and Write DNS records leaves an existing record alone.",
    );
  });

  it("says nothing when the apex points here, is missing, or is unknown", () => {
    for (const state of ["pointing-here", "not-resolving", "unknown"] as const) {
      expect(
        apexNote({ baseDomain: "acme.com", apex: { state, addresses: [], proxied: false } }),
      ).toBeNull();
    }
    expect(apexNote({ baseDomain: "acme.com", apex: null })).toBeNull();
  });
});

describe("writeResultMessage", () => {
  it("warns when the wildcard was left pointing elsewhere", () => {
    expect(
      writeResultMessage({
        baseDomain: "acme.com",
        verified: false,
        apex: "created",
        wildcard: "elsewhere",
      }),
    ).toMatchObject({ tone: "warning", text: expect.stringMatching(/left as it is/) });
  });

  it("mentions an apex it left alone", () => {
    expect(
      writeResultMessage({
        baseDomain: "acme.com",
        verified: true,
        apex: "elsewhere",
        wildcard: "created",
      }),
    ).toEqual({
      tone: "success",
      text: "DNS records written and the domain is verified. acme.com itself already points elsewhere; left as it is.",
    });
  });
});
