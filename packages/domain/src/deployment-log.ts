import { createHash } from "node:crypto";
import { mkdir, appendFile, open, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Result } from "better-result";
import { and, db, eq } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema/deployment";
import { createLogger } from "@otterdeploy/logger";

import { ConflictError, NotFoundError } from "./errors";

const log = createLogger("domain:deployment-log");
const DEFAULT_BASE_DIR = "/tmp/otterstack/deployment-logs";
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 64 * 1024;

export type DeploymentLogLevel = "debug" | "info" | "warn" | "error";
export type DeploymentLogTab = "build" | "deploy" | "runtime";

type DeploymentLogLine = {
  timestamp: string;
  level: DeploymentLogLevel;
  tab: DeploymentLogTab;
  message: string;
};

function sanitizePathSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function deploymentLogBaseDir(): string {
  const configured = process.env.OTTERSTACK_DEPLOYMENT_LOG_DIR;
  return configured && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_BASE_DIR;
}

function assertPathWithinBase(logPath: string): Result<string, Error> {
  const baseDir = resolve(deploymentLogBaseDir());
  const resolvedPath = resolve(logPath);

  if (!resolvedPath.startsWith(`${baseDir}/`) && resolvedPath !== baseDir) {
    return Result.err(
      new Error(`Log path is outside allowed directory: ${resolvedPath}`),
    );
  }
  return Result.ok(resolvedPath);
}

function computeLogPath(row: typeof deployment.$inferSelect): string {
  const baseDir = resolve(deploymentLogBaseDir());
  const org = sanitizePathSegment(row.organizationId);
  const project = sanitizePathSegment(row.projectId);
  const environment = sanitizePathSegment(row.environmentId);
  const resource = sanitizePathSegment(row.resourceId);
  const fileName = `${sanitizePathSegment(row.id)}.log`;
  return resolve(baseDir, org, project, environment, resource, fileName);
}

function redactSensitive(input: string): string {
  return input
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key)\s*=\s*([^\s]+)/gi,
      (_match, key) => `${String(key)}=***`,
    )
    .replace(/\b(authorization:\s*bearer)\s+[^\s]+/gi, "$1 ***")
    .replace(/(\/\/[^:\s/]+:)[^@/\s]+(@)/g, "$1***$2");
}

function parseLogLine(
  rawLine: string,
  deploymentId: string,
  byteOffset: number,
): {
  id: string;
  deploymentId: string;
  timestamp: string;
  tab: DeploymentLogTab;
  level: DeploymentLogLevel;
  message: string;
} {
  const fallbackTimestamp = new Date().toISOString();
  const parsed = (() => {
    try {
      return JSON.parse(rawLine) as Partial<DeploymentLogLine>;
    } catch {
      return null;
    }
  })();

  const timestamp =
    parsed?.timestamp && !Number.isNaN(Date.parse(parsed.timestamp))
      ? new Date(parsed.timestamp).toISOString()
      : fallbackTimestamp;
  const level =
    parsed?.level === "debug" ||
    parsed?.level === "info" ||
    parsed?.level === "warn" ||
    parsed?.level === "error"
      ? parsed.level
      : "info";
  const tab =
    parsed?.tab === "build" ||
    parsed?.tab === "deploy" ||
    parsed?.tab === "runtime"
      ? parsed.tab
      : "deploy";
  const message =
    typeof parsed?.message === "string" && parsed.message.length > 0
      ? parsed.message
      : rawLine;
  const id = createHash("sha1")
    .update(`${deploymentId}:${byteOffset}:${timestamp}:${message}`)
    .digest("hex");

  return {
    id,
    deploymentId,
    timestamp,
    tab,
    level,
    message,
  };
}

async function findDeploymentById(
  deploymentId: string,
  organizationId?: string,
): Promise<typeof deployment.$inferSelect | null> {
  if (organizationId) {
    const row = await db.query.deployment.findFirst({
      where: and(
        eq(deployment.id, deploymentId),
        eq(deployment.organizationId, organizationId),
      ),
    });
    return row ?? null;
  }

  const row = await db.query.deployment.findFirst({
    where: eq(deployment.id, deploymentId),
  });
  return row ?? null;
}

