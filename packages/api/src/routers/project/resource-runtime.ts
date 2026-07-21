/**
 * Generic per-resource runtime endpoints — tasks (deployment history) and
 * env vars. Dispatches on resource kind so the same procedures work for
 * postgres, services, and any future engine.
 *
 *   tasks ── docker.tasks.list filtered by the resource's swarm service name
 *   env   ── databaseResource.extraEnv (jsonb) for databases
 *            serviceEnvVar rows for services
 *
 * One frontend call site per tab covers every container-backed resource.
 */
import type { ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";

import type { ResourceRef } from "../scopes";
import type { ServiceTaskInfo } from "./service-tasks";

import { updateSwarmDatabase } from "../../runtime/db";
import { defaultImageFor } from "../../swarm";
import { bulkReplaceServiceEnvVars, listServiceEnvVars } from "../service/queries";
import { redeployAndFanOut } from "../service/redeploy";
import { insertDeployment, markDeploymentFailed } from "./deployments";
import { PostgresResourceNotFoundError, ProjectNotFoundError } from "./errors";
import {
  getDatabaseResourceRecord,
  getProjectInOrg,
  getProjectRecord,
  setDatabaseResourceExtraEnv,
} from "./queries";
import { composeChildSwarmServices, getResourceById } from "./queries/resource";
import {
  collapseInstanceState,
  listResourceInstances,
  type ResourceInstance,
} from "./resource-instances";
import { buildContainerName, buildVolumeName, sanitizeProjectSlug } from "./views";

export interface EnvEntry {
  key: string;
  value: string;
}

// Resolve a resource to its swarm service name. Postgres uses the
// deterministic name pattern; services store it directly on the row. Compose
// stacks have no single swarm service (they fan out per sub-service) and are
// handled by the compose branch in listResourceTasks instead.
async function resolveSwarmService(
  projectId: ProjectId,
  found: NonNullable<Awaited<ReturnType<typeof getResourceById>>>,
): Promise<{ serviceName: string; projectSlug: string } | null> {
  if (found.kind === "compose") return null;
  if (found.kind === "database") {
    const project = await getProjectRecord(projectId);
    const slug = project?.slug ?? projectId;
    return {
      serviceName: buildContainerName({
        engine: found.record.database.engine,
        projectSlug: slug,
        resourceName: found.record.resource.name,
      }),
      projectSlug: sanitizeProjectSlug(slug),
    };
  }
  return {
    serviceName: found.record.service.serviceName,
    projectSlug: "",
  };
}

const instanceTimeMs = (t: { updatedAt: string | null; createdAt: string | null }) =>
  new Date(t.updatedAt ?? t.createdAt ?? 0).getTime();

// Map one runtime instance to the wire shape, tagged with the compose
// sub-service it belongs to (null for single-service resources).
function toTaskInfo(
  t: ResourceInstance,
  serviceName: string,
  service: string | null,
): ServiceTaskInfo {
  return {
    id: t.id,
    slot: t.slot,
    label: t.slot != null ? `${serviceName}.${t.slot}` : serviceName,
    service,
    state: collapseInstanceState(t.state),
    rawState: t.state,
    desiredState: t.desiredState,
    nodeId: t.nodeId,
    message: t.message,
    error: t.err,
    containerId: t.containerId,
    exitCode: t.exitCode,
    timestamp: t.updatedAt,
    // Docker: the container's own RestartCount. Swarm (no RestartCount): a
    // retired task ("shutdown") stands in for one restart.
    restarts: t.restartCount ?? (t.desiredState === "shutdown" ? 1 : 0),
  };
}

async function collapseAndSort(docker: Docker, serviceName: string) {
  const instancesResult = await listResourceInstances(docker, serviceName);
  if (instancesResult.isErr()) return [];
  // Newest first so the panel reads chronologically without client-side sorting.
  return [...instancesResult.value].sort((a, b) => instanceTimeMs(b) - instanceTimeMs(a));
}

export async function listResourceTasks(
  input: ResourceRef,
): Promise<Result<ServiceTaskInfo[], ProjectNotFoundError | PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  const docker = Docker.fromEnv();

  // A compose stack has no swarm service of its own — aggregate instances
  // across every `${stack}-${key}` child, tagging each task with its compose
  // sub-service so the panel can group per service.
  if (found.kind === "compose") {
    const tasks: ServiceTaskInfo[] = [];
    for (const child of composeChildSwarmServices(found.record)) {
      const instances = await collapseAndSort(docker, child.serviceName);
      tasks.push(...instances.map((t) => toTaskInfo(t, child.serviceName, child.service)));
    }
    tasks.sort((a, b) => {
      const at = new Date(a.timestamp ?? 0).getTime();
      const bt = new Date(b.timestamp ?? 0).getTime();
      return bt - at;
    });
    return Result.ok(tasks);
  }

  const target = await resolveSwarmService(input.projectId, found);
  if (!target) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  // Runtime-aware: swarm tasks, or plain-docker containers under the default
  // runtime (where docker.tasks.list would fail with "service not found").
  const instances = await collapseAndSort(docker, target.serviceName);
  // Single-service runtime view — no compose sub-service breakdown here.
  return Result.ok(instances.map((t) => toTaskInfo(t, target.serviceName, null)));
}

