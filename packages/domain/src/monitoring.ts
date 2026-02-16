import { db, eq } from "@otterstack/db";
import { projectResource } from "@otterstack/db/schema/architecture";

import { DomainError } from "./errors";

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

async function validateResource(resourceId: string, organizationId: string) {
  const row = await db.query.projectResource.findFirst({
    where: eq(projectResource.id, resourceId),
    with: {
      environment: {
        with: { project: true },
      },
    },
  });
  if (!row || row.environment.project.organizationId !== organizationId) {
    throw new DomainError("NOT_FOUND", "Resource not found");
  }
  return row;
}

export async function getMetrics(params: {
  resourceId: string;
  organizationId: string;
  metric: "cpu" | "memory" | "network_in" | "network_out" | "disk";
  from: string;
  to: string;
}) {
  await validateResource(params.resourceId, params.organizationId);
  const points: MetricPoint[] = [];
  return {
    resourceId: params.resourceId,
    metric: params.metric,
    points,
  };
}

export async function getLogs(params: {
  resourceId: string;
  organizationId: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}) {
  await validateResource(params.resourceId, params.organizationId);
  const items: LogItem[] = [];
  return {
    items,
    meta: paginationMeta(params.page, params.pageSize, 0),
  };
}

export async function streamLogs(params: {
  resourceId: string;
  organizationId: string;
  cursor?: string;
}) {
  await validateResource(params.resourceId, params.organizationId);
  const items: LogItem[] = [];
  return {
    items,
    meta: paginationMeta(1, 10, 0),
  };
}
