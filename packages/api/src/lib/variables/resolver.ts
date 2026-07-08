/**
 * Resolves `${{<Resource>.<VAR>}}` references inside a service's env vars
 * by walking the dependency graph and calling type-specific exporters.
 *
 * Recursion handles service-to-service references; cycles are detected via
 * a visited set on the active DFS path. Exporter results are cached for the
 * duration of a single `resolveServiceEnv` call.
 */
import type { EnvironmentId, PreviewId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { Result } from "better-result";

import {
  getDatabaseResourceRecord,
  getProjectRecord,
  loadProjectEnvBag,
  type DatabaseResourceRecord,
} from "../../routers/project/queries";
import {
  RefCycleError,
  RefMissingResourceError,
  RefParseError,
  RefUnknownVarError,
  type ResolveError,
} from "../../routers/service/errors";
import { listPreviewServiceEnvVars,
  getServiceRecord,
  resolveResourceForPreview,
  type ResourceRow,
  type ServiceEnvVarRow,
  type ServiceRecord,
} from "../../routers/service/queries";
import { postgresExports, serviceExports } from "./exporters";
import { parseValue, type Token } from "./parser";
interface ResolveContext {
  projectId: ProjectId;
  // The persistent environment whose var bags apply (the project's default
  // env). Drives the env-var overlay for user-managed environments.
  environmentId: EnvironmentId;
  // Preview scoping for RESOURCE lookups: a preview-scoped row (an opt-in DB
  // branch) wins over the base row; null resolves base rows only. Previews
  // are NOT environments — their var bags are the base env's, unchanged.
  previewId: PreviewId | null;
  visited: Set<string>;
  exportsCache: Map<string, Record<string, string>>;
}

export async function resolveServiceEnv(
  projectId: ProjectId,
  serviceResourceId: ResourceId,
  previewId?: PreviewId | null,
): Promise<Result<Record<string, string>, ResolveError | RefMissingResourceError>> {
  // Var bags always come from the project's persistent environment — a
  // preview inherits production's vars verbatim (it is not an environment);
  // only its RESOURCE refs may re-resolve to preview-scoped branches.
  const envId = (await getProjectRecord(projectId))?.environmentId;
  if (!envId) {
    return Result.err(new RefMissingResourceError({ refResourceName: "environment" }));
  }

  const ctx: ResolveContext = {
    projectId,
    environmentId: envId,
    previewId: previewId ?? null,
    visited: new Set([serviceResourceId]),
    exportsCache: new Map(),
  };

  const record = await getServiceRecord(projectId, serviceResourceId);
  if (!record) {
    return Result.err(new RefMissingResourceError({ refResourceName: "(self)" }));
  }
  return resolveEnvFor(record, ctx);
}

/**
 * A service's env rows for the active environment, in precedence order:
 *   legacy NULL-env rows  <  active-env rows
 * (later overrides earlier, by key). NULL-env rows are pre-backfill leftovers
 * treated as a universal fallback, so production resolves identically before
 * the environment backfill runs.
 */
function overlayServiceEnv(
  rows: ServiceEnvVarRow[],
  environmentId: EnvironmentId,
): ServiceEnvVarRow[] {
  const byKey = new Map<string, ServiceEnvVarRow>();
  for (const r of rows) if (r.environmentId == null) byKey.set(r.key, r);
  for (const r of rows) if (r.environmentId === environmentId) byKey.set(r.key, r);
  return [...byKey.values()];
}

async function resolveEnvFor(
  record: ServiceRecord,
  ctx: ResolveContext,
): Promise<Result<Record<string, string>, ResolveError>> {
  const resolved: Record<string, string> = {};

  // Base overlay (legacy NULL-env < active persistent env), then — inside a
  // preview — that preview's per-service overrides win by key. Overrides are
  // fetched here (not via record.env) so they stay invisible to every base
  // surface by construction.
  let rows = overlayServiceEnv(record.env, ctx.environmentId);
  if (ctx.previewId) {
    const overrides = await listPreviewServiceEnvVars(
      record.service.resourceId as ResourceId,
      ctx.previewId,
    );
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const r of overrides) byKey.set(r.key, r);
    rows = [...byKey.values()];
  }

  for (const envVar of rows) {
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
    if (subbed.isErr()) return Result.err(subbed.error);
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
    if (exportsResult.isErr()) return Result.err(exportsResult.error);

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
  // Magic scopes: `project` and `environment` aren't real resources but
  // env-var bags shared across every service in the (project, environment)
  // pair. Both resolve from the same underlying projectEnvVar table today
  // — semantic split is preserved so when multi-env-per-project lands,
  // `environment` can specialize without breaking existing service envs.
  if (refResourceName === "project" || refResourceName === "environment") {
    const cacheKey = `__${refResourceName}__`;
    const cached = ctx.exportsCache.get(cacheKey);
    if (cached) return Result.ok(cached);
    return loadScopeExports(refResourceName, cacheKey, ctx);
  }

  const resourceRow = await resolveResourceForPreview(
    ctx.projectId,
    ctx.previewId,
    refResourceName,
  );
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

async function loadScopeExports(
  _refResourceName: "project" | "environment",
  cacheKey: string,
  ctx: ResolveContext,
): Promise<Result<Record<string, string>, ResolveError>> {
  // The bag is keyed by (projectId, environmentId) — the persistent env's own
  // vars. Previews read the same bag (they are not environments).
  const bag: Record<string, string> = {};
  Object.assign(
    bag,
    await loadProjectEnvBag({ projectId: ctx.projectId, environmentId: ctx.environmentId }),
  );
  ctx.exportsCache.set(cacheKey, bag);
  return Result.ok(bag);
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
  if (nestedResult.isErr()) return Result.err(nestedResult.error);

  const exports = serviceExports({
    resource: resourceRow,
    service: record.service,
    ports: record.ports,
    resolvedEnv: nestedResult.value,
  });
  ctx.exportsCache.set(resourceRow.id, exports);
  return Result.ok(exports);
}