export async function listResourceEnv(
  input: ResourceRef,
): Promise<Result<EnvEntry[], ProjectNotFoundError | PostgresResourceNotFoundError>> {
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  // The stack resource holds no env of its own — each child service does.
  if (found.kind === "compose") return Result.ok([]);

  if (found.kind === "database") {
    const record = await getDatabaseResourceRecord(input.projectId, input.resourceId);
    const env = (record?.database.extraEnv ?? {}) as Record<string, string>;
    return Result.ok(Object.entries(env).map(([key, value]) => ({ key, value })));
  }

  const rows = await listServiceEnvVars(input.resourceId);
  return Result.ok(rows.map((r) => ({ key: r.key, value: r.value })));
}

export async function bulkSetResourceEnv(
  input: ResourceRef & { env: EnvEntry[]; secretKeys?: string[]; redeploy?: boolean },
  log: RequestLogger,
): Promise<Result<EnvEntry[], ProjectNotFoundError | PostgresResourceNotFoundError>> {
  // Env is baked into a container at creation, so the write only takes effect
  // on a re-apply. `redeploy: false` (the Variables tab) persists the diff and
  // leaves the running container untouched until an explicit Deploy; the next
  // deploy re-resolves env from these rows and picks the change up. Omitted ⇒
  // eager redeploy, preserving the CLI / manifest-reconciler behaviour.
  const shouldRedeploy = input.redeploy !== false;
  const project = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  const found = await getResourceById(input.projectId, input.resourceId);
  if (!found) {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  // Env writes target a concrete service/database — never the stack resource
  // itself (its children own their env). Reject rather than write junk rows.
  if (found.kind === "compose") {
    return Result.err(new PostgresResourceNotFoundError({ resourceId: input.resourceId }));
  }

  if (found.kind === "database") {
    // Collapse to record, write atomically, re-render the swarm spec so the
    // postgres container picks up the new env on its next start.
    const next: Record<string, string> = {};
    for (const e of input.env) next[e.key] = e.value;
    // Filter secretKeys to only those that still exist in `next` — guards
    // against the editor sending a key that was deleted in the same save.
    const filteredSecrets = input.secretKeys?.filter((k) => k in next);
    await setDatabaseResourceExtraEnv(input.resourceId, next, filteredSecrets);

    const dbRecord = await getDatabaseResourceRecord(input.projectId, input.resourceId);
    if (dbRecord && shouldRedeploy) {
      const projectSlug = sanitizeProjectSlug(project.slug);
      const resourceName = dbRecord.resource.name;
      // Use the engine from the row — not "postgres" — so redis/mariadb/
      // mongo containers don't get silently replaced with postgres on
      // every env edit. Same bug pattern as env.ts; see the comment
      // there for the full incident.
      const engine = dbRecord.database.engine;
      const engineImage = defaultImageFor(engine);
      const envDeployment = await insertDeployment({
        resourceId: input.resourceId,
        image: engineImage,
        reason: "env-change",
        snapshot: {
          kind: "postgres",
          version: 1,
          image: engineImage,
          databaseName: dbRecord.database.databaseName,
          username: dbRecord.database.username,
          password: dbRecord.database.password,
          publicEnabled: dbRecord.database.publicEnabled,
          publicHostname: dbRecord.database.publicHostname,
          internalHostname: dbRecord.database.internalHostname,
          extraEnv: next,
        },
      });
      // Wrapped so a driver throw marks the just-inserted row failed instead of
      // stranding it "building" forever (the stale-row rescue only covers
      // zero-task rows; a live DB container keeps deriving from its tasks).
      const rolled = await Result.tryPromise({
        try: () =>
          updateSwarmDatabase(
            {
              engine,
              resourceId: input.resourceId,
              serviceName: buildContainerName({ engine, projectSlug, resourceName }),
              volumeName: buildVolumeName({ engine, projectSlug, resourceName }),
              hostnameAlias: dbRecord.database.internalHostname,
              databaseName: dbRecord.database.databaseName,
              username: dbRecord.database.username,
              password: dbRecord.database.password,
              projectSlug,
              deploymentId: envDeployment.id,
              extraEnv: next,
              public: dbRecord.database.publicEnabled,
            },
            log,
          ),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      if (rolled.isErr()) {
        await markDeploymentFailed(
          envDeployment.id,
          `database env roll failed: ${rolled.error.message}`,
        ).catch(() => undefined);
        throw rolled.error;
      }
    }
    log.set({
      resource: {
        kind: dbRecord?.database.engine ?? "postgres",
        envKeys: Object.keys(next).length,
      },
    });
    return Result.ok(input.env);
  }

  // service — reuse the existing service env path which handles bulk
  // replace + ref fan-out. Redeploy is best-effort: we've already saved
  // the env and the next normal deploy picks it up.
  const secretSet = new Set(input.secretKeys ?? []);
  await bulkReplaceServiceEnvVars(
    input.resourceId,
    input.env.map((e) => ({ ...e, isSecret: secretSet.has(e.key) })),
  );
  if (!shouldRedeploy) {
    log.set({ env: { outcome: "saved_no_redeploy" } });
    return Result.ok(input.env);
  }
  const redeployed = await redeployAndFanOut(input.projectId, input.resourceId, project.slug, log);
  if (redeployed.isErr()) {
    log.set({
      env: {
        outcome: "saved_redeploy_failed",
        reason: redeployed.error.message,
      },
    });
  }
  return Result.ok(input.env);
}
