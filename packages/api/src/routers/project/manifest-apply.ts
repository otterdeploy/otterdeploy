/**
 * Reconciler — execute a manifest diff plan against the project's
 * resources. Calls the existing service/database handlers so the wire
 * path is identical to the equivalent UI clicks; the manifest just
 * decides what to call.
 *
 * Execution order:
 *   1. Database creates                     (services may reference them)
 *   2. Resolve refs in service env values   (database rows exist by step 1)
 *   3. Service creates
 *   4. Service updates (fields + env)
 *   5. Database updates (publicEnabled + extraEnv)
 *   6. Service deletes
 *   7. Database deletes
 *
 * Phase 4 boundary — Phase 5 will fold deployment progress streaming
 * back into the response, Phase 6 wires CLI consumption.
 */

import type { OrganizationId, ProjectId, ResourceId } from "@otterdeploy/shared/id";

import { and, eq } from "drizzle-orm";
import { Result } from "better-result";
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import {
  databaseResource,
  deployment,
  project,
  resource,
  serviceResource,
} from "@otterdeploy/db/schema/project";
import { gitInstallation, gitRepo } from "@otterdeploy/db/schema/git";
import { triggerDeploy } from "@otterdeploy/jobs";

import { fetchBranchHeadSha } from "../../git/github-app";
import {
  type Change,
  type CurrentState,
  diffManifest,
  isSecretSentinel,
  parseRefs,
  type Manifest,
  type ServiceManifest,
  type DatabaseManifest,
} from "../../stack/manifest";
import { ManifestApplySkipError } from "./errors";
import { deleteResourceById } from "./queries";
import { createPostgresResourceStream, validatePostgresCreate } from "./postgres/create-stream";
import { setPostgresExtensions } from "./postgres/extensions";
import {
  applyPostgresExtraEnv,
  setPostgresPublic,
} from "./postgres/env";
import {
  bulkSetEnv,
  createService,
  deleteService,
  updateService,
} from "../service/handlers";

type OrgId = OrganizationId;

export interface ApplyResult {
  appliedCount: number;
  skipped: Array<{ resource: "service" | "database" | "env"; name: string; reason: string }>;
  lastAppliedAt: string;
}

export interface ApplyInput {
  projectId: ProjectId;
  organizationId: OrgId;
  manifest: Manifest;
  current: CurrentState;
  log: RequestLogger;
}

