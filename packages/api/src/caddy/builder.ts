import { buildLayer4Block, buildLayer4SiteBlocks, sanitizeMatcherName } from "./layer4";

// Re-exported so existing `./builder` import sites keep working after the
// layer4 fragments moved to ./layer4.
export { buildLayer4Block, sanitizeMatcherName };

export interface ProxyRouteInput {
  projectId: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
  /** When true, Caddy attempts public ACME issuance (Let's Encrypt) for
   *  this domain. When false, falls back to `tls internal` (self-signed)
   *  — the only safe choice for sslip.io domains and any apex the
   *  operator hasn't proven ownership of. */
  usesAcme: boolean;
  /** When true, the route is wrapped in a forward_auth gate (deployment
   *  protection). Optional so existing call sites/fixtures that predate
   *  the feature keep compiling; absent ⇒ unprotected. See
   *  docs/designs/deployment-protection.md. */
  protected?: boolean;
  /** Operator-authored directives spliced inside this route's site block
   *  (http only) — e.g. `header`, `encode`, `rate_limit`. Indentation is
   *  normalized on emit; null/absent ⇒ none. */
  customDirectives?: string | null;
  /** Operator-uploaded certificate to serve for this domain instead of
   *  ACME / tls internal. Paths are CONTAINER paths under the `/etc/caddy`
   *  mount, set by the reconcile layer only for certs whose files were
   *  actually materialized (see ./certs.ts) — so an emitted `tls` line never
   *  references a file the edge can't read. Absent ⇒ normal ACME/internal
   *  behaviour. */
  customCert?: { certPath: string; keyPath: string } | null;
}

/** Re-indent an operator-authored directive block to sit one level inside a
 *  site block. Caddy is whitespace-insensitive, so this is purely cosmetic
 *  (keeps the rendered + viewer output tidy): dedent by the block's common
 *  leading indentation (preserving relative nesting), then prefix every
 *  non-blank line with `depth` tabs. */
function indentDirectives(raw: string, depth = 1): string {
  const tab = "\t".repeat(depth);
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^[\t ]*/)?.[0].length ?? 0);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((l) => (l.trim().length === 0 ? "" : tab + l.slice(common)))
    .join("\n")
    .replace(/\n+$/, "");
}

/** Reserved, ungated path prefix on every protected deployment domain.
 *  The cross-domain auth handoff callback lands here and is proxied to the
 *  control plane (the only place that can Set-Cookie for the deployment
 *  domain). `.well-known` per RFC 8615; we intercept only this subtree so
 *  the app's other `.well-known/*` paths fall through untouched. */
export const RESERVED_AUTH_PREFIX = "/.well-known/otterdeploy";

/** Control-plane path the forward_auth subrequest hits. */
const DEPLOY_AUTHZ_PATH = "/api/internal/deploy-authz";

/** Fallback control-plane upstream Caddy proxies auth subrequests to when
 *  the reconcile layer doesn't supply one. Dev default: Caddy runs in a
 *  container and reaches the host-run server via host.docker.internal.
 *  Production (Swarm) passes the real service DNS via reconcile options. */
const DEFAULT_AUTHZ_UPSTREAM = "host.docker.internal:3000";

interface HttpBlockOptions {
  /** host:port Caddy proxies forward_auth + reserved-path requests to. */
  authzUpstream?: string;
  /** host:port the per-site access log streams to (Caddy `output net`).
   *  When set, every HTTP site emits structured JSON access logs to the
   *  control-plane edge-log sink. Absent ⇒ no access logging (and existing
   *  callers/tests are unaffected). See packages/api/src/edge-logs. */
  edgeLogSink?: string;
  /** When true, emit the `crowdsec` IP-reputation handler on the site. The
   *  matching global `crowdsec { … }` app config + `order crowdsec first`
   *  are emitted by buildCaddyfile. Identity-blind — runs before
   *  forward_auth. See docs/designs/deployment-protection.md §10. */
  crowdsec?: boolean;
}

