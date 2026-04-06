export type ProxyRouteInput = {
  projectId: string;
  type: "http" | "layer4";
  domain: string;
  upstreamHost: string;
  upstreamPort: number;
  protocol: "tcp" | "http";
  layer4Alpn: string | null;
};

export function sanitizeMatcherName(domain: string): string {
  return domain.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function buildHttpBlock(route: ProxyRouteInput): string {
  return [
    `${route.domain} {`,
    `\treverse_proxy ${route.upstreamHost}:${route.upstreamPort}`,
    "}",
  ].join("\n");
}

export function buildLayer4Block(routes: ProxyRouteInput[], listenPort = ":443"): string {
  const lines = [`\t${listenPort} {`];

  for (const route of routes) {
    const name = sanitizeMatcherName(route.domain);
    lines.push(`\t\t@${name} tls sni ${route.domain}`);
    lines.push(`\t\troute @${name} {`);
    lines.push("\t\t\ttls");
    lines.push(`\t\t\tproxy ${route.upstreamHost}:${route.upstreamPort}`);
    lines.push("\t\t}");
  }

  lines.push("\t}");
  return lines.join("\n");
}

export function buildCaddyfile(routes: ProxyRouteInput[], adminBind: string): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  const lines = ["{", `\tadmin ${adminBind}`];

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

  return lines.join("\n") + "\n";
}

export function buildProjectFragment(routes: ProxyRouteInput[]): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  if (httpRoutes.length === 0 && layer4Routes.length === 0) {
    return "";
  }

  // For validation, wrap in a minimal Caddyfile
  const lines = ["{", "\tadmin off"];

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

  return lines.join("\n") + "\n";
}
