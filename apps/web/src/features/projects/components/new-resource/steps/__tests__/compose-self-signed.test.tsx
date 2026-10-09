/**
 * The compose/template wizard hands out its published
 * addresses as `https://<generated sslip host>` with nothing about the
 * certificate, while the single-service wizard now says those hosts go out
 * self-signed. Same server answer (`publicCertEligible` on publicHostPreview),
 * same note, rendered against the real English bundle.
 */

import { renderToStaticMarkup } from "react-dom/server";

import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Preview } from "../../compose-wizard-shared";
import type { DomainRow } from "../../stack-domains";

import { i18nOptions } from "../../../../../../../../../packages/i18n/src/config";
import { ComposePreview } from "../../compose-preview";
import { rederiveDomains } from "../../stack-domains";
import { selfSignedStackHosts } from "../edge-tls";

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ ...i18nOptions, lng: "en", initAsync: false });
});

const SSLIP = { fqdn: "app-shop.116.203.148.168.sslip.io", publicCertEligible: false };
const ORG = { fqdn: "app-shop.apps.example.com", publicCertEligible: true };

const rows: DomainRow[] = rederiveDomains(
  [
    { key: "app:3000", domain: "", custom: false },
    { key: "status:8080", domain: "", custom: false },
  ],
  SSLIP.fqdn,
);
const exposed = new Set(rows.map((r) => r.key));

describe("selfSignedStackHosts", () => {
  it("names the front door and every derived row on a generated host", () => {
    expect(selfSignedStackHosts(rows, exposed, SSLIP)).toEqual([
      SSLIP.fqdn,
      "app-shop-status.116.203.148.168.sslip.io",
    ]);
  });

  it("is empty when the generated host can hold a trusted certificate", () => {
    expect(selfSignedStackHosts(rederiveDomains(rows, ORG.fqdn), exposed, ORG)).toEqual([]);
  });

  it("is empty once the front door is renamed to the operator's own domain", () => {
    expect(selfSignedStackHosts(rederiveDomains(rows, "shop.example.com"), exposed, SSLIP)).toEqual(
      [],
    );
  });

  it("leaves out a row the operator typed their own domain into", () => {
    const typed = rows.map((r, i) =>
      i === 1 ? { ...r, domain: "status.example.com", custom: true } : r,
    );
    expect(selfSignedStackHosts(typed, exposed, SSLIP)).toEqual([SSLIP.fqdn]);
  });

  it("is empty while the server preview is still loading", () => {
    expect(selfSignedStackHosts(rows, exposed, null)).toEqual([]);
  });
});

describe("ComposePreview", () => {
  const preview: Preview = {
    valid: true,
    error: null,
    errorLine: null,
    errorColumn: null,
    name: "shop",
    vars: [],
    services: [
      { name: "app", image: "nginx", ports: [3000], hasBuild: false },
      { name: "status", image: "nginx", ports: [8080], hasBuild: false },
    ],
    warnings: [],
  };

  function render(selfSignedHosts: readonly string[]) {
    return renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ComposePreview
          parsing={false}
          preview={preview}
          buildServices={[]}
          exposed={exposed}
          domains={rows}
          selfSignedHosts={selfSignedHosts}
          onToggleExpose={() => undefined}
          onDomainChange={() => undefined}
        />
      </I18nextProvider>,
    );
  }

  it("says the generated addresses are self-signed where it hands them out", () => {
    const out = render(selfSignedStackHosts(rows, exposed, SSLIP));
    expect(out).toContain(">Self-signed<");
    // The note itself, not only the chip's title: visible text under the rows.
    expect(out).toMatch(/<span class="min-w-0">Generated addresses are served with a self-signed/);
    expect(out).toContain("custom domain pointed at this server");
  });

  it("says nothing about certificates for hosts that can be trusted", () => {
    expect(render([])).not.toContain("Self-signed");
  });
});
