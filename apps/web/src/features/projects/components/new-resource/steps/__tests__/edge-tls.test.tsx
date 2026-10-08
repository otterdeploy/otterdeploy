/**
 * The new-service wizard's Edge proxy box said "TLS certificates:
 * Let's Encrypt · issued and renewed automatically" for every service, and the
 * Review step read "Public: <host>", for a generated sslip.io host that goes
 * out on a self-signed certificate. Both now say so, from the server's own
 * answer (`publicCertEligible` on publicHostPreview), not from the hostname.
 */

import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import { resourceDefaults } from "../../schemas";
import { selfSignedGeneratedHost, tlsEdgeRow } from "../edge-tls";
import { buildReviewModel } from "../review-model";
import { ReviewSummaryCard, TlsNote } from "../review-parts";

const SSLIP = { fqdn: "web-shop.116.203.148.168.sslip.io", publicCertEligible: false };
const ORG = { fqdn: "web-shop.apps.example.com", publicCertEligible: true };

const generated = [{ port: 3000, protocol: "http", public: true, host: "" }];
const typed = [{ port: 3000, protocol: "http", public: true, host: "app.example.com" }];
const internal = [{ port: 3000, protocol: "http", public: false, host: "" }];

describe("selfSignedGeneratedHost", () => {
  it("names the sslip host a public port with no hostname publishes at", () => {
    expect(selfSignedGeneratedHost(generated, SSLIP)).toBe(SSLIP.fqdn);
  });

  it("is null when the generated host can hold a trusted certificate", () => {
    expect(selfSignedGeneratedHost(generated, ORG)).toBeNull();
  });

  it("is null when every public port has its own hostname", () => {
    expect(selfSignedGeneratedHost(typed, SSLIP)).toBeNull();
  });

  it("is null for an internal-only service", () => {
    expect(selfSignedGeneratedHost(internal, SSLIP)).toBeNull();
  });
});

describe("Edge proxy TLS row", () => {
  it("says self-signed, and how to get a trusted certificate, for an sslip host", () => {
    const row = tlsEdgeRow(SSLIP.fqdn);
    expect(row.sub).toContain(`Self-signed for ${SSLIP.fqdn}`);
    expect(row.sub).toContain("browsers will warn");
    expect(row.sub).toContain("custom domain pointed at this server");
    expect(row.sub).not.toMatch(/^Let's Encrypt/);
  });

  it("keeps the Let's Encrypt promise only for names that can hold one", () => {
    expect(tlsEdgeRow(null).sub).toContain("Let's Encrypt for hostnames that point at this server");
  });
});

describe("Review step", () => {
  const node = SERVICE_KINDS.find((k) => k.id === "docker");
  if (!node) throw new Error("docker kind missing from SERVICE_KINDS");
  const values = { ...resourceDefaults, name: "web", ports: generated };

  it("flags the self-signed host on the Access row and explains it", () => {
    const model = buildReviewModel(node, values, SSLIP);
    expect(model.selfSignedHost).toBe(SSLIP.fqdn);
    const out = renderToStaticMarkup(
      <>
        <ReviewSummaryCard kind={node} model={model} />
        <TlsNote model={model} />
      </>,
    );
    expect(out).toContain(`Public: ${SSLIP.fqdn} (self-signed)`);
    expect(out).toContain("self-signed certificate, so browsers will warn");
  });

  it("does not for a host under a verified base domain", () => {
    const model = buildReviewModel(node, values, ORG);
    expect(model.selfSignedHost).toBeNull();
    const out = renderToStaticMarkup(
      <>
        <ReviewSummaryCard kind={node} model={model} />
        <TlsNote model={model} />
      </>,
    );
    expect(out).toContain(`Public: ${ORG.fqdn}`);
    expect(out).not.toContain("self-signed");
  });
});