export async function applyManifest(input: ApplyInput): Promise<ApplyResult> {
  const { projectId, organizationId, manifest, current, log } = input;
  const skipped: ManifestApplySkipError[] = [];
  let appliedCount = 0;

  const changes = diffManifest(manifest, current);
  const byKind = groupChanges(changes);

  // Per-step result handler — Result.err contributes to skipped[],
  // Result.ok bumps the applied counter. Keeps the orchestrator's
  // control flow free of per-call if/else branches.
  const tally = (result: Result<unknown, ManifestApplySkipError>): void => {
    if (result.isOk()) appliedCount += 1;
    else skipped.push(result.error);
  };

  // ── 1. Database creates ─────────────────────────────────────────────
  for (const change of byKind.databaseCreates) {
    const spec = manifest.databases[change.name];
    if (!spec) continue;
    tally(await createDatabase({ projectId, organizationId, name: change.name, spec, log }));
  }

  // ── 2. Build the ref-resolution table for service env ────────────────
  // Databases created in step 1 (and any pre-existing ones) live in DB
  // rows by now; build a lookup of ${database:<name>.<field>} and
  // ${service:<name>.<field>} values for substitution at write time.
  const refTable = await loadRefTable(projectId);

  // ── 3. Service creates ──────────────────────────────────────────────
  // Git-sourced services land in the DB with a `pending:initial` image and
  // skip swarm (provisionFresh) — they only become real once the builder
  // clones + builds + pushes + rolls the swarm service. Collect them so we
  // can enqueue that build below; without this a UI "Deploy" creates the
  // row but nothing ever builds (the node sits at "pending create").
  const gitBuilds: Array<{ resourceId: ResourceId; name: string }> = [];
  for (const change of byKind.serviceCreates) {
    const spec = manifest.services[change.name];
    if (!spec) continue;
    const resolved = resolveEnv(
      change.name,
      spec.env,
      refTable,
      current.services[change.name]?.env ?? {},
    );
    for (const s of resolved.skipped) skipped.push(s);
    const created = await createServiceFromManifest({
      projectId,
      organizationId,
      name: change.name,
      spec,
      env: resolved.values,
      log,
    });
    tally(created);
    if (created.isOk() && spec.source === "git") {
      gitBuilds.push({ resourceId: created.value.resourceId, name: change.name });
    }
  }

  // ── 4. Service updates (fields + env) ────────────────────────────────
  for (const change of byKind.serviceUpdates) {
    const spec = manifest.services[change.name];
    const existingId = await lookupServiceId(projectId, change.name);
    if (!spec || !existingId) continue;
    const resolved = resolveEnv(
      change.name,
      spec.env,
      refTable,
      current.services[change.name]?.env ?? {},
    );
    for (const s of resolved.skipped) skipped.push(s);
    tally(
      await updateServiceFromManifest({
        projectId,
        organizationId,
        name: change.name,
        resourceId: existingId,
        spec,
        env: resolved.values,
        log,
      }),
    );
    // A git service that was created but never successfully built sits on a
    // `pending:*` image with no deployment. Builds normally fire only on
    // create (or git push), so without this a "Deploy" on such a stuck
    // service no-ops forever. If it's still pending, enqueue the build now.
    if (spec.source === "git") {
      const [svc] = await db
        .select({ image: serviceResource.image })
        .from(serviceResource)
        .where(eq(serviceResource.resourceId, existingId))
        .limit(1);
      if (svc?.image.startsWith("pending:")) {
        gitBuilds.push({ resourceId: existingId, name: change.name });
      }
    }
  }

  // ── 5. Database updates ─────────────────────────────────────────────
  for (const change of byKind.databaseUpdates) {
    const spec = manifest.databases[change.name];
    const existingId = await lookupDatabaseId(projectId, change.name);
    if (!spec || !existingId) continue;
    tally(
      await updateDatabaseFromManifest({
        projectId,
        organizationId,
        name: change.name,
        resourceId: existingId,
        spec,
        currentExtraEnv: current.databases[change.name]?.extraEnv ?? {},
        log,
      }),
    );
  }

  // ── 6 + 7. Deletes (services then databases) ─────────────────────────
  for (const change of byKind.serviceDeletes) {
    const existingId = await lookupServiceId(projectId, change.name);
    if (!existingId) continue;
    const result = await deleteService({ projectId, organizationId, resourceId: existingId }, log);
    if (result.isOk()) appliedCount += 1;
    else
      skipped.push(
        new ManifestApplySkipError({
          resource: "service",
          name: change.name,
          reason: `delete failed: ${result.error.name}`,
        }),
      );
  }
  for (const change of byKind.databaseDeletes) {
    const existingId = await lookupDatabaseId(projectId, change.name);
    if (!existingId) continue;
    await db.delete(resource).where(eq(resource.id, existingId));
    appliedCount += 1;
  }

  // ── Enqueue builds for git-sourced service creates ───────────────────
  // Mirrors the git-push path (git/handle-push.ts): resolve the production
  // branch head, insert a deployment row, and enqueue `deploy.triggered`
  // so the builder clones → builds → pushes → rolls swarm. A failure here
  // means the resource exists but won't build, so it joins skipped[] for
  // the operator to see.
  for (const b of gitBuilds) {
    const enqueued = await enqueueGitBuild({
      projectId,
      organizationId,
      resourceId: b.resourceId,
      log,
    });
    if (enqueued.isErr()) {
      skipped.push(
        new ManifestApplySkipError({
          resource: "service",
          name: b.name,
          reason: `created but build not started: ${enqueued.error}`,
        }),
      );
    }
  }

  await db
    .update(project)
    .set({ lastAppliedManifest: manifest, lastManifestAppliedAt: new Date() })
    .where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)));

  return {
    appliedCount,
    skipped: skipped.map((e) => ({
      resource: e.resource,
      name: e.name,
      reason: e.reason,
    })),
    lastAppliedAt: new Date().toISOString(),
  };
}

