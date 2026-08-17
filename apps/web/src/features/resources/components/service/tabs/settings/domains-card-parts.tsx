/**
 * The read-only pieces of the service Public Networking card. The domain
 * view types, the connection-status chip, and the DNS-records hint. The
 * interactive row controls live in ./domain-row-parts. All stateless.
 * Handlers and busy flags come in as props.
 */

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";

export type DnsState = "pointed" | "proxied" | "unpointed" | "unknown";

/** Verification state of the org's base domain. Generated hostnames are
 *  `<slug>.apps.<baseDomain>`, so a not-yet-verified custom base domain
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
   *  "paused" is the operator's explicit off switch — config kept intact. */
  status: "live" | "disabled" | "paused";
  dnsState: DnsState;
  dnsCheckedAt: string | null;
  usesAcme: boolean;
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
  "domain" | "source" | "status" | "dnsState" | "usesAcme" | "ownershipVerified"
>;

/** Connection chip. Generated hosts route under the org's base domain, so
 *  they only read Live once that domain is provably owned (verified, or the
 *  no-verification-needed sslip.io fallback). Otherwise the route exists
 *  but nothing has confirmed it resolves, so the chip says so. Custom hosts
 *  surface their own DNS reachability: pointed → cert issues here, proxied →
 *  Cloudflare serves TLS, unpointed → needs the A record below. */
export function StatusBadge({
  domain,
  baseDomainStatus,
}: {
  domain: DomainStatusView;
  baseDomainStatus?: BaseDomainStatus;
}) {
  // The operator's own switch — distinct from system "Disabled" so nobody
  // goes hunting for a DNS problem that isn't there.
  if (domain.status === "paused") {
    return <Badge variant="secondary">Paused</Badge>;
  }
  if (domain.status === "disabled") {
    if (domain.source === "custom" && !domain.ownershipVerified) {
      return <Badge variant="secondary">Ownership pending</Badge>;
    }
    return <Badge variant="outline">Disabled</Badge>;
  }
  if (domain.source === "generated") {
    if (baseDomainStatus === "pending") {
      return <Badge variant="secondary">Pending DNS</Badge>;
    }
    return <Badge variant="outline">Live</Badge>;
  }
  switch (domain.dnsState) {
    case "pointed":
      return <Badge variant="outline">{domain.usesAcme ? "Connected" : "Live"}</Badge>;
    case "proxied":
      return <Badge variant="secondary">Cloudflare</Badge>;
    case "unpointed":
      return <Badge variant="destructive">DNS not pointed</Badge>;
    default:
      return <Badge variant="secondary">Checking…</Badge>;
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
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-[11.5px]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="text-muted-foreground">
          Add the ownership TXT record and point the host at this server, then Recheck. The route
          stays disabled until ownership is verified.
        </p>
        {onConfigure ? (
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={onConfigure}
          >
            Configure DNS
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
