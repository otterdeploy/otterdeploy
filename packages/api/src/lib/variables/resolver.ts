/**
 * Resolves `${{<Resource>.<VAR>}}` references inside a service's env vars
 * by walking the dependency graph and calling type-specific exporters.
 *
 * Recursion handles service-to-service references; cycles are detected via
 * a visited set on the active DFS path. Exporter results are cached for the
 * duration of a single `resolveServiceEnv` call.
 */

import { Result } from "better-result";

import { type ProjectId } from "../../routers/project/errors";
import {
  RefCycleError,
  RefMissingResourceError,
  RefParseError,
  RefUnknownVarError,
  type ResolveError,
  type ResourceId,
} from "../../routers/service/errors";
import {
  getDatabaseResourceRecord,
  type DatabaseResourceRecord,
} from "../../routers/project/postgres-resource.queries";

import {
  getResourceByProjectAndName,
  getServiceRecord,
  type ResourceRow,
  type ServiceRecord,
} from "../../routers/service/queries";
import { postgresExports, serviceExports } from "./exporters";
import { parseValue, type Token } from "./parser";

type ResolveContext = {
  projectId: ProjectId;
  visited: Set<string>;
  exportsCache: Map<string, Record<string, string>>;
};

export async function resolveServiceEnv(
  projectId: ProjectId,
  serviceResourceId: ResourceId,
): Promise<Result<Record<string, string>, ResolveError | RefMissingResourceError>> {
  const ctx: ResolveContext = {
    projectId,
    visited: new Set([serviceResourceId]),
    exportsCache: new Map(),
  };

  const record = await getServiceRecord(projectId, serviceResourceId);
  if (!record) {
    return Result.err(new RefMissingResourceError({ refResourceName: "(self)" }));
  }
  return resolveEnvFor(record, ctx);
}

async function resolveEnvFor(
  record: ServiceRecord,
  ctx: ResolveContext,
): Promise<Result<Record<string, string>, ResolveError>> {
  const resolved: Record<string, string> = {};

  for (const envVar of record.env) {
    const parsed = parseValue(envVar.value);
    if (!parsed.ok) {
      return Result.err(
        new RefParseError({
          key: envVar.key,
          position: parsed.error.position,
          message: parsed.error.message,
        }),
      );
    }

    const subbed = await substitute(parsed.tokens, ctx);
    if (subbed.isErr()) return subbed;
    resolved[envVar.key] = subbed.value;
  }

  return Result.ok(resolved);
}

async function substitute(
  tokens: Token[],
  ctx: ResolveContext,
): Promise<Result<string, ResolveError>> {
  let out = "";

  for (const token of tokens) {
    if (token.kind === "literal") {
      out += token.value;
      continue;
    }

    const exportsResult = await loadExports(token.resource, ctx);
    if (exportsResult.isErr()) return exportsResult;

    const value = exportsResult.value[token.var];
    if (value === undefined) {
      return Result.err(
        new RefUnknownVarError({
          refResourceName: token.resource,
          refVarName: token.var,
        }),
      );
    }
    out += value;
  }

  return Result.ok(out);
}

async function loadExports(
  refResourceName: string,
  ctx: ResolveContext,
): Promise<Result<Record<string, string>, ResolveError>> {
  const resourceRow = await getResourceByProjectAndName(ctx.projectId, refResourceName);
  if (!resourceRow) {
    return Result.err(new RefMissingResourceError({ refResourceName }));
  }

  if (ctx.visited.has(resourceRow.id)) {
    return Result.err(new RefCycleError({ chain: [...ctx.visited, resourceRow.id] }));
  }

  const cached = ctx.exportsCache.get(resourceRow.id);
  if (cached) return Result.ok(cached);

  if (resourceRow.type === "database") {
    return loadDatabaseExports(resourceRow, refResourceName, ctx);
  }

  if (resourceRow.type === "service") {
    return loadServiceExports(resourceRow, refResourceName, ctx);
  }

  return Result.err(new RefMissingResourceError({ refResourceName }));
}

async function loadDatabaseExports(
  resourceRow: ResourceRow,
  refResourceName: string,
  ctx: ResolveContext,
): Promise<Result<Record<string, string>, ResolveError>> {
  const record: DatabaseResourceRecord | undefined = await getDatabaseResourceRecord(
    ctx.projectId,
    resourceRow.id,
  );
  if (!record) {
    return Result.err(new RefMissingResourceError({ refResourceName }));
  }

  const exports = postgresExports({
    resource: resourceRow,
    database: {
      internalConnectionString: record.database.internalConnectionString,
      internalHostname: record.database.internalHostname,
      internalPort: record.database.internalPort,
      username: record.database.username,
      password: record.database.password,
      databaseName: record.database.databaseName,
    },
  });
  ctx.exportsCache.set(resourceRow.id, exports);
  return Result.ok(exports);
}

async function loadServiceExports(
  resourceRow: ResourceRow,
  refResourceName: string,
  ctx: ResolveContext,
): Promise<Result<Record<string, string>, ResolveError>> {
  const record = await getServiceRecord(ctx.projectId, resourceRow.id);
  if (!record) {
    return Result.err(new RefMissingResourceError({ refResourceName }));
  }

  ctx.visited.add(resourceRow.id);
  const nestedResult = await resolveEnvFor(record, ctx);
  ctx.visited.delete(resourceRow.id);
  if (nestedResult.isErr()) return nestedResult;

  const exports = serviceExports({
    resource: resourceRow,
    service: record.service,
    ports: record.ports,
    resolvedEnv: nestedResult.value,
  });
  ctx.exportsCache.set(resourceRow.id, exports);
  return Result.ok(exports);
}
