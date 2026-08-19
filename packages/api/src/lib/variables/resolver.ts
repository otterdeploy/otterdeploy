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

import { listProxyRoutesByResourceId } from "../../caddy/queries";
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
  type ResolveError,
} from "../../routers/service/errors";
import {
  getComposeStackByName,
  getStackChildByComposeService,
  listPreviewServiceEnvVars,
  getServiceRecord,
  resolveResourceForPreview,
  type ResourceRow,
  type ServiceRecord,
} from "../../routers/service/queries";
import { decryptForDomain } from "../crypto";
import { postgresExports, serviceExports } from "./exporters";
import { parseValue, type RefToken, type Token } from "./parser";
import { overlayServiceEnv, substituteTokens } from "./substitute";
import { createVaultState, loadVaultValues, type VaultResolveState } from "./vault-resolve";
interface ResolveContext {
  projectId: ProjectId;
  // The persistent environment whose var bags apply (the project's default
  // env). Drives the env-var overlay for user-managed environments.
  environmentId: EnvironmentId;
  // Preview scoping for RESOURCE lookups: a preview-scoped row (an opt-in DB
  // branch) wins over the base row; null resolves base rows only. Previews
  // are NOT environments. Their var bags are the base env's, unchanged.
  previewId: PreviewId | null;
  visited: Set<string>;
  exportsCache: Map<string, Record<string, string>>;
  // `${{vault.<provider>.<ref>}}` state: provider rows load once per
  // resolve, fetched values live only for this resolve's duration.
  vault: VaultResolveState;
}

export async function resolveServiceEnv(
  projectId: ProjectId,
  serviceResourceId: ResourceId,
  previewId?: PreviewId | null,
): Promise<Result<Record<string, string>, ResolveError | RefMissingResourceError>> {
  // Var bags always come from the project's persistent environment. A
  // preview inherits production's vars verbatim (it is not an environment);
  // only its RESOURCE refs may re-resolve to preview-scoped branches.
  const projectRecord = await getProjectRecord(projectId);
  const envId = projectRecord?.environmentId;
  if (!envId) {
    return Result.err(new RefMissingResourceError({ refResourceName: "environment" }));
  }

  const ctx: ResolveContext = {
    projectId,
    environmentId: envId,
    previewId: previewId ?? null,
    visited: new Set([serviceResourceId]),
    exportsCache: new Map(),
    // Vault providers are org-scoped; the project row carries the org.
    vault: createVaultState(projectRecord.organizationId ?? null),
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

  // Base overlay (legacy NULL-env < active persistent env), then: inside a
  // preview: that preview's per-service overrides win by key. Overrides are
  // fetched here (not via record.env) so they stay invisible to every base
  // surface by construction.
  let rows = overlayServiceEnv(record.env, ctx.environmentId);
  if (ctx.previewId) {
    const overrides = await listPreviewServiceEnvVars(record.service.resourceId, ctx.previewId);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const r of overrides) byKey.set(r.key, r);
    rows = [...byKey.values()];
  }

  // First pass: parse every row up-front so vault refs can be fetched in
  // provider-grouped batches (one login/read per provider) before any
  // substitution runs.
  const parsedRows: Array<{ key: string; tokens: Token[] }> = [];
  for (const envVar of rows) {
    // Sealed vars store a ciphertext envelope, not a template string. This
    // IS the deploy/injection boundary, so decrypt here (and nowhere a
    // list/read API surface can reach) before any template parsing.
    const rawValue = envVar.sealed
      ? await decryptForDomain(envVar.value, "env-vars")
      : envVar.value;

    const parsed = parseValue(rawValue);
    if (!parsed.ok) {
      return Result.err(
        new RefParseError({
          key: envVar.key,
          position: parsed.error.position,
          message: parsed.error.message,
        }),
      );
    }
    parsedRows.push({ key: envVar.key, tokens: parsed.tokens });
  }

  const vaultLoaded = await loadVaultValues(
    parsedRows.flatMap((row) => row.tokens),
    ctx.vault,
  );
  if (vaultLoaded.isErr()) return Result.err(vaultLoaded.error);

  const callerStackId = record.service.stackId ?? null;
  for (const row of parsedRows) {
    const subbed = await substituteTokens(row.tokens, ctx.vault, (token) =>
      loadExports(token, ctx, callerStackId),
    );
    if (subbed.isErr()) return Result.err(subbed.error);
    resolved[row.key] = subbed.value;
  }

  return Result.ok(resolved);
}

