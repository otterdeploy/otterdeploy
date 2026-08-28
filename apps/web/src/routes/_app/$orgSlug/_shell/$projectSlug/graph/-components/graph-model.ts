import { useEffect, useMemo } from "react";
import { and, eq } from "@tanstack/db";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import type { Edge } from "@xyflow/react";

import * as z from "zod";

import type { Framework } from "@otterdeploy/shared/framework";
import type { ProjectId } from "@otterdeploy/shared/id";
import type { JsonObject } from "@otterdeploy/shared/json";

import { isJsonObject } from "@otterdeploy/shared/json";

import {
  buildLiveNodes,
  type PendingByName,
} from "@/features/projects/components/graph/build-live-nodes";
import {
  clearAppliedCreate,
  useAppliedCreates,
  type AppliedCreates,
} from "@/features/projects/components/graph/applied-creates-store";
import { clearDeleting, useDeleting } from "@/features/projects/components/graph/deleting-store";
import {
  clearPendingFramework,
  usePendingFrameworks,
} from "@/features/projects/components/graph/pending-framework-store";
import { buildPreviewSatellites } from "@/features/projects/components/graph/preview-satellites";
import {
  type ComposeServiceInfo,
  type PendingMark,
} from "@/features/projects/components/graph/resource-node";
import { dependenciesCollection } from "@/features/projects/data/dependencies";
import { resourceCollection } from "@/features/resources/data/resource";
import { serviceTasksCollection } from "@/features/resources/data/service-tasks";
import { inActiveEnvironment } from "@/features/shell/environment-scope";
import { type ActiveEnvironment } from "@/features/shell/use-active-environment";
import { orpc } from "@/shared/server/orpc";

import { summarizeTraffic } from "./route-traffic";

type ManifestDiff = Awaited<ReturnType<typeof orpc.project.manifest.diff.call>>;
type ManifestChange = NonNullable<ManifestDiff["changes"]>[number];

/** Minimal shape `computePendingByName` reads off each resource row. */
interface ResourceLike {
  type: string;
  name: string;
  resourceId: string;
}

const svcSchema = z.object({
  name: z.string(),
  image: z.string(),
  hasBuild: z.boolean(),
  volumes: z.array(z.string())
})
/** Map a compose `create` change's parsed `details.services` (set server-side
 *  by enrichComposeCreates) into the ghost group's member cards. Every service
 *  reads `pending`: the stack hasn't deployed yet, so nothing is running. */
function composeGhostServices(details: JsonObject | undefined): ComposeServiceInfo[] {
  const raw = details?.services;
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => {
    const svc = svcSchema.parse(s);
    return {
      name: svc.name ,
      image: svc.image ,
      hasBuild: svc.hasBuild === true,
      volumes:svc.volumes,
      status: "pending" as const,
    };
  });
}

/** One ghost-create entry, and the resource kinds that get a node at all
 *  (`env` changes never do). */
type PendingCreate = PendingByName["creates"][number];
type NodeResourceKind = PendingCreate["resource"];

const NODE_RESOURCE_KINDS: readonly NodeResourceKind[] = ["service", "database", "compose"];

function isNodeResourceKind(value: string): value is NodeResourceKind {
  return NODE_RESOURCE_KINDS.some((kind) => kind === value);
}

/**
 * Build the ghost card for one staged `create`. Split out of
 * {@link computePendingByName} so the per-kind enrichment: compose member
 * cards + template brand, service framework hint: is branching that belongs to
 * the card it decorates rather than to the change loop.
 */
function ghostCreate(
  resource: NodeResourceKind,
  name: string,
  details: JsonObject | undefined,
  frameworks: ReadonlyMap<string, Framework>,
): PendingCreate {
  // Compose creates carry a parsed service summary (enrichComposeCreates on the
  // server) so the ghost group renders its member cards, plus the template brand
  // so the ghost shows its logo before the first deploy.
  if (resource === "compose") {
    return {
      resource,
      name,
      services: composeGhostServices(details),
      ...(typeof details?.logoBrand === "string" ? { logoBrand: details.logoBrand } : {}),
    };
  }
  // A staged service ghost shows the wizard-detected framework logo immediately
  // (client hint: no build/persist round-trip).
  if (resource === "service") {
    return { resource, name, framework: frameworks.get(`${resource}:${name}`) };
  }
  return { resource, name };
}

