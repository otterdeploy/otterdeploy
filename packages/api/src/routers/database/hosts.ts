/**
 * `database.listHosts`: the servers that can take another logical database.
 *
 * Eligibility is checked here rather than left to the create to reject: an
 * engine that can host at all, a server that isn't itself a tenant, and a
 * container that is actually running. Everything else about the row exists to
 * answer "is there room" — the live connection budget and the tenants already
 * sharing it — because that is the judgement the operator is making.
 *
 * Probing is per host, bounded, and independently degradable: a server that
 * doesn't answer reports `connections: null` and `running: false` instead of
 * failing the list, so one wedged container can't hide every other server.
 */
import type { OrganizationId } from "@otterdeploy/shared/id";
import type * as z from "zod";

import { db } from "@otterdeploy/db";
import { databaseResource, project, resource } from "@otterdeploy/db/schema";
import { Docker } from "@otterdeploy/docker";
import { and, eq, isNull } from "drizzle-orm";

import type { hostSchema } from "./contract-hosts";

import { requirePermission } from "../..";
import { findResourceContainerId } from "../../backups/exec";
import { getHostRow, hostConnectionUsage, listTenantRows } from "../../database-hosting";
import { engineSupportsHosting } from "../../swarm/database-engines/tenancy";
import { withTimeout } from "./catalog-shared";

type Host = z.infer<typeof hostSchema>;

/** Same budget the catalog's stats probe gets: enough for a healthy server to
 *  answer, short enough that a wedged one doesn't stall the page. */
const PROBE_TIMEOUT_MS = 3_000;

/** Engines whose servers can hold isolated tenants. Narrower than
 *  `DatabaseEngine` because the contract only offers these three. */
type HostEngine = Host["engine"];

function isHostEngine(engine: string): engine is HostEngine {
  return engine === "postgres" || engine === "mariadb" || engine === "mongodb";
}

export const hostDatabaseHandlers = {
  listHosts: requirePermission({ database: ["read"] }).database.listHosts.handler(
    async ({ input, context }) => {
      const hosts = await buildHostList(context.activeOrganizationId, input);
      context.log.set({ hosts: { engine: input.engine, count: hosts.length } });
      return { hosts };
    },
  ),
};

async function buildHostList(
  organizationId: OrganizationId,
  input: { engine: HostEngine; projectId?: string },
): Promise<Host[]> {
  const rows = await db
    .select({
      resourceId: resource.id,
      name: resource.name,
      projectId: resource.projectId,
      projectName: project.name,
      engine: databaseResource.engine,
      internalHostname: databaseResource.internalHostname,
      internalPort: databaseResource.internalPort,
      hostResourceId: databaseResource.hostResourceId,
      status: resource.status,
    })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .innerJoin(project, eq(project.id, resource.projectId))
    .where(
      and(
        eq(project.organizationId, organizationId),
        eq(databaseResource.engine, input.engine),
        // A tenant can't host tenants (its role is not a superuser), and a
        // preview branch is a throwaway copy — neither belongs in this list.
        isNull(databaseResource.hostResourceId),
        isNull(resource.previewId),
      ),
    )
    .orderBy(project.slug, resource.name);

  const eligible = rows.filter(
    (row) =>
      isHostEngine(row.engine) &&
      engineSupportsHosting(row.engine) &&
      (!input.projectId || row.projectId === input.projectId),
  );
  if (eligible.length === 0) return [];

  // Concurrent, so the page's latency is one probe rather than the sum.
  return Promise.all(
    eligible.map(async (row): Promise<Host> => {
      const engine = isHostEngine(row.engine) ? row.engine : input.engine;
      const [tenants, running] = await Promise.all([
        listTenantRows(row.resourceId),
        isRunning(row.resourceId),
      ]);
      return {
        resourceId: row.resourceId,
        name: row.name,
        projectId: row.projectId,
        projectName: row.projectName,
        engine,
        internalHostname: row.internalHostname,
        internalPort: row.internalPort,
        running,
        // Only ask a server that's up: probing a stopped container just burns
        // the timeout, once per card.
        connections: running ? await probeConnections(organizationId, row.resourceId) : null,
        tenants: tenants.map((t) => ({
          resourceId: t.resourceId,
          name: t.name,
          projectId: t.projectId,
          databaseName: t.databaseName,
          connectionLimit: t.connectionLimit,
        })),
      };
    }),
  );
}

async function isRunning(resourceId: string): Promise<boolean> {
  const docker = Docker.fromEnv();
  try {
    return (
      (await withTimeout(findResourceContainerId(docker, resourceId), PROBE_TIMEOUT_MS)) !== null
    );
  } catch {
    return false;
  } finally {
    docker.destroy();
  }
}

async function probeConnections(
  organizationId: OrganizationId,
  resourceId: Host["resourceId"],
): Promise<Host["connections"]> {
  try {
    const host = await getHostRow({ organizationId, resourceId });
    if (!host) return null;
    return await withTimeout(hostConnectionUsage(host), PROBE_TIMEOUT_MS);
  } catch {
    // Unknown, not zero. See the contract's note on why that distinction
    // matters on this particular card.
    return null;
  }
}
