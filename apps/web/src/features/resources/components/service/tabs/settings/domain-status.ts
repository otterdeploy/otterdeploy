/**
 * One status per published host, worst first.
 *
 * The row shows a single globe, and a globe can only say one thing. Before,
 * three chips (connection, certificate, proxy reload) each answered part of
 * "is this host working?" with no ranking between them, so a host could read
 * "Ownership pending" and "Not applied" at once even though an unverified host
 * is not routed at all. The order of the checks below is the ranking: the
 * first one that matches is the state the globe shows and the card explains.
 *
 * Pure and framework-free so the precedence is pinned by tests
 * (./domain-status.test.ts) rather than by whatever a component renders.
 */

import type { BaseDomainStatus, DomainView } from "./domains-card-parts";

/** How the globe is painted. Mirrors the app's status vocabulary: success for
 *  working, warning for "needs you", pulsing warning for "in flight" (the
 *  deployment StatusDot convention), destructive for failures, muted for off. */
export type DomainTone = "ok" | "progress" | "attention" | "error" | "off" | "neutral";

export type DomainStatusKind =
  | "paused"
  | "ownershipPending"
  | "disabled"
  | "edgeFailed"
  | "certFailed"
  | "notPointed"
  | "edgeApplying"
  | "certIssuing"
  | "baseDomainPending"
  | "dnsUnchecked"
  | "temporary"
  | "selfSigned"
  | "proxied"
  | "live";

/** The one action the status card offers for a state, if any. */
export type DomainStatusAction = "recheck" | "resume" | "edgeLogs" | null;

export interface DomainStatus {
  kind: DomainStatusKind;
  tone: DomainTone;
  action: DomainStatusAction;
  /** Whether the card should list the DNS records to publish. */
  showRecords: boolean;
}

export type DomainStatusInput = Pick<
  DomainView,
  | "domain"
  | "source"
  | "status"
  | "dnsState"
  | "dnsCheckedAt"
  | "usesAcme"
  | "certState"
  | "ownershipVerified"
  | "edgeState"
>;

/** A name no public CA will ever issue for. Mirrors `canHoldPublicCert` in
 *  packages/api/src/routers/service/domain-rules.ts. */
function isTemporaryHost(domain: string): boolean {
  return domain.endsWith(".sslip.io") || domain.endsWith(".localhost");
}

const status = (
  kind: DomainStatusKind,
  tone: DomainTone,
  action: DomainStatusAction = null,
  showRecords = false,
): DomainStatus => ({ kind, tone, action, showRecords });

/** The operator's switch and the system gate: nothing is served, so no other
 *  fact about the host is the current problem. */
function gateStatus(d: DomainStatusInput): DomainStatus | null {
  if (d.status === "paused") return status("paused", "off", "resume");
  if (d.status !== "disabled") return null;
  // An unverified custom host is not routed, so a reload or certificate state
  // behind it would be noise.
  if (d.source === "custom" && !d.ownershipVerified) {
    return status("ownershipPending", "attention", "recheck", true);
  }
  return status("disabled", "off");
}

/** Live hosts that something refused or can't reach: the proxy refusing the
 *  change, the CA refusing the certificate, DNS measured elsewhere. */
function problemStatus(d: DomainStatusInput): DomainStatus | null {
  if (d.edgeState === "failed") return status("edgeFailed", "error", "edgeLogs");
  if (d.usesAcme && d.certState === "failed") return status("certFailed", "error", "recheck");
  // A measured miss. Generated hosts only count once DNS was actually checked:
  // sslip/localhost names resolve by construction and never carry one.
  const measuredMiss =
    d.dnsState === "unpointed" && (d.source === "custom" || d.dnsCheckedAt != null);
  if (measuredMiss && !isTemporaryHost(d.domain)) {
    return status("notPointed", "attention", "recheck", true);
  }
  return null;
}

/** Work in flight: resolves on its own, so it offers no action. */
function inFlightStatus(d: DomainStatusInput): DomainStatus | null {
  if (d.edgeState === "pending") return status("edgeApplying", "progress");
  if (d.usesAcme && d.certState === "obtaining") return status("certIssuing", "progress");
  return null;
}