async function loadExports(
  token: RefToken,
  ctx: ResolveContext,
  callerStackId: ResourceId | null,
): Promise<Result<Record<string, string>, ResolveError>> {
  const refResourceName = token.resource;
  const refVarName = token.var;

  // Stack-scoped form: `${{stack.db.HOST}}` (sibling in the caller's own
  // stack) or `${{autumn.db.HOST}}` (that stack by resource name). The child
  // is addressed by its COMPOSE service key, which survives the resource-name
  // fallbacks and hostname renames that break every other identifier.
  if (token.stack) {
    const display = `${token.stack.name ?? "stack"}.${token.resource}`;
    const stackResourceId =
      token.stack.name === null
        ? callerStackId
        : ((await getComposeStackByName(ctx.projectId, token.stack.name))?.id ?? null);
    const child = stackResourceId
      ? await getStackChildByComposeService(ctx.projectId, stackResourceId, token.resource)
      : undefined;
    if (!child) return Result.err(new RefMissingResourceError({ refResourceName: display }));
    return loadResourceExports(child, display, ctx, refVarName);
  }

  // Magic scopes: `project` and `environment` aren't real resources but
  // env-var bags shared across every service in the (project, environment)
  // pair. Both resolve from the same underlying projectEnvVar table today.
  // Semantic split is preserved so when multi-env-per-project lands,
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
  if (!resourceRow) return Result.err(new RefMissingResourceError({ refResourceName }));
  return loadResourceExports(resourceRow, refResourceName, ctx, refVarName);
}

/** Shared tail of both ref forms: cycle guard, cache, and the per-type
 *  exporter for an already-located resource row. */
async function loadResourceExports(
  resourceRow: ResourceRow,
  refResourceName: string,
  ctx: ResolveContext,
  refVarName: string,
): Promise<Result<Record<string, string>, ResolveError>> {
  if (ctx.visited.has(resourceRow.id)) {
    // A ref back into a resource that is currently resolving. Only the env-var
    // exports actually recurse; the computed service exports (HOST / PORT /
    // URL / DOMAIN / PUBLIC_URL / DOMAINS) derive from the service record, its
    // ports and its proxy routes alone. Serve those, so a service can point
    // e.g. BETTER_AUTH_URL at its own PUBLIC_URL, and only report a true
    // cycle when the requested var needs the env bag.
    if (resourceRow.type === "service") {
      const computed = await loadServiceExports(resourceRow, refResourceName, ctx, true);
      if (computed.isErr()) return computed;
      if (computed.value[refVarName] !== undefined) return computed;
    }
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
  // The bag is keyed by (projectId, environmentId). The persistent env's own
  // vars. Previews read the same bag (they are not environments).
  const bag: Record<string, string> = {
    ...(await loadProjectEnvBag({ projectId: ctx.projectId, environmentId: ctx.environmentId })),
  };
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

/**
 * `envFree` skips the recursive env resolve and returns only the computed
 * exports: the cycle fallback above uses it. Env-free results are NOT
 * cached: the full record must still be built when the resource is
 * referenced outside the cycle.
 */
async function loadServiceExports(
  resourceRow: ResourceRow,
  refResourceName: string,
  ctx: ResolveContext,
  envFree = false,
): Promise<Result<Record<string, string>, ResolveError>> {
  const record = await getServiceRecord(ctx.projectId, resourceRow.id);
  if (!record) {
    return Result.err(new RefMissingResourceError({ refResourceName }));
  }

  let resolvedEnv: Record<string, string> = {};
  if (!envFree) {
    ctx.visited.add(resourceRow.id);
    const nestedResult = await resolveEnvFor(record, ctx);
    ctx.visited.delete(resourceRow.id);
    if (nestedResult.isErr()) return Result.err(nestedResult.error);
    resolvedEnv = nestedResult.value;
  }

  // Public domains (ordered primary-first) → DOMAIN / PUBLIC_URL / DOMAINS.
  const routes = await listProxyRoutesByResourceId(resourceRow.id);

  const exports = serviceExports({
    resource: resourceRow,
    service: record.service,
    ports: record.ports,
    resolvedEnv,
    domains: routes.map((r) => r.domain),
  });
  if (!envFree) ctx.exportsCache.set(resourceRow.id, exports);
  return Result.ok(exports);
}
