/**
 * Live per-node + cluster stats for the servers page. Aggregates docker
 * swarm tasks by node, sums CPU + memory reservations, and resolves swarm
 * node ids back to otterdeploy server rows via the hostname pair.
 *
 * Mapping note:
 *   The server table doesn't store swarm node ids — the bootstrap row is the
 *   manager and remote rows come from the join-command flow without a
 *   back-channel from the daemon. We resolve by hostname: `docker.nodes.list`
 *   gives `Description.Hostname` per swarm node, and the server table has
 *   `hostname` (OS hostname) + `name` (friendly). Match the swarm hostname
 *   against either, since the bootstrap row's name is "localhost" while the
 *   real OS hostname lives in `hostname`.
 */
import type { OrganizationId, ServerId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { server } from "@otterdeploy/db/schema/server";
import { Docker, type Node, type Task } from "@otterdeploy/docker";
import { and, eq, inArray } from "drizzle-orm";

import { isSwarmRuntime } from "../../runtime";
type OrgId = OrganizationId;

export interface ServerNodeStats {
  serverId: ServerId;
  tasksRunning: number;
  cpuAllocatedVcpu: number;
  memoryAllocatedGb: number;
  projects: string[];
}

export interface ServerClusterStats {
  tasksRunning: number;
  projects: Array<{ slug: string; name: string; tasksRunning: number }>;
}

export interface ServerStats {
  perServer: ServerNodeStats[];
  cluster: ServerClusterStats;
}

// Type-safe nibbles into the loosely-typed Task.Spec blob from the docker SDK.
function readNanoCpus(spec: unknown): number {
  if (typeof spec !== "object" || spec === null) return 0;
  const resources = (spec as { Resources?: { Reservations?: { NanoCPUs?: number } } }).Resources;
  return resources?.Reservations?.NanoCPUs ?? 0;
}

function readMemoryBytes(spec: unknown): number {
  if (typeof spec !== "object" || spec === null) return 0;
  const resources = (spec as { Resources?: { Reservations?: { MemoryBytes?: number } } }).Resources;
  return resources?.Reservations?.MemoryBytes ?? 0;
}

const BYTES_PER_GB = 1024 ** 3;
const NANO = 1e9;

// Per-hostname accumulator. Hostname is the join key back to server rows.
interface Bucket {
  tasksRunning: number;
  cpuAllocatedVcpu: number;
  memoryAllocatedGb: number;
  projects: Set<string>;
}

const newBucket = (): Bucket => ({
  tasksRunning: 0,
  cpuAllocatedVcpu: 0,
  memoryAllocatedGb: 0,
  projects: new Set<string>(),
});

interface TaskAggregation {
  perHostname: Map<string, Bucket>;
  projectTaskCount: Map<string, number>;
  clusterRunning: number;
}

/** Map swarm node id → swarm hostname so tasks can resolve to server rows. */
function buildSwarmHostnameMap(nodes: Node[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    if (n.ID && n.Description?.Hostname) {
      map.set(n.ID, n.Description.Hostname);
    }
  }
  return map;
}

/**
 * Fold otterdeploy-managed tasks into per-hostname reservation buckets, a
 * per-project running-task tally, and the cluster running total. Tasks without
 * a resolvable node hostname still count toward cluster/project totals.
 */
function aggregateTasks(tasks: Task[], swarmIdToHostname: Map<string, string>): TaskAggregation {
  const perHostname = new Map<string, Bucket>();
  const projectTaskCount = new Map<string, number>();
  let clusterRunning = 0;

  for (const t of tasks) {
    const state = t.Status?.State ?? "";
    const isRunning = state === "running";
    if (isRunning) clusterRunning++;

    const slug = t.Labels?.["otterdeploy.project"];
    if (slug && isRunning) {
      projectTaskCount.set(slug, (projectTaskCount.get(slug) ?? 0) + 1);
    }

    if (!t.NodeID) continue;
    const hostname = swarmIdToHostname.get(t.NodeID);
    if (!hostname) continue;

    let bucket = perHostname.get(hostname);
    if (!bucket) {
      bucket = newBucket();
      perHostname.set(hostname, bucket);
    }

    if (isRunning) {
      bucket.tasksRunning++;
      bucket.cpuAllocatedVcpu += readNanoCpus(t.Spec) / NANO;
      bucket.memoryAllocatedGb += readMemoryBytes(t.Spec) / BYTES_PER_GB;
    }
    if (slug) bucket.projects.add(slug);
  }

  return { perHostname, projectTaskCount, clusterRunning };
}

/** Resolve slug → friendly name for the cluster pills. Shared by both runtimes. */
async function clusterProjectPills(
  organizationId: OrgId,
  projectTaskCount: Map<string, number>,
): Promise<ServerClusterStats["projects"]> {
  const slugs = [...projectTaskCount.keys()];
  const rows =
    slugs.length === 0
      ? []
      : await db
          .select({ slug: project.slug, name: project.name })
          .from(project)
          .where(and(eq(project.organizationId, organizationId), inArray(project.slug, slugs)));
  const slugToName = new Map(rows.map((r) => [r.slug, r.name]));
  return [...projectTaskCount.entries()]
    .map(([slug, tasksRunning]) => ({ slug, name: slugToName.get(slug) ?? slug, tasksRunning }))
    .sort((a, b) => b.tasksRunning - a.tasksRunning);
}

interface ServerRow {
  id: ServerId;
  name: string | null;
  hostname: string | null;
}

/**
 * Plain-docker (DEFAULT runtime) stats. There are no swarm tasks/nodes, so we
 * count the managed CONTAINERS instead (label `otterdeploy.managed=true`, the
 * same label the docker driver stamps). Plain docker is single-node, so the
 * whole aggregate belongs to the local host — attributed to the (single) server
 * row. cpu/mem "allocated" reflects swarm task RESERVATIONS, which the plain
 * docker driver doesn't set (it uses limits), so it's reported as 0 here rather
 * than conflating limits with reservations.
 */
async function getDockerServerStats(
  docker: Docker,
  servers: ServerRow[],
  organizationId: OrgId,
): Promise<ServerStats | null> {
  const list = await docker.containers.list({
    all: false, // running only
    filters: { label: ["otterdeploy.managed=true"] },
  });
  if (list.isErr()) return null;

  const projectTaskCount = new Map<string, number>();
  const projects = new Set<string>();
  let tasksRunning = 0;

  for (const c of list.value) {
    tasksRunning++;
    const slug = (c as { Labels?: Record<string, string> }).Labels?.["otterdeploy.project"];
    if (slug) {
      projects.add(slug);
      projectTaskCount.set(slug, (projectTaskCount.get(slug) ?? 0) + 1);
    }
  }

  const perServer: ServerNodeStats[] = servers.map((s, i) =>
    i === 0
      ? {
          serverId: s.id,
          tasksRunning,
          cpuAllocatedVcpu: 0,
          memoryAllocatedGb: 0,
          projects: [...projects],
        }
      : {
          serverId: s.id,
          tasksRunning: 0,
          cpuAllocatedVcpu: 0,
          memoryAllocatedGb: 0,
          projects: [],
        },
  );

  return {
    perServer,
    cluster: {
      tasksRunning,
      projects: await clusterProjectPills(organizationId, projectTaskCount),
    },
  };
}

export async function getServerStats(input: { organizationId: OrgId }): Promise<ServerStats> {
  // ── Otterdeploy servers in this org ────────────────────────────────────
  const servers = await db
    .select({
      id: server.id,
      name: server.name,
      hostname: server.hostname,
    })
    .from(server)
    .where(eq(server.organizationId, input.organizationId));

  const docker = Docker.fromEnv();

  const empty: ServerStats = {
    perServer: servers.map((s) => ({
      serverId: s.id,
      tasksRunning: 0,
      cpuAllocatedVcpu: 0,
      memoryAllocatedGb: 0,
      projects: [],
    })),
    cluster: { tasksRunning: 0, projects: [] },
  };

  // DEFAULT runtime is plain docker — there are no swarm tasks/nodes, so the
  // task/node aggregation below returns nothing. Count managed containers
  // instead. Only DEPLOY_RUNTIME=swarm reaches the swarm path.
  if (!isSwarmRuntime()) {
    return (await getDockerServerStats(docker, servers, input.organizationId)) ?? empty;
  }

  // ── Swarm node directory ──────────────────────────────────────────────
  // Lets us map task.NodeID → swarm hostname → otterdeploy server row.
  const nodesResult = await docker.nodes.list({});
  const swarmIdToHostname = nodesResult.isOk()
    ? buildSwarmHostnameMap(nodesResult.value)
    : new Map<string, string>();

  // ── All otterdeploy-managed tasks ──────────────────────────────────────
  // Single call, label-filtered so other docker workloads don't leak into
  // the stats. Tasks without a NodeID (still being scheduled) are skipped.
  const tasksResult = await docker.tasks.list({
    filters: { label: ["otterdeploy.managed=true"] },
  });
  if (tasksResult.isErr()) return empty;

  // Group by hostname (the lookup we can join back to otterdeploy server rows).
  const { perHostname, projectTaskCount, clusterRunning } = aggregateTasks(
    tasksResult.value,
    swarmIdToHostname,
  );

  // ── Per-server emission ───────────────────────────────────────────────
  const perServer: ServerNodeStats[] = servers.map((s) => {
    const candidates = [s.hostname, s.name].filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
    let matched: Bucket | undefined;
    for (const candidate of candidates) {
      const bucket = perHostname.get(candidate);
      if (bucket) {
        matched = bucket;
        break;
      }
    }
    return {
      serverId: s.id,
      tasksRunning: matched?.tasksRunning ?? 0,
      cpuAllocatedVcpu: matched?.cpuAllocatedVcpu ?? 0,
      memoryAllocatedGb: matched?.memoryAllocatedGb ?? 0,
      projects: matched ? [...matched.projects] : [],
    };
  });

  return {
    perServer,
    cluster: {
      tasksRunning: clusterRunning,
      projects: await clusterProjectPills(input.organizationId, projectTaskCount),
    },
  };
}
