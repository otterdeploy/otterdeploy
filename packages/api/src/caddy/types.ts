import type { RoutePolicy } from "@otterdeploy/shared/route-policy";

/**
 * The shapes both halves of the Caddyfile builder need.
 *
 * Extracted so `./builder` (site blocks) and `./global-block` (the global
 * `{ … }` stanza) can each import them without importing each other: the
 * global block needs the route shape to emit layer4 matchers, and the site
 * builder needs the CrowdSec config to decide whether to emit the gate. With
 * the types living in one of those two files, that is a cycle.
 */

export interface ProxyRouteInput {
  projectId: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
  /** When true, Caddy attempts public ACME issuance (Let's Encrypt) for
   *  this domain. When false, falls back to `tls internal` (self-signed):
   *  the only safe choice for sslip.io domains and any apex the
   *  operator hasn't proven ownership of. */
  usesAcme: boolean;
  /** When true, the route is wrapped in a forward_auth gate (deployment
   *  protection). Optional so existing call sites/fixtures that predate
   *  the feature keep compiling; absent ⇒ unprotected. See
   *  docs/designs/deployment-protection.md. */
  protected?: boolean;
  /** Allowlisted behavior rendered by trusted builder code. */
  routePolicy?: RoutePolicy;
  /** Raw Caddyfile directives spliced verbatim inside the site block (HTTP
   *  routes only). Brace-balance-checked at the write boundary AND re-checked
   *  in customDirectiveLines; Caddy's /adapt pass is the syntax gate. */
  customDirectives?: string | null;
  /** Operator-uploaded certificate to serve for this domain instead of
   *  ACME / tls internal. Paths are CONTAINER paths under the `/etc/caddy`
   *  mount, set by the reconcile layer only for certs whose files were
   *  actually materialized (see ./certs.ts), so an emitted `tls` line never
   *  references a file the edge can't read. Absent ⇒ normal ACME/internal
   *  behaviour. */
  customCert?: { certPath: string; keyPath: string } | null;
}

/** CrowdSec LAPI connection for the global Caddy `crowdsec` app config. */
export interface CrowdsecConfig {
  apiUrl: string;
  apiKey: string;
}
