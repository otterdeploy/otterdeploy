/**
 * Terminal target discovery. One read covers everything the picker needs to
 * show under Container + Database tabs. SSH targets piggyback on the existing
 * org-scoped server.list — no need to re-source them here.
 *
 * Org scoping:
 *   - Containers: filtered to docker labels { otterstack.managed=true,
 *     otterstack.project=<projectSlug> } for projects in this org.
 *   - Databases: SQL join `resource → project` filtered by organizationId.
 *
 * Container labels are the source of truth for the project mapping — we DO
 * NOT trust labels to identify the org (a different deployment in the same
 * Docker daemon could spoof them). Instead we pre-load the org's project
 * slugs and only emit containers whose `otterstack.project` label matches.
 */

import { Docker } from "@otterdeploy/docker";
import { eq } from "drizzle-orm";

import { db } from "@otterstack/db";
import {
  databaseResource,
  project,
  resource,
} from "@otterstack/db/schema/project";
import {
  type Id,
  ID_PREFIX as IDP,
  type ProjectSlug,
} from "@otterstack/shared/id";

import type { ResourceId } from "../service/errors";

type OrgId = Id<typeof IDP.organization>;

export interface TerminalContainer {
  containerId: string;
  name: string;
  image: string;
  state: string;
  resourceType: "service" | "postgres" | "redis" | "mariadb" | "mongodb";
  projectSlug: ProjectSlug | null;
  projectName: string | null;
  serviceResourceId: ResourceId | null;
  serviceName: string | null;
  replicaSlot: string | null;
}

export interface TerminalDatabase {
  resourceId: ResourceId;
  name: string;
  engine: string;
  projectSlug: ProjectSlug;
  projectName: string;
}

export interface TerminalTargets {
  containers: TerminalContainer[];
  databases: TerminalDatabase[];
}

/**
 * Parse "myservice.3.abc123" → ("myservice", "3"). Falls back to (full, null)
 * when the name doesn't carry a slot suffix (postgres containers do not).
 */
function splitTaskName(name: string): {
  serviceName: string;
  slot: string | null;
} {
  // Stripping a leading slash that docker prepends to Names entries.
  const clean = name.replace(/^\//, "");
  // Swarm task naming: `<service>.<slot>.<taskId>` — slot is numeric.
  const match = /^(.*)\.(\d+)\.[a-z0-9]+$/.exec(clean);
  if (match && match[1])
    return { serviceName: match[1], slot: match[2] ?? null };
  return { serviceName: clean, slot: null };
}

export async function listTerminalTargets(input: {
  organizationId: OrgId;
}): Promise<TerminalTargets> {
  // Org projects — slugs let us scope label-filtered containers safely.
  const projects = await db
    .select({ id: project.id, slug: project.slug, name: project.name })
    .from(project)
    .where(eq(project.organizationId, input.organizationId));

  const slugToProject = new Map<string, { id: string; name: string }>();
  for (const p of projects)
    slugToProject.set(p.slug, { id: p.id, name: p.name });

  // ── Containers ────────────────────────────────────────────────────────
  // Docker label filter: `otterstack.managed=true`. We narrow further
  // server-side by checking each container's `otterstack.project` label is
  // an org-owned slug before emitting.
  const docker = Docker.fromEnv();
  const listed = await docker.containers.list({
    all: false, // running only — exec is meaningless against stopped
    filters: { label: ["otterstack.managed=true"] },
  });

  const containers: TerminalContainer[] = [];
  if (listed.isOk()) {
    for (const c of listed.value) {
      const labels = c.Labels ?? {};
      const labelProjectSlug = labels["otterstack.project"] ?? null;
      // Org guard: drop containers whose project label isn't one of ours.
      if (!labelProjectSlug || !slugToProject.has(labelProjectSlug)) continue;

      const resourceType = labels["otterstack.resource.type"];
      // Accept services + every database engine we support. Anything else
      // (e.g. otterstack-caddy / otterstack-server itself) gets dropped.
      if (
        resourceType !== "service" &&
        resourceType !== "postgres" &&
        resourceType !== "redis" &&
        resourceType !== "mariadb" &&
        resourceType !== "mongodb"
      )
        continue;

      const rawName = c.Names?.[0] ?? c.Id;
      const { serviceName, slot } = splitTaskName(rawName);
      const labelResourceId = labels["otterstack.resource.id"];

      containers.push({
        containerId: c.Id,
        name: serviceName,
        image: c.Image,
        state: c.State,
        resourceType,
        // Cast: the slug came off a docker label as a raw string. We've
        // already verified above (slugToProject.has) that it matches an
        // org-owned project, so it's safe to brand here.
        projectSlug: labelProjectSlug as ProjectSlug,
        projectName: slugToProject.get(labelProjectSlug)?.name ?? null,
        serviceResourceId: (labelResourceId as ResourceId | undefined) ?? null,
        serviceName,
        replicaSlot: slot,
      });
    }
  }
  // Sort: project then service then replica slot for stable rendering.
  containers.sort((a, b) => {
    if (a.projectSlug !== b.projectSlug) {
      return (a.projectSlug ?? "").localeCompare(b.projectSlug ?? "");
    }
    if (a.serviceName !== b.serviceName) {
      return (a.serviceName ?? "").localeCompare(b.serviceName ?? "");
    }
    const aSlot = Number(a.replicaSlot ?? 0);
    const bSlot = Number(b.replicaSlot ?? 0);
    return aSlot - bSlot;
  });

  // ── Databases ─────────────────────────────────────────────────────────
  const dbRows = await db
    .select({
      resourceId: resource.id,
      name: resource.name,
      engine: databaseResource.engine,
      projectSlug: project.slug,
      projectName: project.name,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(project.organizationId, input.organizationId));

  const databases: TerminalDatabase[] = dbRows.map((r) => ({
    resourceId: r.resourceId,
    name: r.name,
    engine: r.engine,
    projectSlug: r.projectSlug as ProjectSlug,
    projectName: r.projectName,
  }));

  return { containers, databases };
}
