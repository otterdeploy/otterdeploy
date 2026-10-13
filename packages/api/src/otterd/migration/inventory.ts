/**
 * The migration preflight, read-only: every managed container on this host's
 * Docker daemon, every deployable resource with its owner and in-flight
 * deploys, the Swarm services that carry our labels, and this host's otterd
 * node. `assess` turns that into the report the operator approves.
 */
import type { Docker } from "@otterdeploy/docker";

import { db } from "@otterdeploy/db";
import { otterdMigrationSession } from "@otterdeploy/db/schema/otterd-migration";
import { deployment, resource } from "@otterdeploy/db/schema/project";
import { Result } from "better-result";
import { eq, inArray } from "drizzle-orm";

import { buildHostNode } from "../store/status";
import { type Assessment, type InventoryContainer, assess } from "./assess";

const MANAGED = { label: ["otterdeploy.managed=true"] };

async function managedContainers(docker: Docker): Promise<InventoryContainer[]> {
  const listed = await docker.containers.list({ all: true, filters: MANAGED });
  if (listed.isErr()) throw new Error(`docker: ${listed.error.message}`);
  return listed.value.map((c) => ({
    id: c.Id ?? "",
    name: (c.Names?.[0] ?? "").replace(/^\//, ""),
    image: c.Image ?? "",
    state: c.State ?? "unknown",
    labels: c.Labels ?? {},
  }));
}

/** Swarm services we own; an install that never ran Swarm has none (and lists fail). */
async function swarmServices(docker: Docker): Promise<number> {
  const listed = await docker.services.list({ filters: MANAGED });
  return listed.isOk() ? listed.value.length : 0;
}

async function deployableResources() {
  const rows = await db
    .select({
      resourceId: resource.id,
      name: resource.name,
      type: resource.type,
      runtimeOwner: resource.runtimeOwner,
    })
    .from(resource)
    .where(inArray(resource.type, ["service", "database"]));
  const busy = await db
    .select({ resourceId: deployment.resourceId })
    .from(deployment)
    .where(inArray(deployment.status, ["pending", "building"]));
  const deploying = new Set(busy.map((b) => b.resourceId));
  return rows.map((r) => ({ ...r, deploying: deploying.has(r.resourceId) }));
}

export function preflight(docker: Docker): Promise<Result<Assessment, string>> {
  return Result.tryPromise({
    try: async () => {
      const [containers, services, resources, host, open] = await Promise.all([
        managedContainers(docker),
        swarmServices(docker),
        deployableResources(),
        buildHostNode(),
        db
          .select({ id: otterdMigrationSession.sessionId })
          .from(otterdMigrationSession)
          .where(eq(otterdMigrationSession.state, "open")),
      ]);
      return assess({
        containers,
        resources,
        hostNode: host.isOk() ? host.value : null,
        swarmServices: services,
        sessionOpen: open.length > 0,
      });
    },
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
}
