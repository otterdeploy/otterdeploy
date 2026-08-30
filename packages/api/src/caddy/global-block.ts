/**
 * The global `{ … }` block: everything that configures Caddy itself rather
 * than a site.
 *
 * Split from ./builder on the file cap. It is also the one part of the config
 * where ORDER carries meaning rather than just style — the trusted-proxy
 * stanza has to be in place before the CrowdSec gate, because the gate decides
 * using the client address and that address is only right once Caddy has been
 * told which hop in front of it to believe.
 */
import type { CrowdsecConfig, ProxyRouteInput } from "./types";

import { buildLayer4Block } from "./layer4";
import { trustedProxyLines } from "./trusted-proxies";

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
 *  loggers, so access logs are NOT duplicated here. See edge-logs/ingest.ts
 *  for the access-vs-event split. */
function edgeLogGlobalLines(sink: string): string[] {
  return ["\tlog {", `\t\toutput net ${sink}`, "\t\tformat json", "\t}"];
}

/** Mirror every site's access logs to a rolled JSON file for the CrowdSec
 *  agent to parse (http scenarios: brute force, CVE probes, crawlers). A
 *  single global capture logger: `include http.log.access` matches every
 *  per-site access logger, so no site block changes. The file lands on the
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
  /** Operator-declared hops in front of Caddy (CDN / upstream LB), as CIDRs.
   *  Null or empty ⇒ Caddy attributes every request to its TCP peer. */
  trustedProxies?: string | null;
  layer4Routes: ProxyRouteInput[];
}

/** The global `{ … }` block (incl. its closing brace). Only registers `email`
 *  when a route wants ACME. Caddy errors on `email` + `local_certs` together,
 *  so pure-internal installs keep the `local_certs` shortcut instead. */
export function buildGlobalBlock(o: GlobalBlockOptions): string[] {
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
  // Before CrowdSec's stanza on purpose: the gate decides using the client
  // address, so the address had better already be the right one.
  lines.push(...trustedProxyLines(o.trustedProxies));
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
