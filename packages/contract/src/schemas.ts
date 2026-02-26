import * as z from "zod/v4";

import {
  BuilderSchema,
  DeploymentSourceSchema,
  DeploymentStatusSchema,
  EnvVarScopeSchema,
  IdSchema,
  SecretProviderSchema,
  ResourceKindSchema,
  ResourceStatusSchema,
  SlugSchema,
  TimestampsSchema,
} from "./shared";

export const ProjectSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    ownerId: IdSchema,
    name: z.string().min(1).max(128),
    slug: SlugSchema,
  })
  .merge(TimestampsSchema);

export const EnvironmentSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    name: z.string().min(1).max(64),
  })
  .merge(TimestampsSchema);

export const ResourceSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    name: z.string().min(1).max(128),
    kind: ResourceKindSchema,
    status: ResourceStatusSchema,
  })
  .merge(TimestampsSchema);

export const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const GraphNodeSchema = z.object({
  id: IdSchema,
  type: z.literal("resource"),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.object({
    name: z.string(),
    kind: ResourceKindSchema,
    status: ResourceStatusSchema,
  }),
});

export const DeploymentSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    resourceId: IdSchema,
    status: DeploymentStatusSchema,
    source: DeploymentSourceSchema,
    builder: BuilderSchema.nullable(),
    gitRef: z.string().nullable(),
    gitCommitSha: z.string().nullable(),
    gitCommitMessage: z.string().nullable(),
    imageTag: z.string().nullable(),
    previousImageTag: z.string().nullable(),
    logPath: z.string().nullable(),
    logServerId: z.string().nullable(),
    triggeredBy: IdSchema.nullable(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    duration: z.number().int().nullable(),
    errorMessage: z.string().nullable(),
  })
  .merge(TimestampsSchema);

export const DeploymentLogSchema = z.object({
  id: IdSchema,
  deploymentId: IdSchema,
  timestamp: z.iso.datetime(),
  tab: z.enum(["build", "deploy", "runtime"]),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
});

export const EnvironmentVariableSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema.nullable(),
    environmentId: IdSchema.nullable(),
    resourceId: IdSchema.nullable(),
    scope: EnvVarScopeSchema,
    key: z.string().min(1),
    isSecret: z.boolean(),
    buildTime: z.boolean(),
    secretReferenceId: IdSchema.nullable(),
    secretProvider: SecretProviderSchema.nullable(),
    secretVersion: z.string().nullable(),
  })
  .merge(TimestampsSchema);

export const EnvironmentVariableRevealSchema = z.object({
  variableId: IdSchema,
  value: z.string().min(1),
  revealedAt: z.iso.datetime(),
  revealAuditId: IdSchema,
  providerVersion: z.string().nullable(),
});

export const GitProviderSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    type: z.string().min(1),
    name: z.string().min(1).max(128),
    appId: z.string().nullable(),
    clientId: z.string().nullable(),
    installationId: z.string().nullable(),
    hasClientSecret: z.boolean(),
    hasWebhookSecret: z.boolean(),
    clientSecretReferenceId: IdSchema.nullable(),
    webhookSecretReferenceId: IdSchema.nullable(),
  })
  .merge(TimestampsSchema);

export const DomainSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    resourceId: IdSchema,
    domain: z.string().min(3),
    verified: z.boolean(),
    sslStatus: z.enum(["pending", "active", "failed", "expired"]),
    sslExpiresAt: z.iso.datetime().nullable(),
  })
  .merge(TimestampsSchema);

export const ServerSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    name: z.string().min(1).max(128),
    ipAddress: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    status: z.enum(["connected", "disconnected", "provisioning", "error"]),
    role: z.enum(["manager", "worker"]),
    sshKeyId: IdSchema.nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .merge(TimestampsSchema);

export const MetricPointSchema = z.object({
  timestamp: z.iso.datetime(),
  value: z.number(),
});

export const BackupSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    resourceId: IdSchema,
    type: z.enum(["manual", "scheduled"]),
    status: z.enum(["pending", "running", "completed", "failed"]),
    storageKey: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    checksum: z.string().nullable(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .merge(TimestampsSchema);

export const AuditLogSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  actorType: z.enum(["user", "system"]),
  actorUserId: IdSchema.nullable(),
  actorLabel: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: IdSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const SystemHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  timestamp: z.iso.datetime(),
});

export const SystemReadySchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.object({
    database: z.enum(["ok", "degraded", "down"]),
    redis: z.enum(["ok", "degraded", "down"]),
  }),
});

export const SystemVersionSchema = z.object({
  version: z.string(),
  commit: z.string().nullable(),
  builtAt: z.iso.datetime().nullable(),
});
