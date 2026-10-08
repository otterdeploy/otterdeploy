/**
 * The Public networking row for a generated sslip.io host read
 * `Live` and nothing else, while every browser refused its certificate. The
 * TLS chip deliberately went silent for sslip/.localhost names ("self-signed is
 * their correct, permanent state"), so the one URL a new install hands out
 * was the one URL the dashboard never warned about.
 *
 * Driven by the route's data (`usesAcme`, `publicCertEligible`), rendered
 * against the real English bundle so a renamed key fails here.
 */

import { renderToStaticMarkup } from "react-dom/server";

import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { i18nOptions } from "../../../../../../../../../../packages/i18n/src/config";
import { servedSelfSignedForGood } from "../domain-row";
import { CertBadge } from "../domains-card-parts";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: "en", initAsync: false });
});

/** A fresh install's first route: generated sslip.io host on `tls internal`. */
const sslip = {
  domain: "web-shop.116.203.148.168.sslip.io",
  status: "live" as const,
  dnsState: "pointed" as const,
  usesAcme: false,
  publicCertEligible: false,
  certSource: "internal" as const,
  certState: "unknown" as const,
  certError: null,
};

/** A custom domain that earned a Let's Encrypt certificate. */
const acme = {
  ...sslip,
  domain: "app.example.com",
  usesAcme: true,
  publicCertEligible: true,
  certSource: "acme" as const,
  certState: "valid" as const,
};

/** A host the edge serves with a certificate the operator uploaded. The route
 *  keeps usesAcme false: an uploaded chain is not ACME. */
const uploaded = {
  ...acme,
  usesAcme: false,
  certSource: "custom" as const,
  certState: "unknown" as const,
};

function render(domain: Parameters<typeof CertBadge>[0]["domain"]) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <CertBadge domain={domain} />
    </I18nextProvider>,
  );
}

describe("CertBadge", () => {
  it("marks a live generated host on a self-signed certificate", () => {
    const out = render(sslip);
    expect(out).toContain("Self-signed");
    // The explanation points at the fix that works for this name: a custom
    // domain, not a DNS recheck that can never earn it a certificate.
    expect(out).toContain("custom domain pointed at this server");
    expect(out).not.toContain("Recheck DNS");
  });

  it("says nothing for a route serving a Let's Encrypt certificate", () => {
    expect(render(acme)).toBe("");
  });

  it("says nothing for a paused host: nothing is served, so nothing warns", () => {
    expect(render({ ...sslip, status: "paused" })).toBe("");
  });

  it("names an uploaded certificate instead of calling it self-signed", () => {
    const out = render(uploaded);
    expect(out).toContain("Custom certificate");
    expect(out).not.toContain("Self-signed");
  });

  it("wears the info tint, the one colour self-signed has everywhere", () => {
    const out = render(sslip);
    expect(out).toContain("text-info");
    expect(out).not.toContain("text-warning");
  });

  it("keeps the DNS advice for a real name that is still self-signed", () => {
    const out = render({ ...acme, usesAcme: false, certSource: "internal", certState: "unknown" });
    expect(out).toContain("Self-signed");
    expect(out).toContain("Recheck DNS");
  });
});

describe("servedSelfSignedForGood (the row's note + Add custom domain)", () => {
  it("is true for a live generated sslip.io host", () => {
    expect(servedSelfSignedForGood(sslip)).toBe(true);
  });

  it("is false for an ACME route", () => {
    expect(servedSelfSignedForGood(acme)).toBe(false);
  });

  it("is false for a real name still on tls internal: that one is fixable by DNS", () => {
    expect(servedSelfSignedForGood({ ...acme, usesAcme: false, certSource: "internal" })).toBe(
      false,
    );
  });

  it("is false for a generated host served with an uploaded certificate", () => {
    expect(servedSelfSignedForGood({ ...sslip, certSource: "custom" })).toBe(false);
  });
});
