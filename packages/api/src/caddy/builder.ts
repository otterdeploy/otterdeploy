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
}

/** Single source of truth for the global block. ACME registration email
 *  is required by Let's Encrypt for any non-internal cert; omitted when
 *  no usesAcme route exists so a pure-internal install doesn't need to
 *  configure an email. */
export interface CaddyfileOptions {
  adminBind?: string;
  acmeEmail?: string | null;
}

export function sanitizeMatcherName(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function buildHttpBlock(route: ProxyRouteInput): string {
  const lines = [`${route.domain} {`];
  // Pre-Phase-2 the global `local_certs` covered everything; now we
  // emit per-site `tls internal` for any route that hasn't earned ACME
  // so the global block can drop `local_certs` (which conflicts with
  // ACME issuance).
  if (!route.usesAcme) {
    lines.push("\ttls internal");
  }
  lines.push(`\treverse_proxy ${route.upstreamHost}:${route.upstreamPort}`);
  lines.push("}");
  return lines.join("\n");
}

export function buildLayer4Block(routes: ProxyRouteInput[], listenPort = ":5432"): string {
  const lines = [`\t${listenPort} {`];

  for (const route of routes) {
    const name = sanitizeMatcherName(route.domain);
    lines.push(`\t\t@${name} tls sni ${route.domain}`);
    lines.push(`\t\troute @${name} {`);
    lines.push("\t\t\ttls {");
    lines.push("\t\t\t\tconnection_policy {");
    lines.push("\t\t\t\t\talpn postgresql");
    lines.push("\t\t\t\t}");
    lines.push("\t\t\t}");
    lines.push(`\t\t\tproxy ${route.upstreamHost}:${route.upstreamPort}`);
    lines.push("\t\t}");
  }

  lines.push("\t}");
  return lines.join("\n");
}

export function buildCaddyfile(
  routes: ProxyRouteInput[],
  adminBind: string,
  options: { acmeEmail?: string | null } = {},
): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");
  const anyUsesAcme = routes.some((r) => r.usesAcme);

  // Global block: only register `email` when at least one route wants
  // ACME — Caddy errors on `email` with `local_certs` together, and the
  // SaaS install with all-real-domains doesn't want local_certs for
  // anything. Pure-internal installs keep the old `local_certs` shortcut.
  const lines = ["{", `\tadmin ${adminBind}`];
  if (anyUsesAcme && options.acmeEmail) {
    lines.push(`\temail ${options.acmeEmail}`);
  }
  if (!anyUsesAcme) {
    lines.push("\tlocal_certs");
  }

  if (layer4Routes.length > 0) {
    lines.push("\tlayer4 {");
    lines.push(buildLayer4Block(layer4Routes));
    lines.push("\t}");
  }

  lines.push("}");

  for (const route of httpRoutes) {
    lines.push("");
    lines.push(buildHttpBlock(route));
  }

  // Layer4 needs an HTTPS site block per domain (Caddy issues the cert
  // there even though traffic is proxied raw by the layer4 module). Split
  // by usesAcme so the verified domains get real certs and the unverified
  // ones stay self-signed without polluting the global block.
  const tlsInternalDomains = layer4Routes
    .filter((r) => !r.usesAcme)
    .map((r) => r.domain);
  if (tlsInternalDomains.length > 0) {
    lines.push("");
    lines.push(`${tlsInternalDomains.join(", ")} {`);
    lines.push("\ttls internal");
    lines.push('\trespond "ok" 200');
    lines.push("}");
  }
  const acmeDomains = layer4Routes
    .filter((r) => r.usesAcme)
    .map((r) => r.domain);
  if (acmeDomains.length > 0) {
    // No explicit `tls` block — Caddy defaults to ACME using the global
    // email + the default Let's Encrypt issuer.
    lines.push("");
    lines.push(`${acmeDomains.join(", ")} {`);
    lines.push('\trespond "ok" 200');
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}

export function buildProjectFragment(
  routes: ProxyRouteInput[],
  options: { acmeEmail?: string | null } = {},
): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  if (httpRoutes.length === 0 && layer4Routes.length === 0) {
    return "";
  }

  const anyUsesAcme = routes.some((r) => r.usesAcme);
  const lines = ["{", "\tadmin off"];
  if (anyUsesAcme && options.acmeEmail) {
    lines.push(`\temail ${options.acmeEmail}`);
  }
  if (!anyUsesAcme) {
    lines.push("\tlocal_certs");
  }

  if (layer4Routes.length > 0) {
    lines.push("\tlayer4 {");
    lines.push(buildLayer4Block(layer4Routes));
    lines.push("\t}");
  }

  lines.push("}");

  for (const route of httpRoutes) {
    lines.push("");
    lines.push(buildHttpBlock(route));
  }

  const tlsInternalDomains = layer4Routes
    .filter((r) => !r.usesAcme)
    .map((r) => r.domain);
  if (tlsInternalDomains.length > 0) {
    lines.push("");
    lines.push(`${tlsInternalDomains.join(", ")} {`);
    lines.push("\ttls internal");
    lines.push('\trespond "ok" 200');
    lines.push("}");
  }
  const acmeDomains = layer4Routes
    .filter((r) => r.usesAcme)
    .map((r) => r.domain);
  if (acmeDomains.length > 0) {
    lines.push("");
    lines.push(`${acmeDomains.join(", ")} {`);
    lines.push('\trespond "ok" 200');
    lines.push("}");
  }

  return lines.join("\n") + "\n";
}