// ── Group changes by kind for the orchestrator ─────────────────────────

interface GroupedChanges {
  serviceCreates: Change[];
  serviceUpdates: Change[];
  serviceDeletes: Change[];
  databaseCreates: Change[];
  databaseUpdates: Change[];
  databaseDeletes: Change[];
}

function groupChanges(changes: Change[]): GroupedChanges {
  const out: GroupedChanges = {
    serviceCreates: [],
    serviceUpdates: [],
    serviceDeletes: [],
    databaseCreates: [],
    databaseUpdates: [],
    databaseDeletes: [],
  };
  for (const c of changes) {
    if (c.kind === "no-op") continue;
    if (c.resource === "service") {
      if (c.kind === "create") out.serviceCreates.push(c);
      else if (c.kind === "update") out.serviceUpdates.push(c);
      else if (c.kind === "delete") out.serviceDeletes.push(c);
    } else if (c.resource === "database") {
      if (c.kind === "create") out.databaseCreates.push(c);
      else if (c.kind === "update") out.databaseUpdates.push(c);
      else if (c.kind === "delete") out.databaseDeletes.push(c);
    }
    // env changes are handled per-service inside resolveEnv → bulkSetEnv;
    // we don't need to track them at the orchestrator level.
  }
  return out;
}

// ── Ref resolution ─────────────────────────────────────────────────────

interface RefTable {
  databases: Map<string, DatabaseRefView>;
  services: Map<string, { host: string }>;
}

interface DatabaseRefView {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  url: string;
}

