import { createHash } from "node:crypto";

import {
  buildCaddyConfig,
  buildProjectConfig,
  type CaddyConfig,
  type ProxyRouteInput,
} from "./builder";
import type { LoadResult } from "./client";

export type ReconcileResult = {
  applied: string[];
  skipped: { projectId: string; error: string }[];
  revision: string;
  loadError?: string;
};

type ReconcileOptions = {
  routes: ProxyRouteInput[];
  adminBind: string;
  load: (config: CaddyConfig) => Promise<LoadResult>;
};

export async function reconcileRoutes(options: ReconcileOptions): Promise<ReconcileResult> {
  const { routes, adminBind, load } = options;

  console.log("[caddy:reconcile] starting reconciliation with %d routes", routes.length);

  const byProject = groupByProject(routes);

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [];
  const validRoutes: ProxyRouteInput[] = [];

  for (const [projectId, projectRoutes] of byProject) {
    console.log("[caddy:reconcile] validating project %s (%d routes)", projectId, projectRoutes.length);

    // Build a standalone config for this project and try loading it
    const projectConfig = buildProjectConfig(projectRoutes);
    const result = await load(projectConfig);

    if (result.ok) {
      validRoutes.push(...projectRoutes);
      applied.push(projectId);
      console.log("[caddy:reconcile] project %s validated ok", projectId);
    } else {
      skipped.push({ projectId, error: result.error });
      console.warn("[caddy:reconcile] project %s failed validation: %s", projectId, result.error);
    }
  }

  // Now load the real combined config
  const config = buildCaddyConfig(validRoutes, adminBind);
  const revision = createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);

  console.log("[caddy:reconcile] loading final config (revision=%s, %d valid routes)", revision, validRoutes.length);

  const loadResult = await load(config);

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
