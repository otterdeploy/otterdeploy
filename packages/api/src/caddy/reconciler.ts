import { createHash } from "node:crypto";

import {
  buildCaddyfile,
  buildProjectFragment,
  type ProxyRouteInput,
} from "./builder";
import type { AdaptResult, LoadResult } from "./client";

export type ReconcileResult = {
  applied: string[];
  skipped: { projectId: string; error: string }[];
  revision: string;
  loadError?: string;
};

type ReconcileOptions = {
  routes: ProxyRouteInput[];
  adminBind: string;
  adapt: (caddyfile: string) => Promise<AdaptResult>;
  load: (caddyfile: string) => Promise<LoadResult>;
};

export async function reconcileRoutes(options: ReconcileOptions): Promise<ReconcileResult> {
  const { routes, adminBind, adapt, load } = options;

  console.log("[caddy:reconcile] starting reconciliation with %d routes", routes.length);

  const byProject = groupByProject(routes);

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [];
  const validRoutes: ProxyRouteInput[] = [];

  for (const [projectId, projectRoutes] of byProject) {
    console.log("[caddy:reconcile] validating project %s (%d routes)", projectId, projectRoutes.length);

    const fragment = buildProjectFragment(projectRoutes);
    if (!fragment.trim()) {
      console.log("[caddy:reconcile] project %s has no routes, marking applied", projectId);
      applied.push(projectId);
      continue;
    }

    const result = await adapt(fragment);

    if (result.ok) {
      validRoutes.push(...projectRoutes);
      applied.push(projectId);
      console.log("[caddy:reconcile] project %s validated ok", projectId);
    } else {
      skipped.push({ projectId, error: result.error });
      console.warn("[caddy:reconcile] project %s failed validation: %s", projectId, result.error);
    }
  }

  const caddyfile = buildCaddyfile(validRoutes, adminBind);
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);

  console.log("[caddy:reconcile] loading caddyfile (revision=%s, %d valid routes)", revision, validRoutes.length);

  const loadResult = await load(caddyfile);

  if (!loadResult.ok) {
    console.error("[caddy:reconcile] load failed: %s", loadResult.error);
    return {
      applied: [],
      skipped,
      revision,
      loadError: loadResult.error,
    };
  }

  console.log("[caddy:reconcile] loaded successfully (applied=%d, skipped=%d)", applied.length, skipped.length);

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
