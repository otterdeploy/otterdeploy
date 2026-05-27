/**
 * Map one database_resource row to a StackService entry.
 *
 * Engine-specific bits (image, identity env, healthcheck command, mount
 * target) come from the adapter — keeps the renderer in lockstep with
 * what the apply path actually deploys.
 */

import type { databaseResource, resource } from "@otterstack/db/schema/project";

import { getEngineAdapter } from "../../swarm/database-engines";
import {
  STACK_DEFAULT_HEALTHCHECK,
  type StackService,
  type StackVolumeMount,
} from "../schema";

import { projectNetworkName } from "./network-name";

type DatabaseRow = typeof databaseResource.$inferSelect;
type ResourceRow = typeof resource.$inferSelect;

export function buildDatabaseService(
  row: { resource: ResourceRow; database: DatabaseRow },
  projectSlug: string,
  volumeName: string,
): StackService {
  const adapter = getEngineAdapter(row.database.engine);
  const identity = {
    username: row.database.username,
    password: row.database.password,
    databaseName: row.database.databaseName,
  };

  const env: Record<string, string> = { ...row.database.extraEnv };
  for (const line of adapter.buildEnv(identity)) {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
  }

  const command = adapter.buildCommand?.({ password: row.database.password });
  const volumes: StackVolumeMount[] = [
    { type: "volume", source: volumeName, target: adapter.mountTarget },
  ];

  return {
    image: adapter.defaultImage,
    hostname: row.database.internalHostname,
    env: Object.keys(env).length > 0 ? env : undefined,
    command,
    volumes,
    networks: [projectNetworkName(projectSlug)],
    healthcheck: {
      test: `CMD-SHELL ${adapter.buildHealthcheck(identity)}`,
      interval: STACK_DEFAULT_HEALTHCHECK.interval,
      timeout: STACK_DEFAULT_HEALTHCHECK.timeout,
      retries: STACK_DEFAULT_HEALTHCHECK.retries,
    },
    deploy: {
      replicas: 1,
      update_config: {
        parallelism: 1,
        order: "stop-first",
        failure_action: "rollback",
      },
      rollback_config: {
        parallelism: 1,
        order: "stop-first",
        failure_action: "pause",
      },
    },
    "x-otterstack": {
      kind: "database",
      engine: row.database.engine,
      resourceId: row.resource.id,
      projectId: row.resource.projectId,
      publicEnabled: row.database.publicEnabled,
      publicHostname: row.database.publicHostname,
    },
  };
}
