import { useEffect, useMemo } from "react";
import { eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import type { Edge } from "@xyflow/react";

import type { ProjectId } from "@otterdeploy/shared/id";

import {
  buildLiveNodes,
  buildRouteEdges,
  type PendingByName,
} from "@/features/projects/components/graph/build-live-nodes";
import {
  clearAppliedCreate,
  useAppliedCreates,
} from "@/features/projects/components/graph/applied-creates-store";
import { type ComposeServiceInfo } from "@/features/projects/components/graph/resource-node";
import { dependenciesCollection } from "@/features/projects/data/dependencies";
import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { orpc } from "@/shared/server/orpc";

type ManifestDiff = Awaited<ReturnType<typeof orpc.project.manifest.diff.call>>;
type ManifestChange = NonNullable<ManifestDiff["changes"]>[number];

/** Minimal shape `computePendingByName` reads off each resource row. */
interface ResourceLike {
  type: string;
  name: string;
  resourceId: string;
}

/** Map a compose `create` change's parsed `details.services` (set server-side
 *  by enrichComposeCreates) into the ghost group's member cards. Every service
 *  reads `pending` — the stack hasn't deployed yet, so nothing is running. */
function composeGhostServices(
  details: Record<string, unknown> | undefined,
): ComposeServiceInfo[] {
  const raw = details?.services;
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const svc = s as {
      name?: unknown;
      image?: unknown;
      hasBuild?: unknown;
      volumes?: unknown;
    };
    return {
      name: typeof svc.name === "string" ? svc.name : "",
      image: typeof svc.image === "string" ? svc.image : null,
      hasBuild: svc.hasBuild === true,
      volumes: Array.isArray(svc.volumes)
        ? svc.volumes.filter((v): v is string => typeof v === "string")
        : [],
      status: "pending" as const,
    };
  });
}

/** Lookup of `${resource}:${name}` → resourceId for the project's applied
 *  service / database / compose resources (the only kinds that get a node). */
function resourceIdByName(
  resources: readonly ResourceLike[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of resources) {
    if (r.type === "service" || r.type === "database" || r.type === "compose") {
      m.set(`${r.type}:${r.name}`, r.resourceId);
    }
  }
  return m;
}

/** Resolve staged manifest changes into ghost creates + update/delete markers,
 *  bridging the apply gap for just-Deployed creates that haven't streamed in. */
function computePendingByName(
  resources: readonly ResourceLike[],
  changes: readonly ManifestChange[],
  appliedCreates: ReadonlySet<string>,
): PendingByName {
  const creates: PendingByName["creates"] = [];
  const marker = new Map<string, "update" | "delete">();
  const idByName = resourceIdByName(resources);
  const createKeys = new Set<string>();
  for (const c of changes) {
    if (c.kind === "no-op" || c.resource === "env") continue;
    const key = `${c.resource}:${c.name}`;
    const id = idByName.get(key);
    if (c.kind === "create" && !id) {
      creates.push({
        resource: c.resource,
        name: c.name,
        // Compose creates carry a parsed service summary (enrichComposeCreates
        // on the server) so the ghost group renders its member cards.
        ...(c.resource === "compose"
          ? { services: composeGhostServices(c.details) }
          : {}),
      });
      createKeys.add(key);
    } else if (id && (c.kind === "update" || c.kind === "delete")) {
      // Key by the node id (`${resource}:${name}`), which is what the node
      // carries — not the resourceId.
      marker.set(key, c.kind);
    }
  }
  // Bridge the apply gap: a create that was just Deployed but whose resource
  // hasn't streamed in yet keeps its ghost so the node stays put.
  for (const key of appliedCreates) {
    if (createKeys.has(key) || idByName.has(key)) continue;
    const sep = key.indexOf(":");
    const resource = key.slice(0, sep) as "service" | "database" | "compose";
    creates.push({ resource, name: key.slice(sep + 1) });
  }
  return { creates, marker };
}

/**
 * Loads everything GraphCanvas renders from: resources, dependency edges, live
 * tasks, and the staged manifest diff — folding them into the React Flow node
 * + edge lists. Polls the diff on a 5s cadence (matching the pending-changes
 * bar) and bridges create-ghosts across the apply handover.
 */
export function useGraphModel(project: { id: ProjectId }) {
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) => eq(r.projectId, project.id)),
    [project.id],
  );

  // Edges come from parsing ${{Resource.VAR}} references in service env vars
  // server-side (project.dependencies). TanStack DB collection so the data
  // stays cached + reactive across panel open/close without a loading flash.
  const { data: dependencyEdges } = useLiveQuery(
    (q) =>
      q
        .from({ d: dependenciesCollection })
        .where(({ d }) => eq(d.projectId, project.id)),
    [project.id],
  );

  const { data: serviceTasks } = useLiveQuery(
    (q) =>
      q
        .from({ d: serviceTasksCollection })
        .where(({ d }) => eq(d.projectId, project.id)),
    [project.id],
  );

  const edgesFromDeps = useMemo<Edge[]>(
    () =>
      dependencyEdges.map((d) => ({
        id: `${d.source}->${d.target}`,
        source: d.source,
        target: d.target,
      })),
    [dependencyEdges],
  );

  const tasksByResourceId = useMemo(() => {
    const m = new Map<string, (typeof serviceTasks)[number]["tasks"]>();
    for (const entry of serviceTasks) m.set(entry.resourceId, entry.tasks);
    return m;
  }, [serviceTasks]);

  // Pending manifest changes — overlay as ghost nodes for creates and markers
  // on existing nodes for updates/deletes. Polled on the same 5s cadence as the
  // pending-changes bar.
  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId: project.id },
      refetchInterval: 5_000,
    }),
  );

  // Create-ghosts the operator just Deployed. Kept mounted until the matching
  // resource lands in the collection so the node doesn't blink out and back
  // across the diff/collection refetch gap. See applied-creates-store.ts.
  const appliedCreates = useAppliedCreates(project.id);

  const pendingByName = useMemo<PendingByName>(
    () => computePendingByName(resources, diff.data?.changes ?? [], appliedCreates),
    [resources, diff.data, appliedCreates],
  );

  // Once a just-Deployed create's resource has landed, stop bridging it so the
  // store doesn't pin a ghost over the now-real node.
  useEffect(() => {
    if (appliedCreates.size === 0) return;
    for (const r of resources) {
      if (r.type !== "service" && r.type !== "database" && r.type !== "compose")
        continue;
      const key = `${r.type}:${r.name}`;
      if (appliedCreates.has(key)) clearAppliedCreate(project.id, key);
    }
  }, [appliedCreates, resources, project.id]);

  // Convert resources to nodes + synthesize public route nodes via the shared
  // helper. The framework brand logo rides on each resource record (detected at
  // build time, stored on the row) — no per-service git-API lookup on render.
  const liveNodes = useMemo(
    () => buildLiveNodes(resources, tasksByResourceId, pendingByName),
    [resources, tasksByResourceId, pendingByName],
  );

  const liveEdges = useMemo(
    () => [...edgesFromDeps, ...buildRouteEdges(resources)],
    [resources, edgesFromDeps],
  );

  return { liveNodes, liveEdges };
}