async function loadRefTable(projectId: ProjectId): Promise<RefTable> {
  const [dbRows, svcRows] = await Promise.all([
    db
      .select({ resource, database: databaseResource })
      .from(resource)
      .innerJoin(databaseResource, eq(databaseResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
    db
      .select({ resource, service: serviceResource })
      .from(resource)
      .innerJoin(serviceResource, eq(serviceResource.resourceId, resource.id))
      .where(eq(resource.projectId, projectId)),
  ]);

  const databases = new Map<string, DatabaseRefView>();
  for (const row of dbRows) {
    databases.set(row.resource.name, {
      host: row.database.internalHostname,
      port: row.database.internalPort,
      username: row.database.username,
      password: row.database.password,
      database: row.database.databaseName,
      url: row.database.internalConnectionString,
    });
  }

  const services = new Map<string, { host: string }>();
  for (const row of svcRows) {
    services.set(row.resource.name, { host: row.service.internalHostname });
  }

  return { databases, services };
}

// ── Git build enqueue (UI "Deploy" of a git-sourced service) ───────────
//
// The git-push webhook (git/handle-push.ts) is the only other place that
// kicks a build; this is its UI-triggered twin. We resolve the head SHA of
// the project's production branch ourselves (no push payload to read it
// from), insert a pending deployment row keyed to the resource, and enqueue
// the build job. Errors are returned as strings so the caller can fold them
// into skipped[] without a typed-error taxonomy for every GitHub failure.
export async function enqueueGitBuild(args: {
  projectId: ProjectId;
  organizationId: OrgId;
  resourceId: ResourceId;
  log: RequestLogger;
}): Promise<Result<{ deploymentId: string }, string>> {
  const [proj] = await db
    .select({
      gitRepoId: project.gitRepoId,
      productionBranch: project.productionBranch,
      imageRepository: project.imageRepository,
      containerRegistryId: project.containerRegistryId,
    })
    .from(project)
    .where(
      and(eq(project.id, args.projectId), eq(project.organizationId, args.organizationId)),
    )
    .limit(1);
  if (!proj?.gitRepoId) return Result.err("project has no git repo binding");
  // Registry binding is optional — the builder defaults to a registry-less
  // local image (built straight into the swarm node's daemon). Only an
  // external registry needs imageRepository + containerRegistryId, and the
  // builder resolves that itself; no gate here.

  const [repo] = await db
    .select({
      fullName: gitRepo.fullName,
      defaultBranch: gitRepo.defaultBranch,
      installationRowId: gitRepo.installationId,
    })
    .from(gitRepo)
    .where(eq(gitRepo.id, proj.gitRepoId))
    .limit(1);
  if (!repo) return Result.err("git repo not found");

  // Resolve an installation token only when the repo is linked to one.
  // With no installation we build anonymously — the head-SHA lookup below
  // and the builder's clone both fall back to unauthenticated access, which
  // works for public repos. A genuinely private repo with no installation
  // fails the SHA lookup with a clear 404 below; we deliberately don't
  // pre-judge on the `is_private` flag, which defaults to true and is often
  // stale/wrong (a public repo can be recorded as private).
  let installationId: string | null = null;
  if (repo.installationRowId) {
    const [inst] = await db
      .select({ installationId: gitInstallation.installationId })
      .from(gitInstallation)
      .where(eq(gitInstallation.id, repo.installationRowId))
      .limit(1);
    if (!inst) return Result.err("git installation not found");
    installationId = inst.installationId;
  }

  const branch = proj.productionBranch || repo.defaultBranch || "main";
  const [owner, repoName] = repo.fullName.split("/");
  if (!owner || !repoName) {
    return Result.err(`unexpected repo full name: ${repo.fullName}`);
  }

  // fetchBranchHeadSha throws on failure (github-app.ts idiom); wrap it so
  // GitHub/network errors fold into skipped[] rather than aborting apply.
  const shaResult = await Result.tryPromise({
    try: () => fetchBranchHeadSha(installationId, owner, repoName, branch),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  });
  if (shaResult.isErr()) {
    return Result.err(`could not resolve ${branch} head: ${shaResult.error}`);
  }
  const sha = shaResult.value;

  const ref = `refs/heads/${branch}`;
  const [row] = await db
    .insert(deployment)
    .values({
      resourceId: args.resourceId,
      // Rewritten to the real registry tag by the builder once known.
      image: `pending:${sha.slice(0, 12)}`,
      reason: "create" as const,
      status: "pending" as const,
      gitSha: sha,
      gitRef: ref,
    })
    .returning({ id: deployment.id });
  if (!row) return Result.err("failed to insert deployment row");

  await triggerDeploy({
    projectId: args.projectId,
    gitRepoId: proj.gitRepoId,
    ref,
    sha,
    deploymentIds: [row.id],
  });
  args.log.set({ manifestBuild: { resourceId: args.resourceId, sha, ref } });
  return Result.ok({ deploymentId: row.id });
}

interface ResolvedEnv {
  values: Array<{ key: string; value: string }>;
  skipped: ManifestApplySkipError[];
}

function resolveEnv(
  serviceName: string,
  desired: Record<string, string> | undefined,
  refs: RefTable,
  currentServerEnv: Record<string, string>,
): ResolvedEnv {
  const values: ResolvedEnv["values"] = [];
  const skipped: ManifestApplySkipError[] = [];

  for (const [key, raw] of Object.entries(desired ?? {})) {
    if (isSecretSentinel(raw)) {
      const existing = currentServerEnv[key];
      if (existing === undefined) {
        skipped.push(
          new ManifestApplySkipError({
            resource: "env",
            name: `${serviceName}.${key}`,
            reason:
              "declared as ${secret} but no value set — run `otterdeploy env set` before applying",
          }),
        );
        continue;
      }
      values.push({ key, value: existing });
      continue;
    }

    const substituted = interpolate(raw, refs);
    if (substituted.unresolved.length > 0) {
      skipped.push(
        new ManifestApplySkipError({
          resource: "env",
          name: `${serviceName}.${key}`,
          reason: `unresolved reference(s): ${substituted.unresolved.join(", ")}`,
        }),
      );
      continue;
    }
    values.push({ key, value: substituted.value });
  }

  return { values, skipped };
}

function interpolate(raw: string, refs: RefTable): { value: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const tokens = parseRefs(raw);
  if (tokens.length === 0) return { value: raw, unresolved };

  const out = raw.replace(/\$\{([^}]+)\}/g, (whole, body: string) => {
    if (body === "secret") return whole; // handled upstream
    const colonIdx = body.indexOf(":");
    if (colonIdx === -1) {
      unresolved.push(whole);
      return whole;
    }
    const namespace = body.slice(0, colonIdx);
    const rest = body.slice(colonIdx + 1);
    const dotIdx = rest.indexOf(".");
    if (dotIdx === -1) {
      unresolved.push(whole);
      return whole;
    }
    const name = rest.slice(0, dotIdx);
    const tail = rest.slice(dotIdx + 1);

    if (namespace === "database") {
      const dbRef = refs.databases.get(name);
      if (!dbRef) {
        unresolved.push(`\${database:${name}.${tail}} (database not found)`);
        return whole;
      }
      const value = (dbRef as unknown as Record<string, unknown>)[tail];
      if (value === undefined) {
        unresolved.push(whole);
        return whole;
      }
      return String(value);
    }

    if (namespace === "service") {
      const svcRef = refs.services.get(name);
      if (!svcRef) {
        unresolved.push(`\${service:${name}.${tail}} (service not found)`);
        return whole;
      }
      if (tail === "host") return svcRef.host;
      // service-env and port refs land here — Phase 5 will extend the
      // ref table; for now they remain unresolved.
      unresolved.push(whole);
      return whole;
    }

    unresolved.push(whole);
    return whole;
  });

  return { value: out, unresolved };
}

// ── Service create/update via existing handlers ────────────────────────

interface CreateServiceArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  spec: ServiceManifest;
  env: Array<{ key: string; value: string }>;
  log: RequestLogger;
}