/** CrowdSec LAPI connection for the global Caddy `crowdsec` app config. */
export interface CrowdsecConfig {
  apiUrl: string;
  apiKey: string;
}

/** Global-block lines for the CrowdSec bouncer app: `order crowdsec first`
 *  so the per-site handler runs ahead of forward_auth/reverse_proxy, plus
 *  the LAPI connection. Emitted once, in the global options block. */
function crowdsecGlobalLines(cfg: CrowdsecConfig): string[] {
  return [
    "\torder crowdsec first",
    "\tcrowdsec {",
    `\t\tapi_url ${cfg.apiUrl}`,
    `\t\tapi_key ${cfg.apiKey}`,
    "\t}",
  ];
}

/** Global-block lines for the operational log plane (Phase 3): ship Caddy's
 *  default logger (TLS/ACME lifecycle, reverse_proxy errors, config events) to
 *  the same edge-log sink as the per-site access logs. The two use different
 *  loggers, so access logs are NOT duplicated here — see edge-logs/ingest.ts
 *  for the access-vs-event split. */
function edgeLogGlobalLines(sink: string): string[] {
  return ["\tlog {", `\t\toutput net ${sink}`, "\t\tformat json", "\t}"];
}

/** Mirror every site's access logs to a rolled JSON file for the CrowdSec
 *  agent to parse (http scenarios: brute force, CVE probes, crawlers). A
 *  single global capture logger — `include http.log.access` matches every
 *  per-site access logger — so no site block changes. The file lands on the
 *  shared `otterdeploy-caddy-logs` volume the agent reads read-only; see the
 *  crowdsec service's acquis config in docker-compose.yml. */
function crowdsecAccessFileLines(): string[] {
  return [
    "\tlog crowdsec-access {",
    "\t\tinclude http.log.access",
    "\t\toutput file /var/log/caddy/access.json {",
    "\t\t\troll_size 20MiB",
    "\t\t\troll_keep 2",
    "\t\t}",
    "\t\tformat json",
    "\t}",
  ];
}

/** Single source of truth for the global block. ACME registration email
 *  is required by Let's Encrypt for any non-internal cert; omitted when
 *  no usesAcme route exists so a pure-internal install doesn't need to
 *  configure an email. */
export interface CaddyfileOptions {
  adminBind?: string;
  acmeEmail?: string | null;
}

