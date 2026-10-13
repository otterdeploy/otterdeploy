import type { ProjectId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { environment, preview, resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { and, count, eq, inArray } from "drizzle-orm";

import type { OrgRef } from "../scopes";

import { reconcile } from "../../caddy";
import { removeProjectDir } from "../../lib/data-dir";
import { destroySwarmPostgres } from "../../runtime/db";
import {
  ProjectNotFoundError,
  ProjectHasServicesError,
  ProjectResourceDeleteError,
} from "./errors";
import { deleteProjectContents } from "./project-delete-contents";
import { projectNetworkCandidates, removeProjectNetworks } from "./project-networks";
import { getProjectInOrg, listDatabaseResourceRecords, deleteProjectRecord } from "./queries";
import { buildContainerName, sanitizeProjectSlug } from "./views";

export async function deleteProject(
  input: { id: ProjectId; deleteContents?: boolean } & OrgRef,
  log: RequestLogger,
): Promise<
  Result<{ ok: true }, ProjectNotFoundError | ProjectHasServicesError | ProjectResourceDeleteError>
> {
  const project = await getProjectInOrg({
    projectId: input.id,
    organizationId: input.organizationId,
  });
  if (!project) {
    return Result.err(new ProjectNotFoundError({ projectId: input.id }));
  }

  if (input.deleteContents) {
    const teardown = await deleteProjectContents(
      { projectId: input.id, organizationId: input.organizationId },
      log,
    );
    if (teardown.isErr()) return Result.err(teardown.error);
  }

  // Legacy callers must explicitly opt in to deleting project contents.
  // Never cascade rows underneath runtimes that have not been reclaimed.
  const [serviceRow] = await db
    .select({ n: count() })
    .from(resource)
    .where(and(eq(resource.projectId, input.id), inArray(resource.type, ["service", "compose"])));
  const serviceCount = serviceRow?.n ?? 0;
  if (serviceCount > 0) {
    log.set({ teardown: { refused: "services_exist", serviceCount } });
    return Result.err(new ProjectHasServicesError({ projectId: input.id, serviceCount }));
  }

  const projectSlug = sanitizeProjectSlug(project.slug);
  const dbRecords = await listDatabaseResourceRecords(input.id);
  // Preview branch containers are named `<name>-<preview slug>`. Resolve the
  // slugs so project deletion reaps them too, not just the base containers.
  const previewRows = await db
    .select({ id: preview.id, slug: preview.slug })
    .from(preview)
    .where(eq(preview.projectId, input.id));
  const previewSlugById = new Map(previewRows.map((r) => [r.id, r.slug]));
  // Read before the delete cascades the environment rows away: each
  // additional environment has an overlay network of its own.
  const environments = await db
    .select({ id: environment.id, slug: environment.slug })
    .from(environment)
    .where(eq(environment.projectId, input.id));

  // 1. Tear down each child postgres Swarm service before dropping DB rows.
  //    FK cascade handles preview / resource / database_resource / proxy_route.
  for (const record of dbRecords) {
    const previewSlug = record.resource.previewId
      ? previewSlugById.get(record.resource.previewId)
      : undefined;
    const serviceName = buildContainerName({
      stored: record.database.serviceName,
      engine: record.database.engine,
      projectSlug,
      resourceName: previewSlug ? `${record.resource.name}-${previewSlug}` : record.resource.name,
    });
    await destroySwarmPostgres({ serviceName }, log);
  }

  // 2. Delete the project row, FKs cascade to children.
  const deleted = await deleteProjectRecord({
    projectId: input.id,
    organizationId: input.organizationId,
  });
  if (!deleted) {
    return Result.err(new ProjectNotFoundError({ projectId: input.id }));
  }

  // 3. Refresh Caddy so removed proxy routes drop out of the live config.
  await reconcile(log);

  // 4. Remove the project's overlay networks (main + one per environment).
  //    One still in use, or a daemon that is unreachable, goes to the orphan
  //    GC rather than failing a delete that has already committed.
  const networks = await removeProjectNetworks(
    projectNetworkCandidates({
      slug: project.slug,
      environments,
      mainEnvironmentId: project.environmentId,
    }),
    { organizationId: input.organizationId, projectId: input.id },
    log,
  );

  // 5. Drop the project's whole host subtree
  //    (`orgs/<org>/projects/<prj>/`: envs, resources, DR escape hatch).
  //    Guarded + best-effort; no-op when the data folder isn't in use.
  await removeProjectDir(input.organizationId, input.id);

  log.set({
    teardown: {
      swarmServicesDestroyed: dbRecords.length,
      networksRemoved: networks.removed,
      networksDeferred: networks.deferred,
      projectDeleted: true,
    },
  });

  return Result.ok({ ok: true });
}
