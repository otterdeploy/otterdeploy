import type { orpc } from "@/shared/server/orpc";

export type ResourceListItem = Awaited<
  ReturnType<typeof orpc.project.resource.list.call>
>[number];
export type ProxyRouteItem = Awaited<
  ReturnType<typeof orpc.project.proxyRoute.list.call>
>[number];

export interface RouteRow {
  id: string;
  name: string;
  kind: "service" | "database" | "platform";
  internalHost: string;
  internalPort: number;
  domain: string;
  publicHost: string;
  tls: "letsencrypt" | "internal";
  enabled: boolean;
  isHttp: boolean;
  protected: boolean;
  customDirectives: string | null;
}

export interface RouteGroup {
  key: string;
  name: string;
  kind: RouteRow["kind"];
  internalHost: string;
  internalPort: number;
  routes: RouteRow[];
}

export function mapRoute(
  route: ProxyRouteItem,
  byResourceId: Map<string, ResourceListItem>,
): RouteRow {
  const resource = route.resourceId ? byResourceId.get(route.resourceId) : null;
  const kind: RouteRow["kind"] = resource
    ? resource.type === "database"
      ? "database"
      : "service"
    : "platform";
  const name = resource?.name ?? deriveNameFromUpstream(route.upstreamHost);
  const isHttp = route.type === "http";
  const publicHost = isHttp
    ? `https://${route.domain}`
    : `${route.domain}:${route.upstreamPort}`;
  return {
    id: route.id,
    name,
    kind,
    internalHost: route.upstreamHost,
    internalPort: route.upstreamPort,
    domain: route.domain,
    publicHost,
    tls: route.usesAcme ? "letsencrypt" : "internal",
    enabled: route.enabled,
    isHttp,
    protected: route.protected,
    customDirectives: route.customDirectives ?? null,
  };
}

function deriveNameFromUpstream(host: string): string {
  // Upstream hosts look like "<resource>.<project>.otterdeploy.internal". Surface
  // the leading label so platform routes (no resourceId) still show something
  // human-readable.
  const label = host.split(".")[0];
  return label && label.length > 0 ? label : host;
}

// Group routes by service so a multi-domain service collapses into one header
// instead of repeating its name + internal address on every row.
export function groupRoutes(rows: RouteRow[]): RouteGroup[] {
  const map = new Map<string, RouteGroup>();
  for (const r of rows) {
    const key = `${r.name}@${r.internalHost}:${r.internalPort}`;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        name: r.name,
        kind: r.kind,
        internalHost: r.internalHost,
        internalPort: r.internalPort,
        routes: [],
      };
      map.set(key, group);
    }
    group.routes.push(r);
  }
  return Array.from(map.values());
}
