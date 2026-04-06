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

export function buildLayer4Route(route: ProxyRouteInput): string {
  const matcherName = `pg_${sanitizeMatcherName(route.domain)}`;
  const alpn = route.layer4Alpn ?? "postgresql";

  return [
    `@${matcherName} tls {`,
    `\talpn ${alpn}`,
    `\tsni ${route.domain}`,
    "}",
    `route @${matcherName} {`,
    "\ttls {",
    "\t\tconnection_policy {",
    `\t\t\talpn ${alpn}`,
    "\t\t}",
    "\t}",
    `\tproxy ${route.upstreamHost}:${route.upstreamPort}`,
    "}",
  ].join("\n");
}

export function buildGlobalBlock(layer4Routes: ProxyRouteInput[], adminBind: string): string {
  const lines = ["{", `\tadmin ${adminBind}`];

  if (layer4Routes.length > 0) {
    lines.push("\tservers {");
    lines.push("\t\tlistener_wrappers {");
    lines.push("\t\t\tlayer4 {");
    for (const route of layer4Routes) {
      const routeLines = buildLayer4Route(route).split("\n");
      for (const line of routeLines) {
        lines.push(`\t\t\t\t${line}`);
      }
    }
    lines.push("\t\t\t}");
    lines.push("\t\t\ttls");
    lines.push("\t\t}");
    lines.push("\t}");
  }

  lines.push("}");
  return lines.join("\n");
}

export function buildCaddyfile(routes: ProxyRouteInput[], adminBind: string): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  const sections: string[] = [buildGlobalBlock(layer4Routes, adminBind)];

  for (const route of httpRoutes) {
    sections.push(buildHttpBlock(route));
  }

  return sections.join("\n\n") + "\n";
}

export function buildProjectFragment(routes: ProxyRouteInput[]): string {
  const httpRoutes = routes.filter((r) => r.type === "http");
  const layer4Routes = routes.filter((r) => r.type === "layer4");

  const sections: string[] = [];

  for (const route of httpRoutes) {
    sections.push(buildHttpBlock(route));
  }

  for (const route of layer4Routes) {
    sections.push(buildLayer4Route(route));
  }

  return sections.join("\n\n");
}