async function createServiceFromManifest(
  args: CreateServiceArgs,
): Promise<Result<{ resourceId: ResourceId }, ManifestApplySkipError>> {
  // Git-sourced services start with a placeholder image — the builder
  // overwrites it on first build. The existing handler accepts the
  // placeholder; we still pass the manifest's command/entrypoint.
  const image = args.spec.source === "image" ? args.spec.image : "pending:initial";
  const result = await createService(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      name: args.name,
      source: args.spec.source,
      // A git create on an unbound project should still land as a
      // `pending:initial` row (swarm skipped) — the missing build binding
      // surfaces below as a non-fatal "build not started" skip, not a hard
      // create failure that leaves the ghost stuck forever.
      skipBuildBindingCheck: true,
      sourceSubdir: args.spec.source === "git" ? (args.spec.sourceSubdir ?? null) : null,
      image,
      command: args.spec.startCommand ?? null,
      entrypoint: args.spec.entrypoint ?? null,
      replicas: args.spec.replicas ?? 1,
      ports:
        args.spec.ports?.map((p) => ({
          containerPort: p.container,
          protocol: p.protocol,
          appProtocol: p.appProtocol,
          isPrimary: p.primary,
        })) ?? [],
      env: args.env.length > 0 ? args.env : undefined,
      healthcheck: args.spec.healthcheck
        ? {
            cmd: args.spec.healthcheck.cmd,
            intervalMs: args.spec.healthcheck.intervalMs ?? null,
            timeoutMs: args.spec.healthcheck.timeoutMs ?? null,
            retries: args.spec.healthcheck.retries ?? null,
            startMs: args.spec.healthcheck.startMs ?? null,
          }
        : undefined,
      restart: args.spec.restart,
      resources: args.spec.resources
        ? {
            cpuLimit: args.spec.resources.cpuLimit ?? null,
            memoryLimitMb: args.spec.resources.memoryMb ?? null,
            cpuReservation: args.spec.resources.cpuReservation ?? null,
            memoryReservationMb: args.spec.resources.memoryReservationMb ?? null,
            diskLimitMb: args.spec.resources.diskMb ?? null,
            swapLimitMb: args.spec.resources.swapMb ?? null,
            pidsLimit: args.spec.resources.pidsLimit ?? null,
          }
        : undefined,
      preDeploy: args.spec.preDeploy ?? null,
      buildConfig: args.spec.source === "git" ? (args.spec.build ?? null) : null,
    },
    args.log,
  );
  if (result.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "service",
        name: args.name,
        reason: `create failed: ${result.error.message}`,
      }),
    );
  }
  return Result.ok({ resourceId: result.value.id as ResourceId });
}

