/**
 * Resolves `${{<Resource>.<VAR>}}` references inside a service's env vars
 * by walking the dependency graph and calling type-specific exporters.
 *
 * Recursion handles service-to-service references; cycles are detected via
 * a visited set on the active DFS path. Exporter results are cached for the
 * duration of a single `resolveServiceEnv` call.
 */

import {
  getDatabaseResourceRecord,
  type DatabaseResourceRecord,
} from "../queries/postgres-resource";

import {
  getResourceByProjectAndName,
  getServiceRecord,
  type ResourceRow,
  type ServiceRecord,
} from "../queries/service";
import { postgresExports, serviceExports } from "./exporters";
import { parseValue, type Token } from "./parser";

export type ResolveError =
  | { kind: "parse_error"; key: string; message: string; position: number }
  | { kind: "missing_resource"; refResourceName: string }
  | { kind: "unsupported_resource_type"; refResourceName: string; type: string }
  | { kind: "missing_database_record"; refResourceName: string }
  | { kind: "missing_service_record"; refResourceName: string }
  | { kind: "unknown_var"; refResourceName: string; refVarName: string }
  | { kind: "cycle"; chain: string[] };

export type ResolveSuccess = { ok: true; env: Record<string, string> };
export type ResolveFailure = { ok: false; error: ResolveError };
export type ResolveResult = ResolveSuccess | ResolveFailure;

type ResolveContext = {
  projectId: string;
  visited: Set<string>;
  exportsCache: Map<string, Record<string, string>>;
};

export async function resolveServiceEnv(
  projectId: string,
  serviceResourceId: string,
): Promise<ResolveResult> {
  const ctx: ResolveContext = {
    projectId,
    visited: new Set([serviceResourceId]),
    exportsCache: new Map(),
  };

  const record = await getServiceRecord(projectId, serviceResourceId);
  if (!record) {
    return {
      ok: false,
      error: { kind: "missing_service_record", refResourceName: "(self)" },
    };
  }

  return resolveEnvFor(record, ctx);
}

async function resolveEnvFor(
  record: ServiceRecord,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const resolved: Record<string, string> = {};

  for (const envVar of record.env) {
    const parsed = parseValue(envVar.value);
    if (!parsed.ok) {
      return {
        ok: false,
        error: {
          kind: "parse_error",
          key: envVar.key,
          message: parsed.error.message,
          position: parsed.error.position,
        },
      };
    }

    const subbed = await substitute(parsed.tokens, ctx);
    if (!subbed.ok) return subbed;

    resolved[envVar.key] = subbed.value;
  }

  return { ok: true, env: resolved };
}

async function substitute(
  tokens: Token[],
  ctx: ResolveContext,
): Promise<{ ok: true; value: string } | ResolveFailure> {
  let out = "";

  for (const token of tokens) {
    if (token.kind === "literal") {
      out += token.value;
      continue;
    }

    const exportsResult = await loadExports(token.resource, ctx);
    if (!exportsResult.ok) return exportsResult;

    const value = exportsResult.exports[token.var];
    if (value === undefined) {
      return {
        ok: false,
        error: {
          kind: "unknown_var",
          refResourceName: token.resource,
          refVarName: token.var,
        },
      };
    }
    out += value;
  }

  return { ok: true, value: out };
}

async function loadExports(
  refResourceName: string,
  ctx: ResolveContext,
): Promise<
  { ok: true; exports: Record<string, string> } | ResolveFailure
> {
  const resourceRow = await getResourceByProjectAndName(
    ctx.projectId,
    refResourceName,
  );

  if (!resourceRow) {
    return {
      ok: false,
      error: { kind: "missing_resource", refResourceName },
    };
  }

  if (ctx.visited.has(resourceRow.id)) {
    return {
      ok: false,
      error: {
        kind: "cycle",
        chain: [...ctx.visited, resourceRow.id],
      },
    };
  }

  const cached = ctx.exportsCache.get(resourceRow.id);
  if (cached) return { ok: true, exports: cached };

  if (resourceRow.type === "database") {
    return loadDatabaseExports(resourceRow, refResourceName, ctx);
  }

  if (resourceRow.type === "service") {
    return loadServiceExports(resourceRow, refResourceName, ctx);
  }

  return {
    ok: false,
    error: {
      kind: "unsupported_resource_type",
      refResourceName,
      type: resourceRow.type,
    },
  };
}

async function loadDatabaseExports(
  resourceRow: ResourceRow,
  refResourceName: string,
  ctx: ResolveContext,
): Promise<
  { ok: true; exports: Record<string, string> } | ResolveFailure
> {
  const record: DatabaseResourceRecord | undefined =
    await getDatabaseResourceRecord(ctx.projectId, resourceRow.id);
  if (!record) {
    return {
      ok: false,
      error: { kind: "missing_database_record", refResourceName },
    };
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
  return { ok: true, exports };
}

async function loadServiceExports(
  resourceRow: ResourceRow,
  refResourceName: string,
  ctx: ResolveContext,
): Promise<
  { ok: true; exports: Record<string, string> } | ResolveFailure
> {
  const record = await getServiceRecord(ctx.projectId, resourceRow.id);
  if (!record) {
    return {
      ok: false,
      error: { kind: "missing_service_record", refResourceName },
    };
  }

  ctx.visited.add(resourceRow.id);
  const nestedResult = await resolveEnvFor(record, ctx);
  ctx.visited.delete(resourceRow.id);
  if (!nestedResult.ok) return nestedResult;

  const exports = serviceExports({
    resource: resourceRow,
    service: record.service,
    ports: record.ports,
    resolvedEnv: nestedResult.env,
  });
  ctx.exportsCache.set(resourceRow.id, exports);
  return { ok: true, exports };
}
