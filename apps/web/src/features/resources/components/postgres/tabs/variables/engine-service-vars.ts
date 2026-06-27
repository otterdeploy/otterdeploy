/**
 * Engine-identity env vars the swarm spec actually injects into the
 * container. Mirrors per-engine adapters under
 * `packages/api/src/swarm/database-engines/<engine>.ts`. Backend reality
 * is the truth — keep this in sync when adding a new engine.
 */

import type { PostgresBodyProps } from "../../types";

export interface DerivedVar {
  name: string;
  value: string;
  secret: boolean;
  description?: string;
}

export function buildEngineServiceVars(resource: PostgresBodyProps["resource"]): DerivedVar[] {
  switch (resource.engine) {
    case "postgres":
      return [
        { name: "POSTGRES_USER", value: resource.username, secret: false },
        { name: "POSTGRES_PASSWORD", value: resource.password, secret: true },
        { name: "POSTGRES_DB", value: resource.databaseName, secret: false },
        {
          name: "DATABASE_URL",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
    case "redis":
      // Redis authenticates via --requirepass (set on Command, not Env).
      // We surface it here so consumers have a canonical key to reference.
      return [
        { name: "REDIS_PASSWORD", value: resource.password, secret: true },
        {
          name: "REDIS_URL",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
    case "mariadb":
      return [
        { name: "MARIADB_USER", value: resource.username, secret: false },
        { name: "MARIADB_PASSWORD", value: resource.password, secret: true },
        {
          name: "MARIADB_ROOT_PASSWORD",
          value: resource.password,
          secret: true,
        },
        {
          name: "MARIADB_DATABASE",
          value: resource.databaseName,
          secret: false,
        },
        {
          name: "DATABASE_URL",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
    case "mongodb":
      return [
        {
          name: "MONGO_INITDB_ROOT_USERNAME",
          value: resource.username,
          secret: false,
        },
        {
          name: "MONGO_INITDB_ROOT_PASSWORD",
          value: resource.password,
          secret: true,
        },
        {
          name: "MONGO_INITDB_DATABASE",
          value: resource.databaseName,
          secret: false,
        },
        {
          name: "MONGODB_URI",
          value: resource.internalConnectionString,
          secret: true,
        },
      ];
  }
  return [];
}

/**
 * Platform-injected OTTERDEPLOY_* envs every container receives. Read-only;
 * derived from the resource record.
 */
export function buildSystemVars(resource: PostgresBodyProps["resource"]): DerivedVar[] {
  return [
    {
      name: "OTTERDEPLOY_PRIVATE_DOMAIN",
      value: resource.internalHostname,
      secret: false,
      description: "The private DNS name of the service.",
    },
    {
      name: "OTTERDEPLOY_TCP_PROXY_DOMAIN",
      value: resource.publicHostname,
      secret: false,
      description:
        "The public TCP proxy domain for the service, if applicable. Always reached over 443 — no port needed.",
    },
    {
      name: "OTTERDEPLOY_TCP_APPLICATION_PORT",
      value: String(resource.internalPort),
      secret: false,
      description: "The internal port the database listens on.",
    },
    {
      name: "OTTERDEPLOY_PROJECT_ID",
      value: resource.projectId,
      secret: false,
      description: "The project this resource belongs to.",
    },
    {
      name: "OTTERDEPLOY_RESOURCE_NAME",
      value: resource.name,
      secret: false,
      description: "The resource name.",
    },
    {
      name: "OTTERDEPLOY_RESOURCE_ID",
      value: resource.resourceId,
      secret: false,
      description: "The resource ID.",
    },
    {
      name: "OTTERDEPLOY_SERVICE_NAME",
      value: resource.runtime.serviceName,
      secret: false,
      description: "The swarm service name.",
    },
    {
      name: "OTTERDEPLOY_NETWORK_NAME",
      value: resource.runtime.networkName,
      secret: false,
      description: "The internal swarm overlay network.",
    },
    {
      name: "OTTERDEPLOY_VOLUME_NAME",
      value: resource.runtime.volumeName,
      secret: false,
      description: "The name of the attached volume.",
    },
    {
      name: "OTTERDEPLOY_VOLUME_MOUNT_PATH",
      value: "/var/lib/postgresql/data",
      secret: false,
      description: "The mount path of the attached volume.",
    },
  ];
}
