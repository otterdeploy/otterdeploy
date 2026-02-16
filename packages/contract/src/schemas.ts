import * as z from "zod/v4";

import {
  BuildMethodSchema,
  DeploymentSourceSchema,
  DeploymentStatusSchema,
  EnvVarScopeSchema,
  IdSchema,
  OrgRoleSchema,
  ResourceKindSchema,
  ResourceLinkTypeSchema,
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
    projectId: IdSchema, // computed via environment -> project join
    environmentId: IdSchema,
    name: z.string().min(1).max(128),
    kind: ResourceKindSchema,
    status: ResourceStatusSchema,
    metadata: z.record(z.string(), z.unknown()),
    posX: z.number(),
    posY: z.number(),
    buildMethod: BuildMethodSchema.nullable(),
    dockerfilePath: z.string().nullable(),
    port: z.number().int().nullable(),
    healthCheckPath: z.string().nullable(),
    replicas: z.number().int().nullable(),
  })
  .extend(TimestampsSchema);

export const ResourceLinkSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    sourceResourceId: IdSchema,
    targetResourceId: IdSchema,
    linkType: ResourceLinkTypeSchema,
  })
  .extend(TimestampsSchema);

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
    metadata: z.record(z.string(), z.unknown()),
  }),
});

export const GraphEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  target: IdSchema,
  type: z.string(),
  data: z.object({
    linkType: ResourceLinkTypeSchema,
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
    buildMethod: BuildMethodSchema.nullable(),
    gitRef: z.string().nullable(),
    gitCommitSha: z.string().nullable(),
    gitCommitMessage: z.string().nullable(),
    imageTag: z.string().nullable(),
    previousImageTag: z.string().nullable(),
    triggeredBy: IdSchema.nullable(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    duration: z.number().int().nullable(),
  })
  .extend(TimestampsSchema);

export const DeploymentLogSchema = z.object({
  id: IdSchema,
  deploymentId: IdSchema,
  timestamp: z.iso.datetime(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
});

export const EnvironmentVariableSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema.nullable(),
    resourceId: IdSchema.nullable(),
    scope: EnvVarScopeSchema,
    key: z.string().min(1),
    isSecret: z.boolean(),
    buildTime: z.boolean(),
  })
  .extend(TimestampsSchema);

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
  .extend(TimestampsSchema);

export const ServerSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    name: z.string().min(1).max(128),
    ipAddress: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    status: z.enum(["connected", "disconnected", "provisioning", "error"]),
    role: z.enum(["manager", "worker"]),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .extend(TimestampsSchema);

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
  .extend(TimestampsSchema);

export const TeamMemberSchema = z.object({
  memberId: IdSchema,
  userId: IdSchema,
  organizationId: IdSchema,
  role: OrgRoleSchema,
  email: z.email(),
  name: z.string().nullable(),
  twoFactorEnabled: z.boolean(),
  joinedAt: z.iso.datetime(),
});

export const AuditLogSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  actorUserId: IdSchema.nullable(),
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
