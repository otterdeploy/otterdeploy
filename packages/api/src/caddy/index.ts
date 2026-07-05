import type { ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { PLATFORM_SETTINGS_ID, platformSettings } from "@otterdeploy/db/schema/platform";
import { env } from "@otterdeploy/env/server";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { asStepLogger } from "../lib/logger";
import { isSwarmRuntime } from "../runtime";
import { ensureEdgeOnProjectNetworks } from "../swarm/client";
import { buildProjectFragment, type CrowdsecConfig, type ProxyRouteInput } from "./builder";
import { adaptCaddyfile, loadCaddyfile } from "./client";
import {
  getProjectCustomConfig,
  getProjectsWithCustomConfig,
  listEnabledProxyRoutes,
  listProxyRoutesByProject,
  setProjectCustomConfig,
  updateProxyRoute,
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
    customDirectives: r.customDirectives,
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
    crowdsec:
      env.CROWDSEC_LAPI_URL && env.CROWDSEC_BOUNCER_KEY
        ? { apiUrl: env.CROWDSEC_LAPI_URL, apiKey: env.CROWDSEC_BOUNCER_KEY }
        : undefined,
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

  const routes = records.map(toRouteInput);
  const [options, projectCustomConfig] = await Promise.all([
    loadCaddyOptions(),
    getProjectsWithCustomConfig(),
  ]);
  if (options.controlPlane) {
    routes.push(controlPlaneRoute(options.controlPlane));
  }

  return reconcileRoutes({
    routes,
    adminBind: env.CADDY_ADMIN_BIND,
    ...options,
    projectCustomConfig,
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
export async function renderProjectCaddyfile(projectId: ProjectId): Promise<ProjectCaddyfile> {
  const records = await listProxyRoutesByProject(projectId);
  const routes = records.filter((r) => r.enabled).map(toRouteInput);
  const [options, customConfig] = await Promise.all([
    loadCaddyOptions(),
    getProjectCustomConfig(projectId),
  ]);
  const caddyfile = buildProjectFragment(routes, { ...options, customConfig });
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);
  return { caddyfile, revision };
}

function shortRevision(caddyfile: string): string {
  return createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);
}

export interface SaveCustomConfigResult {
  /** The project's rendered fragment after the change (or the rejected
   *  candidate when `applied` is false). */
  caddyfile: string;
  revision: string;
  /** True when the config validated and the live edge was reloaded. */
  applied: boolean;
  /** Caddy's parse/validation error when `applied` is false; null otherwise. */
  error: string | null;
}

/**
 * Validate proposed project-level custom Caddy config against the project's
 * current enabled routes via Caddy `/adapt` and ONLY persist + reconcile if it
 * parses. This is deliberately validate-before-save: because a project's routes
 * and custom config validate as one fragment, persisting broken config would
 * make every future reconcile skip the project — taking its real routes
 * offline. Returning the error without saving keeps the live edge intact.
 */
export async function saveProjectCustomConfig(
  projectId: ProjectId,
  config: string | null,
  rlog?: RequestLogger,
): Promise<SaveCustomConfigResult> {
  const trimmed = config && config.trim().length > 0 ? config : null;
  const records = await listProxyRoutesByProject(projectId);
  const routes = records.filter((r) => r.enabled).map(toRouteInput);
  const options = await loadCaddyOptions();
  const fragment = buildProjectFragment(routes, { ...options, customConfig: trimmed });

  if (fragment.trim().length > 0) {
    const adapted = await adaptCaddyfile(fragment, env.CADDY_ADMIN_URL, rlog);
    if (!adapted.ok) {
      return {
        caddyfile: fragment,
        revision: shortRevision(fragment),
        applied: false,
        error: adapted.error,
      };
    }
  }

  await setProjectCustomConfig(projectId, trimmed);
  await reconcile(rlog);
  const rendered = await renderProjectCaddyfile(projectId);
  return { ...rendered, applied: true, error: null };
}

export interface SaveRouteDirectivesResult {
  route: ProxyRouteRecord;
  applied: boolean;
  error: string | null;
}

/**
 * Validate proposed per-route custom directives in isolation (a single-site
 * fragment) via `/adapt`, then persist + reconcile only if they parse. Same
 * validate-before-save rationale as {@link saveProjectCustomConfig}. Directives
 * only render on http routes; for layer4 routes they're stored but inert.
 */
export async function saveRouteCustomDirectives(
  route: ProxyRouteRecord,
  directives: string | null,
  rlog?: RequestLogger,
): Promise<SaveRouteDirectivesResult> {
  const trimmed = directives && directives.trim().length > 0 ? directives : null;

  if (trimmed && route.type === "http") {
    const options = await loadCaddyOptions();
    const candidate: ProxyRouteInput = { ...toRouteInput(route), customDirectives: trimmed };
    const fragment = buildProjectFragment([candidate], options);
    const adapted = await adaptCaddyfile(fragment, env.CADDY_ADMIN_URL, rlog);
    if (!adapted.ok) {
      return { route, applied: false, error: adapted.error };
    }
  }

  const updated = await updateProxyRoute(route.id, { customDirectives: trimmed });
  await reconcile(rlog);
  return { route: updated ?? route, applied: true, error: null };
}
