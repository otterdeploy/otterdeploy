/**
 * Terminal target discovery. One read covers everything the picker needs to
 * show under Container + Database tabs. SSH targets piggyback on the existing
 * org-scoped server.list — no need to re-source them here.
 *
 * Org scoping:
 *   - Containers: filtered to docker labels { otterdeploy.managed=true,
 *     otterdeploy.project=<projectSlug> } for projects in this org.
 *   - Databases: SQL join `resource → project` filtered by organizationId.
 *
 * Container labels are the source of truth for the project mapping — we DO
 * NOT trust labels to identify the org (a different deployment in the same
 * Docker daemon could spoof them). Instead we pre-load the org's project
 * slugs and only emit containers whose `otterdeploy.project` label matches.
 */
import type { OrganizationId, ProjectId, ProjectSlug, ResourceId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource, serviceResource } from "@otterdeploy/db/schema/project";
import { type ContainerSummary, Docker } from "@otterdeploy/docker";
import { FRAMEWORK_KINDS, type Framework } from "@otterdeploy/shared/framework";
import { canonicalId, ID_PREFIX, zId, zSlug } from "@otterdeploy/shared/id";
import { and, eq, inArray, isNull } from "drizzle-orm";
type OrgId = OrganizationId;

export interface TerminalContainer {
  containerId: string;
  projectId: ProjectId;
  name: string;
  image: string;
  state: string;
  resourceType: "service" | "postgres" | "redis" | "mariadb" | "mongodb";
  /** Detected framework for source-built services (picker icon fallback). */
  framework: Framework | null;
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

const TERMINAL_RESOURCE_TYPE_LIST = [
  "service",
  "postgres",
  "redis",
  "mariadb",
  "mongodb",
] satisfies TerminalContainer["resourceType"][];
const TERMINAL_RESOURCE_TYPES: ReadonlySet<string> = new Set(TERMINAL_RESOURCE_TYPE_LIST);

function isTerminalResourceType(
  value: string | undefined,
): value is TerminalContainer["resourceType"] {
  return value !== undefined && TERMINAL_RESOURCE_TYPES.has(value);
}

// Docker labels and DB slug/id columns travel as plain strings — parse (not
// cast) to the branded types at this boundary.
const projectIdSchema = zId("prj");
const resourceIdSchema = zId("res");
const projectSlugSchema = zSlug(ID_PREFIX.project);

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
  if (match && match[1]) return { serviceName: match[1], slot: match[2] ?? null };
  return { serviceName: clean, slot: null };
}

/**
 * Map a docker container summary to a terminal target, or `null` when it should
 * be dropped (project label not org-owned, or an unsupported resource type).
 */
function toTerminalContainer(
  c: ContainerSummary,
  slugToProject: Map<string, { id: string; name: string }>,
): TerminalContainer | null {
  const labels = c.Labels ?? {};
  const labelProjectSlug = labels["otterdeploy.project"] ?? null;
  const terminalProject = labelProjectSlug ? slugToProject.get(labelProjectSlug) : undefined;
  // Org guard: drop containers whose project label isn't one of ours.
  if (!labelProjectSlug || !terminalProject) return null;

  const resourceType = labels["otterdeploy.resource.type"];
  // Accept services + every database engine we support. Anything else
  // (e.g. otterdeploy-caddy / otterdeploy-server itself) gets dropped.
  if (!isTerminalResourceType(resourceType)) return null;

  const rawName = c.Names?.[0] ?? c.Id;
  const { serviceName, slot } = splitTaskName(rawName);
  const rawLabelResourceId = labels["otterdeploy.resource.id"];
  // Old prefix on pre-rename containers; callers match this against DB ids.
  const labelResourceId = rawLabelResourceId ? canonicalId(rawLabelResourceId) : rawLabelResourceId;

  // The slug came off a docker label and the id off our own project row —
  // parse both rather than cast; a malformed label drops the container the
  // same way an unknown project slug does.
  const parsedSlug = projectSlugSchema.safeParse(labelProjectSlug);
  const parsedProjectId = projectIdSchema.safeParse(terminalProject.id);
  if (!parsedSlug.success || !parsedProjectId.success) return null;
  const parsedResourceId = resourceIdSchema.safeParse(labelResourceId);

  return {
    containerId: c.Id,
    projectId: parsedProjectId.data,
    name: serviceName,
    image: c.Image,
    state: c.State,
    resourceType,
    // Stamped in a batch after assembly (one query for all service rows).
    framework: null,
    projectSlug: parsedSlug.data,
    projectName: terminalProject.name,
    serviceResourceId: parsedResourceId.success ? parsedResourceId.data : null,
    serviceName,
    replicaSlot: slot,
  };
}

