import { Result } from "better-result";
import { createHash } from "node:crypto";
import { createLogger } from "@otterdeploy/logger";
import { db, eq, desc } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/deployment";
import { resource } from "@otterdeploy/db/schema/project";
import { getServiceLogs, listServices, type ServiceInfo } from "@otterdeploy/docker";

import { NotFoundError } from "./errors";

const log = createLogger("domain:monitoring");

type MetricPoint = {
  timestamp: string;
  value: number;
};

type LogItem = {
  id: string;
  timestamp: string;
  message: string;
  deploymentId: string;
  tab: "runtime";
  level: "debug" | "info" | "warn" | "error";
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

function toUnixSeconds(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

async function resolveServiceName(resourceId: string): Promise<string> {
  const fallback = `otterstack-${resourceId}`;
  const byMostRecentUpdate = (services: ServiceInfo[]) =>
    [...services].sort((a, b) => {
      const aTs = Date.parse(a.updatedAt ?? a.createdAt);
      const bTs = Date.parse(b.updatedAt ?? b.createdAt);
      const aTime = Number.isNaN(aTs) ? 0 : aTs;
      const bTime = Number.isNaN(bTs) ? 0 : bTs;
      return bTime - aTime;
    });

  const servicesByLabel = await listServices({ "otterstack.resource.id": resourceId });
  if (servicesByLabel.isOk() && servicesByLabel.value.length > 0) {
    return byMostRecentUpdate(servicesByLabel.value)[0]?.name ?? fallback;
  }
  if (servicesByLabel.isErr()) {
    log.warn(
      { resourceId, err: servicesByLabel.error },
      "Could not list services by resource label",
    );
  }

  // Fallback: scan all services and match either label or common DB service-name suffix.
  const allServicesResult = await listServices();
  if (allServicesResult.isErr()) {
    log.warn({ resourceId, err: allServicesResult.error }, "Could not list all services");
    return fallback;
  }

  const databaseSuffix = `_db-${resourceId.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}`;
  const nameCandidates = allServicesResult.value.filter((service) => {
    if (service.labels?.["otterstack.resource.id"] === resourceId) return true;
    return service.name.toLowerCase().endsWith(databaseSuffix);
  });

  if (nameCandidates.length > 0) {
    return byMostRecentUpdate(nameCandidates)[0]?.name ?? fallback;
  }

  const byMostRecentAcrossAll = [...allServicesResult.value].sort((a, b) => {
    const aTs = Date.parse(a.updatedAt ?? a.createdAt);
    const bTs = Date.parse(b.updatedAt ?? b.createdAt);
    const aTime = Number.isNaN(aTs) ? 0 : aTs;
    const bTime = Number.isNaN(bTs) ? 0 : bTs;
    return bTime - aTime;
  });
  return byMostRecentAcrossAll[0]?.name ?? fallback;
}

function decodeDockerStream(buffer: Buffer): string[] {
  const lines: string[] = [];
  let offset = 0;

  // Docker multiplexed stream format:
  // [1 byte stream type][3 bytes 0][4 bytes big-endian payload length][payload]
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const reserved = buffer.subarray(offset + 1, offset + 4);

    const isKnownStreamType = streamType === 1 || streamType === 2 || streamType === 3;
    const hasValidReservedBytes = reserved[0] === 0 && reserved[1] === 0 && reserved[2] === 0;
    if (!isKnownStreamType || !hasValidReservedBytes) break;

    const payloadLength = buffer.readUInt32BE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (payloadEnd > buffer.length) break;

    const payload = buffer.subarray(payloadStart, payloadEnd).toString("utf8");
    lines.push(...payload.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean));
    offset = payloadEnd;
  }

  if (lines.length > 0) return lines;

  // Fallback for plain-text streams.
  return buffer
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function inferLogLevel(message: string): LogItem["level"] {
  try {
    const parsed = JSON.parse(message) as { level?: unknown };
    if (
      parsed.level === "debug" ||
      parsed.level === "info" ||
      parsed.level === "warn" ||
      parsed.level === "error"
    ) {
      return parsed.level;
    }
  } catch {
    // not json, keep heuristics
  }

  const lower = message.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("debug") || lower.includes("trace")) return "debug";
  return "info";
}

