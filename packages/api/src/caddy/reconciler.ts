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

  const byProject = groupByProject(routes);

  const applied: string[] = [];
  const skipped: { projectId: string; error: string }[] = [];
  const validRoutes: ProxyRouteInput[] = [];

  for (const [projectId, projectRoutes] of byProject) {
    const fragment = buildProjectFragment(projectRoutes);
    if (!fragment.trim()) {
      applied.push(projectId);
      continue;
    }

    const wrappedFragment = wrapForValidation(fragment);
    const result = await adapt(wrappedFragment);

    if (result.ok) {
      validRoutes.push(...projectRoutes);
      applied.push(projectId);
    } else {
      skipped.push({ projectId, error: result.error });
    }
  }

  const caddyfile = buildCaddyfile(validRoutes, adminBind);
  const revision = createHash("sha256").update(caddyfile).digest("hex").slice(0, 12);

  const loadResult = await load(caddyfile);

  if (!loadResult.ok) {
    return {
      applied: [],
      skipped,
      revision,
      loadError: loadResult.error,
    };
  }

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

function wrapForValidation(fragment: string): string {
  return `${fragment.trim()}\n`;
}
