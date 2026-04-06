import { env } from "@otterstack/env/server";

import type { ProxyRouteInput } from "./builder";
import { adaptCaddyfile, loadCaddyfile } from "./client";
import { listEnabledProxyRoutes } from "./queries";
import { reconcileRoutes, type ReconcileResult } from "./reconciler";

export type { ReconcileResult } from "./reconciler";
export type { ProxyRouteInput } from "./builder";

export async function reconcile(): Promise<ReconcileResult> {
  const records = await listEnabledProxyRoutes();

  const routes: ProxyRouteInput[] = records.map((r) => ({
    projectId: r.projectId,
    type: r.type,
    domain: r.domain,
    upstreamHost: r.upstreamHost,
    upstreamPort: r.upstreamPort,
    protocol: r.protocol,
    layer4Alpn: r.layer4Alpn,
  }));

  return reconcileRoutes({
    routes,
    adminBind: env.CADDY_ADMIN_BIND,
    adapt: (caddyfile) => adaptCaddyfile(caddyfile, env.CADDY_ADMIN_URL),
    load: (caddyfile) => loadCaddyfile(caddyfile, env.CADDY_ADMIN_URL),
  });
}
