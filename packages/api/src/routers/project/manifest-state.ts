/**
 * Materialize the diff's `CurrentState` view from DB rows for a project.
 * Adapter only — pure diff logic lives in stack/manifest/diff.ts.
 */

import type { ProjectId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import {
  composeResource,
  databaseResource,
  resource,
  serviceEnvVar,
  servicePort,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type {
  CurrentCompose,
  CurrentDatabase,
  CurrentService,
  CurrentServicePort,
  CurrentState,
} from "../../stack/manifest/diff";

interface ServiceStateRow {
  resource: typeof resource.$inferSelect;
  service: typeof serviceResource.$inferSelect;
}

// Map one joined service row + its resolved ports/env onto the diff's
// CurrentService view. Kept out of loadCurrentState so the field-by-field
// null-coalescing doesn't inflate that function's branch count.
function toCurrentService(
  row: ServiceStateRow,
  ports: CurrentServicePort[],
  env: Record<string, string>,
): CurrentService {
  return {
    name: row.resource.name,
    source: row.service.source,
    image: row.service.image || null,
    sourceSubdir: row.service.sourceSubdir,
    replicas: row.service.replicas,
    command: row.service.command ?? null,
    entrypoint: row.service.entrypoint ?? null,
    ports,
    env,
    publicEnabled: row.service.publicEnabled,
    preDeploy: row.service.preDeploy ?? null,
    postDeploy: row.service.postDeploy ?? null,
    buildConfig: row.service.buildConfig ?? null,
    restartWindowMs: row.service.restartWindowMs ?? null,
    diskLimitMb: row.service.diskLimitMb ?? null,
    swapLimitMb: row.service.swapLimitMb ?? null,
    pidsLimit: row.service.pidsLimit ?? null,
  };
}

export async function loadCurrentState(projectId: ProjectId): Promise<CurrentState> {
  const [serviceRows, databaseRows, composeRows] = await Promise.all([
    db
      .select({ resource, service: serviceResource })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      // Compose member services are real service_resource rows owned by a
      // stack (stackId set). They reconcile through the stack, not the
      // top-level manifest, so exclude them here — otherwise every deployed
      // stack's children would read back as unmanaged "delete me" services.
      .where(and(eq(resource.projectId, projectId), isNull(serviceResource.stackId))),
    db
      .select({ resource, database: databaseResource })
      .from(resource)
      .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({ name: resource.name })
      .from(resource)
      .innerJoin(composeResource, eq(composeResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
  ]);

  const services: Record<string, CurrentService> = {};
  if (serviceRows.length > 0) {
    const serviceIds = serviceRows.map((r) => r.service.resourceId);
    const [ports, envs] = await Promise.all([
      db.select().from(servicePort).where(inArray(servicePort.serviceResourceId, serviceIds)),
      db.select().from(serviceEnvVar).where(inArray(serviceEnvVar.serviceResourceId, serviceIds)),
    ]);

    const portsBySvc = new Map<string, CurrentServicePort[]>();
    for (const p of ports) {
      const list = portsBySvc.get(p.serviceResourceId) ?? [];
      list.push({
        containerPort: p.containerPort,
        protocol: p.protocol,
        appProtocol: p.appProtocol,
        isPrimary: p.isPrimary,
      });
      portsBySvc.set(p.serviceResourceId, list);
    }

    const envBySvc = new Map<string, Record<string, string>>();
    for (const e of envs) {
      const existing = envBySvc.get(e.serviceResourceId) ?? {};
      existing[e.key] = e.value;
      envBySvc.set(e.serviceResourceId, existing);
    }

    for (const row of serviceRows) {
      const svcPorts = portsBySvc.get(row.service.resourceId) ?? [];
      const svcEnv = envBySvc.get(row.service.resourceId) ?? {};
      services[row.resource.name] = toCurrentService(row, svcPorts, svcEnv);
    }
  }

  const databases: Record<string, CurrentDatabase> = {};
  for (const row of databaseRows) {
    databases[row.resource.name] = {
      name: row.resource.name,
      engine: row.database.engine,
      publicEnabled: row.database.publicEnabled,
      extraEnv: row.database.extraEnv,
    };
  }

  const composes: Record<string, CurrentCompose> = {};
  for (const row of composeRows) {
    composes[row.name] = { name: row.name };
  }

  return { services, databases, composes };
}
