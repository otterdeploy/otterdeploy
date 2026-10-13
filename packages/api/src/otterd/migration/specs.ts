/**
 * The otterd service a legacy resource becomes: the same spec its next
 * legacy deploy would have built, translated once, with the image the
 * running container actually runs, placed on the container's node. A
 * migration never changes what runs; it changes who is responsible for it.
 */
import type { ServiceSpec } from "@otterdeploy/otterd-proto";

import { db } from "@otterdeploy/db";
import { project, resource } from "@otterdeploy/db/schema/project";
import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { eq } from "drizzle-orm";

import { resolveRuntimeScope } from "../../lib/environment/runtime-scope";
import { networkScopeSuffix } from "../../lib/environment/scoping";
import { resolveServiceEnv } from "../../lib/variables";
import { getLatestDeploymentForResource } from "../../routers/project/deployments";
import { getDatabaseResourceRecord } from "../../routers/project/queries/postgres-resource";
import { buildContainerName, buildVolumeName } from "../../routers/project/view-helpers";
import { getServiceRecord } from "../../routers/service/queries/service";
import { buildSwarmSpec } from "../../routers/service/spec";
import { sanitizeSlug } from "../../routers/service/views";
import { databaseToSpec, serviceToSpec } from "../translate";

export interface MigrationSpec {
  spec: ServiceSpec;
  /** The runtime name the deploy layer addresses it by. */
  serviceName: string;
}

const detail = (r: Result<ServiceSpec, { detail: string }>): Result<ServiceSpec, string> =>
  r.mapError((e) => `spec refused: ${e.detail}`);

async function serviceSpecOf(
  row: { id: string; projectId: string },
  slug: string,
  nodeId: string,
  image: string,
): Promise<Result<MigrationSpec, string>> {
  const projectId = idSchema.project.parse(row.projectId);
  const resourceId = idSchema.resource.parse(row.id);
  const record = await getServiceRecord(projectId, resourceId);
  if (!record) return Result.err(`no service record for ${row.id}`);
  const env = await resolveServiceEnv(projectId, resourceId);
  if (env.isErr()) return Result.err(`env does not resolve: ${env.error.message}`);
  const scope = await resolveRuntimeScope(record.resource);
  const legacy = await buildSwarmSpec(record, env.value, sanitizeSlug(slug), scope, image);
  return detail(serviceToSpec(legacy, { nodeId })).map((spec) => ({
    spec,
    serviceName: legacy.serviceName,
  }));
}

async function databaseSpecOf(
  row: { id: string; projectId: string; name: string },
  slug: string,
  nodeId: string,
  image: string,
): Promise<Result<MigrationSpec, string>> {
  const projectId = idSchema.project.parse(row.projectId);
  const resourceId = idSchema.resource.parse(row.id);
  const record = await getDatabaseResourceRecord(projectId, resourceId);
  if (!record) return Result.err(`no database record for ${row.id}`);
  if (record.database.hostResourceId) {
    return Result.err("a database on a shared host moves with its host");
  }
  const engine = record.database.engine;
  const projectSlug = sanitizeSlug(slug);
  const names = { engine, projectSlug, resourceName: row.name };
  const serviceName = buildContainerName({ ...names, stored: record.database.serviceName });
  const latest = await getLatestDeploymentForResource(resourceId);
  const spec = databaseToSpec(
    {
      engine,
      resourceId: row.id,
      image,
      serviceName,
      volumeName: buildVolumeName({ ...names, stored: record.database.volumeName }),
      hostnameAlias: record.database.internalHostname,
      networkScopeSuffix: networkScopeSuffix(await resolveRuntimeScope(record.resource)),
      databaseName: record.database.databaseName,
      username: record.database.username,
      password: record.database.password,
      projectSlug,
      deploymentId: latest?.id ?? "migration",
      extraEnv: record.database.extraEnv ?? {},
      public: record.database.publicEnabled,
    },
    { nodeId },
  );
  return detail(spec).map((s) => ({ spec: s, serviceName }));
}

/** The otterd spec for a legacy resource whose container runs `image` on `nodeId`. */
export async function migrationSpecFor(
  resourceId: string,
  nodeId: string,
  image: string,
): Promise<Result<MigrationSpec, string>> {
  const id = idSchema.resource.safeParse(resourceId);
  if (!id.success) return Result.err(`not a resource id: ${resourceId}`);
  const [row] = await db
    .select({
      id: resource.id,
      projectId: resource.projectId,
      name: resource.name,
      type: resource.type,
      previewId: resource.previewId,
      slug: project.slug,
    })
    .from(resource)
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(eq(resource.id, id.data));
  if (!row) return Result.err(`no resource ${resourceId}`);
  if (row.previewId) return Result.err("a preview migrates with its base resource");
  if (row.type === "service") return serviceSpecOf(row, row.slug, nodeId, image);
  if (row.type === "database") return databaseSpecOf(row, row.slug, nodeId, image);
  return Result.err(`a ${row.type} resource has no container of its own`);
}
