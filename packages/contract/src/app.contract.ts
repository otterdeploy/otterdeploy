import type { InferContractRouterInputs, InferContractRouterOutputs } from "@orpc/contract";
import { oc } from "@orpc/contract";
import { z } from "zod";

import {
  BuildMethodSchema,
  DeploymentSourceSchema,
  DeploymentStatusSchema,
  EnvVarScopeSchema,
  IdSchema,
  OrgRoleSchema,
  PaginatedInputSchema,
  ResourceKindSchema,
  ResourceLinkTypeSchema,
  ResourceStatusSchema,
  SlugSchema,
  SuccessSchema,
  TimestampsSchema,
  createPaginatedOutputSchema,
} from "./shared";

const route = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: `/${string}`) => ({
  method,
  path,
});

const ProjectSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    ownerId: IdSchema,
    name: z.string().min(1).max(128),
    slug: SlugSchema,
  })
  .merge(TimestampsSchema);

const EnvironmentSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    name: z.string().min(1).max(64),
  })
  .merge(TimestampsSchema);

const ResourceSchema = z
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
  .merge(TimestampsSchema);

const ResourceLinkSchema = z
  .object({
    id: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    sourceResourceId: IdSchema,
    targetResourceId: IdSchema,
    linkType: ResourceLinkTypeSchema,
  })
  .merge(TimestampsSchema);

const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

const GraphNodeSchema = z.object({
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

const GraphEdgeSchema = z.object({
  id: IdSchema,
  source: IdSchema,
  target: IdSchema,
  type: z.string(),
  data: z.object({
    linkType: ResourceLinkTypeSchema,
  }),
});

const DeploymentSchema = z
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
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    duration: z.number().int().nullable(),
  })
  .merge(TimestampsSchema);

const DeploymentLogSchema = z.object({
  id: IdSchema,
  deploymentId: IdSchema,
  timestamp: z.string().datetime(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
});

const EnvironmentVariableSchema = z
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
  .merge(TimestampsSchema);

const DomainSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    resourceId: IdSchema,
    domain: z.string().min(3),
    verified: z.boolean(),
    sslStatus: z.enum(["pending", "active", "failed", "expired"]),
    sslExpiresAt: z.string().datetime().nullable(),
  })
  .merge(TimestampsSchema);

const ServerSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    name: z.string().min(1).max(128),
    ipAddress: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    status: z.enum(["connected", "disconnected", "provisioning", "error"]),
    role: z.enum(["manager", "worker"]),
    lastSeenAt: z.string().datetime().nullable(),
  })
  .merge(TimestampsSchema);

const MetricPointSchema = z.object({
  timestamp: z.string().datetime(),
  value: z.number(),
});

const BackupSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    resourceId: IdSchema,
    type: z.enum(["manual", "scheduled"]),
    status: z.enum(["pending", "running", "completed", "failed"]),
    storageKey: z.string().nullable(),
    sizeBytes: z.number().int().nullable(),
    checksum: z.string().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
  })
  .merge(TimestampsSchema);

const TeamMemberSchema = z.object({
  memberId: IdSchema,
  userId: IdSchema,
  organizationId: IdSchema,
  role: OrgRoleSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  twoFactorEnabled: z.boolean(),
  joinedAt: z.string().datetime(),
});

const AuditLogSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  actorUserId: IdSchema.nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: IdSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});

const SystemHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  timestamp: z.string().datetime(),
});

const SystemReadySchema = z.object({
  status: z.enum(["ready", "degraded"]),
  checks: z.object({
    database: z.enum(["ok", "degraded", "down"]),
    redis: z.enum(["ok", "degraded", "down"]),
  }),
});

const SystemVersionSchema = z.object({
  version: z.string(),
  commit: z.string().nullable(),
  builtAt: z.string().datetime().nullable(),
});

