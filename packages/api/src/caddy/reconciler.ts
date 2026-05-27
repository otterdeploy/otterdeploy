import { createHash } from "node:crypto";

import type { RequestLogger } from "evlog";

import { asStepLogger } from "../lib/logger";
import {
  buildCaddyfile,
  buildProjectFragment,
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
  adapt: (caddyfile: string) => Promise<AdaptResult>;
  load: (caddyfile: string) => Promise<LoadResult>;
  rlog?: RequestLogger;
}

export async function reconcileRoutes(options: ReconcileOptions): Promise<ReconcileResult> {
  const { routes, adminBind, acmeEmail, adapt, load, rlog } = options;
  const log = asStepLogger(rlog);

  log.info({ caddy: { step: "reconcile", status: "starting", routeCount: routes.length } });

  const byProject = groupByProject(routes);

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [];
  const validRoutes: ProxyRouteInput[] = [];

  for (const [projectId, projectRoutes] of byProject) {
    log.info({ caddy: { step: "reconcile", status: "validating", projectId, routeCount: projectRoutes.length } });

    const fragment = buildProjectFragment(projectRoutes, { acmeEmail });
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
      log.warn({ caddy: { step: "reconcile", status: "validation-failed", projectId, detail: result.error } });
    }
  }

  const caddyfile = buildCaddyfile(validRoutes, adminBind, { acmeEmail });
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
