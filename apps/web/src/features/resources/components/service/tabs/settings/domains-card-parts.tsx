/**
 * The read-only pieces of the service Public Networking card: the domain view
 * types and the connection-status chip that the stack's "Exposed services"
 * card reads. The service row's own state lives in ./domain-status (which
 * state wins) and ./domain-status-card (the globe and its card).
 */

import { useTranslation } from "react-i18next";

import { Badge } from "@/shared/components/ui/badge";

export type DnsState = "pointed" | "proxied" | "unpointed" | "unknown";
type CertState = "unknown" | "obtaining" | "valid" | "failed";
type EdgeState = "synced" | "pending" | "failed";

/** Verification state of the org's base domain. Generated hostnames are
 *  `<slug>.<baseDomain>`, so a not-yet-verified custom base domain
 *  means the generated route isn't provably reachable yet either. `"unset"`
 *  is the sslip.io fallback, which needs no ownership proof and is always
 *  reachable once the route exists. */
export type BaseDomainStatus = "unset" | "pending" | "verified";

export interface DomainView {
  id: string;
  domain: string;
  /** Container port this host proxies to: shown on the row so a
   *  multi-port service reads at a glance as "which door is this". */
  port: number;
  source: "generated" | "custom";
  isPrimary: boolean;
  /** "disabled" is the system gate (unexposed / verification pending);
   *  "paused" is the operator's explicit off switch: config kept intact. */
  status: "live" | "disabled" | "paused";
  dnsState: DnsState;
  dnsCheckedAt: string | null;
  usesAcme: boolean;
  /** TLS lifecycle, promoted from Caddy's own ACME log events
   *  (packages/api/src/edge-logs/cert-promote.ts). */
  certState: CertState;
  certError: string | null;
  /** Whether the edge runs this host's latest change: "pending" until the
   *  proxy reload lands, "failed" (with `edgeError`) when it was refused. */
  edgeState: EdgeState;
  edgeError: string | null;
  protected: boolean;
  ownershipVerified: boolean;
  verifyRecord: string | null;
  verifyToken: string | null;
  dnsTarget: string | null;
}

/** Just the fields the connection chip reads. Surfaces that only summarize
 *  reachability (the stack's read-only "Exposed services" card) synthesize
 *  this instead of a whole {@link DomainView}. */
export type DomainStatusView = Pick<
  DomainView,
  "domain" | "source" | "status" | "dnsState" | "dnsCheckedAt" | "usesAcme" | "ownershipVerified"
>;

/** Connection chip. Generated hosts whose DNS has actually been measured
 *  (minted under a real apex, or Recheck was run) surface that observation:
 *  pointed → Live, unpointed → the wildcard/A record is missing. Ones never
 *  measured (sslip/localhost resolve by construction; legacy rows) fall back
 *  to the org base domain's verification signal. Custom hosts surface their
 *  own DNS reachability: pointed → cert issues here, proxied → Cloudflare
 *  serves TLS, unpointed → needs the A record below. */
export function StatusBadge({
  domain,
  baseDomainStatus,
}: {
  domain: DomainStatusView;
  baseDomainStatus?: BaseDomainStatus;
}) {
  const { t } = useTranslation();
  // The operator's own switch: distinct from system "Disabled" so nobody
  // goes hunting for a DNS problem that isn't there.
  if (domain.status === "paused") {
    return <Badge variant="secondary">{t("domains.statusPaused")}</Badge>;
  }
  if (domain.status === "disabled") {
    if (domain.source === "custom" && !domain.ownershipVerified) {
      return <Badge variant="secondary">{t("domains.statusOwnershipPending")}</Badge>;
    }
    return <Badge variant="outline">{t("domains.statusDisabled")}</Badge>;
  }
  if (domain.source === "generated") {
    // A measured answer beats inference from the base domain's paperwork.
    if (domain.dnsCheckedAt) {
      if (domain.dnsState === "pointed") {
        return <Badge variant="outline">{t("domains.statusLive")}</Badge>;
      }
      if (domain.dnsState === "proxied") {
        return <Badge variant="secondary">{t("domains.statusCloudflare")}</Badge>;
      }
      if (domain.dnsState === "unpointed") {
        return <Badge variant="destructive">{t("domains.statusNotPointed")}</Badge>;
      }
      // "unknown": the lookup couldn't classify; fall through to the base
      // domain signal rather than asserting either way.
    }
    if (baseDomainStatus === "pending") {
      return <Badge variant="secondary">{t("domains.statusPendingDns")}</Badge>;
    }
    return <Badge variant="outline">{t("domains.statusLive")}</Badge>;
  }
  switch (domain.dnsState) {
    case "pointed":
      return (
        <Badge variant="outline">
          {domain.usesAcme ? t("domains.statusConnected") : t("domains.statusLive")}
        </Badge>
      );
    case "proxied":
      return <Badge variant="secondary">{t("domains.statusCloudflare")}</Badge>;
    case "unpointed":
      return <Badge variant="destructive">{t("domains.statusNotPointed")}</Badge>;
    default:
      return <Badge variant="secondary">{t("domains.statusChecking")}</Badge>;
  }
}
