/**
 * Infrastructure-domain relations: git providers/installations/repos, servers,
 * proxy routes, audit logs, and the backups graph.
 *
 * See `./index` for the shared conventions (`from`/`to` placement and
 * `optional` nullability semantics).
 */
import type { RelationBuilder } from "./builder";

export function gitRelations(r: RelationBuilder) {
  return {
    gitProvider: {
      organization: r.one.organization({
        from: r.gitProvider.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      installations: r.many.gitInstallation(),
    },
    gitInstallation: {
      provider: r.one.gitProvider({
        from: r.gitInstallation.providerId,
        to: r.gitProvider.id,
        optional: false,
      }),
      repos: r.many.gitRepo(),
    },
    gitRepo: {
      installation: r.one.gitInstallation({
        from: r.gitRepo.installationId,
        to: r.gitInstallation.id,
        optional: true,
      }),
      // No reverse to `project`: the repo binding moved onto the SERVICE
      // (service_resource.git_repo_id / branch), so the project no longer FKs a
      // repo. Add a `services` relation here if a repo→services query is needed.
    },
  };
}

export function serverRelations(r: RelationBuilder) {
  return {
    server: {
      organization: r.one.organization({
        from: r.server.organizationId,
        to: r.organization.id,
        optional: false,
      }),
    },
  };
}

export function proxyRelations(r: RelationBuilder) {
  return {
    proxyRoute: {
      project: r.one.project({
        from: r.proxyRoute.projectId,
        to: r.project.id,
        optional: false,
      }),
      resource: r.one.resource({
        from: r.proxyRoute.resourceId,
        to: r.resource.id,
        optional: true,
      }),
    },
  };
}

export function auditRelations(r: RelationBuilder) {
  return {
    auditLog: {
      organization: r.one.organization({
        from: r.auditLog.organizationId,
        to: r.organization.id,
        optional: true,
      }),
    },
  };
}

export function backupRelations(r: RelationBuilder) {
  return {
    backupDestination: {
      organization: r.one.organization({
        from: r.backupDestination.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      // Schedules reference destinations via a jsonb id array, not an FK, so
      // there's no relational back-ref to declare here.
      backups: r.many.backup(),
    },
    backupSchedule: {
      organization: r.one.organization({
        from: r.backupSchedule.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      project: r.one.project({
        from: r.backupSchedule.projectId,
        to: r.project.id,
        optional: true,
      }),
      // No `destination` relation: a schedule fans out to many destinations
      // (jsonb `destinationIds`), so there's no single FK to relate.
      backups: r.many.backup(),
    },
    backup: {
      organization: r.one.organization({
        from: r.backup.organizationId,
        to: r.organization.id,
        optional: false,
      }),
      resource: r.one.resource({
        from: r.backup.resourceId,
        to: r.resource.id,
        optional: false,
      }),
      schedule: r.one.backupSchedule({
        from: r.backup.scheduleId,
        to: r.backupSchedule.id,
        optional: true,
      }),
      destination: r.one.backupDestination({
        from: r.backup.destinationId,
        to: r.backupDestination.id,
        optional: false,
      }),
      logs: r.many.backupLog(),
    },
    backupLog: {
      backup: r.one.backup({
        from: r.backupLog.backupId,
        to: r.backup.id,
        optional: false,
      }),
    },
  };
}
