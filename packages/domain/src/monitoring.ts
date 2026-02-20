import { Result } from "better-result";
import { db, eq } from "@otterdeploy/db";
import { projectResource } from "@otterdeploy/db/schema/architecture";

import { NotFoundError } from "./errors";

type MetricPoint = {
  timestamp: string;
  value: number;
};

type LogItem = {
  id: string;
  timestamp: string;
  message: string;
  level: "info" | "warn" | "error";
};

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

async function validateResource(
  resourceId: string,
  organizationId: string,
): Promise<Result<typeof projectResource.$inferSelect, NotFoundError>> {
  const row = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    return Result.err(new NotFoundError({ resource: "resource", id: resourceId }));
  }
  return Result.ok(row);
}

export async function getMetrics(params: {
  resourceId: string;
  organizationId: string;
  metric: "cpu" | "memory" | "network_in" | "network_out" | "disk";
  from: string;
  to: string;
}): Promise<Result<{ resourceId: string; metric: string; points: MetricPoint[] }, NotFoundError>> {
  const result = await validateResource(params.resourceId, params.organizationId);
  if (result.isErr()) return result;
  const points: MetricPoint[] = [];
  return Result.ok({
    resourceId: params.resourceId,
    metric: params.metric,
    points,
  });
}

export async function getLogs(params: {
  resourceId: string;
  organizationId: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}): Promise<Result<{ items: LogItem[]; meta: ReturnType<typeof paginationMeta> }, NotFoundError>> {
  const result = await validateResource(params.resourceId, params.organizationId);
  if (result.isErr()) return result;
  const items: LogItem[] = [];
  return Result.ok({
    items,
    meta: paginationMeta(params.page, params.pageSize, 0),
  });
}

export async function streamLogs(params: {
  resourceId: string;
  organizationId: string;
  cursor?: string;
}): Promise<Result<{ items: LogItem[]; meta: ReturnType<typeof paginationMeta> }, NotFoundError>> {
  const result = await validateResource(params.resourceId, params.organizationId);
  if (result.isErr()) return result;
  const items: LogItem[] = [];
  return Result.ok({
    items,
    meta: paginationMeta(1, 10, 0),
  });
}