export function buildHttpBlock(route: ProxyRouteInput, options: HttpBlockOptions = {}): string {
  const lines = [`${route.domain} {`];
  // Operator-uploaded cert wins over both ACME and `tls internal` — Caddy
  // serves exactly this pair and never tries to manage the domain itself.
  if (route.customCert) {
    lines.push(`\ttls ${route.customCert.certPath} ${route.customCert.keyPath}`);
  } else if (!route.usesAcme) {
    // Pre-Phase-2 the global `local_certs` covered everything; now we
    // emit per-site `tls internal` for any route that hasn't earned ACME
    // so the global block can drop `local_certs` (which conflicts with
    // ACME issuance).
    lines.push("\ttls internal");
  }

  // Structured access logging → the edge-log sink (live tail + metrics).
  if (options.edgeLogSink) {
    lines.push("\tlog {");
    lines.push(`\t\toutput net ${options.edgeLogSink}`);
    lines.push("\t\tformat json");
    lines.push("\t}");
    // Append the chosen reverse_proxy upstream to each access-log entry — the
    // placeholder resolves at log-write time (after the proxy dials), so the
    // edge-log parser can populate the `upstream` field. Empty for static /
    // non-proxied responses.
    lines.push("\tlog_append upstream {http.reverse_proxy.upstream.hostport}");
    // Generate a request id: returned to the client + logged (resp_headers)
    // and forwarded to the app for end-to-end tracing.
    lines.push("\theader X-Request-Id {http.request.uuid}");
    lines.push("\trequest_header X-Request-Id {http.request.uuid}");
  }

  // CrowdSec IP-reputation gate — runs first (global `order crowdsec first`),
  // before forward_auth. Identity-blind: blocks banned IPs with 403.
  if (options.crowdsec) {
    lines.push("\tcrowdsec");
  }

  if (route.protected) {
    const authzUpstream = options.authzUpstream ?? DEFAULT_AUTHZ_UPSTREAM;
    // Ungated reserved-path handle FIRST: the auth-handoff callback must
    // run on this domain (to Set-Cookie for it) and must not be gated by
    // the very wall it exists to satisfy.
    lines.push(`\thandle ${RESERVED_AUTH_PREFIX}/* {`);
    lines.push(`\t\treverse_proxy ${authzUpstream}`);
    lines.push("\t}");
    // Everything else: forward_auth gate, then the app. forward_auth
    // copies the request (incl. Cookie) to the control plane; 2xx ⇒
    // proceed, any other status (e.g. 302 → login) ⇒ relayed to the
    // browser. The domain is baked into the uri so the endpoint never
    // trusts a client-set header for *which* deployment.
    lines.push("\thandle {");
    // Strip any client-supplied identity headers BEFORE the gate. copy_headers
    // only overwrites headers the auth response actually sets; on the
    // share/bypass/guest paths it doesn't set Remote-User, so without this an
    // attacker could inject one and spoof identity to the backend app.
    lines.push("\t\trequest_header -Remote-User");
    lines.push("\t\trequest_header -Remote-Email");
    lines.push(`\t\tforward_auth ${authzUpstream} {`);
    lines.push(`\t\t\turi ${DEPLOY_AUTHZ_PATH}?domain=${encodeURIComponent(route.domain)}`);
    lines.push("\t\t\tcopy_headers Remote-User Remote-Email");
    lines.push("\t\t}");
    lines.push(`\t\treverse_proxy ${route.upstreamHost}:${route.upstreamPort}`);
    lines.push("\t}");
  } else {
    lines.push(`\treverse_proxy ${route.upstreamHost}:${route.upstreamPort}`);
  }

  // Operator-authored directives, spliced at the site-block level. Caddy
  // orders handler directives by its built-in directive order regardless of
  // source position, so placement here is safe for the common cases (header,
  // encode, rate_limit, basic_auth). A parse error is caught by the per-
  // project /adapt pass in the reconciler.
  if (route.customDirectives && route.customDirectives.trim().length > 0) {
    lines.push(indentDirectives(route.customDirectives));
  }

  lines.push("}");
  return lines.join("\n");
}

interface GlobalBlockOptions {
  /** The `admin` line body: `admin <bind>` or `admin off`. */
  adminLine: string;
  acmeEmail?: string | null;
  anyUsesAcme: boolean;
  /** false ⇒ emit `auto_https disable_redirects` (operator runs HTTP→HTTPS
   *  elsewhere). Undefined/true keeps Caddy's default auto-redirect. */
  httpsAutoRedirect?: boolean | null;
  crowdsec?: CrowdsecConfig;
  edgeLogSink?: string;
  layer4Routes: ProxyRouteInput[];
}

/** The global `{ … }` block (incl. its closing brace). Only registers `email`
 *  when a route wants ACME — Caddy errors on `email` + `local_certs` together,
 *  so pure-internal installs keep the `local_certs` shortcut instead. */
function buildGlobalBlock(o: GlobalBlockOptions): string[] {
  const lines = ["{", `\t${o.adminLine}`];
  if (o.anyUsesAcme && o.acmeEmail) {
    lines.push(`\temail ${o.acmeEmail}`);
  }
  if (!o.anyUsesAcme) {
    lines.push("\tlocal_certs");
  }
  if (o.httpsAutoRedirect === false) {
    lines.push("\tauto_https disable_redirects");
  }
  if (o.crowdsec) {
    lines.push(...crowdsecGlobalLines(o.crowdsec));
  }
  if (o.edgeLogSink) {
    lines.push(...edgeLogGlobalLines(o.edgeLogSink));
  }
  // Access-log file for CrowdSec's parsers: only when the bouncer is wired
  // (no point writing files nobody reads) AND sites emit access logs at all
  // (they only do when the edge-log sink is configured).
  if (o.crowdsec && o.edgeLogSink) {
    lines.push(...crowdsecAccessFileLines());
  }
  if (o.layer4Routes.length > 0) {
    lines.push(buildLayer4Block(o.layer4Routes));
  }
  lines.push("}");
  return lines;
}

