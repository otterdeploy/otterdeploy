/**
 * Project-domain relations: projects, environments, resources, deployments,
 * service detail tables, and the container-registry/deployment-log links.
 *
 * See `./index` for the shared conventions (`from`/`to` placement,
 * `optional` nullability semantics, and the `project` ↔ `environment` aliases).
 */
import type { RelationBuilder } from "./builder";

export function projectRelations(r: RelationBuilder) {
  return {
    project: {
      organization: r.one.organization({
        from: r.project.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      environments: r.many.environment({ alias: "projectEnvironments" }),
      activeEnvironment: r.one.environment({
        from: r.project.environmentId,
        to: r.environment.id,
        alias: "projectActiveEnvironment",
        optional: true,
      }),
      resources: r.many.resource(),
      teamMembers: r.many.teamMember(),
      projectEnvVars: r.many.projectEnvVar(),
      proxyRoutes: r.many.proxyRoute(),
      backupSchedules: r.many.backupSchedule(),
    },
    teamMember: {
      project: r.one.project({
        from: r.teamMember.teamId,
        to: r.project.id,
        optional: false,
      }),
      user: r.one.user({
        from: r.teamMember.userId,
        to: r.user.id,
        optional: false,
      }),
    },
    environment: {
      project: r.one.project({
        from: r.environment.projectId,
        to: r.project.id,
        alias: "projectEnvironments",
        optional: true,
      }),
      activeForProjects: r.many.project({ alias: "projectActiveEnvironment" }),
      serviceEnvVars: r.many.serviceEnvVar(),
      projectEnvVars: r.many.projectEnvVar(),
    },
    resource: {
      project: r.one.project({
        from: r.resource.projectId,
        to: r.project.id,
        optional: false,
      }),
      database: r.one.databaseResource({ optional: true }),
      service: r.one.serviceResource({ optional: true }),
      compose: r.one.composeResource({ optional: true }),
      deployments: r.many.deployment(),
      backups: r.many.backup(),
      proxyRoutes: r.many.proxyRoute(),
    },
    deployment: {
      resource: r.one.resource({
        from: r.deployment.resourceId,
        to: r.resource.id,
        optional: false,
      }),
      logs: r.many.deploymentLog(),
    },
  };
}

export function serviceRelations(r: RelationBuilder) {
  return {
    databaseResource: {
      resource: r.one.resource({
        from: r.databaseResource.resourceId,
        to: r.resource.id,
        optional: false,
      }),
    },
    composeResource: {
      resource: r.one.resource({
        from: r.composeResource.resourceId,
        to: r.resource.id,
        optional: false,
      }),
    },
    serviceResource: {
      resource: r.one.resource({
        from: r.serviceResource.resourceId,
        to: r.resource.id,
        optional: false,
      }),
      mounts: r.many.serviceMount(),
      ports: r.many.servicePort(),
      envVars: r.many.serviceEnvVar(),
      envSubscriptions: r.many.projectEnvSubscription(),
    },
    serviceMount: {
      serviceResource: r.one.serviceResource({
        from: r.serviceMount.serviceResourceId,
        to: r.serviceResource.resourceId,
        optional: false,
      }),
    },
    servicePort: {
      serviceResource: r.one.serviceResource({
        from: r.servicePort.serviceResourceId,
        to: r.serviceResource.resourceId,
        optional: false,
      }),
    },
    serviceEnvVar: {
      serviceResource: r.one.serviceResource({
        from: r.serviceEnvVar.serviceResourceId,
        to: r.serviceResource.resourceId,
        optional: false,
      }),
      environment: r.one.environment({
        from: r.serviceEnvVar.environmentId,
        to: r.environment.id,
        optional: true,
      }),
    },
    projectEnvVar: {
      project: r.one.project({
        from: r.projectEnvVar.projectId,
        to: r.project.id,
        optional: false,
      }),
      environment: r.one.environment({
        from: r.projectEnvVar.environmentId,
        to: r.environment.id,
        optional: false,
      }),
    },
    projectEnvSubscription: {
      serviceResource: r.one.serviceResource({
        from: r.projectEnvSubscription.serviceResourceId,
        to: r.serviceResource.resourceId,
        optional: false,
      }),
    },
  };
}

export function registryRelations(r: RelationBuilder) {
  return {
    containerRegistry: {
      organization: r.one.organization({
        from: r.containerRegistry.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      // No reverse to `project`: the registry binding moved onto the SERVICE
      // (service_resource.container_registry_id / image_repository), so the
      // project no longer FKs a registry. Add a `services` relation here if a
      // registry→services query is ever needed.
    },
    deploymentLog: {
      deployment: r.one.deployment({
        from: r.deploymentLog.deploymentId,
        to: r.deployment.id,
        optional: false,
      }),
    },
  };
}
