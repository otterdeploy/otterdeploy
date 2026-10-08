/**
 * The graph's Visit pill opened a generated sslip.io host
 * straight into ERR_CERT_AUTHORITY_INVALID, with nothing on the card saying
 * why. The mark comes from the project's route rows (`usesAcme`), via
 * selfSignedHosts, never from the hostname.
 */

import { renderToStaticMarkup } from "react-dom/server";

import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { i18nOptions } from "../../../../../../../../packages/i18n/src/config";
import { SelfSignedHostsProvider, selfSignedHosts } from "../../../data/self-signed-hosts";
import { ResourceCardFooter } from "../resource-card-parts";
import { VisitPill } from "../visit-pill";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: "en", initAsync: false });
});

const SSLIP = "web-shop.116.203.148.168.sslip.io";
const ACME = "app.example.com";

const sslipRoute = {
  domain: SSLIP,
  type: "http" as const,
  enabled: true,
  disabledByUser: false,
  usesAcme: false,
};
const routes = [sslipRoute, { ...sslipRoute, domain: ACME, usesAcme: true }];

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SelfSignedHostsProvider hosts={selfSignedHosts(routes)}>{node}</SelfSignedHostsProvider>
    </I18nextProvider>,
  );
}

describe("selfSignedHosts", () => {
  it("collects served HTTP routes that did not earn ACME", () => {
    expect([...selfSignedHosts(routes)]).toEqual([SSLIP]);
  });

  it("ignores routes that serve nothing and layer-4 routes", () => {
    const hosts = selfSignedHosts([
      { ...sslipRoute, disabledByUser: true },
      { ...sslipRoute, domain: "b.sslip.io", enabled: false },
      { ...sslipRoute, domain: "db.sslip.io", type: "layer4" as const },
    ]);
    expect(hosts.size).toBe(0);
  });
});

describe("VisitPill", () => {
  it("warns before opening a self-signed host", () => {
    const out = render(<VisitPill url={SSLIP} />);
    expect(out).toContain('data-self-signed="true"');
    expect(out).toContain("Self-signed certificate: the browser will warn first.");
  });

  it("matches a full URL as well as a bare host", () => {
    expect(render(<VisitPill url={`https://${SSLIP}/`} compact />)).toContain(
      'data-self-signed="true"',
    );
  });

  it("stays plain for a Let's Encrypt route", () => {
    const out = render(<VisitPill url={ACME} />);
    expect(out).not.toContain("data-self-signed");
    expect(out).toContain(`title="Open https://${ACME}"`);
  });

  it("stays plain outside a provider: no data, no warning invented", () => {
    const out = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <VisitPill url={SSLIP} />
      </I18nextProvider>,
    );
    expect(out).not.toContain("data-self-signed");
  });
});

describe("ResourceCardFooter", () => {
  const data = { kind: "service" as const, name: "web", description: "" };

  it("says Self-signed in words beside a self-signed address", () => {
    expect(render(<ResourceCardFooter data={{ ...data, publicUrl: SSLIP }} />)).toContain(
      ">Self-signed<",
    );
  });

  it("does not for an ACME address", () => {
    expect(render(<ResourceCardFooter data={{ ...data, publicUrl: ACME }} />)).not.toContain(
      "Self-signed",
    );
  });
});