/**
 * Bridge the apply gap: a create that was just Deployed but whose resource
 * hasn't streamed into the collection yet keeps its ghost so the node stays put.
 * Split out of {@link computePendingByName}: it's a second, independent pass
 * over a different input, and folding it inline pushed that function past its
 * branch budget.
 */
function bridgeAppliedCreates(
  appliedCreates: AppliedCreates,
  createKeys: ReadonlySet<string>,
  idByName: ReadonlyMap<string, string>,
  frameworks: ReadonlyMap<string, Framework>,
): PendingCreate[] {
  const bridged: PendingCreate[] = [];
  for (const [key, details] of appliedCreates) {
    if (createKeys.has(key) || idByName.has(key)) continue;
    const sep = key.indexOf(":");
    const resource = key.slice(0, sep);
    if (!isNodeResourceKind(resource)) continue;
    // Same builder the diff path uses, on the details recorded at Deploy time:
    // the bridged ghost is the node the operator was already looking at, not a
    // stripped stand-in that forgets the stack's services and logo.
    bridged.push(ghostCreate(resource, key.slice(sep + 1), details, frameworks));
  }
  return bridged;
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
  appliedCreates: AppliedCreates,
  frameworks: ReadonlyMap<string, Framework>,
  deleting: ReadonlySet<string>,
): PendingByName {
  const creates: PendingByName["creates"] = [];
  const marker = new Map<string, PendingMark>();
  const idByName = resourceIdByName(resources);
  const createKeys = new Set<string>();
  for (const c of changes) {
    if (c.kind === "no-op" || c.resource === "env") continue;
    const key = `${c.resource}:${c.name}`;
    const id = idByName.get(key);
    if (c.kind === "create" && !id) {
      // Narrow the wire `details` to JsonObject at the boundary: the diff
      // payload is plain JSON, the contract just types it loosely.
      const details = isJsonObject(c.details) ? c.details : undefined;
      creates.push(ghostCreate(c.resource, c.name, details, frameworks));
      createKeys.add(key);
    } else if (id && (c.kind === "update" || c.kind === "delete")) {
      // Key by the node id (`${resource}:${name}`), which is what the node
      // carries: not the resourceId.
      marker.set(key, c.kind);
    }
  }
  creates.push(...bridgeAppliedCreates(appliedCreates, createKeys, idByName, frameworks));
  // A teardown already running outranks any staged marker: the resource is on
  // its way out, and that is the more urgent thing to say about it.
  for (const key of deleting) if (idByName.has(key)) marker.set(key, "deleting");
  return { creates, marker };
}

/**
 * Loads everything GraphCanvas renders from: resources, dependency edges, live
 * tasks, and the staged manifest diff: folding them into the React Flow node
 * + edge lists. Polls the diff on a 5s cadence (matching the pending-changes
 * bar) and bridges create-ghosts across the apply handover.
 */
