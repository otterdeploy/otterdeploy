import { db, eq, and, desc, or, sql } from "@otterstack/db";
import { deployment, deploymentEvent } from "@otterstack/db/schema/deployment";
import { projectResource } from "@otterstack/db/schema/architecture";
import { createIdempotencyKey, publishEvent } from "@otterstack/events";
import { Result } from "better-result";

import { DomainError } from "./errors";
import { transitionTo } from "./deployment-machine";

function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    pagination: {
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      total,
    },
  };
}

function formatDeployment(row: typeof deployment.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    environmentId: row.environmentId,
    resourceId: row.resourceId,
    status: row.status,
    source: row.source,
    buildMethod: row.buildMethod ?? null,
    gitRef: row.gitRef ?? null,
    gitCommitSha: row.gitCommitSha ?? null,
    gitCommitMessage: row.gitCommitMessage ?? null,
    imageTag: row.imageTag ?? null,
    previousImageTag: row.previousImageTag ?? null,
    triggeredBy: row.triggeredBy ?? null,
    startedAt: toISOString(row.startedAt),
    completedAt: toISOString(row.completedAt),
    duration: row.duration ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatDeploymentEvent(row: typeof deploymentEvent.$inferSelect) {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    status: row.status,
    previousStatus: row.previousStatus,
    actor: row.actor,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

async function publishDeploymentRequestedEvent(input: {
  deploymentId: string;
  organizationId: string;
  resourceId: string;
  environmentId: string;
  source: "git_push" | "manual" | "rollback" | "api" | "preview";
  actorUserId: string;
  gitCommitSha?: string;
  correlationId?: string;
}) {
  const publishResult = await publishEvent("deployment.requested", {
    orgId: input.organizationId,
    deploymentId: input.deploymentId,
    resourceId: input.resourceId,
    environmentId: input.environmentId,
    source: input.source,
    actorUserId: input.actorUserId,
    correlationId: input.correlationId,
    idempotencyKey: createIdempotencyKey({
      orgId: input.organizationId,
      resourceId: input.resourceId,
      operation: "deploy",
      contentHashSource: `${input.deploymentId}:${input.source}:${input.gitCommitSha ?? ""}`,
    }),
  });

  if (publishResult.isErr()) {
    throw publishResult.error;
  }
}

async function enqueueDeploymentRequestedEvent(input: {
  deploymentId: string;
  organizationId: string;
  resourceId: string;
  environmentId: string;
  source: "git_push" | "manual" | "rollback" | "api" | "preview";
  actorUserId: string;
  gitCommitSha?: string;
  correlationId?: string;
  failureReason: string;
  conflictMessage: string;
}) {
  const publishResult = await Result.tryPromise({
    try: () => publishDeploymentRequestedEvent(input),
    catch: (error) => error,
  });

  if (publishResult.isOk()) {
    return;
  }

  const error = publishResult.error;
  await transitionTo(input.deploymentId, "failed", {
    actor: "system",
    reason: input.failureReason,
    metadata: {
      error: error instanceof Error ? error.message : "Unknown publish error",
    },
  });

  throw new DomainError("CONFLICT", input.conflictMessage, error);
}

export async function createDeployment(params: {
  organizationId: string;
  projectId: string;
  environmentId: string;
  resourceId: string;
  source: "git_push" | "manual" | "rollback" | "api" | "preview";
  triggeredBy: string;
  gitRef?: string;
  gitCommitSha?: string;
  gitCommitMessage?: string;
  buildMethod?: "nixpacks" | "dockerfile" | "buildpack";
  correlationId?: string;
}) {
  // Validate resource belongs to environment/project/org
  const resource = await db.query.projectResource.findFirst({
    where: and(
      eq(projectResource.id, params.resourceId),
      eq(projectResource.environmentId, params.environmentId),
    ),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });

  if (
    !resource ||
    resource.environment.projectId !== params.projectId ||
    resource.environment.project.organizationId !== params.organizationId
  ) {
    throw new DomainError("NOT_FOUND", "Resource not found in project/environment");
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    organizationId: params.organizationId,
    projectId: params.projectId,
    environmentId: params.environmentId,
    resourceId: params.resourceId,
    status: "queued" as const,
    source: params.source,
    gitRef: params.gitRef ?? null,
    gitCommitSha: params.gitCommitSha ?? null,
    gitCommitMessage: params.gitCommitMessage ?? null,
    buildMethod: params.buildMethod ?? null,
    imageTag: null,
    previousImageTag: null,
    startedAt: null,
    completedAt: null,
    duration: null,
    triggeredBy: params.triggeredBy,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(deployment).values(row).returning();
  if (!inserted) {
    throw new DomainError("CONFLICT", "Failed to create deployment");
  }

  // Insert initial timeline event (null → queued)
  await db.insert(deploymentEvent).values({
    id: crypto.randomUUID(),
    deploymentId: inserted.id,
    status: "queued",
    previousStatus: null,
    actor: params.triggeredBy,
    reason: null,
    metadata: {},
    createdAt: now,
  });

  await enqueueDeploymentRequestedEvent({
    deploymentId: inserted.id,
    organizationId: inserted.organizationId,
    resourceId: inserted.resourceId,
    environmentId: inserted.environmentId,
    source: inserted.source,
    actorUserId: params.triggeredBy,
    gitCommitSha: inserted.gitCommitSha ?? undefined,
    correlationId: params.correlationId,
    failureReason: "Failed to enqueue deployment workflow",
    conflictMessage:
      "Failed to enqueue deployment workflow. Check Inngest configuration and retry.",
  });

  return formatDeployment(inserted);
}

export async function getDeploymentWithTimeline(deploymentId: string, organizationId: string) {
  const row = await db.query.deployment.findFirst({
    where: and(eq(deployment.id, deploymentId), eq(deployment.organizationId, organizationId)),
  });

  if (!row) {
    throw new DomainError("NOT_FOUND", "Deployment not found");
  }

  const events = await db.query.deploymentEvent.findMany({
    where: eq(deploymentEvent.deploymentId, deploymentId),
    orderBy: [desc(deploymentEvent.createdAt)],
  });

  return {
    deployment: formatDeployment(row),
    events: events.map(formatDeploymentEvent),
  };
}

export async function listDeployments(params: {
  organizationId: string;
  resourceId?: string;
  environmentId?: string;
  projectId?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const { page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(deployment.organizationId, params.organizationId)];
  if (params.projectId) conditions.push(eq(deployment.projectId, params.projectId));
  if (params.environmentId) conditions.push(eq(deployment.environmentId, params.environmentId));
  if (params.resourceId) conditions.push(eq(deployment.resourceId, params.resourceId));

  const whereClause = and(...conditions);

  const [items, [countRow]] = await Promise.all([
    db.query.deployment.findMany({
      where: whereClause,
      orderBy: [desc(deployment.createdAt)],
      limit: pageSize,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(deployment)
      .where(whereClause!),
  ]);

  return {
    items: items.map(formatDeployment),
    meta: paginationMeta(page, pageSize, countRow?.count ?? 0),
  };
}

export async function cancelDeployment(
  deploymentId: string,
  organizationId: string,
  canceledBy: string,
) {
  const row = await db.query.deployment.findFirst({
    where: and(eq(deployment.id, deploymentId), eq(deployment.organizationId, organizationId)),
  });

  if (!row) {
    throw new DomainError("NOT_FOUND", "Deployment not found");
  }

  // Only queued/building can be canceled
  if (row.status !== "queued" && row.status !== "building") {
    throw new DomainError("CONFLICT", `Cannot cancel deployment in ${row.status} status`);
  }

  await transitionTo(deploymentId, "canceled", {
    actor: canceledBy,
    reason: "Canceled by user",
  });

  const updated = await db.query.deployment.findFirst({
    where: eq(deployment.id, deploymentId),
  });
  return formatDeployment(updated!);
}

export async function initiateRollback(
  deploymentId: string,
  organizationId: string,
  actorUserId: string,
  reason?: string,
  correlationId?: string,
) {
  const original = await db.query.deployment.findFirst({
    where: and(eq(deployment.id, deploymentId), eq(deployment.organizationId, organizationId)),
  });

  if (!original) {
    throw new DomainError("NOT_FOUND", "Deployment not found");
  }

  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    organizationId,
    projectId: original.projectId,
    environmentId: original.environmentId,
    resourceId: original.resourceId,
    status: "queued" as const,
    source: "rollback" as const,
    gitRef: original.gitRef,
    gitCommitSha: original.gitCommitSha,
    gitCommitMessage: null,
    buildMethod: original.buildMethod,
    imageTag: original.previousImageTag,
    previousImageTag: original.imageTag,
    startedAt: null,
    completedAt: null,
    duration: null,
    triggeredBy: actorUserId,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db.insert(deployment).values(row).returning();
  if (!inserted) {
    throw new DomainError("CONFLICT", "Failed to create rollback deployment");
  }

  // Insert initial timeline event
  await db.insert(deploymentEvent).values({
    id: crypto.randomUUID(),
    deploymentId: inserted.id,
    status: "queued",
    previousStatus: null,
    actor: actorUserId,
    reason: reason ?? "Rollback initiated",
    metadata: { rolledBackFrom: deploymentId },
    createdAt: now,
  });

  await enqueueDeploymentRequestedEvent({
    deploymentId: inserted.id,
    organizationId: inserted.organizationId,
    resourceId: inserted.resourceId,
    environmentId: inserted.environmentId,
    source: inserted.source,
    actorUserId,
    gitCommitSha: inserted.gitCommitSha ?? undefined,
    correlationId,
    failureReason: "Failed to enqueue rollback workflow",
    conflictMessage: "Failed to enqueue rollback workflow. Check Inngest configuration and retry.",
  });

  // NOTE: Secret snapshot resolution excluded from scope (Wave 3 constraint)

  return formatDeployment(inserted);
}

export async function getActiveDeployment(resourceId: string) {
  const row = await db.query.deployment.findFirst({
    where: and(
      eq(deployment.resourceId, resourceId),
      or(
        eq(deployment.status, "queued"),
        eq(deployment.status, "building"),
        eq(deployment.status, "deploying"),
        eq(deployment.status, "verifying"),
      ),
    ),
    orderBy: [desc(deployment.createdAt)],
  });

  return row ? formatDeployment(row) : null;
}

export async function supersedeQueuedDeployments(resourceId: string, exceptDeploymentId: string) {
  const queued = await db.query.deployment.findMany({
    where: and(eq(deployment.resourceId, resourceId), eq(deployment.status, "queued")),
  });

  for (const d of queued) {
    if (d.id === exceptDeploymentId) continue;
    await transitionTo(d.id, "canceled", {
      actor: "system",
      reason: "Superseded by newer deployment",
    });
  }
}
