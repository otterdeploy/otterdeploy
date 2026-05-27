import { eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import {
  PLATFORM_SETTINGS_ID,
  platformSettings,
} from "@otterstack/db/schema/platform";
import { env } from "@otterstack/env/server";
import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import type { ProxyRouteInput } from "./builder";
import { adaptCaddyfile, loadCaddyfile } from "./client";
import { listEnabledProxyRoutes } from "./queries";
import { reconcileRoutes, type ReconcileResult } from "./reconciler";

export type { ReconcileResult } from "./reconciler";
export type { ProxyRouteInput } from "./builder";

export async function reconcile(rlog?: RequestLogger): Promise<ReconcileResult> {
  const log = asStepLogger(rlog);
  log.info({ caddy: { step: "fetch-routes" } });
  const records = await listEnabledProxyRoutes();
  log.info({ caddy: { step: "fetch-routes", count: records.length } });

  const routes: ProxyRouteInput[] = records.map((r) => ({
    projectId: r.projectId,
    type: r.type,
    domain: r.domain,
    upstreamHost: r.upstreamHost,
    upstreamPort: r.upstreamPort,
    protocol: r.protocol,
    layer4Alpn: r.layer4Alpn,
    usesAcme: r.usesAcme,
  }));

  // ACME registration email — required for any route that wants a real
  // cert from Let's Encrypt. Reconcile reads it on every pass so a change
  // in platform settings takes effect on the next route insert/update
  // without restarting the server.
  const [settings] = await db
    .select({ acmeEmail: platformSettings.acmeEmail })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return reconcileRoutes({
    routes,
    adminBind: env.CADDY_ADMIN_BIND,
    acmeEmail: settings?.acmeEmail ?? null,
    adapt: (caddyfile) => adaptCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog),
    load: (caddyfile) => loadCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog),
    rlog,
  });
}