export function useGraphModel(
  project: { id: ProjectId },
  /** Environment whose resources the canvas renders. Passed in rather than
   *  resolved here so the canvas and its parent layout can never disagree. */
  activeEnv: ActiveEnvironment,
) {
  const { data: resources } = useLiveQuery(
    (q) =>
      q
        .from({ r: resourceCollection })
        .where(({ r }) =>
          and(eq(r.projectId, project.id), inActiveEnvironment(r.environmentId, activeEnv)),
        ),
    [project.id, activeEnv.id, activeEnv.isMain],
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

  // Pending manifest changes: overlay as ghost nodes for creates and markers
  // on existing nodes for updates/deletes. The input MUST match the
  // pending-changes bar's (`{ projectId, environment }`): oRPC derives the
  // query key from the input, so a mismatched input is a second cache entry
  // polling the same procedure in parallel. Manifest writes push a `manifest`
  // resync over the event stream (and local staging invalidates via
  // invalidateManifestConsumers), so the interval is only a dead-stream
  // backstop.
  const diff = useQuery(
    orpc.project.manifest.diff.queryOptions({
      input: { projectId: project.id, environment: activeEnv.slug },
      refetchInterval: 60_000,
    }),
  );

  // Create-ghosts the operator just Deployed. Kept mounted until the matching
  // resource lands in the collection so the node doesn't blink out and back
  // across the diff/collection refetch gap. See applied-creates-store.ts.
  const appliedCreates = useAppliedCreates(project.id);
  // Resources being torn down right now: marked the moment the operator
  // confirms, so the node shows the work instead of a modal spinner.
  const deleting = useDeleting(project.id);
  // Wizard-detected frameworks for staged service ghosts (instant brand logo).
  const pendingFrameworks = usePendingFrameworks(project.id);

  // Once a just-Deployed create's resource has landed, stop bridging it so the
  // store doesn't pin a ghost over the now-real node: and drop its framework
  // hint, since the real row now carries the persisted value.
  useEffect(() => {
    if (appliedCreates.size === 0 && pendingFrameworks.size === 0 && deleting.size === 0) return;
    const live = new Set<string>();
    for (const r of resources) {
      if (r.type !== "service" && r.type !== "database" && r.type !== "compose")
        continue;
      const key = `${r.type}:${r.name}`;
      if (appliedCreates.has(key)) clearAppliedCreate(project.id, key);
      if (pendingFrameworks.has(key)) clearPendingFramework(project.id, key);
      live.add(key);
    }
    // The mirror image for deletes: the mark is intent, the collection is
    // truth. Once a row is gone its node is gone with it, so stop marking it.
    for (const key of deleting) if (!live.has(key)) clearDeleting(project.id, key);
  }, [appliedCreates, pendingFrameworks, deleting, resources, project.id]);

  // Open PR previews: satellite cards hanging off the service they preview.
  // The PR webhook handlers push a `previews` resync over the event stream,
  // so this poll is only the backstop for a missed event.
  const previews = useQuery(
    orpc.project.previews.list.queryOptions({
      input: { projectId: project.id },
      refetchInterval: 120_000,
    }),
  );

  // Per-host traffic stats over the last 5m: feeds the corner rollup chip
  // only, so a slow cadence is fine. Domains themselves live in the
  // Networking tab, not on the graph. (The traffic drawer keeps its own
  // faster query while open.)
  const routeStats = useQuery(
    orpc.edgeLogs.routeStats.queryOptions({
      input: { projectId: project.id, range: "5m" },
      refetchInterval: 30_000,
    }),
  );

  // Convert resources to nodes, then append the preview satellites (nodes +
  // dashed edges together, so an edge can never reference a node that wasn't
  // emitted). The framework brand logo rides on each resource record: no
  // per-service git-API lookup.
  //
  // Memoized on the underlying data (not recomputed per render): a drag
  // re-renders this hook's consumer ~60×/s via setState, and rebuilding the
  // node/edge arrays each frame handed React Flow fresh object identities,
  // re-rendering every card. With the inputs unchanged mid-drag, the same
  // arrays are returned so only the dragged node's identity changes downstream.
  const graph = useMemo(() => {
    const edgesFromDeps: Edge[] = dependencyEdges.map((d) => ({
      id: `${d.source}->${d.target}`,
      source: d.source,
      target: d.target,
    }));
    const tasksByResourceId = new Map<string, (typeof serviceTasks)[number]["tasks"]>();
    for (const entry of serviceTasks) tasksByResourceId.set(entry.resourceId, entry.tasks);

    const pendingByName: PendingByName = computePendingByName(
      resources,
      diff.data?.changes ?? [],
      appliedCreates,
      pendingFrameworks,
      deleting,
    );

    const base = buildLiveNodes(resources, tasksByResourceId, pendingByName);
    const serviceIds = new Set(base.map((n) => n.id));
    const satellites = buildPreviewSatellites(previews.data ?? [], serviceIds);
    return {
      nodes: [...base, ...satellites.nodes],
      edges: [...edgesFromDeps, ...satellites.edges],
    };
  }, [
    resources,
    dependencyEdges,
    serviceTasks,
    diff.data,
    previews.data,
    appliedCreates,
    pendingFrameworks,
    deleting,
  ]);

  // Corner chip rollup: null (chip omitted) when no host saw traffic.
  const traffic = useMemo(() => summarizeTraffic(routeStats.data), [routeStats.data]);

  return { liveNodes: graph.nodes, liveEdges: graph.edges, traffic };
}
