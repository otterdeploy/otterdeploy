/**
 * The read-only pieces of the service Public Networking card. The domain
 * view types, the connection-status chip, and the DNS-records hint. The
 * interactive row controls live in ./domain-row-parts. All stateless.
 * Handlers and busy flags come in as props.
 */

import { useTranslation } from "react-i18next";

import { SelfSignedBadge } from "@/shared/components/domains/self-signed-badge";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Spinner } from "@/shared/components/ui/spinner";

export type DnsState = "pointed" | "proxied" | "unpointed" | "unknown";
type CertState = "unknown" | "obtaining" | "valid" | "failed";

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
  /** False for names no public CA signs (generated sslip.io / .localhost
   *  hosts): their self-signed certificate is permanent, so the fix is a
   *  custom domain, not DNS. Decided server-side (domain-rules.ts). */
  publicCertEligible: boolean;
  /** Which certificate the edge serves: Let's Encrypt, an operator-uploaded
   *  chain, or Caddy's self-signed one. An uploaded chain leaves `usesAcme`
   *  false, so that flag alone would call it self-signed. */
  certSource: "acme" | "internal" | "custom";
  /** TLS lifecycle, promoted from Caddy's own ACME log events
   *  (packages/api/src/edge-logs/cert-promote.ts). */
  certState: CertState;
  certError: string | null;
  /** Whether the edge runs this host's latest change. Writes answer before
   *  the proxy reload; the reload's outcome lands here over the project
   *  event stream (packages/api/src/caddy/edge-state.ts). */
  edgeState: "synced" | "pending" | "failed";
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

/** Just the fields the TLS chip reads. */
type DomainCertView = Pick<
  DomainView,
  | "status"
  | "dnsState"
  | "usesAcme"
  | "publicCertEligible"
  | "certSource"
  | "certState"
  | "certError"
>;

/**
 * Whether TLS is actually trusted, which {@link StatusBadge} does NOT say.
 *
 * That chip answers "does DNS reach this host", and the two facts come apart:
 * a domain proxied through Cloudflare reads `Cloudflare` there while its
 * ORIGIN still serves a self-signed certificate. A route showed `Live` while
 * browsers rejected it with ERR_CERT_AUTHORITY_INVALID, and nothing on the
 * page said otherwise — the operator found out by visiting the site.
 *
 * Keyed off `usesAcme`, NOT off `certState` alone. A route on `tls internal`
 * makes Caddy emit no ACME events at all, so its `certState` stays `unknown`
 * forever — indistinguishable from "issued, just not logged yet". `usesAcme`
 * is the decision the reconciler actually wrote into the Caddyfile, so it is
 * the only field that can tell those apart.
 *
 * Silent on the healthy path: a badge on every working row is noise, and
 * StatusBadge already says Live. This speaks only when something is wrong or
 * in flight.
 *
 * A generated sslip.io / `.localhost` host used to be skipped here as "correct
 * and permanent", and that silence is how a fresh install's first URL read
 * `Live` while every browser refused it. Permanent is not the
 * same as fine: it gets the chip too, with the fix that actually applies (a
 * custom domain) instead of a DNS recheck that can never help.
 *
 * An uploaded certificate is checked first: its route keeps `usesAcme` false,
 * so without `certSource` the operator's own trusted chain read "Self-signed".
 * It is named rather than left silent, because the row is otherwise the only
 * place that says why this host has no Let's Encrypt certificate.
 */
export function CertBadge({ domain }: { domain: DomainCertView }) {
  const { t } = useTranslation();

  // Nothing is being served, so TLS is not the operator's current problem.
  if (domain.status !== "live") return null;

  if (domain.certSource === "custom") {
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground"
        title={t("domains.certCustomHint")}
      >
        {t("domains.certCustom")}
      </Badge>
    );
  }

  if (!domain.usesAcme && !domain.publicCertEligible) {
    return <SelfSignedBadge />;
  }

  if (!domain.usesAcme) {
    // A proxied host is NOT the same failure as a pointed one, and painting
    // both amber said it was. Behind Cloudflare, visitors get a valid edge
    // certificate — the self-signed origin only bites on SSL mode Full
    // (strict). Pointed and self-signed means every visitor gets a browser
    // warning right now. One is a caution to read, the other is an outage, so
    // the proxied case states the fact quietly and lets the Cloudflare chip
    // beside it carry the context.
    if (domain.dnsState === "proxied") {
      return (
        <Badge
          variant="outline"
          className="text-muted-foreground"
          title={t("domains.certSelfSignedProxiedHint")}
        >
          {t("domains.certOriginSelfSigned")}
        </Badge>
      );
    }
    return <SelfSignedBadge hint={t("domains.certSelfSignedHint")} />;
  }

  if (domain.certState === "failed") {
    return (
      <Badge variant="destructive" title={domain.certError ?? t("domains.certFailedHint")}>
        {t("domains.certFailed")}
      </Badge>
    );
  }

  if (domain.certState === "obtaining") {
    return <Badge variant="outline">{t("domains.certIssuing")}</Badge>;
  }

  return null;
}

/**
 * The proxy reload behind the host's last change. A domain write answers as
 * soon as the route is saved and the reload runs behind it, so for a moment
 * (or, when Caddy is slow to swap configs, many seconds) the row exists but
 * the edge does not serve it yet. Silent once the edge has it.
 */
export function EdgeBadge({ domain }: { domain: Pick<DomainView, "edgeState" | "edgeError"> }) {
  const { t } = useTranslation();
  if (domain.edgeState === "pending") {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-muted-foreground"
        title={t("domains.edgePendingHint")}
      >
        <Spinner className="size-3" />
        {t("domains.edgePending")}
      </Badge>
    );
  }
  if (domain.edgeState === "failed") {
    return (
      <Badge variant="destructive" title={domain.edgeError ?? t("domains.edgeFailedHint")}>
        {t("domains.edgeFailed")}
      </Badge>
    );
  }
  return null;
}

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

/**
 * Ownership TXT proof plus the A record that routes traffic here.
 *
 * Keeps the inline records (they are what someone reads at a glance) and adds
 * the "Configure DNS records" entry point, which is where Cloudflare detection
 * and one-click setup live (shared/components/domains/dns-records-dialog.tsx).
 * The same dialog serves the control-plane and workspace domains, so the flow
 * reads identically wherever a domain is added.
 */
export function DnsHint({
  domain,
  onConfigure,
}: {
  domain: DomainView;
  /** Opens the shared DNS dialog. Omitted where the surface can't offer it. */
  onConfigure?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[11.5px]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-muted-foreground">
          {domain.source === "generated"
            ? t("domains.dnsHintGenerated")
            : t("domains.dnsHintCustom")}
        </p>
        {onConfigure ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={onConfigure}
          >
            {t("domains.configureDns")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 font-mono">
        {domain.verifyRecord && domain.verifyToken ? (
          <DnsRecord type="TXT" name={domain.verifyRecord} value={domain.verifyToken} />
        ) : null}
        {domain.dnsTarget ? (
          <DnsRecord type="A" name={domain.domain} value={domain.dnsTarget} />
        ) : null}
      </div>
    </div>
  );
}

/** A single DNS record line. Type + name share a row that wraps, and the
 *  value sits below so long record names and tokens both flow full-width
 *  instead of collapsing into a thin, character-wrapped column. */
function DnsRecord({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-baseline gap-2 text-muted-foreground">
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tracking-wide uppercase">
          {type}
        </span>
        <span className="min-w-0 break-all">{name}</span>
      </div>
      <span className="pl-1 break-all text-foreground">{value}</span>
    </div>
  );
}