interface UpdateServiceArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  resourceId: ResourceId;
  spec: ServiceManifest;
  env: Array<{ key: string; value: string }>;
  log: RequestLogger;
}

async function updateServiceFromManifest(
  args: UpdateServiceArgs,
): Promise<Result<{ resourceId: ResourceId }, ManifestApplySkipError>> {
  const patch =
    args.spec.source === "image"
      ? { image: args.spec.image }
      : { /* git: image is builder-managed */ };

  const updated = await updateService(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      resourceId: args.resourceId,
      ...patch,
      command: args.spec.startCommand ?? undefined,
      entrypoint: args.spec.entrypoint ?? undefined,
      replicas: args.spec.replicas,
      ports:
        args.spec.ports?.map((p) => ({
          containerPort: p.container,
          protocol: p.protocol,
          appProtocol: p.appProtocol,
          isPrimary: p.primary,
        })),
      restart: args.spec.restart,
      healthcheck: args.spec.healthcheck
        ? {
            cmd: args.spec.healthcheck.cmd,
            intervalMs: args.spec.healthcheck.intervalMs ?? null,
            timeoutMs: args.spec.healthcheck.timeoutMs ?? null,
            retries: args.spec.healthcheck.retries ?? null,
            startMs: args.spec.healthcheck.startMs ?? null,
          }
        : undefined,
      resources: args.spec.resources
        ? {
            cpuLimit: args.spec.resources.cpuLimit ?? null,
            memoryLimitMb: args.spec.resources.memoryMb ?? null,
            cpuReservation: args.spec.resources.cpuReservation ?? null,
            memoryReservationMb: args.spec.resources.memoryReservationMb ?? null,
            diskLimitMb: args.spec.resources.diskMb ?? null,
            swapLimitMb: args.spec.resources.swapMb ?? null,
            pidsLimit: args.spec.resources.pidsLimit ?? null,
          }
        : undefined,
      preDeploy: args.spec.preDeploy ?? null,
      buildConfig: args.spec.source === "git" ? (args.spec.build ?? null) : null,
    },
    args.log,
  );
  if (updated.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "service",
        name: args.name,
        reason: `update failed: ${updated.error.message}`,
      }),
    );
  }

  // Reconcile env wholesale — bulkSetEnv replaces the set with what we pass.
  const envResult = await bulkSetEnv(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      resourceId: args.resourceId,
      vars: args.env,
    },
    args.log,
  );
  if (envResult.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "service",
        name: args.name,
        reason: `env reconcile failed: ${envResult.error.message}`,
      }),
    );
  }
  return Result.ok({ resourceId: args.resourceId });
}

// ── Database create/update ─────────────────────────────────────────────

interface CreateDatabaseArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  spec: DatabaseManifest;
  log: RequestLogger;
}