const projectContract = {
  create: oc
    .route(route("POST", "/projects"))
    .input(
      z.object({
        organizationId: IdSchema,
        name: z.string().min(1).max(128),
        slug: SlugSchema.optional(),
      }),
    )
    .output(ProjectSchema),
  getById: oc
    .route(route("GET", "/projects/{projectId}"))
    .input(
      z.object({
        projectId: IdSchema,
      }),
    )
    .output(ProjectSchema),
  list: oc
    .route(route("GET", "/projects"))
    .input(
      PaginatedInputSchema.extend({
        organizationId: IdSchema,
      }),
    )
    .output(createPaginatedOutputSchema(ProjectSchema)),
  update: oc
    .route(route("PATCH", "/projects/{projectId}"))
    .input(
      z.object({
        projectId: IdSchema,
        name: z.string().min(1).max(128).optional(),
        slug: SlugSchema.optional(),
      }),
    )
    .output(ProjectSchema),
  delete: oc
    .route(route("DELETE", "/projects/{projectId}"))
    .input(
      z.object({
        projectId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const environmentContract = {
  create: oc
    .route(route("POST", "/environments"))
    .input(
      z.object({
        projectId: IdSchema,
        name: z.string().min(1).max(64),
      }),
    )
    .output(EnvironmentSchema),
  getById: oc
    .route(route("GET", "/environments/{environmentId}"))
    .input(
      z.object({
        environmentId: IdSchema,
      }),
    )
    .output(EnvironmentSchema),
  list: oc
    .route(route("GET", "/projects/{projectId}/environments"))
    .input(
      z.object({
        projectId: IdSchema,
      }),
    )
    .output(z.array(EnvironmentSchema)),
  delete: oc
    .route(route("DELETE", "/environments/{environmentId}"))
    .input(
      z.object({
        environmentId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const resourceContract = {
  create: oc
    .route(route("POST", "/resources"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema,
        name: z.string().min(1).max(128),
        kind: ResourceKindSchema,
        status: ResourceStatusSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        posX: z.number(),
        posY: z.number(),
        buildMethod: BuildMethodSchema.optional(),
        dockerfilePath: z.string().optional(),
        port: z.number().int().optional(),
        healthCheckPath: z.string().optional(),
        replicas: z.number().int().min(1).optional(),
      }),
    )
    .output(ResourceSchema),
  getById: oc
    .route(route("GET", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(ResourceSchema),
  list: oc
    .route(route("GET", "/projects/{projectId}/resources"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
      }),
    )
    .output(z.array(ResourceSchema)),
  update: oc
    .route(route("PATCH", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
        name: z.string().min(1).max(128).optional(),
        kind: ResourceKindSchema.optional(),
        status: ResourceStatusSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        posX: z.number().optional(),
        posY: z.number().optional(),
        buildMethod: BuildMethodSchema.nullable().optional(),
        dockerfilePath: z.string().nullable().optional(),
        port: z.number().int().nullable().optional(),
        healthCheckPath: z.string().nullable().optional(),
        replicas: z.number().int().min(1).nullable().optional(),
      }),
    )
    .output(ResourceSchema),
  delete: oc
    .route(route("DELETE", "/resources/{resourceId}"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const resourceLinkContract = {
  create: oc
    .route(route("POST", "/resource-links"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema,
        sourceResourceId: IdSchema,
        targetResourceId: IdSchema,
        linkType: ResourceLinkTypeSchema.optional(),
      }),
    )
    .output(ResourceLinkSchema),
  delete: oc
    .route(route("DELETE", "/resource-links/{linkId}"))
    .input(
      z.object({
        linkId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const architectureContract = {
  getGraph: oc
    .route(route("GET", "/architecture/{projectId}/graph"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
      }),
    )
    .output(
      z.object({
        project: ProjectSchema.pick({
          id: true,
          organizationId: true,
          ownerId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        }),
        environment: EnvironmentSchema.pick({
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        }),
        viewport: ViewportSchema,
        nodes: z.array(GraphNodeSchema),
        edges: z.array(GraphEdgeSchema),
      }),
    ),
  replaceGraph: oc
    .route(route("PUT", "/architecture/{projectId}/graph"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resources: z.array(
          z.object({
            id: IdSchema,
            name: z.string(),
            kind: ResourceKindSchema,
            status: ResourceStatusSchema,
            metadata: z.record(z.string(), z.unknown()),
            posX: z.number(),
            posY: z.number(),
          }),
        ),
        links: z.array(
          z.object({
            id: IdSchema,
            sourceResourceId: IdSchema,
            targetResourceId: IdSchema,
            linkType: ResourceLinkTypeSchema,
          }),
        ),
        viewport: ViewportSchema,
      }),
    )
    .output(
      z.object({
        project: ProjectSchema.pick({
          id: true,
          organizationId: true,
          ownerId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        }),
        environment: EnvironmentSchema.pick({
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        }),
        viewport: ViewportSchema,
        nodes: z.array(GraphNodeSchema),
        edges: z.array(GraphEdgeSchema),
      }),
    ),
  updateViewport: oc
    .route(route("PATCH", "/architecture/{projectId}/viewport"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        viewport: ViewportSchema,
      }),
    )
    .output(
      z.object({
        environmentId: IdSchema,
        viewport: ViewportSchema,
      }),
    ),
};

const deploymentContract = {
  create: oc
    .route(route("POST", "/deployments"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema,
        resourceId: IdSchema,
        source: DeploymentSourceSchema,
        gitRef: z.string().optional(),
        gitCommitSha: z.string().optional(),
        buildMethod: BuildMethodSchema.optional(),
      }),
    )
    .output(DeploymentSchema),
  getById: oc
    .route(route("GET", "/deployments/{deploymentId}"))
    .input(
      z.object({
        deploymentId: IdSchema,
      }),
    )
    .output(DeploymentSchema),
  list: oc
    .route(route("GET", "/deployments"))
    .input(
      PaginatedInputSchema.extend({
        projectId: IdSchema.optional(),
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentSchema)),
  cancel: oc
    .route(route("POST", "/deployments/{deploymentId}/cancel"))
    .input(
      z.object({
        deploymentId: IdSchema,
        reason: z.string().max(512).optional(),
      }),
    )
    .output(DeploymentSchema),
  rollback: oc
    .route(route("POST", "/deployments/{deploymentId}/rollback"))
    .input(
      z.object({
        deploymentId: IdSchema,
        reason: z.string().max(512).optional(),
      }),
    )
    .output(DeploymentSchema),
  streamLogs: oc
    .route(route("GET", "/deployments/{deploymentId}/logs"))
    .input(
      z.object({
        deploymentId: IdSchema,
        cursor: z.string().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema)),
};

const environmentVariableContract = {
  set: oc
    .route(route("PUT", "/environment-variables"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
        scope: EnvVarScopeSchema,
        key: z.string().min(1),
        value: z.string().min(1),
        isSecret: z.boolean().default(true),
        buildTime: z.boolean().default(false),
      }),
    )
    .output(EnvironmentVariableSchema),
  get: oc
    .route(route("GET", "/environment-variables/{variableId}"))
    .input(
      z.object({
        variableId: IdSchema,
      }),
    )
    .output(EnvironmentVariableSchema),
  list: oc
    .route(route("GET", "/environment-variables"))
    .input(
      z.object({
        projectId: IdSchema,
        environmentId: IdSchema.optional(),
        resourceId: IdSchema.optional(),
      }),
    )
    .output(z.array(EnvironmentVariableSchema)),
  delete: oc
    .route(route("DELETE", "/environment-variables/{variableId}"))
    .input(
      z.object({
        variableId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const domainContract = {
  add: oc
    .route(route("POST", "/domains"))
    .input(
      z.object({
        resourceId: IdSchema,
        domain: z.string().min(3),
      }),
    )
    .output(DomainSchema),
  verify: oc
    .route(route("POST", "/domains/{domainId}/verify"))
    .input(
      z.object({
        domainId: IdSchema,
      }),
    )
    .output(DomainSchema),
  list: oc
    .route(route("GET", "/domains"))
    .input(
      z.object({
        resourceId: IdSchema.optional(),
        organizationId: IdSchema.optional(),
      }),
    )
    .output(z.array(DomainSchema)),
  remove: oc
    .route(route("DELETE", "/domains/{domainId}"))
    .input(
      z.object({
        domainId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const serverContract = {
  register: oc
    .route(route("POST", "/servers"))
    .input(
      z.object({
        organizationId: IdSchema,
        name: z.string().min(1).max(128),
        ipAddress: z.string().min(1),
        port: z.number().int().min(1).max(65535).default(22),
        role: z.enum(["manager", "worker"]).default("worker"),
      }),
    )
    .output(ServerSchema),
  list: oc
    .route(route("GET", "/servers"))
    .input(
      z.object({
        organizationId: IdSchema,
      }),
    )
    .output(z.array(ServerSchema)),
  test: oc
    .route(route("POST", "/servers/{serverId}/test"))
    .input(
      z.object({
        serverId: IdSchema,
      }),
    )
    .output(
      z.object({
        serverId: IdSchema,
        status: z.enum(["healthy", "degraded", "offline"]),
        roundTripMs: z.number().int().nullable(),
      }),
    ),
  remove: oc
    .route(route("DELETE", "/servers/{serverId}"))
    .input(
      z.object({
        serverId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const monitoringContract = {
  getMetrics: oc
    .route(route("GET", "/monitoring/metrics"))
    .input(
      z.object({
        resourceId: IdSchema,
        metric: z.enum(["cpu", "memory", "network_in", "network_out", "disk"]),
        from: z.string().datetime(),
        to: z.string().datetime(),
      }),
    )
    .output(
      z.object({
        resourceId: IdSchema,
        metric: z.string(),
        points: z.array(MetricPointSchema),
      }),
    ),
  getLogs: oc
    .route(route("GET", "/monitoring/logs"))
    .input(
      PaginatedInputSchema.extend({
        resourceId: IdSchema,
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema)),
  streamLogs: oc
    .route(route("GET", "/monitoring/logs/stream"))
    .input(
      z.object({
        resourceId: IdSchema,
        cursor: z.string().optional(),
      }),
    )
    .output(createPaginatedOutputSchema(DeploymentLogSchema)),
};

const backupContract = {
  create: oc
    .route(route("POST", "/backups"))
    .input(
      z.object({
        resourceId: IdSchema,
      }),
    )
    .output(BackupSchema),
  list: oc
    .route(route("GET", "/backups"))
    .input(
      PaginatedInputSchema.extend({
        organizationId: IdSchema,
        resourceId: IdSchema.optional(),
      }),
    )
    .output(createPaginatedOutputSchema(BackupSchema)),
  restore: oc
    .route(route("POST", "/backups/{backupId}/restore"))
    .input(
      z.object({
        backupId: IdSchema,
        targetResourceId: IdSchema,
      }),
    )
    .output(SuccessSchema),
  delete: oc
    .route(route("DELETE", "/backups/{backupId}"))
    .input(
      z.object({
        backupId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const teamContract = {
  listMembers: oc
    .route(route("GET", "/organizations/{organizationId}/members"))
    .input(
      z.object({
        organizationId: IdSchema,
      }),
    )
    .output(z.array(TeamMemberSchema)),
  invite: oc
    .route(route("POST", "/organizations/{organizationId}/members/invite"))
    .input(
      z.object({
        organizationId: IdSchema,
        email: z.string().email(),
        role: OrgRoleSchema,
      }),
    )
    .output(
      z.object({
        invitationId: IdSchema,
        organizationId: IdSchema,
        email: z.string().email(),
        role: OrgRoleSchema,
        expiresAt: z.string().datetime(),
      }),
    ),
  updateRole: oc
    .route(route("PATCH", "/organizations/{organizationId}/members/{memberId}/role"))
    .input(
      z.object({
        organizationId: IdSchema,
        memberId: IdSchema,
        role: OrgRoleSchema,
      }),
    )
    .output(TeamMemberSchema),
  removeMember: oc
    .route(route("DELETE", "/organizations/{organizationId}/members/{memberId}"))
    .input(
      z.object({
        organizationId: IdSchema,
        memberId: IdSchema,
      }),
    )
    .output(SuccessSchema),
};

const auditContract = {
  list: oc
    .route(route("GET", "/audit"))
    .input(
      PaginatedInputSchema.extend({
        organizationId: IdSchema,
        action: z.string().optional(),
        actorUserId: IdSchema.optional(),
      }),
    )
    .output(createPaginatedOutputSchema(AuditLogSchema)),
};

const systemContract = {
  health: oc.route(route("GET", "/system/health")).input(z.object({})).output(SystemHealthSchema),
  ready: oc.route(route("GET", "/system/ready")).input(z.object({})).output(SystemReadySchema),
  version: oc.route(route("GET", "/system/version")).input(z.object({})).output(SystemVersionSchema),
};

export const appContract = {
  project: projectContract,
  environment: environmentContract,
  resource: resourceContract,
  resourceLink: resourceLinkContract,
  architecture: architectureContract,
  deployment: deploymentContract,
  environmentVariable: environmentVariableContract,
  domain: domainContract,
  server: serverContract,
  monitoring: monitoringContract,
  backup: backupContract,
  team: teamContract,
  audit: auditContract,
  system: systemContract,
} as const;

export type AppContract = typeof appContract;
export type AppContractInputs = InferContractRouterInputs<AppContract>;
export type AppContractOutputs = InferContractRouterOutputs<AppContract>;
