import { createHash } from "node:crypto";

import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import {
  buildCaddyfile,
  buildProjectFragment,
  type CrowdsecConfig,
  type ProxyRouteInput,
} from "./builder";
import type { AdaptResult, LoadResult } from "./client";

export interface ReconcileResult {
  applied: string[];
  skipped: { projectId: string; error: string }[];
  revision: string;
  loadError?: string;
}

interface ReconcileOptions {
  routes: ProxyRouteInput[];
  adminBind: string;
  /** ACME registration email passed to the Caddy global block. Required
   *  for any route with usesAcme=true; ignored when every route is
   *  internal-only. */
  acmeEmail?: string | null;
  /** host:port Caddy proxies forward_auth + reserved-path requests to for
   *  protected routes (the control plane). Env-driven so dev
   *  (host.docker.internal) and Swarm (service DNS) differ. */
  authzUpstream?: string;
  /** host:port every HTTP site streams JSON access logs to (`output net`). */
  edgeLogSink?: string;
  /** CrowdSec LAPI connection; when set, every HTTP site gets the `crowdsec`
   *  IP-reputation gate + the global bouncer app config. */
  crowdsec?: CrowdsecConfig;
  /** projectId → operator-authored standalone Caddy config. Appended to each
   *  project's fragment, validated with it, and (when valid) merged into the
   *  global file. A project can appear here with no routes. */
  projectCustomConfig?: Map<string, string>;
  adapt: (caddyfile: string) => Promise<AdaptResult>;
  load: (caddyfile: string) => Promise<LoadResult>;
  rlog?: RequestLogger;
}

export async function reconcileRoutes(options: ReconcileOptions): Promise<ReconcileResult> {
  const { routes, adminBind, acmeEmail, authzUpstream, edgeLogSink, crowdsec, projectCustomConfig, adapt, load, rlog } = options;
  const log = asStepLogger(rlog);

  log.info({ caddy: { step: "reconcile", status: "starting", routeCount: routes.length } });

  const byProject = groupByProject(routes);

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [];
  const validRoutes: ProxyRouteInput[] = [];
  const validCustomBlocks: string[] = [];

  // A project may have custom config but no routes, so reconcile the union of
  // both id sets.
  const projectIds = new Set<string>([
    ...byProject.keys(),
    ...(projectCustomConfig?.keys() ?? []),
  ]);

  for (const projectId of projectIds) {
    const projectRoutes = byProject.get(projectId) ?? [];
    const customConfig = projectCustomConfig?.get(projectId);
    log.info({ caddy: { step: "reconcile", status: "validating", projectId, routeCount: projectRoutes.length } });

    const fragment = buildProjectFragment(projectRoutes, { acmeEmail, authzUpstream, edgeLogSink, crowdsec, customConfig });
    if (!fragment.trim()) {
      log.info({ caddy: { step: "reconcile", status: "empty", projectId } });
      applied.push(projectId);
      continue;
    }

    const result = await adapt(fragment);

    if (result.ok) {
      validRoutes.push(...projectRoutes);
      if (customConfig && customConfig.trim().length > 0) {
        validCustomBlocks.push(customConfig);
      }
      applied.push(projectId);
      log.info({ caddy: { step: "reconcile", status: "validated", projectId } });
    } else {
      skipped.push({ projectId, error: result.error });
      log.warn({ caddy: { step: "reconcile", status: "validation-failed", projectId, detail: result.error } });
    }
  }

  const caddyfile = buildCaddyfile(validRoutes, adminBind, { acmeEmail, authzUpstream, edgeLogSink, crowdsec, customBlocks: validCustomBlocks });
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);

  log.info({ caddy: { step: "reconcile", status: "loading", revision, validRouteCount: validRoutes.length } });

  const loadResult = await load(caddyfile);

  if (!loadResult.ok) {
    log.error({ caddy: { step: "reconcile", status: "load-failed", detail: loadResult.error } });
    return {
      applied: [],
      skipped,
      revision,
      loadError: loadResult.error,
    };
  }

  log.info({ caddy: { step: "reconcile", status: "loaded", appliedCount: applied.length, skippedCount: skipped.length } });

  return { applied, skipped, revision };
}

function groupByProject(routes: ProxyRouteInput[]): Map<string, ProxyRouteInput[]> {
  const map = new Map<string, ProxyRouteInput[]>();
  for (const route of routes) {
    const existing = map.get(route.projectId);
    if (existing) {
      existing.push(route);
    } else {
      map.set(route.projectId, [route]);
    }
  }
  return map;
}
