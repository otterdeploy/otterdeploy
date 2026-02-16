import { createHash } from "node:crypto";

import {
  DeploymentSourceSchema,
  DeploymentStatusSchema,
  IdSchema,
  ResourceStatusSchema,
} from "@otterstack/contract/shared";
import { z } from "zod";

export const DEPLOYMENT_EVENT_NAMES = [
  "deployment.requested",
  "deployment.building",
  "deployment.build.succeeded",
  "deployment.build.failed",
  "deployment.deploying",
  "deployment.released",
  "deployment.failed",
  "deployment.rollback.requested",
  "deployment.rollback.completed",
] as const;

export const RESOURCE_EVENT_NAMES = [
  "resource.created",
  "resource.updated",
  "resource.deleted",
  "resource.health.changed",
] as const;

export const OPERATIONS_EVENT_NAMES = [
  "backup.requested",
  "backup.completed",
  "backup.failed",
  "domain.added",
  "domain.verified",
  "domain.ssl.provisioned",
] as const;

export const GOVERNANCE_EVENT_NAMES = [
  "member.invited",
  "member.joined",
  "member.removed",
  "apikey.created",
  "apikey.revoked",
  "setting.changed",
] as const;

export const EVENT_NAMES = [
  ...DEPLOYMENT_EVENT_NAMES,
  ...RESOURCE_EVENT_NAMES,
  ...OPERATIONS_EVENT_NAMES,
  ...GOVERNANCE_EVENT_NAMES,
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
export const EventNameSchema = z.enum(EVENT_NAMES);

const BaseEventSchema = z.object({
  orgId: IdSchema,
  occurredAt: z.iso.datetime().optional(),
  correlationId: z.string().min(1).optional(),
});

const DeploymentBaseSchema = BaseEventSchema.extend({
  deploymentId: IdSchema,
  resourceId: IdSchema,
  environmentId: IdSchema,
});

export const EventSchemas = {
  "deployment.requested": DeploymentBaseSchema.extend({
    source: DeploymentSourceSchema,
    actorUserId: IdSchema,
    idempotencyKey: z.string().min(1),
  }),
  "deployment.building": DeploymentBaseSchema.extend({
    status: z.literal("building"),
  }),
  "deployment.build.succeeded": DeploymentBaseSchema.extend({
    imageRef: z.string().min(1),
    status: z.literal("deploying"),
  }),
  "deployment.build.failed": DeploymentBaseSchema.extend({
    status: z.literal("failed"),
    errorMessage: z.string().min(1),
  }),
  "deployment.deploying": DeploymentBaseSchema.extend({
    status: z.literal("deploying"),
  }),
  "deployment.released": DeploymentBaseSchema.extend({
    status: z.literal("live"),
    releasedUrl: z.url().nullable(),
  }),
  "deployment.failed": DeploymentBaseSchema.extend({
    status: z.literal("failed"),
    reason: z.string().min(1),
  }),
  "deployment.rollback.requested": DeploymentBaseSchema.extend({
    actorUserId: IdSchema,
    reason: z.string().min(1).optional(),
  }),
  "deployment.rollback.completed": DeploymentBaseSchema.extend({
    status: z.literal("rolled_back"),
  }),

  "resource.created": BaseEventSchema.extend({
    projectId: IdSchema,
    environmentId: IdSchema,
    resourceId: IdSchema,
    kind: z.string().min(1),
    status: ResourceStatusSchema,
  }),
  "resource.updated": BaseEventSchema.extend({
    projectId: IdSchema,
    environmentId: IdSchema,
    resourceId: IdSchema,
    status: ResourceStatusSchema,
  }),
  "resource.deleted": BaseEventSchema.extend({
    projectId: IdSchema,
    environmentId: IdSchema,
    resourceId: IdSchema,
  }),
  "resource.health.changed": BaseEventSchema.extend({
    projectId: IdSchema,
    environmentId: IdSchema,
    resourceId: IdSchema,
    previousStatus: ResourceStatusSchema,
    nextStatus: ResourceStatusSchema,
  }),

  "backup.requested": BaseEventSchema.extend({
    backupId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
  }),
  "backup.completed": BaseEventSchema.extend({
    backupId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    storagePath: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
  }),
  "backup.failed": BaseEventSchema.extend({
    backupId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    reason: z.string().min(1),
  }),
  "domain.added": BaseEventSchema.extend({
    domainId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    domain: z.string().min(3),
  }),
  "domain.verified": BaseEventSchema.extend({
    domainId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    domain: z.string().min(3),
    verifiedAt: z.string().datetime(),
  }),
  "domain.ssl.provisioned": BaseEventSchema.extend({
    domainId: IdSchema,
    projectId: IdSchema,
    environmentId: IdSchema,
    domain: z.string().min(3),
    sslStatus: z.enum(["pending", "active", "failed", "expired"]),
  }),

  "member.invited": BaseEventSchema.extend({
    actorUserId: IdSchema,
    organizationId: IdSchema,
    email: z.string().email(),
    role: z.enum(["owner", "admin", "member", "viewer"]),
  }),
  "member.joined": BaseEventSchema.extend({
    actorUserId: IdSchema.optional(),
    organizationId: IdSchema,
    memberUserId: IdSchema,
  }),
  "member.removed": BaseEventSchema.extend({
    actorUserId: IdSchema,
    organizationId: IdSchema,
    memberUserId: IdSchema,
  }),
  "apikey.created": BaseEventSchema.extend({
    actorUserId: IdSchema,
    organizationId: IdSchema,
    keyId: IdSchema,
    label: z.string().min(1),
  }),
  "apikey.revoked": BaseEventSchema.extend({
    actorUserId: IdSchema,
    organizationId: IdSchema,
    keyId: IdSchema,
  }),
  "setting.changed": BaseEventSchema.extend({
    actorUserId: IdSchema,
    organizationId: IdSchema,
    settingKey: z.string().min(1),
    fromValue: z.unknown(),
    toValue: z.unknown(),
  }),
} as const satisfies Record<EventName, z.ZodTypeAny>;

export type EventPayload<TName extends EventName> = z.infer<(typeof EventSchemas)[TName]>;
export type EventPayloadMap = {
  [TName in EventName]: EventPayload<TName>;
};

export function parseEvent<TName extends EventName>(
  name: TName,
  payload: unknown,
): EventPayload<TName> {
  return EventSchemas[name].parse(payload) as EventPayload<TName>;
}

export function createIdempotencyKey(input: {
  orgId: string;
  resourceId: string;
  operation: string;
  contentHashSource: string;
}) {
  const digest = createHash("sha256").update(input.contentHashSource).digest("hex").slice(0, 16);
  return `${input.orgId}:${input.resourceId}:${input.operation}:${digest}`;
}

export function createDeploymentConcurrencyKey(input: { orgId: string; resourceId: string }) {
  return `${input.orgId}:${input.resourceId}:deploy`;
}

export function isDeploymentTerminalStatus(status: z.infer<typeof DeploymentStatusSchema>) {
  return (
    status === "failed" || status === "canceled" || status === "rolled_back" || status === "live"
  );
}
