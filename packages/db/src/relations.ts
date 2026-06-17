/**
 * Relational Query Builder (RQB v2) graph.
 *
 * drizzle-orm 1.0 replaced the old `relations()` helper with
 * `defineRelations(schema, (r) => …)`. This object is what powers
 * `db.query.<table>.findMany({ with: { … } })` — it does NOT affect
 * `db.select()` / `.leftJoin()` (those work straight off the table objects),
 * so wiring it in is purely additive.
 *
 * Conventions used below:
 *   - `from`/`to` are declared on the side that HOLDS the foreign key column
 *     (the `one` side). The reverse `many`/`one` pairs automatically by table.
 *   - `optional: false` marks NOT NULL foreign keys (the related row always
 *     exists); `optional: true` marks nullable ones (the related row may be
 *     absent). This only changes the inferred result type's nullability.
 *   - A few columns reference another table at the application layer without a
 *     DB-level FK (to avoid cross-schema import cycles): `project.gitRepoId`,
 *     `project.containerRegistryId`, `project.environmentId`,
 *     `proxyRoute.resourceId`. RQB only needs the column pair, so these are
 *     modelled here too.
 *   - `project` ↔ `environment` has two distinct paths, so each is given an
 *     explicit `alias` to disambiguate:
 *       · "projectEnvironments"      — environments owned by a project
 *       · "projectActiveEnvironment" — a project's selected/default environment
 */
import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  // ─── auth ──────────────────────────────────────────────────────────────
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    memberships: r.many.member(),
    sentInvitations: r.many.invitation(),
    teamMemberships: r.many.teamMember(),
  },
  session: {
    user: r.one.user({ from: r.session.userId, to: r.user.id, optional: false }),
  },
  account: {
    user: r.one.user({ from: r.account.userId, to: r.user.id, optional: false }),
  },
  organization: {
    members: r.many.member(),
    invitations: r.many.invitation(),
    projects: r.many.project(),
    servers: r.many.server(),
    gitProviders: r.many.gitProvider(),
    containerRegistries: r.many.containerRegistry(),
    auditLogs: r.many.auditLog(),
    backupDestinations: r.many.backupDestination(),
    backupSchedules: r.many.backupSchedule(),
    backups: r.many.backup(),
  },
  member: {
    organization: r.one.organization({
      from: r.member.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    user: r.one.user({ from: r.member.userId, to: r.user.id, optional: false }),
  },
  invitation: {
    organization: r.one.organization({
      from: r.invitation.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    inviter: r.one.user({
      from: r.invitation.inviterId,
      to: r.user.id,
      optional: false,
    }),
  },

  // ─── project ───────────────────────────────────────────────────────────
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
    gitRepo: r.one.gitRepo({
      from: r.project.gitRepoId,
      to: r.gitRepo.id,
      optional: true,
    }),
    containerRegistry: r.one.containerRegistry({
      from: r.project.containerRegistryId,
      to: r.containerRegistry.id,
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
  deployment: {
    resource: r.one.resource({
      from: r.deployment.resourceId,
      to: r.resource.id,
      optional: false,
    }),
    logs: r.many.deploymentLog(),
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

  // ─── build / registry ────────────────────────────────────────────────────
  containerRegistry: {
    organization: r.one.organization({
      from: r.containerRegistry.organizationId,
      to: r.organization.id,
      optional: false,
    }),
    projects: r.many.project(),
  },
  deploymentLog: {
    deployment: r.one.deployment({
      from: r.deploymentLog.deploymentId,
      to: r.deployment.id,
      optional: false,
    }),
  },

  // ─── git ───────────────────────────────────────────────────────────────
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
    projects: r.many.project(),
  },

  // ─── server ──────────────────────────────────────────────────────────────
  server: {
    organization: r.one.organization({
      from: r.server.organizationId,
      to: r.organization.id,
      optional: false,
    }),
  },

  // ─── proxy ───────────────────────────────────────────────────────────────
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

  // ─── audit ───────────────────────────────────────────────────────────────
  auditLog: {
    organization: r.one.organization({
      from: r.auditLog.organizationId,
      to: r.organization.id,
      optional: true,
    }),
  },

  // ─── backups ─────────────────────────────────────────────────────────────
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
}));
