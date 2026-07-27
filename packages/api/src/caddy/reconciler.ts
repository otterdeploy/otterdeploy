import type { RequestLogger } from "evlog";

import { createHash } from "node:crypto";

import type { AdaptResult, LoadResult } from "./client";

import { asStepLogger } from "../lib/logger";
import {
  buildCaddyfile,
  buildProjectFragment,
  type CrowdsecConfig,
  type ProxyRouteInput,
} from "./builder";
import { routeValidationError } from "./route-validation";

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
  /** false ⇒ disable Caddy's automatic HTTP→HTTPS redirect in the global block. */
  httpsAutoRedirect?: boolean | null;
  adapt: (caddyfile: string) => Promise<AdaptResult>;
  load: (caddyfile: string) => Promise<LoadResult>;
  rlog?: RequestLogger;
}

export async function reconcileRoutes(options: ReconcileOptions): Promise<ReconcileResult> {
  const {
    routes,
    adminBind,
    acmeEmail,
    authzUpstream,
    edgeLogSink,
    crowdsec,
    httpsAutoRedirect,
    adapt,
    load,
    rlog,
  } = options;
  const log = asStepLogger(rlog);

  log.info({ caddy: { step: "reconcile", status: "starting", routeCount: routes.length } });

  const unsafeProjects = new Map<string, string>();
  for (const route of routes) {
    const error = routeValidationError(route);
    if (error && !unsafeProjects.has(route.projectId)) {
      unsafeProjects.set(route.projectId, error);
    }
  }
  const byProject = groupByProject(routes.filter((route) => !unsafeProjects.has(route.projectId)));

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [...unsafeProjects].map(
    ([projectId, error]) => ({ projectId, error }),
  );
  const validRoutes: ProxyRouteInput[] = [];
  const projectIds = new Set<string>(byProject.keys());

  for (const projectId of projectIds) {
    const projectRoutes = byProject.get(projectId) ?? [];
    log.info({
      caddy: {
        step: "reconcile",
        status: "validating",
        projectId,
        routeCount: projectRoutes.length,
      },
    });

    const fragment = buildProjectFragment(projectRoutes, {
      acmeEmail,
      authzUpstream,
      edgeLogSink,
      crowdsec,
    });
    if (!fragment.trim()) {
      log.info({ caddy: { step: "reconcile", status: "empty", projectId } });
      applied.push(projectId);
      continue;
    }

    const result = await adapt(fragment);

    if (result.ok) {
      validRoutes.push(...projectRoutes);
      applied.push(projectId);
      log.info({ caddy: { step: "reconcile", status: "validated", projectId } });
    } else {
      skipped.push({ projectId, error: result.error });
      log.warn({
        caddy: { step: "reconcile", status: "validation-failed", projectId, detail: result.error },
      });
    }
  }

  const caddyfile = buildCaddyfile(validRoutes, adminBind, {
    acmeEmail,
    authzUpstream,
    edgeLogSink,
    crowdsec,
    httpsAutoRedirect,
  });
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);

  log.info({
    caddy: { step: "reconcile", status: "loading", revision, validRouteCount: validRoutes.length },
  });

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

  log.info({
    caddy: {
      step: "reconcile",
      status: "loaded",
      appliedCount: applied.length,
      skippedCount: skipped.length,
    },
  });

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