export async function ensureDeploymentLog(params: {
  deploymentId: string;
  organizationId?: string;
  logServerId?: string | null;
}): Promise<Result<{ logPath: string }, NotFoundError | ConflictError>> {
  const row = await findDeploymentById(params.deploymentId, params.organizationId);
  if (!row) {
    return Result.err(
      new NotFoundError({ resource: "deployment", id: params.deploymentId }),
    );
  }

  const chosenPath = row.logPath ?? computeLogPath(row);
  const safePathResult = assertPathWithinBase(chosenPath);
  if (safePathResult.isErr()) {
    return Result.err(
      new ConflictError({
        resource: "deployment",
        detail: safePathResult.error.message,
      }),
    );
  }
  const logPath = safePathResult.value;

  await mkdir(dirname(logPath), { recursive: true });

  let fileExists = true;
  try {
    await stat(logPath);
  } catch {
    fileExists = false;
  }

  if (!fileExists) {
    const initialLine: DeploymentLogLine = {
      timestamp: new Date().toISOString(),
      level: "info",
      tab: "deploy",
      message: "initializing deployment",
    };
    await appendFile(logPath, `${JSON.stringify(initialLine)}\n`, "utf8");
  }

  if (row.logPath !== logPath || (params.logServerId ?? null) !== (row.logServerId ?? null)) {
    await db
      .update(deployment)
      .set({
        logPath,
        logServerId: params.logServerId ?? row.logServerId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(deployment.id, row.id));
  }

  return Result.ok({ logPath });
}

export async function appendDeploymentLog(params: {
  deploymentId: string;
  organizationId?: string;
  level?: DeploymentLogLevel;
  tab?: DeploymentLogTab;
  message: string;
}): Promise<Result<void, NotFoundError | ConflictError>> {
  const ensured = await ensureDeploymentLog({
    deploymentId: params.deploymentId,
    organizationId: params.organizationId,
  });
  if (ensured.isErr()) return ensured;

  const line: DeploymentLogLine = {
    timestamp: new Date().toISOString(),
    level: params.level ?? "info",
    tab: params.tab ?? "deploy",
    message: redactSensitive(params.message),
  };

  try {
    await appendFile(ensured.value.logPath, `${JSON.stringify(line)}\n`, "utf8");
    return Result.ok(undefined);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error(
      { deploymentId: params.deploymentId, err },
      "Failed to append deployment log",
    );
    return Result.err(
      new ConflictError({
        resource: "deployment",
        detail: err.message,
      }),
    );
  }
}

export async function getDeploymentLogPath(params: {
  deploymentId: string;
  organizationId?: string;
  createIfMissing?: boolean;
}): Promise<Result<string | null, NotFoundError | ConflictError>> {
  const row = await findDeploymentById(params.deploymentId, params.organizationId);
  if (!row) {
    return Result.err(
      new NotFoundError({ resource: "deployment", id: params.deploymentId }),
    );
  }

  if (!row.logPath && params.createIfMissing) {
    const ensured = await ensureDeploymentLog({
      deploymentId: row.id,
      organizationId: row.organizationId,
    });
    if (ensured.isErr()) return ensured;
    return Result.ok(ensured.value.logPath);
  }

  if (!row.logPath) return Result.ok(null);

  const safePathResult = assertPathWithinBase(row.logPath);
  if (safePathResult.isErr()) {
    return Result.err(
      new ConflictError({
        resource: "deployment",
        detail: safePathResult.error.message,
      }),
    );
  }
  return Result.ok(safePathResult.value);
}

export async function readDeploymentLogChunk(params: {
  deploymentId: string;
  organizationId: string;
  cursor?: string;
  limitBytes?: number;
}): Promise<
  Result<
    {
      items: Array<{
        id: string;
        deploymentId: string;
        timestamp: string;
        tab: DeploymentLogTab;
        level: DeploymentLogLevel;
        message: string;
      }>;
      cursor: string;
      nextCursor: string;
      hasMore: boolean;
      sizeBytes: number;
    },
    NotFoundError | ConflictError
  >
> {
  const pathResult = await getDeploymentLogPath({
    deploymentId: params.deploymentId,
    organizationId: params.organizationId,
    createIfMissing: true,
  });
  if (pathResult.isErr()) return pathResult;

  const logPath = pathResult.value;
  if (!logPath) {
    return Result.ok({
      items: [],
      cursor: "0",
      nextCursor: "0",
      hasMore: false,
      sizeBytes: 0,
    });
  }

  let fileSize = 0;
  try {
    const info = await stat(logPath);
    fileSize = info.size;
  } catch {
    return Result.ok({
      items: [],
      cursor: "0",
      nextCursor: "0",
      hasMore: false,
      sizeBytes: 0,
    });
  }

  const parsedCursor = Number.parseInt(params.cursor ?? "0", 10);
  const cursor = Number.isFinite(parsedCursor)
    ? Math.max(0, Math.min(parsedCursor, fileSize))
    : 0;
  const requestedBytes = params.limitBytes ?? DEFAULT_CHUNK_BYTES;
  const chunkBytes = Math.max(1, Math.min(requestedBytes, MAX_CHUNK_BYTES));
  const end = Math.min(fileSize, cursor + chunkBytes);
  const bytesToRead = Math.max(0, end - cursor);

  if (bytesToRead === 0) {
    return Result.ok({
      items: [],
      cursor: String(cursor),
      nextCursor: String(cursor),
      hasMore: false,
      sizeBytes: fileSize,
    });
  }

  const file = await open(logPath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, cursor);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    let nextCursor = cursor + bytesRead;

    if (nextCursor < fileSize) {
      const lastNewLine = text.lastIndexOf("\n");
      if (lastNewLine >= 0) {
        const visible = text.slice(0, lastNewLine + 1);
        const skippedBytes = Buffer.byteLength(text) - Buffer.byteLength(visible);
        text = visible;
        nextCursor -= skippedBytes;
      } else {
        return Result.ok({
          items: [],
          cursor: String(cursor),
          nextCursor: String(cursor),
          hasMore: true,
          sizeBytes: fileSize,
        });
      }
    }

    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    let byteOffset = cursor;
    const items = lines.map((line) => {
      const parsed = parseLogLine(line, params.deploymentId, byteOffset);
      byteOffset += Buffer.byteLength(line) + 1;
      return parsed;
    });

    return Result.ok({
      items,
      cursor: String(cursor),
      nextCursor: String(nextCursor),
      hasMore: nextCursor < fileSize,
      sizeBytes: fileSize,
    });
  } finally {
    await file.close();
  }
}