async function createDatabase(
  args: CreateDatabaseArgs,
): Promise<Result<{ name: string }, ManifestApplySkipError>> {
  const validation = await validatePostgresCreate({
    projectId: args.projectId,
    organizationId: args.organizationId,
    name: args.name,
  });
  if (validation.isErr()) {
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason: `validation failed: ${validation.error.message}`,
      }),
    );
  }

  // Drain the create stream to completion — the manifest apply path
  // doesn't surface per-step progress (Phase 6 will).
  const stream = createPostgresResourceStream(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      name: args.name,
      engine: args.spec.engine,
      publicEnabled: args.spec.publicEnabled ?? false,
      project: validation.value.project,
    },
    args.log,
  );

  let success = false;
  let errorMessage: string | null = null;
  let createdResourceId: ResourceId | null = null;
  for await (const event of stream) {
    if (event.type === "created") {
      createdResourceId = event.resource.resourceId as ResourceId;
    }
    if (event.type === "done") success = true;
    if (event.type === "error") errorMessage = event.message;
  }
  if (!success) {
    // Roll back the draft row a failed create left behind. Otherwise the
    // half-created database lands in loadCurrentState, the next diff sees
    // the manifest entry as already-existing and flips create → no-op: the
    // ghost vanishes and the operator can never cleanly retry.
    if (createdResourceId) await deleteResourceById(createdResourceId);
    return Result.err(
      new ManifestApplySkipError({
        resource: "database",
        name: args.name,
        reason: errorMessage ?? "create stream ended without done event",
      }),
    );
  }

  // extraEnv + extensions come after creation — the create stream doesn't
  // accept them as input today, so we apply them as second steps. Both
  // need the resource id, so resolve it once.
  const needsExtraEnv =
    args.spec.extraEnv && Object.keys(args.spec.extraEnv).length > 0;
  const specExtensions = manifestExtensions(args.spec);
  if (needsExtraEnv || specExtensions.length > 0) {
    const dbId = await lookupDatabaseId(args.projectId, args.name);
    if (dbId && needsExtraEnv) {
      await applyPostgresExtraEnv(
        {
          projectId: args.projectId,
          organizationId: args.organizationId,
          resourceId: dbId,
          nextExtraEnv: args.spec.extraEnv ?? {},
        },
        args.log,
      );
    }
    if (dbId && specExtensions.length > 0) {
      await setPostgresExtensions(
        {
          projectId: args.projectId,
          organizationId: args.organizationId,
          resourceId: dbId,
          extensions: specExtensions,
        },
        args.log,
      );
    }
  }

  return Result.ok({ name: args.name });
}

/** Extensions only exist on the postgres manifest variant — read them off
 *  the spec without assuming the discriminant has been narrowed. */
function manifestExtensions(spec: DatabaseManifest): string[] {
  const value = (spec as { extensions?: unknown }).extensions;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface UpdateDatabaseArgs {
  projectId: ProjectId;
  organizationId: OrgId;
  name: string;
  resourceId: ResourceId;
  spec: DatabaseManifest;
  currentExtraEnv: Record<string, string>;
  log: RequestLogger;
}

async function updateDatabaseFromManifest(
  args: UpdateDatabaseArgs,
): Promise<Result<{ name: string }, ManifestApplySkipError>> {
  const desiredPublic = args.spec.publicEnabled ?? false;
  await setPostgresPublic(
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      resourceId: args.resourceId,
      publicEnabled: desiredPublic,
    },
    args.log,
  );

  const desiredExtra = args.spec.extraEnv ?? {};
  if (!shallowEqual(desiredExtra, args.currentExtraEnv)) {
    await applyPostgresExtraEnv(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        nextExtraEnv: desiredExtra,
      },
      args.log,
    );
  }

  // Reconcile extensions to the manifest's desired set. setPostgresExtensions
  // is idempotent (diffs against the current list), so calling it
  // unconditionally is safe — but skip when the manifest declares none and
  // the resource also has none, to avoid a no-op redeploy.
  const desiredExtensions = manifestExtensions(args.spec);
  if (desiredExtensions.length > 0) {
    await setPostgresExtensions(
      {
        projectId: args.projectId,
        organizationId: args.organizationId,
        resourceId: args.resourceId,
        extensions: desiredExtensions,
      },
      args.log,
    );
  }
  return Result.ok({ name: args.name });
}

// ── DB lookup helpers ──────────────────────────────────────────────────

async function lookupServiceId(projectId: ProjectId, name: string): Promise<ResourceId | null> {
  const [row] = await db
    .select({ id: serviceResource.resourceId })
    .from(serviceResource)
    .innerJoin(resource, eq(resource.id, serviceResource.resourceId))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);
  return row?.id ?? null;
}

async function lookupDatabaseId(projectId: ProjectId, name: string): Promise<ResourceId | null> {
  const [row] = await db
    .select({ id: databaseResource.resourceId })
    .from(databaseResource)
    .innerJoin(resource, eq(resource.id, databaseResource.resourceId))
    .where(and(eq(resource.projectId, projectId), eq(resource.name, name)))
    .limit(1);
  return row?.id ?? null;
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}
