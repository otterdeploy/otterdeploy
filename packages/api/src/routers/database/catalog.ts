/**
 * Org-wide database catalog handler. One DB round for identity (every base
 * database resource joined to its project), one for last-backup freshness,
 * one for latest-deployment images — then a bounded parallel sweep of the
 * runtime for per-database status + live stats (see catalog-stats.ts).
 *
 * Degradation is per-database and per-field: a database whose runtime can't
 * be inspected reports `runtimeStatus: "unreachable"`, a running database
 * whose probe fails/times out reports `stats: null`, and the rest of the
 * catalog is unaffected. Probes are capped at ~3s each and run concurrently,
 * so the endpoint's latency is one probe, not the sum.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";
import type * as z from "zod";

import { db } from "@otterdeploy/db";
import { backup, databaseResource, deployment, project, resource } from "@otterdeploy/db/schema";
import { DATABASE_ENGINES } from "@otterdeploy/shared/database-engines";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { orgCatalogItemSchema } from "./contract-catalog";
import type { DbConnInfo } from "./query";

import { requirePermission } from "../..";
import { inspectSwarmDatabaseRuntime } from "../../runtime/db";
import { defaultImageFor } from "../../swarm";
import { buildContainerName, buildVolumeName } from "../project/views";
import {
  backupFreshnessPerResource,
  type CatalogStats,
  firstPerResource,
  versionFromImage,
  withTimeout,
} from "./catalog-shared";
import { collectEngineStats } from "./catalog-stats";

export type OrgCatalogItem = z.infer<typeof orgCatalogItemSchema>;

const PROBE_TIMEOUT_MS = 3_000;

async function probeRuntime(input: {
  serviceName: string;
  volumeName: string;
  projectSlug: string;
}): Promise<OrgCatalogItem["runtimeStatus"]> {
  try {
    const runtime = await withTimeout(inspectSwarmDatabaseRuntime(input), PROBE_TIMEOUT_MS);
    return runtime.status;
  } catch {
    return "unreachable";
  }
}

async function probeStats(conn: DbConnInfo): Promise<CatalogStats | null> {
  try {
    return await withTimeout(collectEngineStats(conn), PROBE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export async function buildOrgDatabaseCatalog(
  organizationId: OrganizationId,
): Promise<OrgCatalogItem[]> {
  // Base databases only — preview-scoped branches belong to their PR, not the
  // org catalog (same rule as the project graph's resource list).
  const rows = await db
    .select({
      resource,
      database: databaseResource,
      projectName: project.name,
      projectSlug: project.slug,
    })
    .from(resource)
    .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(and(eq(project.organizationId, organizationId), isNull(resource.previewId)))
    .orderBy(project.slug, resource.name);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.resource.id);

  const [backupRows, deploymentRows] = await Promise.all([
    db
      .select({
        resourceId: backup.resourceId,
        status: backup.status,
        completedAt: backup.completedAt,
        createdAt: backup.createdAt,
      })
      .from(backup)
      .where(
        and(
          eq(backup.organizationId, organizationId),
          eq(backup.kind, "database"),
          inArray(backup.resourceId, ids),
        ),
      )
      .orderBy(desc(backup.createdAt)),
    db
      .select({
        resourceId: deployment.resourceId,
        image: deployment.image,
      })
      .from(deployment)
      .where(and(inArray(deployment.resourceId, ids), isNull(deployment.previewId)))
      .orderBy(desc(deployment.createdAt)),
  ]);

  // `backup.resourceId` is nullable at the type level (volume runs carry a
  // volume name instead), but the inArray filter above can only match
  // non-null resource ids — narrow for the aggregator.
  const freshness = backupFreshnessPerResource(
    backupRows.filter(
      (r): r is typeof r & { resourceId: (typeof ids)[number] } => r.resourceId !== null,
    ),
  );
  const latestDeployment = firstPerResource(deploymentRows);

  return Promise.all(
    rows.map(async (row): Promise<OrgCatalogItem> => {
      const engine = row.database.engine;
      const naming = {
        engine,
        projectSlug: row.projectSlug,
        resourceName: row.resource.name,
      };
      const serviceName = buildContainerName(naming);
      const volumeName = buildVolumeName(naming);

      const runtimeStatus = await probeRuntime({
        serviceName,
        volumeName,
        projectSlug: row.projectSlug,
      });

      // Only interrogate a database the runtime says is up — probing a
      // stopped container would just burn the timeout per card.
      const conn: DbConnInfo = {
        engine,
        username: row.database.username,
        password: row.database.password,
        databaseName: row.database.databaseName,
        projectSlug: row.projectSlug,
        resourceName: row.resource.name,
        resourceId: row.resource.id,
      };
      const stats = runtimeStatus === "running" ? await probeStats(conn) : null;

      const image = latestDeployment.get(row.resource.id)?.image ?? defaultImageFor(engine);
      const backupInfo = freshness.get(row.resource.id);

      return {
        resourceId: row.resource.id,
        name: row.resource.name,
        projectId: row.resource.projectId,
        projectName: row.projectName,
        projectSlug: row.projectSlug,
        engine,
        engineLabel: DATABASE_ENGINES[engine].label,
        image,
        version: versionFromImage(image),
        status: row.resource.status,
        runtimeStatus,
        volumeName,
        internalHostname: row.database.internalHostname,
        internalPort: row.database.internalPort,
        internalConnectionString: row.database.internalConnectionString,
        publicEnabled: row.database.publicEnabled,
        publicHostname: row.database.publicEnabled ? row.database.publicHostname : null,
        lastBackupAt: backupInfo?.lastBackupAt ?? null,
        lastBackupStatus: backupInfo?.lastBackupStatus ?? null,
        stats,
      };
    }),
  );
}

export const catalogDatabaseHandlers = {
  listOrgCatalog: requirePermission({ database: ["read"] }).database.listOrgCatalog.handler(
    async ({ context }) => {
      const databases = await buildOrgDatabaseCatalog(context.activeOrganizationId);
      context.log.set({ catalog: { databases: databases.length } });
      return { databases };
    },
  ),
};
