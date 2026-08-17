import type { SessionSource } from "../types";

/**
 * The picker's data model: one flat list of *destinations*, not a taxonomy of
 * transports. An operator thinks "I want a shell in store-web replica 2" or "on
 * the db box", never "I want a docker exec as opposed to an SSH". So how we
 * reach a target (exec vs. host PTY vs. ssh) is demoted to a trailing hint,
 * and the grouping is what the thing IS.
 */
export type TargetGroup = "service" | "database" | "server";

export interface PickerTarget {
  /** Stable React key. */
  id: string;
  group: TargetGroup;
  /** What the operator names the thing. Rendered mono. */
  name: string;
  /** Disambiguator when a name repeats: "replica 2". */
  qualifier: string | null;
  /** Owning project slug, when it has one. */
  project: string | null;
  /** Kind tag: engine, node role, "host". */
  tag: string | null;
  /** Right-aligned machine detail: short container id, host address. */
  detail: string;
  /** Everything else worth matching a search against. */
  keywords: string[];
  source: SessionSource;
  /** Why this row can't be opened, or null when it can. */
  unavailable: string | null;
  /** Set when the target resolves but the backend path isn't wired yet. */
  pending: boolean;
}

export interface TargetContainer {
  containerId: string;
  name: string;
  image: string;
  state: string;
  resourceType: "service" | "postgres" | "redis" | "mariadb" | "mongodb";
  projectSlug: string | null;
  projectName: string | null;
  serviceResourceId: string | null;
  serviceName: string | null;
  replicaSlot: string | null;
}

export interface TargetDatabase {
  resourceId: string;
  name: string;
  engine: string;
  projectSlug: string;
  projectName: string;
}

export interface TargetServer {
  id: string;
  name: string;
  host: string;
  labels: readonly string[];
}

const SHORT_ID = 12;

function serviceTargets(containers: TargetContainer[]): PickerTarget[] {
  const services = containers.filter((c) => c.resourceType === "service");

  // A replica number is noise on a single-replica service and essential on a
  // scaled one, so only the scaled ones carry it.
  const perService = new Map<string, number>();
  for (const c of services) {
    const key = `${c.projectSlug ?? ""}/${c.serviceName ?? c.name}`;
    perService.set(key, (perService.get(key) ?? 0) + 1);
  }

  return services.map((c) => {
    const name = c.serviceName ?? c.name;
    const key = `${c.projectSlug ?? ""}/${name}`;
    const scaled = (perService.get(key) ?? 1) > 1;
    const short = c.containerId.slice(0, SHORT_ID);
    return {
      id: c.containerId,
      group: "service",
      name,
      qualifier: scaled ? `replica ${c.replicaSlot ?? "?"}` : null,
      project: c.projectSlug,
      tag: null,
      detail: short,
      keywords: [c.image, c.containerId, c.projectName ?? "", "shell", "exec", "container"],
      source: {
        kind: "container",
        project: c.projectSlug ?? "",
        service: name,
        replica: c.replicaSlot ?? short,
        containerId: c.containerId,
      },
      // The discovery RPC lists running containers only, but a container can
      // stop between the fetch and the click. Say so rather than opening a
      // session that dies on connect.
      unavailable: c.state === "running" ? null : `container is ${c.state}`,
      pending: false,
    };
  });
}

/**
 * Databases are one row per resource, and that row opens a shell *inside the
 * database container*, which works today. The engine console (psql, redis-cli)
 * has no backend yet, so it isn't offered as a separate destination; that would
 * be a second axis for the same box, which is exactly what this list removes.
 */
function databaseTargets(
  containers: TargetContainer[],
  databases: TargetDatabase[],
): PickerTarget[] {
  const dbContainers = containers.filter((c) => c.resourceType !== "service");
  const byResourceId = new Map(
    dbContainers.filter((c) => c.serviceResourceId).map((c) => [c.serviceResourceId, c]),
  );
  const claimed = new Set<string>();

  const fromResources: PickerTarget[] = databases.map((db) => {
    const container = byResourceId.get(db.resourceId);
    if (container) claimed.add(container.containerId);
    const short = container?.containerId.slice(0, SHORT_ID) ?? "";
    return {
      id: db.resourceId,
      group: "database",
      name: db.name,
      qualifier: null,
      project: db.projectSlug,
      tag: db.engine,
      detail: short || "–",
      keywords: [db.engine, db.projectName, container?.image ?? "", "database", "console", "shell"],
      source: container
        ? {
            kind: "container",
            project: db.projectSlug,
            service: db.name,
            replica: short,
            containerId: container.containerId,
          }
        : { kind: "database", engine: db.engine, service: db.name, project: db.projectSlug },
      unavailable: container ? null : "no running container",
      pending: false,
    };
  });

  // Database containers we couldn't tie back to a resource row still deserve a
  // shell: better an honest container name than a silently missing target.
  const orphans: PickerTarget[] = dbContainers
    .filter((c) => !claimed.has(c.containerId))
    .map((c) => {
      const short = c.containerId.slice(0, SHORT_ID);
      return {
        id: c.containerId,
        group: "database",
        name: c.serviceName ?? c.name,
        qualifier: null,
        project: c.projectSlug,
        tag: c.resourceType,
        detail: short,
        keywords: [c.resourceType, c.image, c.containerId, "database", "shell"],
        source: {
          kind: "container",
          project: c.projectSlug ?? "",
          service: c.serviceName ?? c.name,
          replica: short,
          containerId: c.containerId,
        },
        unavailable: c.state === "running" ? null : `container is ${c.state}`,
        pending: false,
      };
    });

  return [...fromResources, ...orphans];
}

function serverTargets(servers: TargetServer[]): PickerTarget[] {
  return servers.map((s) => {
    // The bootstrap node is the otterdeploy-server host itself. A local PTY,
    // no SSH hop. Every other node needs the SSH exec path, which isn't built.
    const isLocal = s.labels.includes("bootstrap");
    return {
      id: s.id,
      group: "server",
      name: s.name,
      qualifier: null,
      project: null,
      tag: isLocal ? "host" : "node",
      detail: s.host,
      keywords: [s.host, ...s.labels, "ssh", "server", "node", "machine"],
      source: {
        kind: "ssh",
        mode: isLocal ? "local" : "remote",
        node: s.name,
        host: s.host,
      },
      unavailable: null,
      pending: !isLocal,
    };
  });
}

/** Project, then name, then replica, so the list never reshuffles between opens. */
function ordered(targets: PickerTarget[]): PickerTarget[] {
  return [...targets].sort((a, b) => {
    const byProject = (a.project ?? "").localeCompare(b.project ?? "");
    if (byProject !== 0) return byProject;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return (a.qualifier ?? "").localeCompare(b.qualifier ?? "", undefined, { numeric: true });
  });
}

/**
 * Flatten every reachable shell into one list, sorted inside each group and
 * concatenated in group order, sorting the whole array at once would need a
 * comparator that ranks groups against each other, which is a display concern.
 */
export function buildPickerTargets(input: {
  containers: TargetContainer[];
  databases: TargetDatabase[];
  servers: TargetServer[];
}): PickerTarget[] {
  return [
    ...ordered(serviceTargets(input.containers)),
    ...ordered(databaseTargets(input.containers, input.databases)),
    ...ordered(serverTargets(input.servers)),
  ];
}

/** Project facets derived from the target list, most-populated first. */
export function projectFacets(targets: PickerTarget[]): Array<{ slug: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of targets) {
    if (!t.project) continue;
    counts.set(t.project, (counts.get(t.project) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}
