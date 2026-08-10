import type { ProjectId, ServerId } from "@otterdeploy/shared/id";
import type { RoutePolicy } from "@otterdeploy/shared/route-policy";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { asStepLogger } from "../lib/logger";
import { crowdsecConfig } from "../lib/platform-runtime-settings";
import { listAllServers } from "../routers/server/queries";
import { isSwarmRuntime } from "../runtime";
import { ensureEdgeOnProjectNetworks } from "../swarm/client";
import {
  buildCaddyfile,
  buildProjectFragment,
  type CrowdsecConfig,
  type ProxyRouteInput,
} from "./builder";
import {
  applyCustomCertsToRoutes,
  listServableCustomCerts,
  mapProjectOrganizations,
  materializeCustomCerts,
} from "./certs";
import { adaptCaddyfile } from "./client";
import { CONTROL_PLANE_ROUTE_POLICY } from "./control-plane-policy";
import { maskCaddySecrets, stripGlobalBlock } from "./display";
import { reconcileNodeEdges, type NodeEdgeResult, type PlacedRoute } from "./node-reconciler";
import {
  listEnabledProxyRoutes,
  listEnabledRoutePlacements,
  listProxyRoutesByProject,
  updateProxyRoute,
  type ProxyRouteRecord,
} from "./queries";
import { reconcileRoutes, type ReconcileResult } from "./reconciler";
import { loadWithEdgeSelfHeal } from "./self-heal";

export type { ReconcileResult } from "./reconciler";
export type { ProxyRouteInput } from "./builder";
export { CONTROL_PLANE_ROUTE_POLICY } from "./control-plane-policy";

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
    routePolicy: r.routePolicy,
  };
}

interface CaddyBuildOptions {
  acmeEmail: string | null;
  httpsAutoRedirect: boolean | null;
  authzUpstream: string;
  edgeLogSink?: string;
  crowdsec?: CrowdsecConfig;
  /** platform_settings.controlPlaneFqdn, when set — reconcile turns it into
   *  a synthetic site block fronting the dashboard/API itself. Only
   *  consumed by reconcile(); the per-project renders ignore it. */
  controlPlane?: { domain: string; usesAcme: boolean };
}

/** Resolve the build options every render shares: the ACME registration
 *  email from platform settings (required for any Let's Encrypt route) plus
 *  the env-driven authz upstream, edge-log sink, and CrowdSec connection.
 *  Read on every call so a settings change takes effect without a restart. */