export async function listTerminalTargets(input: {
  organizationId: OrgId;
  /** Optional project allow-list, used by project-restricted API keys. */
  projectIds?: string[];
}): Promise<TerminalTargets> {
  // Org projects — slugs let us scope label-filtered containers safely.
  const projects = await db
    .select({ id: project.id, slug: project.slug, name: project.name })
    .from(project)
    .where(eq(project.organizationId, input.organizationId));

  const slugToProject = new Map<string, { id: string; name: string }>();
  const allowedProjectIds = input.projectIds ? new Set(input.projectIds) : null;
  for (const p of projects) {
    if (!allowedProjectIds || allowedProjectIds.has(p.id)) {
      slugToProject.set(p.slug, { id: p.id, name: p.name });
    }
  }

  // ── Containers ────────────────────────────────────────────────────────
  // Docker label filter: `otterdeploy.managed=true`. We narrow further
  // server-side by checking each container's `otterdeploy.project` label is
  // an org-owned slug before emitting.
  const docker = Docker.fromEnv();
  const listed = await docker.containers.list({
    all: false, // running only — exec is meaningless against stopped
    filters: { label: ["otterdeploy.managed=true"] },
  });

  const containers: TerminalContainer[] = [];
  if (listed.isOk()) {
    for (const c of listed.value) {
      const mapped = toTerminalContainer(c, slugToProject);
      if (mapped) containers.push(mapped);
    }
  }
  // Framework enrichment: the picker's icon fallback when the image ref
  // resolves no brand mark (source-built services have a build image no
  // resolver recognises, but a detected framework we can render instead).
  const frameworkIds = containers.flatMap((c) =>
    c.resourceType === "service" && c.serviceResourceId ? [c.serviceResourceId] : [],
  );
  if (frameworkIds.length > 0) {
    const rows = await db
      .select({ resourceId: serviceResource.resourceId, framework: serviceResource.framework })
      .from(serviceResource)
      .where(inArray(serviceResource.resourceId, frameworkIds));
    const frameworkByResource = new Map(rows.map((r) => [r.resourceId, r.framework]));
    const isFramework = (value: string | null | undefined): value is Framework =>
      value != null && FRAMEWORK_KINDS.some((kind) => kind === value);
    for (const c of containers) {
      const detected = c.serviceResourceId ? frameworkByResource.get(c.serviceResourceId) : null;
      if (isFramework(detected)) c.framework = detected;
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
      projectId: project.id,
      projectSlug: project.slug,
      projectName: project.name,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    // Base databases only — a PR preview's branch DB is not a terminal target.
    .where(and(eq(project.organizationId, input.organizationId), isNull(resource.previewId)));

  const databases: TerminalDatabase[] = dbRows
    .filter((row) => !allowedProjectIds || allowedProjectIds.has(row.projectId))
    .map((r) => ({
      resourceId: r.resourceId,
      name: r.name,
      engine: r.engine,
      // Our own project row — parse the plain-text column to the brand.
      projectSlug: projectSlugSchema.parse(r.projectSlug),
      projectName: r.projectName,
    }));

  return { containers, databases };
}
