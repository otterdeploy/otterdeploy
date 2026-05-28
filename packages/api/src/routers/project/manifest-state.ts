/**
 * Materialize the diff's `CurrentState` view from DB rows for a project.
 * Adapter only — pure diff logic lives in stack/manifest/diff.ts.
 */

import { eq, inArray } from "drizzle-orm";

import { db } from "@otterstack/db";
import {
  databaseResource,
  resource,
  serviceEnvVar,
  servicePort,
  serviceResource,
} from "@otterstack/db/schema/project";
import type { Id, ID_PREFIX } from "@otterstack/shared/id";

import type {
  CurrentDatabase,
  CurrentService,
  CurrentServicePort,
  CurrentState,
} from "../../stack/manifest/diff";

type ProjectId = Id<typeof ID_PREFIX.project>;

export async function loadCurrentState(projectId: ProjectId): Promise<CurrentState> {
  const [serviceRows, databaseRows] = await Promise.all([
    db
      .select({ resource, service: serviceResource })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({ resource, database: databaseResource })
      .from(resource)
      .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
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
      services[row.resource.name] = {
        name: row.resource.name,
        source: row.service.source,
        image: row.service.image || null,
        sourceSubdir: row.service.sourceSubdir,
        replicas: row.service.replicas,
        command: row.service.command ?? null,
        entrypoint: row.service.entrypoint ?? null,
        ports: portsBySvc.get(row.service.resourceId) ?? [],
        env: envBySvc.get(row.service.resourceId) ?? {},
        publicEnabled: row.service.publicEnabled,
        preDeploy: row.service.preDeploy ?? null,
        buildConfig: row.service.buildConfig ?? null,
        restartWindowMs: row.service.restartWindowMs ?? null,
        diskLimitMb: row.service.diskLimitMb ?? null,
        swapLimitMb: row.service.swapLimitMb ?? null,
        pidsLimit: row.service.pidsLimit ?? null,
      };
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

  return { services, databases };
}