async function loadCaddyOptions(): Promise<CaddyBuildOptions> {
  const [settings] = await db
    .select({
      acmeEmail: platformSettings.acmeEmail,
      httpsAutoRedirect: platformSettings.httpsAutoRedirect,
      controlPlaneFqdn: platformSettings.controlPlaneFqdn,
      controlPlaneFqdnVerifiedAt: platformSettings.controlPlaneFqdnVerifiedAt,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
    .limit(1);

  return {
    acmeEmail: settings?.acmeEmail ?? null,
    httpsAutoRedirect: settings?.httpsAutoRedirect ?? null,
    authzUpstream: env.DEPLOY_AUTHZ_UPSTREAM,
    edgeLogSink: env.EDGE_LOG_SINK,
    // Settings-backed (env seeds it): saving credentials or flipping the
    // toggle in Settings → Firewall re-renders the global block + per-site
    // gate on the next reconcile, with no .env edit.
    crowdsec: (await crowdsecConfig()) ?? undefined,
    controlPlane: settings?.controlPlaneFqdn
      ? {
          domain: settings.controlPlaneFqdn,
          // ACME only after TXT verification — an unproven name stays on
          // tls internal, same gate every proxy route obeys.
          usesAcme: settings.controlPlaneFqdnVerifiedAt != null,
        }
      : undefined,
  };
}

/** Pseudo project id the control-plane site block is grouped under in the
 *  reconciler (per-"project" adapt validation + skip reporting). Never
 *  collides with real ids, which are `project_`-prefixed. */
export const CONTROL_PLANE_PROJECT_ID = "control-plane";

/** Synthetic route serving the dashboard/API on its operator-chosen domain.
 *  Upstream reuses DEPLOY_AUTHZ_UPSTREAM — the address Caddy already uses to
 *  reach the control plane for forward_auth (dev: host.docker.internal:3000,
 *  prod: the server service DNS). */
function controlPlaneRoute(cp: { domain: string; usesAcme: boolean }): ProxyRouteInput {
  const upstream = env.DEPLOY_AUTHZ_UPSTREAM;
  const sep = upstream.lastIndexOf(":");
  const host = sep === -1 ? upstream : upstream.slice(0, sep);
  const port = sep === -1 ? 3000 : Number(upstream.slice(sep + 1)) || 3000;
  return {
    projectId: CONTROL_PLANE_PROJECT_ID,
    type: "http",
    domain: cp.domain,
    upstreamHost: host,
    upstreamPort: port,
    protocol: "http",
    layer4Alpn: null,
    usesAcme: cp.usesAcme,
    routePolicy: CONTROL_PLANE_ROUTE_POLICY,
  };
}

export async function reconcile(rlog?: RequestLogger): Promise<ReconcileResult> {
  const log = asStepLogger(rlog);
  // Plain docker: re-attach the edge to every project bridge network first — a
  // recreated Caddy container drops those dynamic attachments, which 502s every
  // deployed service until reconnected. No-op under swarm (shared overlay) and
  // when already attached.
  if (!isSwarmRuntime()) await ensureEdgeOnProjectNetworks(rlog);
  log.info({ caddy: { step: "fetch-routes" } });
  const records = await listEnabledProxyRoutes();
  log.info({ caddy: { step: "fetch-routes", count: records.length } });

  let routes = records.map(toRouteInput);
  const [options, customCerts] = await Promise.all([
    loadCaddyOptions(),
    // Write (or heal) every servable uploaded cert's files for the edge
    // container; only certs actually on disk are eligible for `tls` emission.
    materializeCustomCerts(rlog),
  ]);
  if (customCerts.length > 0) {
    const projectOrg = await mapProjectOrganizations([
      ...new Set(records.map((r) => r.projectId)),
    ] as ProjectId[]);
    routes = applyCustomCertsToRoutes(routes, customCerts, projectOrg);
  }
  if (options.controlPlane) {
    routes.push(controlPlaneRoute(options.controlPlane));
  }

  const result = await reconcileRoutes({
    routes,
    adminBind: env.CADDY_ADMIN_BIND,
    ...options,
    adapt: (caddyfile) => adaptCaddyfile(caddyfile, env.CADDY_ADMIN_URL, rlog),
    load: (caddyfile) => loadWithEdgeSelfHeal(caddyfile, rlog),
    rlog,
  });

  // Then every OTHER node's edge, over SSH. Deliberately after the control
  // plane: it serves every unplaced route, so getting it right first means a
  // node that can't be reached degrades instead of going dark. Failures ride
  // back on the result rather than throwing — one unreachable machine must not
  // fail the reconcile for the rest.
  const nodeEdges = await reconcileNodeEdgesForInstall(routes, options, rlog);

  return { ...result, nodeEdges };
}

/**
 * Fan the reconciled routes out to per-node edges.
 *
 * Swarm-only: under plain docker there is one machine, its edge IS the control
 * plane's, and there is nothing to push anywhere.
 */
async function reconcileNodeEdgesForInstall(
  routes: ProxyRouteInput[],
  options: Awaited<ReturnType<typeof loadCaddyOptions>>,
  rlog?: RequestLogger,
): Promise<NodeEdgeResult[]> {
  if (!isSwarmRuntime()) return [];

  const placements = await listEnabledRoutePlacements();
  const placementByDomain = new Map(placements.map((p) => [p.domain, p.placementServerId]));

  // Index by domain because that's the one key both sides share — the built
  // route inputs have already lost their row ids by this point.
  const placed: PlacedRoute[] = routes.map((route) => ({
    domain: route.domain,
    placementServerId: placementByDomain.get(route.domain) ?? null,
    route,
  }));

  return reconcileNodeEdges({
    placed,
    // The control plane's own edge was just reconciled in-process above, and it
    // keeps every unplaced route. Identified by the bootstrap row's loopback
    // host — the machine running otterdeploy registers itself as 127.0.0.1.
    controlPlaneServerId: await resolveControlPlaneServerId(),
    buildOptions: options,
    adminBind: env.CADDY_ADMIN_BIND,
    rlog,
  });
}

/** The bootstrap row for the machine running otterdeploy itself, which owns the
 *  in-process edge. Null when no such row exists yet — every node then gets
 *  only its own routes, and unplaced ones stay on the control-plane edge that
 *  was just reconciled regardless. */
async function resolveControlPlaneServerId(): Promise<ServerId | null> {
  const servers = await listAllServers();
  return servers.find((s) => s.host === "127.0.0.1" || s.host === "localhost")?.id ?? null;
}

export interface ProjectCaddyfile {
  caddyfile: string;
  revision: string;
}

/** Render the live Caddyfile fragment a single project contributes to the
 *  edge config for read-only display in the dashboard. Only enabled routes
 *  are rendered, mirroring the reconciler (disabled routes never reach
 *  Caddy). The install-wide global block is stripped from the display text
 *  (it is not project state and carries edge credentials); `revision` is
 *  still computed over the FULL fragment — the same short SHA the reconciler
 *  stamps — so the UI can detect drift. */
export async function renderProjectCaddyfile(projectId: ProjectId): Promise<ProjectCaddyfile> {
  const records = await listProxyRoutesByProject(projectId);
  let routes = records.filter((r) => r.enabled).map(toRouteInput);
  const [options, customCerts] = await Promise.all([
    loadCaddyOptions(),
    // DB-only read (no file writes) — shows the same `tls` lines reconcile
    // emits for uploaded certs, so the viewer stays byte-faithful.
    listServableCustomCerts(),
  ]);
  if (customCerts.length > 0) {
    const projectOrg = await mapProjectOrganizations([projectId]);
    routes = applyCustomCertsToRoutes(routes, customCerts, projectOrg);
  }
  const fragment = buildProjectFragment(routes, options);
  const revision = createHash("sha256").update(fragment).digest("hex").slice(0, 12);
  return { caddyfile: maskCaddySecrets(stripGlobalBlock(fragment)), revision };
}

/** Render the full install-wide Caddyfile — global block plus every
 *  project's site blocks plus custom config — exactly as the reconciler
 *  assembles it, for the admin-gated org Networking view. DB-only (no cert
 *  files are written); CrowdSec credentials are masked for display. */
export async function renderInstalledCaddyfile(): Promise<ProjectCaddyfile> {
  const records = await listEnabledProxyRoutes();
  let routes = records.map(toRouteInput);
  const [options, customCerts] = await Promise.all([loadCaddyOptions(), listServableCustomCerts()]);
  if (customCerts.length > 0) {
    const projectOrg = await mapProjectOrganizations([
      ...new Set(records.map((r) => r.projectId)),
    ] as ProjectId[]);
    routes = applyCustomCertsToRoutes(routes, customCerts, projectOrg);
  }
  if (options.controlPlane) {
    routes.push(controlPlaneRoute(options.controlPlane));
  }
  const caddyfile = buildCaddyfile(routes, env.CADDY_ADMIN_BIND, {
    ...options,
  });
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);
  return { caddyfile: maskCaddySecrets(caddyfile), revision };
}

export interface SaveRoutePolicyResult {
  route: ProxyRouteRecord;
  applied: boolean;
  error: string | null;
}

/**
 * Persist an allowlisted route policy and atomically reconcile it. If Caddy
 * cannot accept the generated configuration, restore the previous policy and
 * reload the last-known-good desired state so database and edge do not drift.
 */
export async function saveRoutePolicy(
  route: ProxyRouteRecord,
  policy: RoutePolicy,
  rlog?: RequestLogger,
): Promise<SaveRoutePolicyResult> {
  const updated = await updateProxyRoute(route.id, { routePolicy: policy });
  if (!updated) return { route, applied: false, error: "Route no longer exists." };
  const result = await reconcile(rlog);
  const error =
    result.loadError ??
    result.skipped.find((entry) => entry.projectId === route.projectId)?.error ??
    null;
  if (!error) return { route: updated, applied: true, error: null };
  await updateProxyRoute(route.id, { routePolicy: route.routePolicy });
  await reconcile(rlog);
  return { route, applied: false, error };
}
