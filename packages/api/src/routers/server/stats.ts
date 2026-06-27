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
import { Docker } from "@otterdeploy/docker";
import { and, eq, inArray } from "drizzle-orm";
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

  // ── Swarm node directory ──────────────────────────────────────────────
  // Lets us map task.NodeID → swarm hostname → otterdeploy server row.
  const nodesResult = await docker.nodes.list({});
  const swarmIdToHostname = new Map<string, string>();
  if (nodesResult.isOk()) {
    for (const n of nodesResult.value) {
      if (n.ID && n.Description?.Hostname) {
        swarmIdToHostname.set(n.ID, n.Description.Hostname);
      }
    }
  }

  // ── All otterdeploy-managed tasks ──────────────────────────────────────
  // Single call, label-filtered so other docker workloads don't leak into
  // the stats. Tasks without a NodeID (still being scheduled) are skipped.
  const tasksResult = await docker.tasks.list({
    filters: { label: ["otterdeploy.managed=true"] },
  });

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
  if (tasksResult.isErr()) return empty;
  const tasks = tasksResult.value;

  // Group by hostname (the lookup we can join back to otterdeploy server rows).
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

  // ── Project name lookup for the cluster pills ─────────────────────────
  const projectSlugs = [...projectTaskCount.keys()];
  const projectRows =
    projectSlugs.length === 0
      ? []
      : await db
          .select({ slug: project.slug, name: project.name })
          .from(project)
          .where(
            and(
              eq(project.organizationId, input.organizationId),
              inArray(project.slug, projectSlugs),
            ),
          );
  const slugToName = new Map<string, string>();
  for (const row of projectRows) slugToName.set(row.slug, row.name);

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
      projects: [...projectTaskCount.entries()]
        .map(([slug, tasksRunning]) => ({
          slug,
          name: slugToName.get(slug) ?? slug,
          tasksRunning,
        }))
        .sort((a, b) => b.tasksRunning - a.tasksRunning),
    },
  };
}