function parseTimestampedLine(line: string): { timestamp: string; message: string } {
  // docker logs --timestamps prefix: 2026-02-26T09:58:40.123456789Z <message>
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)\s+(.*)$/);
  if (!match) {
    return { timestamp: new Date().toISOString(), message: line };
  }

  // Normalize nanoseconds precision to milliseconds for JS Date compatibility.
  const rawTimestamp = match[1] ?? "";
  const normalizedTimestamp = rawTimestamp.replace(
    /\.(\d{3})\d*Z$/,
    ".$1Z",
  );
  const parsed = new Date(normalizedTimestamp);
  return {
    timestamp: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
    message: match[2] ?? "",
  };
}

async function resolveLatestDeploymentId(resourceId: string): Promise<string | null> {
  const latest = await db.query.deployment.findFirst({
    where: eq(deployment.resourceId, resourceId),
    orderBy: [desc(deployment.createdAt)],
  });
  return latest?.id ?? null;
}

async function validateResource(
  resourceId: string,
  organizationId: string,
): Promise<Result<typeof resource.$inferSelect, NotFoundError>> {
  const row = await db.query.resource.findFirst({
    where: eq(resource.id, resourceId),
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
  deploymentId?: string;
  page: number;
  pageSize: number;
}): Promise<Result<{ items: LogItem[]; meta: ReturnType<typeof paginationMeta> }, NotFoundError>> {
  const result = await validateResource(params.resourceId, params.organizationId);
  if (result.isErr()) return result;

  const deploymentId =
    params.deploymentId ??
    (await resolveLatestDeploymentId(params.resourceId)) ??
    params.resourceId;
  const serviceName = await resolveServiceName(params.resourceId);
  const since = toUnixSeconds(params.from);
  const until = toUnixSeconds(params.to);
  const tailCount = Math.min(Math.max(params.page * params.pageSize, params.pageSize), 500);

  const logResult = await getServiceLogs(serviceName, {
    tail: since || until ? 5_000 : tailCount,
    follow: false,
    stdout: true,
    stderr: true,
    timestamps: true,
    since,
    until,
  });

  if (logResult.isErr()) {
    log.warn(
      { resourceId: params.resourceId, serviceName, err: logResult.error },
      "Could not fetch service logs",
    );
    return Result.ok({
      items: [],
      meta: paginationMeta(params.page, params.pageSize, 0),
    });
  }

  const buffer = logResult.value;
  const decoded = decodeDockerStream(buffer);

  const allItems: LogItem[] = decoded.map((line, index) => {
    const { timestamp, message } = parseTimestampedLine(line);
    const id = createHash("sha1")
      .update(`${serviceName}:${timestamp}:${message}:${index}`)
      .digest("hex");
    return {
      id,
      deploymentId,
      timestamp,
      message,
      tab: "runtime",
      level: inferLogLevel(message),
    };
  });

  const fromMs = params.from ? Date.parse(params.from) : null;
  const toMs = params.to ? Date.parse(params.to) : null;
  const filtered = allItems.filter((item) => {
    const itemMs = Date.parse(item.timestamp);
    if (Number.isNaN(itemMs)) return false;
    if (fromMs !== null && !Number.isNaN(fromMs) && itemMs < fromMs) return false;
    if (toMs !== null && !Number.isNaN(toMs) && itemMs > toMs) return false;
    return true;
  });

  const sorted = filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const offset = (params.page - 1) * params.pageSize;
  const items = sorted.slice(offset, offset + params.pageSize);

  return Result.ok({
    items,
    meta: paginationMeta(params.page, params.pageSize, sorted.length),
  });
}

export async function streamLogs(params: {
  resourceId: string;
  organizationId: string;
  cursor?: string;
}): Promise<Result<{ items: LogItem[]; meta: ReturnType<typeof paginationMeta> }, NotFoundError>> {
  return getLogs({
    resourceId: params.resourceId,
    organizationId: params.organizationId,
    page: 1,
    pageSize: 50,
  });
}