/** One HTTP site block per http route, each preceded by a blank separator. */
function buildHttpSiteBlocks(
  httpRoutes: ProxyRouteInput[],
  options: { authzUpstream?: string; edgeLogSink?: string; crowdsec?: CrowdsecConfig },
): string[] {
  const lines: string[] = [];
  for (const route of httpRoutes) {
    lines.push("");
    lines.push(
      buildHttpBlock(route, {
        authzUpstream: options.authzUpstream,
        edgeLogSink: options.edgeLogSink,
        crowdsec: Boolean(options.crowdsec),
      }),
    );
  }
  return lines;
}

export function buildCaddyfile(
  routes: ProxyRouteInput[],
  adminBind: string,
  options: {
    acmeEmail?: string | null;
    authzUpstream?: string;
    edgeLogSink?: string;
    crowdsec?: CrowdsecConfig;
    /** false ⇒ emit `auto_https disable_redirects` (operator runs HTTP→HTTPS
     *  elsewhere). Undefined/true keeps Caddy's default auto-redirect. */
    httpsAutoRedirect?: boolean | null;
    /** Operator-authored, already-validated standalone Caddyfile blocks
     *  (one entry per project that has custom config), appended verbatim
     *  after the generated site blocks. */
    customBlocks?: string[];
  } = {},
): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");
  // A custom-cert route never triggers ACME (Caddy serves the uploaded pair),
  // so it does not force the global registration email on its own.
  const anyUsesAcme = routes.some((r) => r.usesAcme && !r.customCert);

  const lines = buildGlobalBlock({
    adminLine: `admin ${adminBind}`,
    acmeEmail: options.acmeEmail,
    anyUsesAcme,
    httpsAutoRedirect: options.httpsAutoRedirect,
    crowdsec: options.crowdsec,
    edgeLogSink: options.edgeLogSink,
    layer4Routes,
  });
  lines.push(...buildHttpSiteBlocks(httpRoutes, options));
  lines.push(...buildLayer4SiteBlocks(layer4Routes));

  for (const block of options.customBlocks ?? []) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    lines.push("");
    lines.push(trimmed);
  }

  return lines.join("\n") + "\n";
}

export function buildProjectFragment(
  routes: ProxyRouteInput[],
  options: {
    acmeEmail?: string | null;
    authzUpstream?: string;
    edgeLogSink?: string;
    crowdsec?: CrowdsecConfig;
    /** Operator-authored standalone Caddyfile blocks for this project,
     *  appended after the generated blocks and validated together with them. */
    customConfig?: string | null;
  } = {},
): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");
  const customConfig = options.customConfig?.trim() ?? "";

  if (httpRoutes.length === 0 && layer4Routes.length === 0 && customConfig.length === 0) {
    return "";
  }

  // A custom-cert route never triggers ACME (Caddy serves the uploaded pair),
  // so it does not force the global registration email on its own.
  const anyUsesAcme = routes.some((r) => r.usesAcme && !r.customCert);
  const lines = buildGlobalBlock({
    adminLine: "admin off",
    acmeEmail: options.acmeEmail,
    anyUsesAcme,
    crowdsec: options.crowdsec,
    edgeLogSink: options.edgeLogSink,
    layer4Routes,
  });
  lines.push(...buildHttpSiteBlocks(httpRoutes, options));
  lines.push(...buildLayer4SiteBlocks(layer4Routes));

  if (customConfig.length > 0) {
    lines.push("");
    lines.push(customConfig);
  }

  return lines.join("\n") + "\n";
}