function generatedStatus(d: DomainStatusInput, baseDomainStatus?: BaseDomainStatus): DomainStatus {
  if (isTemporaryHost(d.domain)) return status("temporary", "neutral");
  if (d.dnsCheckedAt == null && baseDomainStatus === "pending") {
    return status("baseDomainPending", "attention");
  }
  return status(d.dnsState === "proxied" ? "proxied" : "live", "ok");
}

function customStatus(d: DomainStatusInput): DomainStatus {
  if (d.dnsState === "proxied") return status("proxied", "ok");
  if (d.dnsState !== "pointed") return status("dnsUnchecked", "neutral", "recheck");
  // Pointed but the proxy serves a self-signed certificate: every visitor gets
  // a browser warning, so it is not "live" in any sense they would recognise.
  if (!d.usesAcme) return status("selfSigned", "attention", "recheck");
  return status("live", "ok");
}

export function domainStatus(
  d: DomainStatusInput,
  baseDomainStatus?: BaseDomainStatus,
): DomainStatus {
  return (
    gateStatus(d) ??
    problemStatus(d) ??
    inFlightStatus(d) ??
    (d.source === "generated" ? generatedStatus(d, baseDomainStatus) : customStatus(d))
  );
}

export type DomainFactKey = "ownership" | "dns" | "certificate" | "proxy";
export type DomainFactValue =
  | "verified"
  | "txtMissing"
  | "pointsHere"
  | "proxiedCf"
  | "notPointed"
  | "notChecked"
  | "byDesign"
  | "trusted"
  | "issuing"
  | "failed"
  | "selfSigned"
  | "cfEdge"
  | "waitsForDns"
  | "notServed"
  | "serving"
  | "applying"
  | "notApplied"
  | "pausedByYou"
  | "notRouted"
  | "notVerified";

export interface DomainFact {
  key: DomainFactKey;
  tone: DomainTone;
  value: DomainFactValue;
}

const fact = (key: DomainFactKey, tone: DomainTone, value: DomainFactValue): DomainFact => ({
  key,
  tone,
  value,
});

function dnsFact(d: DomainStatusInput): DomainFact {
  if (isTemporaryHost(d.domain)) return fact("dns", "ok", "byDesign");
  if (d.dnsState === "pointed") return fact("dns", "ok", "pointsHere");
  if (d.dnsState === "proxied") return fact("dns", "ok", "proxiedCf");
  if (d.dnsState === "unpointed") return fact("dns", "attention", "notPointed");
  return fact("dns", "off", "notChecked");
}

function certificateFact(d: DomainStatusInput): DomainFact {
  if (d.status !== "live") return fact("certificate", "off", "notServed");
  if (isTemporaryHost(d.domain)) return fact("certificate", "attention", "selfSigned");
  if (!d.usesAcme) {
    return d.dnsState === "proxied"
      ? fact("certificate", "neutral", "cfEdge")
      : fact("certificate", "attention", "selfSigned");
  }
  if (d.certState === "valid") return fact("certificate", "ok", "trusted");
  if (d.certState === "obtaining") return fact("certificate", "progress", "issuing");
  if (d.certState === "failed") return fact("certificate", "error", "failed");
  return fact("certificate", "off", "waitsForDns");
}

function proxyFact(d: DomainStatusInput): DomainFact {
  if (d.status === "paused") return fact("proxy", "off", "pausedByYou");
  if (d.status === "disabled") {
    const unverified = d.source === "custom" && !d.ownershipVerified;
    return fact("proxy", "off", unverified ? "notVerified" : "notRouted");
  }
  if (d.edgeState === "pending") return fact("proxy", "progress", "applying");
  if (d.edgeState === "failed") return fact("proxy", "error", "notApplied");
  return fact("proxy", "ok", "serving");
}

/**
 * The four facts the card lists under its headline, so nothing the old chips
 * said is lost by collapsing them into one globe. Ownership only applies to a
 * custom host.
 */
export function domainFacts(d: DomainStatusInput): DomainFact[] {
  const ownership =
    d.source === "custom"
      ? [
          d.ownershipVerified
            ? fact("ownership", "ok", "verified")
            : fact("ownership", "attention", "txtMissing"),
        ]
      : [];
  return [...ownership, dnsFact(d), certificateFact(d), proxyFact(d)];
}
