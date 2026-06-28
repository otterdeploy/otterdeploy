/**
 * Layer4 (TLS-SNI) Caddyfile fragments for public databases. Split out of
 * `./builder.ts` to keep that file focused on the HTTP/global blocks; the
 * public `sanitizeMatcherName` / `buildLayer4Block` exports are re-exported
 * from `./builder` so existing import sites are unaffected.
 */

import type { ProxyRouteInput } from "./builder";

export function sanitizeMatcherName(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// The layer4 routing for public databases lives in a `layer4` *listener
// wrapper*, not a standalone listener — it wraps the HTTP server's existing
// :443 listener (the trailing `tls` wrapper terminates everything the layer4
// wrapper doesn't consume). So public Postgres rides on :443 by TLS-SNI next
// to HTTP, with no second port. Emitted inside the global `{ }` block.
export function buildLayer4Block(routes: ProxyRouteInput[]): string {
  const lines = ["\tservers {", "\t\tlistener_wrappers {", "\t\t\tlayer4 {"];

  for (const route of routes) {
    const name = sanitizeMatcherName(route.domain);
    const alpn = route.layer4Alpn;
    // Match by SNI *and* ALPN. A bare-SNI match would also catch this domain's
    // ACME TLS-ALPN-01 challenge (ALPN `acme-tls/1`) and route it to the proxy,
    // so the cert could never issue. Scoping to the engine's ALPN lets the
    // challenge fall through to the `tls` wrapper, which answers it.
    lines.push(`\t\t\t\t@${name} tls {`);
    if (alpn) lines.push(`\t\t\t\t\talpn ${alpn}`);
    lines.push(`\t\t\t\t\tsni ${route.domain}`);
    lines.push("\t\t\t\t}");
    lines.push(`\t\t\t\troute @${name} {`);
    // Terminate TLS here (Caddy presents the domain's managed cert) and proxy
    // plaintext to the engine over the overlay network.
    if (alpn) {
      lines.push("\t\t\t\t\ttls {");
      lines.push("\t\t\t\t\t\tconnection_policy {");
      lines.push(`\t\t\t\t\t\t\talpn ${alpn}`);
      lines.push("\t\t\t\t\t\t}");
      lines.push("\t\t\t\t\t}");
    }
    lines.push(`\t\t\t\t\tproxy ${route.upstreamHost}:${route.upstreamPort}`);
    lines.push("\t\t\t\t}");
  }

  lines.push("\t\t\t}");
  lines.push("\t\t\ttls");
  lines.push("\t\t}");
  lines.push("\t}");
  return lines.join("\n");
}

/** Layer4 needs an HTTPS site block per domain (Caddy issues the cert there
 *  even though traffic is proxied raw by the layer4 module). Split by usesAcme
 *  so verified domains get real certs and unverified ones stay self-signed
 *  without polluting the global block. */
export function buildLayer4SiteBlocks(layer4Routes: ProxyRouteInput[]): string[] {
  const lines: string[] = [];
  const tlsInternalDomains = layer4Routes.filter((r) => !r.usesAcme).map((r) => r.domain);
  if (tlsInternalDomains.length > 0) {
    lines.push("");
    lines.push(`${tlsInternalDomains.join(", ")} {`);
    lines.push("\ttls internal");
    lines.push('\trespond "ok" 200');
    lines.push("}");
  }
  const acmeDomains = layer4Routes.filter((r) => r.usesAcme).map((r) => r.domain);
  if (acmeDomains.length > 0) {
    // No explicit `tls` block — Caddy defaults to ACME using the global
    // email + the default Let's Encrypt issuer.
    lines.push("");
    lines.push(`${acmeDomains.join(", ")} {`);
    lines.push('\trespond "ok" 200');
    lines.push("}");
  }
  return lines;
}
