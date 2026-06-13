import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@otterdeploy/db";
import {
  PLATFORM_SETTINGS_ID,
  platformSettings,
} from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import type { ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import {
  buildProjectFragment,
  type CrowdsecConfig,
  type ProxyRouteInput,
} from "./builder";
import { adaptCaddyfile, loadCaddyfile } from "./client";
import {
  listEnabledProxyRoutes,
  listProxyRoutesByProject,
  type ProxyRouteRecord,
} from "./queries";
import { reconcileRoutes, type ReconcileResult } from "./reconciler";

export type { ReconcileResult } from "./reconciler";
export type { ProxyRouteInput } from "./builder";

/** Map a DB proxy-route row onto the builder's route-input shape. Shared by
 *  the live reconcile pass and the read-only per-project render so both
 *  surfaces stay byte-identical. */
function toRouteInput(r: ProxyRouteRecord): ProxyRouteInput {
  return {
    projectId: r.projectId,
    type: r.type,
    domain: r.domain,
    upstreamHost: r.upstreamHost,
    upstreamPort: r.upstreamPort,
    protocol: r.protocol,
    layer4Alpn: r.layer4Alpn,
    usesAcme: r.usesAcme,
    protected: r.protected,
  };
}

interface CaddyBuildOptions {
  acmeEmail: string | null;
  authzUpstream: string;
  edgeLogSink?: string;
  crowdsec?: CrowdsecConfig;
}

/** Resolve the build options every render shares: the ACME registration
 *  email from platform settings (required for any Let's Encrypt route) plus
 *  the env-driven authz upstream, edge-log sink, and CrowdSec connection.
 *  Read on every call so a settings change takes effect without a restart. */
async function loadCaddyOptions(): Promise<CaddyBuildOptions> {
  const [settings] = await db
    .select({ acmeEmail: platformSettings.acmeEmail })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return {
    acmeEmail: settings?.acmeEmail ?? null,
    authzUpstream: env.DEPLOY_AUTHZ_UPSTREAM,
    edgeLogSink: env.EDGE_LOG_SINK,
    crowdsec:
      env.CROWDSEC_LAPI_URL && env.CROWDSEC_BOUNCER_KEY
        ? { apiUrl: env.CROWDSEC_LAPI_URL, apiKey: env.CROWDSEC_BOUNCER_KEY }
        : undefined,
  };
}

export async function reconcile(rlog?: RequestLogger): Promise<ReconcileResult> {
  const log = asStepLogger(rlog);
  log.info({ caddy: { step: "fetch-routes" } });
  const records = await listEnabledProxyRoutes();
  log.info({ caddy: { step: "fetch-routes", count: records.length } });

  const routes = records.map(toRouteInput);
  const options = await loadCaddyOptions();

  return reconcileRoutes({
    routes,
    adminBind: env.CADDY_ADMIN_BIND,
    ...options,
    adapt: (caddyfile) => adaptCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog),
    load: (caddyfile) => loadCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog),
    rlog,
  });
}

export interface ProjectCaddyfile {
  caddyfile: string;
  revision: string;
}

/** Render the live Caddyfile fragment a single project contributes to the
 *  edge config — the exact `buildProjectFragment` output the reconciler
 *  validates per project and assembles into the global file — for read-only
 *  display in the dashboard. Only enabled routes are rendered, mirroring
 *  the reconciler (disabled routes never reach Caddy). `revision` is the
 *  same short SHA the reconciler stamps, so the UI can detect drift. */
export async function renderProjectCaddyfile(
  projectId: ProjectId,
): Promise<ProjectCaddyfile> {
  const records = await listProxyRoutesByProject(projectId);
  const routes = records.filter((r) => r.enabled).map(toRouteInput);
  const options = await loadCaddyOptions();
  const caddyfile = buildProjectFragment(routes, options);
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);
  return { caddyfile, revision };
}
